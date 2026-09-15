import { createOnce } from './creation';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type WebSocket from 'ws';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { z } from 'zod';
import { clientMessage, graphCommand } from '../shared/protocol';
import type { DialogueNode } from '../shared/model';
import { hash, requireDialogue, AccessError, dialogueActor } from './access';
import { transaction } from './database';
import { applyGraph, readGraph } from './graph';
import { recordGraphAction, reverseGraph } from './history';

interface Peer {
  socket: WebSocket;
  texts: Set<string>;
  awarenessIds: Map<string, number>;
}

export function registerLive(app: FastifyInstance, pool: pg.Pool) {
  const rooms = new Map<string, Set<Peer>>();
  const queues = new Map<string, Promise<unknown>>();
  const presence = new Map<string, { doc: Y.Doc; awareness: Awareness }>();
  const send = (socket: WebSocket, message: unknown) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };
  const broadcast = (dialogueId: string, message: unknown) => {
    for (const peer of rooms.get(dialogueId) || []) send(peer.socket, message);
  };
  const enqueue = <T>(id: string, operation: () => Promise<T>) => {
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(id, next);
    void next
      .finally(() => {
        if (queues.get(id) === next) queues.delete(id);
      })
      .catch(() => {});
    return next;
  };
  const awarenessFor = (nodeId: string) => {
    let result = presence.get(nodeId);
    if (!result) {
      const doc = new Y.Doc(),
        awareness = new Awareness(doc);
      awareness.setLocalState(null);
      result = { doc, awareness };
      presence.set(nodeId, result);
    }
    return result.awareness;
  };
  app.get(
    '/api/dialogues/:dialogueId/live',
    {
      websocket: true,
      preValidation: async (request) => {
        const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
        await requireDialogue(pool, request, dialogueId);
      },
    },
    (socket, request) => {
      const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
      const peer: Peer = { socket, texts: new Set(), awarenessIds: new Map() };
      const room = rooms.get(dialogueId) || new Set<Peer>();
      rooms.set(dialogueId, room);
      room.add(peer);
      socket.on('message', (raw) => {
        void enqueue(dialogueId, async () => {
          let operationId: string | undefined;
          try {
            const message = clientMessage.parse(JSON.parse(raw.toString()));
            if ('operationId' in message) operationId = message.operationId;
            if (graphCommand.safeParse(message).success) {
              const command = graphCommand.parse(message);
              const actor = await dialogueActor(pool, request, dialogueId);
              const result = await transaction(pool, async (client) => {
                await client.query('SELECT id FROM dialogues WHERE id=$1 FOR UPDATE', [dialogueId]);
                // Keep existing movement receipts compatible with migration 002.
                const payloadHash = hash(
                  JSON.stringify(command.type === 'move-nodes' ? command.positions : command),
                );
                const prior = await client.query(
                  'SELECT payload_hash FROM graph_operations WHERE dialogue_id=$1 AND operation_id=$2',
                  [dialogueId, command.operationId],
                );
                if (prior.rows[0]) {
                  if (prior.rows[0].payload_hash !== payloadHash)
                    throw new AccessError('Идентификатор операции уже использован.');
                  const receipt = await client.query(
                    'SELECT notice FROM graph_history WHERE dialogue_id=$1 AND operation_id=$2',
                    [dialogueId, command.operationId],
                  );
                  return { snapshot: null, notice: receipt.rows[0]?.notice || '' };
                }
                const result =
                  command.type === 'reverse-graph'
                    ? await reverseGraph(
                        client,
                        dialogueId,
                        command.operationId,
                        command.targetOperationId,
                        actor,
                      )
                    : {
                        snapshot: await recordGraphAction(
                          client,
                          dialogueId,
                          command.operationId,
                          actor,
                          () => applyGraph(client, dialogueId, command),
                          command,
                        ),
                        notice: '',
                      };
                await client.query(
                  'INSERT INTO graph_operations(dialogue_id,operation_id,payload_hash) VALUES ($1,$2,$3)',
                  [dialogueId, command.operationId, payloadHash],
                );
                return result;
              });
              if (result.snapshot) {
                broadcast(dialogueId, { type: 'graph', ...result.snapshot });
                if (command.type === 'move-nodes')
                  broadcast(dialogueId, { type: 'positions', positions: command.positions });
              }
              send(socket, {
                type: 'saved',
                operationId: command.operationId,
                notice: result.notice,
              });
            } else if (message.type === 'open-text') {
              const result = await pool.query(
                "SELECT text_state FROM nodes WHERE id=$1 AND dialogue_id=$2 AND deleted_at IS NULL AND kind IN ('line','choice')",
                [message.nodeId, dialogueId],
              );
              if (!result.rows[0]) throw new AccessError('Эта нода недоступна для редактирования.');
              peer.texts.add(message.nodeId);
              const doc = new Y.Doc();
              doc.getText('text');
              if (result.rows[0].text_state) Y.applyUpdate(doc, result.rows[0].text_state);
              send(socket, {
                type: 'text-state',
                nodeId: message.nodeId,
                data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
              });
              doc.destroy();
              const awareness = awarenessFor(message.nodeId);
              send(socket, {
                type: 'awareness',
                nodeId: message.nodeId,
                data: Buffer.from(
                  encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]),
                ).toString('base64'),
              });
            } else if (message.type === 'text-update') {
              if (!peer.texts.has(message.nodeId)) {
                const deleted = await pool.query(
                  'SELECT id FROM nodes WHERE id=$1 AND dialogue_id=$2 AND deleted_at IS NOT NULL',
                  [message.nodeId, dialogueId],
                );
                if (!deleted.rows.length) throw new AccessError('Сначала откройте редактор ноды.');
              }
              const actor = await dialogueActor(pool, request, dialogueId);
              const update = Buffer.from(message.data, 'base64');
              const result = await transaction(pool, async (client) => {
                const stored = await client.query(
                  'SELECT text_state,text_revision FROM nodes WHERE id=$1 AND dialogue_id=$2 FOR UPDATE',
                  [message.nodeId, dialogueId],
                );
                if (!stored.rows[0]) throw new AccessError('Нода недоступна.');
                const duplicate = await client.query(
                  'SELECT payload_hash FROM text_operations WHERE node_id=$1 AND operation_id=$2',
                  [message.nodeId, message.operationId],
                );
                if (duplicate.rows[0]) {
                  if (duplicate.rows[0].payload_hash !== hash(update))
                    throw new AccessError('Идентификатор операции уже использован.');
                  return null;
                }
                const doc = new Y.Doc();
                try {
                  doc.getText('text');
                  if (stored.rows[0].text_state) Y.applyUpdate(doc, stored.rows[0].text_state);
                  Y.applyUpdate(doc, update);
                  const preview = doc.getText('text').toString().slice(0, 240);
                  await client.query(
                    'UPDATE nodes SET text_state=$2, preview=$3, text_revision=text_revision+1 WHERE id=$1',
                    [message.nodeId, Buffer.from(Y.encodeStateAsUpdate(doc)), preview],
                  );
                  await client.query(
                    'INSERT INTO text_operations(node_id,operation_id,payload_hash,update_data,actor,revision) VALUES ($1,$2,$3,$4,$5,$6)',
                    [
                      message.nodeId,
                      message.operationId,
                      hash(update),
                      update,
                      actor,
                      BigInt(stored.rows[0].text_revision) + 1n,
                    ],
                  );
                  return preview;
                } finally {
                  doc.destroy();
                }
              });
              // Both the acknowledgement and broadcast occur strictly after COMMIT.
              if (result !== null) {
                for (const other of room)
                  if (other !== peer && other.texts.has(message.nodeId))
                    send(other.socket, {
                      type: 'text-update',
                      nodeId: message.nodeId,
                      data: message.data,
                    });
                broadcast(dialogueId, { type: 'preview', nodeId: message.nodeId, preview: result });
              }
              send(socket, {
                type: 'saved',
                nodeId: message.nodeId,
                operationId: message.operationId,
              });
            } else if (message.type === 'awareness') {
              if (!peer.texts.has(message.nodeId)) throw new AccessError('Редактор не открыт.');
              const bytes = Buffer.from(message.data, 'base64');
              const decoder = decoding.createDecoder(bytes);
              if (decoding.readVarUint(decoder) !== 1)
                throw new AccessError('Некорректное присутствие.');
              const clientId = decoding.readVarUint(decoder);
              const assigned = peer.awarenessIds.get(message.nodeId);
              if (
                (assigned !== undefined && assigned !== clientId) ||
                [...room].some((p) => p !== peer && p.awarenessIds.get(message.nodeId) === clientId)
              )
                throw new AccessError('Идентификатор присутствия занят.');
              peer.awarenessIds.set(message.nodeId, clientId);
              const awareness = awarenessFor(message.nodeId);
              applyAwarenessUpdate(awareness, bytes, socket);
              for (const other of room)
                if (other !== peer && other.texts.has(message.nodeId)) send(other.socket, message);
            }
          } catch (error) {
            send(socket, {
              type: 'error',
              operationId,
              rejected: error instanceof AccessError,
              message:
                error instanceof AccessError
                  ? error.message
                  : 'Не удалось сохранить изменение. Переподключитесь для повтора.',
            });
          }
        });
      });
      socket.on('close', () => {
        room.delete(peer);
        for (const [nodeId, clientId] of peer.awarenessIds) {
          const entry = presence.get(nodeId);
          if (!entry) continue;
          removeAwarenessStates(entry.awareness, [clientId], socket);
          const data = Buffer.from(encodeAwarenessUpdate(entry.awareness, [clientId])).toString(
            'base64',
          );
          for (const other of room)
            if (other.texts.has(nodeId)) send(other.socket, { type: 'awareness', nodeId, data });
        }
        broadcast(dialogueId, { type: 'peers', count: room.size });
        if (!room.size) {
          rooms.delete(dialogueId);
          for (const nodeId of peer.texts) {
            const entry = presence.get(nodeId);
            entry?.awareness.destroy();
            entry?.doc.destroy();
            presence.delete(nodeId);
          }
        }
      });
      socket.on('error', () => {});
      void enqueue(dialogueId, async () => {
        send(socket, { type: 'ready', ...(await readGraph(pool, dialogueId)) });
      }).catch(() => socket.close(1011));
      broadcast(dialogueId, { type: 'peers', count: room.size });
    },
  );
  app.addHook('preClose', async () => {
    for (const room of rooms.values()) for (const peer of room) peer.socket.terminate();
    await Promise.allSettled([...queues.values()]);
    for (const entry of presence.values()) {
      entry.awareness.destroy();
      entry.doc.destroy();
    }
    presence.clear();
  });
  return {
    notifyProject: async (projectId: string, graphChanged = false) => {
      const dialogues = await pool.query('SELECT id FROM dialogues WHERE project_id=$1', [
        projectId,
      ]);
      for (const dialogue of dialogues.rows)
        await enqueue(dialogue.id, async () => {
          if (graphChanged)
            broadcast(dialogue.id, { type: 'graph', ...(await readGraph(pool, dialogue.id)) });
          broadcast(dialogue.id, { type: 'project-changed' });
        });
    },
    createNode: (dialogueId: string, node: DialogueNode, actor: string, operationId?: string) =>
      enqueue(dialogueId, async () => {
        const input = { kind: node.kind, x: node.x, y: node.y };
        const result = await createOnce(
          pool,
          'dialogue:' + dialogueId + ':nodes',
          operationId,
          input,
          async (client) => {
            await client.query('SELECT id FROM dialogues WHERE id=$1 FOR UPDATE', [dialogueId]);
            return recordGraphAction(
              client,
              dialogueId,
              operationId || node.id,
              actor,
              async () => {
                await client.query(
                  'INSERT INTO nodes(id,dialogue_id,kind,x,y) VALUES ($1,$2,$3,$4,$5)',
                  [node.id, dialogueId, node.kind, node.x, node.y],
                );
                return { ...node, operationId: operationId || node.id };
              },
            );
          },
        );
        if (result.created) broadcast(dialogueId, { type: 'node', node: result.value });
        return result.value;
      }),
  };
}

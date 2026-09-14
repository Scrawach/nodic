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
import { clientMessage } from '../shared/protocol';
import type { DialogueNode } from '../shared/model';
import { hash, requireDialogue, AccessError } from './access';
import { transaction } from './database';

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
  const enqueue = (id: string, operation: () => Promise<void>) => {
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
            if (message.type === 'move-nodes') {
              const changed = await transaction(pool, async (client) => {
                await client.query('SELECT id FROM dialogues WHERE id=$1 FOR UPDATE', [dialogueId]);
                const payloadHash = hash(JSON.stringify(message.positions));
                const prior = await client.query(
                  'SELECT payload_hash FROM graph_operations WHERE dialogue_id=$1 AND operation_id=$2',
                  [dialogueId, message.operationId],
                );
                if (prior.rows[0]) {
                  if (prior.rows[0].payload_hash !== payloadHash)
                    throw new AccessError('Идентификатор операции уже использован.');
                  return false;
                }
                if (
                  new Set(message.positions.map((p) => p.nodeId)).size !== message.positions.length
                )
                  throw new AccessError('Нода указана несколько раз.');
                for (const position of message.positions) {
                  const updated = await client.query(
                    'UPDATE nodes SET x=$3,y=$4 WHERE id=$1 AND dialogue_id=$2',
                    [position.nodeId, dialogueId, position.x, position.y],
                  );
                  if (updated.rowCount !== 1) throw new AccessError('Нода недоступна.');
                }
                await client.query(
                  'INSERT INTO graph_operations(dialogue_id,operation_id,payload_hash) VALUES ($1,$2,$3)',
                  [dialogueId, message.operationId, payloadHash],
                );
                return true;
              });
              if (changed)
                broadcast(dialogueId, { type: 'positions', positions: message.positions });
              send(socket, { type: 'saved', operationId: message.operationId });
            } else if (message.type === 'open-text') {
              const result = await pool.query(
                "SELECT text_state FROM nodes WHERE id=$1 AND dialogue_id=$2 AND kind IN ('line','choice')",
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
              if (!peer.texts.has(message.nodeId))
                throw new AccessError('Сначала откройте редактор ноды.');
              const update = Buffer.from(message.data, 'base64');
              const result = await transaction(pool, async (client) => {
                const stored = await client.query(
                  'SELECT text_state FROM nodes WHERE id=$1 AND dialogue_id=$2 FOR UPDATE',
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
                    'INSERT INTO text_operations(node_id,operation_id,payload_hash,update_data) VALUES ($1,$2,$3,$4)',
                    [message.nodeId, message.operationId, hash(update), update],
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
            } else {
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
        const result = await pool.query(
          'SELECT id, kind, x, y, preview FROM nodes WHERE dialogue_id=$1 ORDER BY id',
          [dialogueId],
        );
        send(socket, { type: 'ready', nodes: result.rows });
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
    notifyNode: (dialogueId: string, node: DialogueNode) =>
      broadcast(dialogueId, { type: 'node', node }),
  };
}

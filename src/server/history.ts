import type pg from 'pg';
import type { DialogueNode, DialogueEdge } from '../shared/model';
import type { GraphCommand } from '../shared/protocol';
import { AccessError } from './access';
import { applyGraph, readGraph } from './graph';

type Value = DialogueNode | DialogueEdge | { x: number; y: number } | string | null;
type Change = {
  field: string;
  kind: 'node' | 'edge' | 'position' | 'character';
  id: string;
  before: Value;
  after: Value;
  beforeVersion: string | null;
  afterVersion: string | null;
  guards?: Record<string, string | null>;
  textBoundary?: string;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function versions(
  client: pg.PoolClient,
  dialogueId: string,
): Promise<Map<string, string | null>> {
  const result = await client.query(
    'SELECT field,version FROM graph_field_versions WHERE dialogue_id=$1',
    [dialogueId],
  );
  return new Map(result.rows.map((row) => [row.field, row.version]));
}
async function stamp(
  client: pg.PoolClient,
  dialogueId: string,
  field: string,
  version: string | null,
) {
  await client.query(
    'INSERT INTO graph_field_versions(dialogue_id,field,version) VALUES ($1,$2,$3) ON CONFLICT (dialogue_id,field) DO UPDATE SET version=EXCLUDED.version',
    [dialogueId, field, version],
  );
}
async function save(
  client: pg.PoolClient,
  dialogueId: string,
  operationId: string,
  actor: string,
  changes: Change[],
  notice = '',
) {
  await client.query(
    'INSERT INTO graph_history(dialogue_id,operation_id,actor,changes,notice) VALUES ($1,$2,$3,$4,$5)',
    [dialogueId, operationId, actor, JSON.stringify(changes), notice],
  );
}
function nodeGuards(id: string, stamps: Map<string, string | null>) {
  return Object.fromEntries(
    ['position:' + id, 'character:' + id].map((key) => [key, stamps.get(key) ?? null]),
  );
}

async function protectNode(
  client: pg.PoolClient,
  change: Change,
  stamps: Map<string, string | null>,
) {
  change.guards = nodeGuards(change.id, stamps);
  const node = await client.query('SELECT text_revision FROM nodes WHERE id=$1 FOR UPDATE', [
    change.id,
  ]);
  change.textBoundary = String(node.rows[0].text_revision);
}

// Caller owns the dialogue lock, transaction, and delivery after commit.
export async function recordGraphAction<T>(
  client: pg.PoolClient,
  dialogueId: string,
  operationId: string,
  actor: string,
  action: () => Promise<T>,
  command?: GraphCommand,
) {
  const before = await readGraph(client, dialogueId);
  const stamps = await versions(client, dialogueId);
  const value = await action();
  const after = await readGraph(client, dialogueId);
  const changes: Change[] = [];
  const add = (kind: Change['kind'], id: string, a: Value, b: Value, force = false) => {
    if (!force && same(a, b)) return;
    const field = kind + ':' + id;
    changes.push({
      kind,
      id,
      field,
      before: a,
      after: b,
      beforeVersion: stamps.get(field) ?? null,
      afterVersion: operationId,
    });
  };
  for (const id of new Set([...before.nodes, ...after.nodes].map((n) => n.id))) {
    const a = before.nodes.find((n) => n.id === id),
      b = after.nodes.find((n) => n.id === id);
    if (!a || !b) add('node', id, a ?? null, b ?? null);
    else {
      add(
        'position',
        id,
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
        command?.type === 'move-nodes' && command.positions.some((p) => p.nodeId === id),
      );
      add(
        'character',
        id,
        a.characterId,
        b.characterId,
        command?.type === 'set-character' && command.nodeId === id,
      );
    }
  }
  for (const id of new Set([...before.edges, ...after.edges].map((e) => e.id))) {
    add(
      'edge',
      id,
      before.edges.find((e) => e.id === id) ?? null,
      after.edges.find((e) => e.id === id) ?? null,
      command?.type === 'bend-edge' && command.edgeId === id,
    );
  }
  for (const change of changes) {
    await stamp(client, dialogueId, change.field, operationId);
    stamps.set(change.field, operationId);
  }
  for (const change of changes)
    if (change.kind === 'node' && change.after) await protectNode(client, change, stamps);
  await save(client, dialogueId, operationId, actor, changes);
  return value;
}

export async function reverseGraph(
  client: pg.PoolClient,
  dialogueId: string,
  operationId: string,
  targetOperationId: string,
  actor: string,
) {
  const stored = await client.query(
    'SELECT actor,changes FROM graph_history WHERE dialogue_id=$1 AND operation_id=$2',
    [dialogueId, targetOperationId],
  );
  if (!stored.rows[0] || stored.rows[0].actor !== actor)
    throw new AccessError('Можно отменять только свои действия текущей сессии.');
  const changes: Change[] = stored.rows[0].changes;
  const stamps = await versions(client, dialogueId);
  const graph = await readGraph(client, dialogueId);
  // Validate the entire operation before changing anything: group movement remains atomic.
  for (const change of changes) {
    if ((stamps.get(change.field) ?? null) !== change.afterVersion)
      throw new AccessError('Отмена пропущена: объект уже изменён другим действием.');
    if (change.kind === 'position' || change.kind === 'character') {
      if (!graph.nodes.some((n) => n.id === change.id))
        throw new AccessError('Отмена пропущена: нода удалена.');
    }
    if (change.kind === 'node' && change.before === null) {
      await client.query('SELECT id FROM nodes WHERE id=$1 FOR UPDATE', [change.id]);
      const foreignText = await client.query(
        'SELECT 1 FROM text_operations WHERE node_id=$1 AND revision > $2 AND actor IS DISTINCT FROM $3 LIMIT 1',
        [change.id, change.textBoundary ?? '0', actor],
      );
      if (foreignText.rows.length)
        throw new AccessError('Отмена пропущена: в ноде появился текст другого автора.');
      for (const [key, version] of Object.entries(change.guards ?? {})) {
        if ((stamps.get(key) ?? null) !== version)
          throw new AccessError('Отмена пропущена: нода уже изменена другим действием.');
      }
      const extra = graph.edges.some(
        (edge) =>
          (edge.source === change.id || edge.target === change.id) &&
          !changes.some((c) => c.kind === 'edge' && c.id === edge.id && c.before === null),
      );
      if (extra) throw new AccessError('Отмена пропущена: у ноды появились новые связи.');
    }
  }
  const applied: Change[] = [];
  let skipped = 0;
  // Remove edges, restore nodes, update fields, restore edges, hide nodes.
  const priority = (c: Change) =>
    c.kind === 'edge'
      ? c.before === null
        ? 0
        : 3
      : c.kind === 'node'
        ? c.before === null
          ? 4
          : 1
        : 2;
  for (const change of [...changes].sort((a, b) => priority(a) - priority(b))) {
    const desired = change.before;
    if (change.kind === 'position') {
      const p = desired as { x: number; y: number };
      await applyGraph(client, dialogueId, {
        type: 'move-nodes',
        operationId,
        positions: [{ nodeId: change.id, ...p }],
      });
    } else if (change.kind === 'character') {
      await applyGraph(client, dialogueId, {
        type: 'set-character',
        operationId,
        nodeId: change.id,
        characterId: desired as string | null,
      });
    } else if (change.kind === 'node') {
      if (desired === null)
        await applyGraph(client, dialogueId, {
          type: 'delete-node',
          operationId,
          nodeId: change.id,
        });
      else {
        const restored = await client.query(
          'UPDATE nodes SET deleted_at=NULL WHERE id=$1 AND dialogue_id=$2 RETURNING id',
          [change.id, dialogueId],
        );
        if (!restored.rows.length) throw new AccessError('Нода недоступна для восстановления.');
      }
    } else if (desired === null) {
      await applyGraph(client, dialogueId, { type: 'delete-edge', operationId, edgeId: change.id });
    } else {
      const edge = desired as DialogueEdge;
      if (change.after !== null) {
        await applyGraph(client, dialogueId, {
          type: 'bend-edge',
          operationId,
          edgeId: edge.id,
          bend: edge.bend,
        });
      } else {
        await client.query('SAVEPOINT restore_edge');
        try {
          await applyGraph(client, dialogueId, {
            type: 'connect-edge',
            operationId,
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
          });
          if (edge.bend)
            await applyGraph(client, dialogueId, {
              type: 'bend-edge',
              operationId,
              edgeId: edge.id,
              bend: edge.bend,
            });
          await client.query('RELEASE SAVEPOINT restore_edge');
        } catch (error) {
          await client.query('ROLLBACK TO SAVEPOINT restore_edge');
          await client.query('RELEASE SAVEPOINT restore_edge');
          if (!(error instanceof AccessError)) throw error;
          skipped++;
          continue;
        }
      }
    }
    await stamp(client, dialogueId, change.field, change.beforeVersion);
    stamps.set(change.field, change.beforeVersion);
    applied.push({
      ...change,
      before: change.after,
      after: change.before,
      beforeVersion: change.afterVersion,
      afterVersion: change.beforeVersion,
    });
  }
  for (const change of applied)
    if (change.kind === 'node' && change.after) change.guards = nodeGuards(change.id, stamps);
  const notice = skipped
    ? 'Восстановление выполнено; часть связей пропущена: их концы удалены или изменились правила ветвления.'
    : '';
  await save(client, dialogueId, operationId, actor, applied, notice);
  return { snapshot: await readGraph(client, dialogueId), notice };
}

import type pg from 'pg';
import type { GraphCommand } from '../shared/protocol';
import type { GraphSnapshot } from '../shared/model';
import { AccessError } from './access';

export async function readGraph(
  client: pg.Pool | pg.PoolClient,
  dialogueId: string,
): Promise<GraphSnapshot> {
  const nodes = await client.query(
    'SELECT id, kind, x, y, preview, character_id AS "characterId" FROM nodes WHERE dialogue_id=$1 AND deleted_at IS NULL ORDER BY id',
    [dialogueId],
  );
  const edges = await client.query(
    "SELECT id, source, target, CASE WHEN bend_x IS NULL THEN NULL ELSE json_build_object('x', bend_x, 'y', bend_y) END AS bend FROM edges WHERE dialogue_id=$1 ORDER BY id",
    [dialogueId],
  );
  return { nodes: nodes.rows, edges: edges.rows };
}

// The caller holds the dialogue lock and owns the transaction and post-commit delivery.
export async function applyGraph(
  client: pg.PoolClient,
  dialogueId: string,
  command: Exclude<GraphCommand, { type: 'reverse-graph' }>,
) {
  const graph = await readGraph(client, dialogueId);
  const node = (id: string) => {
    const found = graph.nodes.find((n) => n.id === id);
    if (!found) throw new AccessError('Нода недоступна или удалена.');
    return found;
  };
  switch (command.type) {
    case 'move-nodes':
      if (new Set(command.positions.map((p) => p.nodeId)).size !== command.positions.length)
        throw new AccessError('Нода указана несколько раз.');
      for (const p of command.positions) {
        node(p.nodeId);
        await client.query('UPDATE nodes SET x=$2,y=$3 WHERE id=$1', [p.nodeId, p.x, p.y]);
      }
      break;
    case 'connect-edge': {
      const source = node(command.source),
        target = node(command.target);
      if (source.kind === 'end') throw new AccessError('У конца не может быть исходящих связей.');
      if (target.kind === 'start') throw new AccessError('У начала не может быть входящих связей.');
      const outgoing = graph.edges.filter((e) => e.source === source.id);
      if (outgoing.some((e) => e.target === target.id))
        throw new AccessError('Эти ноды уже соединены.');
      if (
        outgoing.length &&
        (target.kind !== 'choice' || outgoing.some((e) => node(e.target).kind !== 'choice'))
      )
        throw new AccessError(
          'Несколько выходов допустимы только в варианты. Удалите прежнюю связь.',
        );
      await client.query('INSERT INTO edges(id,dialogue_id,source,target) VALUES ($1,$2,$3,$4)', [
        command.edgeId,
        dialogueId,
        source.id,
        target.id,
      ]);
      break;
    }
    case 'delete-node':
      if (node(command.nodeId).kind === 'start')
        throw new AccessError('Ноду начала нельзя удалить.');
      await client.query('DELETE FROM edges WHERE dialogue_id=$1 AND (source=$2 OR target=$2)', [
        dialogueId,
        command.nodeId,
      ]);
      await client.query('UPDATE nodes SET deleted_at=now() WHERE id=$1', [command.nodeId]);
      break;
    case 'delete-edge':
    case 'bend-edge':
      if (!graph.edges.some((e) => e.id === command.edgeId))
        throw new AccessError('Связь недоступна или удалена.');
      if (command.type === 'delete-edge')
        await client.query('DELETE FROM edges WHERE id=$1', [command.edgeId]);
      else
        await client.query('UPDATE edges SET bend_x=$2,bend_y=$3 WHERE id=$1', [
          command.edgeId,
          command.bend?.x ?? null,
          command.bend?.y ?? null,
        ]);
      break;
    case 'set-character': {
      if (node(command.nodeId).kind !== 'line')
        throw new AccessError('Персонаж задаётся только у реплики.');
      if (command.characterId) {
        const character = await client.query(
          'SELECT c.id FROM characters c JOIN dialogues d ON d.project_id=c.project_id WHERE d.id=$1 AND c.id=$2 FOR KEY SHARE OF c',
          [dialogueId, command.characterId],
        );
        if (!character.rows.length) throw new AccessError('Персонаж недоступен в этом проекте.');
      }
      await client.query('UPDATE nodes SET character_id=$2 WHERE id=$1', [
        command.nodeId,
        command.characterId,
      ]);
      break;
    }
  }
  return readGraph(client, dialogueId);
}

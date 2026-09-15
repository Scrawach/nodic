import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openDatabase, transaction } from './database';
import * as Y from 'yjs';
import { graphFragment } from '../shared/protocol';
import { cookieName, createProject, grantAccess, requireDialogue, requireProject } from './access';
import { registerLive } from './live';
import { readGraph } from './graph';
import { characterColors } from '../shared/model';
import { AccessError, dialogueActor } from './access';
import { createOnce } from './creation';

export async function createApp(options: { databaseUrl?: string; publicOrigin?: string } = {}) {
  const pool = await openDatabase(options.databaseUrl);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 2 * 1024 * 1024 } });
  const origin = options.publicOrigin || process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:5173';
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== origin)
      return reply.code(403).send({ message: 'Origin not allowed' });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ message: 'Некорректные данные запроса.' });
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.code(status >= 400 && status < 600 ? status : 500).send({
      message:
        status < 500 && error instanceof Error ? error.message : 'Не удалось выполнить запрос.',
    });
  });
  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });
  const live = registerLive(app, pool);
  app.post('/api/projects', async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    return reply.code(201).send(await createProject(pool, name));
  });
  app.post('/api/projects/:projectId/access', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    const { token } = z.object({ token: z.string().min(1).max(256) }).parse(request.body);
    const currentRole = await requireProject(pool, request, projectId).catch(() => null);
    if (currentRole === 'owner') return { role: 'owner' };
    const grant = await grantAccess(pool, projectId, token);
    reply.setCookie(cookieName(projectId), grant.session, {
      httpOnly: true,
      sameSite: 'strict',
      secure: origin.startsWith('https:'),
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return { role: grant.role };
  });
  app.get('/api/projects/:projectId', async (request) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    const role = await requireProject(pool, request, projectId);
    const result = await pool.query('SELECT id, name FROM projects WHERE id = $1', [projectId]);
    const dialogues = await pool.query(
      'SELECT id, name FROM dialogues WHERE project_id = $1 ORDER BY id',
      [projectId],
    );
    const characters = await pool.query(
      'SELECT id,name,color FROM characters WHERE project_id=$1 ORDER BY name,id',
      [projectId],
    );
    return { ...result.rows[0], role, dialogues: dialogues.rows, characters: characters.rows };
  });
  app.post('/api/projects/:projectId/rename', async (request) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    await requireProject(pool, request, projectId);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    await pool.query('UPDATE projects SET name=$2 WHERE id=$1', [projectId, name]);
    await live.notifyProject(projectId);
    return { id: projectId, name };
  });
  app.post('/api/dialogues/:dialogueId/rename', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    const result = await pool.query(
      'UPDATE dialogues SET name=$2 WHERE id=$1 RETURNING project_id',
      [dialogueId, name],
    );
    if (!result.rows[0]) throw new AccessError('Диалог удалён.');
    await live.notifyProject(result.rows[0].project_id);
    return { id: dialogueId, name };
  });
  app.post('/api/dialogues/:dialogueId/delete', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    if ((await requireDialogue(pool, request, dialogueId)) !== 'owner')
      throw new AccessError('Удалять диалог может только владелец.');
    const found = await pool.query('SELECT project_id FROM dialogues WHERE id=$1', [dialogueId]);
    if (!found.rows[0]) throw new AccessError('Диалог удалён.');
    const projectId = found.rows[0].project_id;
    await transaction(pool, async (client) => {
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const dialogues = await client.query(
        'SELECT id FROM dialogues WHERE project_id=$1 ORDER BY id FOR UPDATE',
        [projectId],
      );
      if (dialogues.rows.length <= 1)
        throw Object.assign(
          new Error('Последний диалог удалить нельзя. Можно удалить проект целиком.'),
          { statusCode: 409 },
        );
      await client.query('DELETE FROM edges WHERE dialogue_id=$1', [dialogueId]);
      await client.query('DELETE FROM dialogues WHERE id=$1', [dialogueId]);
      await client.query('DELETE FROM creation_operations WHERE scope=$1', [
        'dialogue:' + dialogueId + ':nodes',
      ]);
      // Keep the creation receipt: replay must not recreate a deleted dialogue.
    });
    await live.notifyRemoved(projectId, [dialogueId], false);
    await live.notifyProject(projectId);
    return { deleted: true };
  });
  app.post('/api/projects/:projectId/delete', async (request) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    if ((await requireProject(pool, request, projectId)) !== 'owner')
      throw new AccessError('Удалять проект может только владелец.');
    const dialogueIds = await transaction(pool, async (client) => {
      await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
      const dialogues = await client.query(
        'SELECT id FROM dialogues WHERE project_id=$1 ORDER BY id FOR UPDATE',
        [projectId],
      );
      const ids = dialogues.rows.map((d) => d.id);
      await client.query('DELETE FROM edges WHERE dialogue_id=ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM projects WHERE id=$1', [projectId]);
      await client.query('DELETE FROM creation_operations WHERE scope=ANY($1::text[])', [
        [
          'project:' + projectId + ':dialogues',
          'project:' + projectId + ':characters',
          ...ids.map((id: string) => 'dialogue:' + id + ':nodes'),
        ],
      ]);
      return ids;
    });
    await live.notifyRemoved(projectId, dialogueIds, true);
    return { deleted: true };
  });
  app.get('/api/dialogues/:dialogueId', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const result = await pool.query(
      'SELECT id, project_id AS "projectId", name FROM dialogues WHERE id = $1',
      [dialogueId],
    );
    return { ...result.rows[0], ...(await readGraph(pool, dialogueId)) };
  });
  app.post('/api/dialogues/:dialogueId/copy', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const { nodeIds } = z
      .object({ nodeIds: z.array(z.uuid()).min(1).max(1000) })
      .parse(request.body);
    return transaction(pool, async (client) => {
      const dialogue = await client.query(
        'SELECT project_id FROM dialogues WHERE id=$1 FOR UPDATE',
        [dialogueId],
      );
      const result = await client.query(
        'SELECT id,kind,x,y,character_id AS "characterId",character_missing AS "characterMissing",text_state FROM nodes WHERE dialogue_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE',
        [dialogueId, nodeIds],
      );
      if (result.rows.length !== new Set(nodeIds).size)
        throw new AccessError('Нода недоступна или удалена.');
      const nodes = result.rows
        .filter((n) => n.kind !== 'start')
        .map((n) => {
          const doc = new Y.Doc();
          try {
            if (n.text_state) Y.applyUpdate(doc, n.text_state);
            const { text_state: _state, ...node } = n;
            return { ...node, text: doc.getText('text').toString() };
          } finally {
            doc.destroy();
          }
        });
      if (!nodes.length) throw new AccessError('Начало не копируется. Выделите другие ноды.');
      const ids = new Set(nodes.map((n) => n.id));
      const graph = await readGraph(client, dialogueId);
      return graphFragment.parse({
        projectId: dialogue.rows[0].project_id,
        nodes,
        edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      });
    });
  });
  app.post('/api/dialogues/:dialogueId/nodes', async (request, reply) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const body = z
      .object({
        kind: z.enum(['line', 'choice', 'end']),
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .parse(request.body);
    const node = { id: randomUUID(), ...body, preview: '', characterId: null };
    const operationId = z.uuid().optional().parse(request.headers['idempotency-key']);
    const result = await live.createNode(
      dialogueId,
      node,
      await dialogueActor(pool, request, dialogueId),
      operationId,
    );
    return reply.code(201).send(result);
  });
  app.post('/api/projects/:projectId/dialogues', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    await requireProject(pool, request, projectId);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    const dialogue = { id: randomUUID(), name };
    const operationId = z.uuid().optional().parse(request.headers['idempotency-key']);
    const result = await createOnce(
      pool,
      `project:${projectId}:dialogues`,
      operationId,
      { name },
      async (client) => {
        await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
        await client.query('INSERT INTO dialogues(id,project_id,name) VALUES ($1,$2,$3)', [
          dialogue.id,
          projectId,
          name,
        ]);
        await client.query(
          "INSERT INTO nodes(id,dialogue_id,kind,x,y) VALUES ($1,$2,'start',80,200)",
          [randomUUID(), dialogue.id],
        );
        return dialogue;
      },
    );
    if (result.created) await live.notifyProject(projectId);
    return reply.code(201).send(result.value);
  });
  app.post('/api/projects/:projectId/characters', async (request, reply) => {
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    await requireProject(pool, request, projectId);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .parse(request.body);
    const operationId = z.uuid().optional().parse(request.headers['idempotency-key']);
    const result = await createOnce(
      pool,
      `project:${projectId}:characters`,
      operationId,
      body,
      async (client) => {
        await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
        const used = await client.query('SELECT color FROM characters WHERE project_id=$1', [
          projectId,
        ]);
        const color =
          body.color?.toLowerCase() ||
          characterColors.find((c) => !used.rows.some((row) => row.color === c)) ||
          characterColors[used.rows.length % characterColors.length];
        const value = { id: randomUUID(), name: body.name, color };
        await client.query(
          'INSERT INTO characters(id,project_id,name,color) VALUES ($1,$2,$3,$4)',
          [value.id, projectId, value.name, value.color],
        );
        return value;
      },
    );
    if (result.created) await live.notifyProject(projectId);
    return reply.code(201).send(result.value);
  });
  app.post('/api/projects/:projectId/characters/:characterId/rename', async (request) => {
    const { projectId, characterId } = z
      .object({ projectId: z.uuid(), characterId: z.uuid() })
      .parse(request.params);
    await requireProject(pool, request, projectId);
    const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(request.body);
    const result = await pool.query(
      'UPDATE characters SET name=$3 WHERE id=$1 AND project_id=$2 RETURNING id,name,color',
      [characterId, projectId, name],
    );
    if (!result.rows[0]) throw new AccessError('Персонаж недоступен в этом проекте.');
    await live.notifyProject(projectId);
    return result.rows[0];
  });
  app.post('/api/projects/:projectId/characters/:characterId/delete', async (request) => {
    const { projectId, characterId } = z
      .object({ projectId: z.uuid(), characterId: z.uuid() })
      .parse(request.params);
    await requireProject(pool, request, projectId);
    await transaction(pool, async (client) => {
      // Graph commands lock the dialogue before characters. Keep that order to
      // serialize assignment/deletion without deadlocking connected authors.
      await client.query('SELECT id FROM dialogues WHERE project_id=$1 ORDER BY id FOR UPDATE', [
        projectId,
      ]);
      const character = await client.query(
        'SELECT id FROM characters WHERE id=$1 AND project_id=$2 FOR UPDATE',
        [characterId, projectId],
      );
      if (!character.rows.length) return; // Repeating a completed deletion is harmless.
      const version = randomUUID();
      await client.query(
        "INSERT INTO graph_field_versions(dialogue_id,field,version) SELECT dialogue_id,'character:' || id::text,$2 FROM nodes WHERE character_id=$1 ON CONFLICT (dialogue_id,field) DO UPDATE SET version=EXCLUDED.version",
        [characterId, version],
      );
      await client.query(
        'UPDATE nodes SET character_id=NULL,character_missing=true WHERE character_id=$1',
        [characterId],
      );
      await client.query('DELETE FROM characters WHERE id=$1', [characterId]);
    });
    await live.notifyProject(projectId, true);
    return { deleted: true };
  });
  app.post('/api/projects/:projectId/characters/:characterId/color', async (request) => {
    const { projectId, characterId } = z
      .object({ projectId: z.uuid(), characterId: z.uuid() })
      .parse(request.params);
    await requireProject(pool, request, projectId);
    const { color } = z
      .object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
      .parse(request.body);
    const result = await pool.query(
      'UPDATE characters SET color=$3 WHERE id=$1 AND project_id=$2 RETURNING id,name,color',
      [characterId, projectId, color.toLowerCase()],
    );
    if (!result.rows[0]) throw new AccessError('Персонаж недоступен в этом проекте.');
    await live.notifyProject(projectId);
    return result.rows[0];
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  return app;
}

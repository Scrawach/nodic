import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openDatabase } from './database';
import { cookieName, createProject, grantAccess, requireDialogue, requireProject } from './access';
import { registerLive } from './live';
import { readGraph } from './graph';
import { characterColors } from '../shared/model';
import { AccessError } from './access';
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
  app.get('/api/dialogues/:dialogueId', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const result = await pool.query(
      'SELECT id, project_id AS "projectId", name FROM dialogues WHERE id = $1',
      [dialogueId],
    );
    return { ...result.rows[0], ...(await readGraph(pool, dialogueId)) };
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
    const result = await live.createNode(dialogueId, node, operationId);
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

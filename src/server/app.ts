import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openDatabase } from './database';
import { cookieName, createProject, grantAccess, requireDialogue, requireProject } from './access';
import { registerLive } from './live';

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
    return reply
      .code(status >= 400 && status < 600 ? status : 500)
      .send({
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
    return { ...result.rows[0], role, dialogues: dialogues.rows };
  });
  app.get('/api/dialogues/:dialogueId', async (request) => {
    const { dialogueId } = z.object({ dialogueId: z.uuid() }).parse(request.params);
    await requireDialogue(pool, request, dialogueId);
    const result = await pool.query(
      'SELECT id, project_id AS "projectId", name FROM dialogues WHERE id = $1',
      [dialogueId],
    );
    const nodes = await pool.query(
      'SELECT id, kind, x, y, preview FROM nodes WHERE dialogue_id = $1 ORDER BY id',
      [dialogueId],
    );
    return { ...result.rows[0], nodes: nodes.rows };
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
    const node = { id: randomUUID(), ...body, preview: '' };
    await pool.query('INSERT INTO nodes(id,dialogue_id,kind,x,y) VALUES ($1,$2,$3,$4,$5)', [
      node.id,
      dialogueId,
      node.kind,
      node.x,
      node.y,
    ]);
    live.notifyNode(dialogueId, node);
    return reply.code(201).send(node);
  });
  app.addHook('onClose', async () => {
    await pool.end();
  });
  return app;
}

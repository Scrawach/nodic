import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { transaction } from './database';

export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export const cookieName = (projectId: string) => `nodic_${projectId}`;

export class AccessError extends Error {
  statusCode = 403;
}

export async function createProject(pool: pg.Pool, name: string) {
  const id = randomUUID(),
    dialogueId = randomUUID();
  const ownerToken = secret(),
    editorToken = secret();
  await transaction(pool, async (client) => {
    await client.query('INSERT INTO projects VALUES ($1, $2, $3, $4, now())', [
      id,
      name,
      hash(ownerToken),
      hash(editorToken),
    ]);
    await client.query('INSERT INTO dialogues VALUES ($1, $2, $3)', [
      dialogueId,
      id,
      'Первый диалог',
    ]);
    await client.query('INSERT INTO nodes(id, dialogue_id, kind, x, y) VALUES ($1,$2,$3,$4,$5)', [
      randomUUID(),
      dialogueId,
      'start',
      80,
      200,
    ]);
  });
  return { id, dialogueId, ownerToken, editorToken };
}

export async function grantAccess(pool: pg.Pool, projectId: string, token: string) {
  const result = await pool.query('SELECT owner_hash, editor_hash FROM projects WHERE id = $1', [
    projectId,
  ]);
  const project = result.rows[0];
  const digest = hash(token);
  const role =
    project?.owner_hash === digest ? 'owner' : project?.editor_hash === digest ? 'editor' : null;
  if (!role) throw new AccessError('Ссылка недействительна.');
  const session = secret();
  await pool.query("INSERT INTO project_sessions VALUES ($1,$2,$3,now() + interval '30 days')", [
    hash(session),
    projectId,
    role,
  ]);
  return { session, role };
}

export async function requireProject(pool: pg.Pool, request: FastifyRequest, projectId: string) {
  const token = request.cookies[cookieName(projectId)];
  if (!token) throw new AccessError('Откройте проект по ссылке приглашения.');
  const result = await pool.query(
    'SELECT role FROM project_sessions WHERE hash = $1 AND project_id = $2 AND expires_at > now()',
    [hash(token), projectId],
  );
  if (!result.rows[0]) throw new AccessError('Сессия истекла. Откройте ссылку проекта снова.');
  return result.rows[0].role as 'owner' | 'editor';
}

export async function requireDialogue(pool: pg.Pool, request: FastifyRequest, dialogueId: string) {
  const result = await pool.query('SELECT project_id FROM dialogues WHERE id = $1', [dialogueId]);
  if (!result.rows[0]) throw new AccessError('Диалог недоступен.');
  return requireProject(pool, request, result.rows[0].project_id);
}

export async function dialogueActor(pool: pg.Pool, request: FastifyRequest, dialogueId: string) {
  const result = await pool.query('SELECT project_id FROM dialogues WHERE id=$1', [dialogueId]);
  if (!result.rows[0]) throw new AccessError('Диалог недоступен.');
  const projectId = result.rows[0].project_id;
  await requireProject(pool, request, projectId);
  return hash(request.cookies[cookieName(projectId)]!);
}

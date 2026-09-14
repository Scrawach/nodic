import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../src/server/app';
import WebSocket from 'ws';
import * as Y from 'yjs';

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  app = await createApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app?.close();
});

test('an author creates a project and can reopen its initial dialogue', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'The lantern' },
  });
  expect(created.statusCode).toBe(201);
  const project = created.json();
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.ownerToken },
  });
  expect(grant.statusCode).toBe(200);
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const reopened = await app.inject({ url: `/api/projects/${project.id}`, headers: { cookie } });
  expect(reopened.statusCode).toBe(200);
  expect(reopened.json()).toMatchObject({
    name: 'The lantern',
    role: 'owner',
    dialogues: [{ name: 'Первый диалог' }],
  });
  const dialogue = await app.inject({
    url: `/api/dialogues/${project.dialogueId}`,
    headers: { cookie },
  });
  expect(dialogue.json().nodes).toMatchObject([{ kind: 'start' }]);
});

function connect(cookie: string) {
  const socket = new WebSocket(
    app.listeningOrigin!.replace('http', 'ws') + '/api/dialogues/' + currentDialogue + '/live',
    { headers: { cookie } },
  );
  const messages: Record<string, unknown>[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const next = async (type: string) => {
    await expect.poll(() => messages.some((m) => m.type === type)).toBe(true);
    return messages.splice(
      messages.findIndex((m) => m.type === type),
      1,
    )[0];
  };
  return { socket, next, send: (message: unknown) => socket.send(JSON.stringify(message)) };
}
let currentDialogue: string;

test('two authors merge a shared text and can reopen it after a server restart', async () => {
  const created = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Shared text' } })
  ).json();
  currentDialogue = created.dialogueId;
  const cookieFor = async (token: string) => {
    const grant = await app.inject({
      method: 'POST',
      url: `/api/projects/${created.id}/access`,
      payload: { token },
    });
    return grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  };
  const [ownerCookie, editorCookie] = await Promise.all([
    cookieFor(created.ownerToken),
    cookieFor(created.editorToken),
  ]);
  const nodeResponse = await app.inject({
    method: 'POST',
    url: `/api/dialogues/${currentDialogue}/nodes`,
    headers: { cookie: ownerCookie },
    payload: { kind: 'line', x: 200, y: 100 },
  });
  expect(nodeResponse.statusCode).toBe(201);
  const nodeId = nodeResponse.json().id;
  const a = connect(ownerCookie),
    b = connect(editorCookie);
  const docs = [new Y.Doc(), new Y.Doc()];
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.send({ type: 'open-text', nodeId });
    b.send({ type: 'open-text', nodeId });
    const [initialA, initialB] = await Promise.all([a.next('text-state'), b.next('text-state')]);
    Y.applyUpdate(docs[0], Buffer.from(String(initialA.data), 'base64'));
    Y.applyUpdate(docs[1], Buffer.from(String(initialB.data), 'base64'));
    docs[0].getText('text').insert(0, 'Hello');
    const firstId = crypto.randomUUID();
    a.send({
      type: 'text-update',
      nodeId,
      operationId: firstId,
      data: Buffer.from(Y.encodeStateAsUpdate(docs[0])).toString('base64'),
    });
    await a.next('saved');
    const incoming = await b.next('text-update');
    Y.applyUpdate(docs[1], Buffer.from(String(incoming.data), 'base64'));
    docs[1].getText('text').insert(5, ' world');
    b.send({
      type: 'text-update',
      nodeId,
      operationId: crypto.randomUUID(),
      data: Buffer.from(Y.encodeStateAsUpdate(docs[1])).toString('base64'),
    });
    await b.next('saved');
    // Retrying an acknowledged operation must be idempotent.
    a.send({
      type: 'text-update',
      nodeId,
      operationId: firstId,
      data: Buffer.from(Y.encodeStateAsUpdate(docs[0])).toString('base64'),
    });
    await a.next('saved');
    a.socket.close();
    b.socket.close();
    await app.close();
    app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const reopened = connect(editorCookie);
    try {
      await reopened.next('ready');
      reopened.send({ type: 'open-text', nodeId });
      const state = await reopened.next('text-state');
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, Buffer.from(String(state.data), 'base64'));
      expect(fresh.getText('text').toString()).toBe('Hello world');
      fresh.destroy();
    } finally {
      reopened.socket.close();
    }
  } finally {
    a.socket.terminate();
    b.socket.terminate();
    docs.forEach((d) => d.destroy());
  }
});

test('an owner opening the editor invitation keeps their owner access', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Owner access' } })
  ).json();
  const owner = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.ownerToken },
  });
  const cookie = owner.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const editorInvitation = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    headers: { cookie },
    payload: { token: project.editorToken },
  });
  expect(editorInvitation.json().role).toBe('owner');
});

test('concurrent inserts from independent text copies both survive', async () => {
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Concurrent authors' },
    })
  ).json();
  currentDialogue = project.dialogueId;
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const node = (
    await app.inject({
      method: 'POST',
      url: `/api/dialogues/${currentDialogue}/nodes`,
      headers: { cookie },
      payload: { kind: 'line', x: 100, y: 100 },
    })
  ).json();
  const a = connect(cookie),
    b = connect(cookie),
    docs = [new Y.Doc(), new Y.Doc()];
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.send({ type: 'open-text', nodeId: node.id });
    b.send({ type: 'open-text', nodeId: node.id });
    await Promise.all([a.next('text-state'), b.next('text-state')]);
    docs[0].getText('text').insert(0, 'Аня');
    docs[1].getText('text').insert(0, 'Борис');
    for (const [i, peer] of [a, b].entries())
      peer.send({
        type: 'text-update',
        nodeId: node.id,
        operationId: crypto.randomUUID(),
        data: Buffer.from(Y.encodeStateAsUpdate(docs[i])).toString('base64'),
      });
    await Promise.all([a.next('saved'), b.next('saved')]);
    const [fromB, fromA] = await Promise.all([a.next('text-update'), b.next('text-update')]);
    Y.applyUpdate(docs[0], Buffer.from(String(fromB.data), 'base64'));
    Y.applyUpdate(docs[1], Buffer.from(String(fromA.data), 'base64'));
    const result = docs[0].getText('text').toString();
    expect(['АняБорис', 'БорисАня']).toContain(result);
    expect(docs[1].getText('text').toString()).toBe(result);
  } finally {
    a.socket.terminate();
    b.socket.terminate();
    docs.forEach((d) => d.destroy());
  }
});

test('a project invitation does not give access to another project', async () => {
  const create = async (name: string) =>
    (await app.inject({ method: 'POST', url: '/api/projects', payload: { name } })).json();
  const [one, two] = await Promise.all([create('Private one'), create('Private two')]);
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${one.id}/access`,
    payload: { token: one.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  expect(
    (await app.inject({ url: `/api/projects/${two.id}`, headers: { cookie } })).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/dialogues/${two.dialogueId}/nodes`,
        headers: { cookie },
        payload: { kind: 'line', x: 0, y: 0 },
      })
    ).statusCode,
  ).toBe(403);
});

test('moves are atomic, shared, persistent and retries cannot overwrite a later move', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Moving' } })
  ).json();
  currentDialogue = project.dialogueId;
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const read = async () =>
    (await app.inject({ url: `/api/dialogues/${currentDialogue}`, headers: { cookie } })).json();
  const initial = await read();
  const nodeId = initial.nodes[0].id;
  const a = connect(cookie),
    b = connect(cookie);
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    const first = {
      type: 'move-nodes',
      operationId: crypto.randomUUID(),
      positions: [{ nodeId, x: 250, y: -80 }],
    };
    a.send(first);
    await a.next('saved');
    expect(await b.next('positions')).toMatchObject({ positions: first.positions });
    expect((await read()).nodes[0]).toMatchObject({ x: 250, y: -80 });
    b.send({ ...first, operationId: crypto.randomUUID(), positions: [{ nodeId, x: 500, y: 300 }] });
    await b.next('saved');
    a.send(first);
    await a.next('saved');
    expect((await read()).nodes[0]).toMatchObject({ x: 500, y: 300 });
    a.send({ ...first, positions: [{ nodeId, x: 999, y: 999 }] });
    expect(await a.next('error')).toMatchObject({ operationId: first.operationId });
    // One inaccessible member rejects the entire group, including preceding valid members.
    a.send({
      ...first,
      operationId: crypto.randomUUID(),
      positions: [
        { nodeId, x: 1, y: 2 },
        { nodeId: crypto.randomUUID(), x: 3, y: 4 },
      ],
    });
    await a.next('error');
    expect((await read()).nodes[0]).toMatchObject({ x: 500, y: 300 });
    a.socket.close();
    b.socket.close();
    await app.close();
    app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const reopened = connect(cookie);
    try {
      expect(await reopened.next('ready')).toMatchObject({
        nodes: [{ id: nodeId, x: 500, y: 300 }],
      });
      reopened.send(first);
      await reopened.next('saved');
      expect((await read()).nodes[0]).toMatchObject({ x: 500, y: 300 });
    } finally {
      reopened.socket.terminate();
    }
  } finally {
    a.socket.terminate();
    b.socket.terminate();
  }
});

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

test('graph rules, characters, curves and deletion persist through public operations', async () => {
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Graph operations' },
    })
  ).json();
  currentDialogue = project.dialogueId;
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const request = (url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      payload,
      headers: { cookie },
    });
  const read = async () => (await request(`/api/dialogues/${currentDialogue}`)).json();
  const startId = (await read()).nodes[0].id;
  const line = (
    await request(`/api/dialogues/${currentDialogue}/nodes`, { kind: 'line', x: 300, y: 100 })
  ).json();
  const choice = (
    await request(`/api/dialogues/${currentDialogue}/nodes`, { kind: 'choice', x: 600, y: 200 })
  ).json();
  const end = (
    await request(`/api/dialogues/${currentDialogue}/nodes`, { kind: 'end', x: 900, y: 200 })
  ).json();
  const a = connect(cookie),
    b = connect(cookie);
  const command = async (value: Record<string, unknown>, response = 'saved') => {
    a.send({ operationId: crypto.randomUUID(), ...value });
    return a.next(response);
  };
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    const edgeId = crypto.randomUUID(),
      operationId = crypto.randomUUID();
    const connection = {
      type: 'connect-edge',
      operationId,
      edgeId,
      source: startId,
      target: line.id,
    };
    await command(connection);
    await command(connection);
    expect((await read()).edges).toHaveLength(1);
    expect(await b.next('graph')).toMatchObject({
      edges: [{ id: edgeId, source: startId, target: line.id }],
    });
    await command(
      { type: 'connect-edge', edgeId: crypto.randomUUID(), source: startId, target: choice.id },
      'error',
    );
    await command(
      { type: 'connect-edge', edgeId: crypto.randomUUID(), source: line.id, target: startId },
      'error',
    );
    await command(
      { type: 'connect-edge', edgeId: crypto.randomUUID(), source: end.id, target: line.id },
      'error',
    );
    await command({ type: 'bend-edge', edgeId, bend: { x: 220, y: 180 } });
    expect((await read()).edges[0].bend).toEqual({ x: 220, y: 180 });
    const character = (
      await request(`/api/projects/${project.id}/characters`, { name: 'Лесник' })
    ).json();
    await command({ type: 'set-character', nodeId: line.id, characterId: character.id });
    expect((await read()).nodes.find((n: { id: string }) => n.id === line.id).characterId).toBe(
      character.id,
    );
    await command({ type: 'set-character', nodeId: choice.id, characterId: character.id }, 'error');
    const second = await request(`/api/projects/${project.id}/dialogues`, {
      name: 'Второй разговор',
    });
    expect(second.statusCode).toBe(201);
    const secondGraph = (await request(`/api/dialogues/${second.json().id}`)).json();
    expect(secondGraph.nodes).toMatchObject([{ kind: 'start' }]);
    expect(secondGraph.edges).toEqual([]);
    expect((await request(`/api/projects/${project.id}`)).json()).toMatchObject({
      characters: [{ id: character.id, name: 'Лесник' }],
    });
    const foreign = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Other project' } })
    ).json();
    expect(
      (await request(`/api/projects/${foreign.id}/dialogues`, { name: 'Denied' })).statusCode,
    ).toBe(403);
    expect(
      (await request(`/api/projects/${foreign.id}/characters`, { name: 'Denied' })).statusCode,
    ).toBe(403);
    await command({ type: 'delete-node', nodeId: startId }, 'error');
    a.send({ type: 'open-text', nodeId: line.id });
    await a.next('text-state');
    await command({ type: 'delete-node', nodeId: line.id });
    // Text already in flight may be saved, but cannot recreate the deleted node.
    const doc = new Y.Doc();
    doc.getText('text').insert(0, 'Поздний ввод');
    await command({
      type: 'text-update',
      nodeId: line.id,
      data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
    });
    doc.destroy();
    const after = await read();
    expect(after.nodes.some((n: { id: string }) => n.id === line.id)).toBe(false);
    expect(after.edges).toEqual([]);
    b.send({ type: 'open-text', nodeId: line.id });
    await b.next('error');
  } finally {
    a.socket.terminate();
    b.socket.terminate();
  }
});

test('concurrent incompatible branches accept exactly one command', async () => {
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Concurrent graph' },
    })
  ).json();
  currentDialogue = project.dialogueId;
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const initial = (
    await app.inject({ url: `/api/dialogues/${currentDialogue}`, headers: { cookie } })
  ).json();
  const targets = [];
  for (const kind of ['line', 'choice'])
    targets.push(
      (
        await app.inject({
          method: 'POST',
          url: `/api/dialogues/${currentDialogue}/nodes`,
          headers: { cookie },
          payload: { kind, x: 300, y: 100 },
        })
      ).json().id,
    );
  const a = connect(cookie),
    b = connect(cookie);
  try {
    await Promise.all([a.next('ready'), b.next('ready')]);
    a.send({
      type: 'connect-edge',
      operationId: crypto.randomUUID(),
      edgeId: crypto.randomUUID(),
      source: initial.nodes[0].id,
      target: targets[0],
    });
    b.send({
      type: 'connect-edge',
      operationId: crypto.randomUUID(),
      edgeId: crypto.randomUUID(),
      source: initial.nodes[0].id,
      target: targets[1],
    });
    await Promise.all([a.next('graph'), b.next('graph')]);
    const graph = (
      await app.inject({ url: `/api/dialogues/${currentDialogue}`, headers: { cookie } })
    ).json();
    const winner = graph.edges[0].target === targets[0] ? a : b;
    const loser = winner === a ? b : a;
    await Promise.all([winner.next('saved'), loser.next('error')]);
    expect(graph.edges).toHaveLength(1);
  } finally {
    a.socket.terminate();
    b.socket.terminate();
  }
});

test('character colours are distinct by default, editable, persistent and project-scoped', async () => {
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Character colours' },
    })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.editorToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, payload, headers: { cookie } });
  const a = (await post(`/api/projects/${project.id}/characters`, { name: 'Аня' })).json();
  const b = (await post(`/api/projects/${project.id}/characters`, { name: 'Борис' })).json();
  expect(a.color).not.toBe(b.color);
  const changed = await post(`/api/projects/${project.id}/characters/${a.id}/color`, {
    color: '#487FBD',
  });
  expect(changed.json().color).toBe('#487fbd');
  expect(
    (await post(`/api/projects/${project.id}/characters/${a.id}/color`, { color: 'red; invalid' }))
      .statusCode,
  ).toBe(400);
  const other = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Private palette' } })
  ).json();
  expect(
    (await post(`/api/projects/${other.id}/characters/${a.id}/color`, { color: '#ffffff' }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await post(`/api/projects/${project.id}/characters/${crypto.randomUUID()}/color`, {
        color: '#ffffff',
      })
    ).statusCode,
  ).toBe(403);
  const reopened = (
    await app.inject({ url: `/api/projects/${project.id}`, headers: { cookie } })
  ).json();
  expect(reopened.characters).toEqual(expect.arrayContaining([{ ...a, color: '#487fbd' }, b]));
});

test('creation retries are durable, concurrent, payload-bound and access checked', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Retries' } })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: '/api/projects/' + project.id + '/access',
    payload: { token: project.ownerToken },
  });
  const cookie = grant.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const cases = [
    {
      url: '/api/dialogues/' + project.dialogueId + '/nodes',
      payload: { kind: 'line', x: 10, y: 20 },
      changed: { kind: 'line', x: 11, y: 20 },
    },
    {
      url: '/api/projects/' + project.id + '/dialogues',
      payload: { name: 'Repeated dialogue' },
      changed: { name: 'Changed' },
    },
    {
      url: '/api/projects/' + project.id + '/characters',
      payload: { name: 'Repeated character' },
      changed: { name: 'Changed' },
    },
  ];
  for (const example of cases) {
    const key = crypto.randomUUID();
    const send = () =>
      app.inject({
        method: 'POST',
        url: example.url,
        payload: example.payload,
        headers: { cookie, 'idempotency-key': key },
      });
    const replies = await Promise.all([send(), send(), send()]);
    for (const response of replies) {
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(replies[0]!.json());
    }
    const denied = await app.inject({
      method: 'POST',
      url: example.url,
      payload: example.payload,
      headers: { 'idempotency-key': key },
    });
    expect(denied.statusCode).toBe(403);
    const conflict = await app.inject({
      method: 'POST',
      url: example.url,
      payload: example.changed,
      headers: { cookie, 'idempotency-key': key },
    });
    expect(conflict.statusCode).toBe(409);
    await app.close();
    app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    expect((await send()).json()).toEqual(replies[0]!.json());
  }
  const graph = (
    await app.inject({ url: '/api/dialogues/' + project.dialogueId, headers: { cookie } })
  ).json();
  expect(graph.nodes.filter((node: { kind: string }) => node.kind === 'line')).toHaveLength(1);
  const saved = (
    await app.inject({ url: '/api/projects/' + project.id, headers: { cookie } })
  ).json();
  expect(saved.dialogues).toHaveLength(2);
  expect(saved.characters).toHaveLength(1);
});

test('creation keys are scoped to projects and replay cannot resurrect a deleted node', async () => {
  const create = async () => {
    const project = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Scope' } })
    ).json();
    const grant = await app.inject({
      method: 'POST',
      url: '/api/projects/' + project.id + '/access',
      payload: { token: project.ownerToken },
    });
    return { project, cookie: grant.cookies.map((c) => c.name + '=' + c.value).join('; ') };
  };
  const one = await create(),
    two = await create();
  const key = crypto.randomUUID();
  const character = async (owner: typeof one) =>
    app.inject({
      method: 'POST',
      url: '/api/projects/' + owner.project.id + '/characters',
      payload: { name: 'Same' },
      headers: { cookie: owner.cookie, 'idempotency-key': key },
    });
  const a = await character(one),
    b = await character(two);
  expect(a.statusCode).toBe(201);
  expect(b.statusCode).toBe(201);
  expect(a.json().id).not.toBe(b.json().id);
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/projects/' + two.project.id + '/characters',
    payload: { name: 'Same' },
    headers: { cookie: one.cookie, 'idempotency-key': key },
  });
  expect(forbidden.statusCode).toBe(403);
  const nodeKey = crypto.randomUUID();
  const nodeRequest = () =>
    app.inject({
      method: 'POST',
      url: '/api/dialogues/' + one.project.dialogueId + '/nodes',
      payload: { kind: 'line', x: 10, y: 20 },
      headers: { cookie: one.cookie, 'idempotency-key': nodeKey },
    });
  const node = (await nodeRequest()).json();
  currentDialogue = one.project.dialogueId;
  const peer = connect(one.cookie);
  try {
    await peer.next('ready');
    peer.send({ type: 'delete-node', operationId: crypto.randomUUID(), nodeId: node.id });
    await peer.next('graph');
    expect((await nodeRequest()).json()).toEqual(node);
    const graph = (
      await app.inject({
        url: '/api/dialogues/' + currentDialogue,
        headers: { cookie: one.cookie },
      })
    ).json();
    expect(graph.nodes.map((item: { id: string }) => item.id)).not.toContain(node.id);
  } finally {
    peer.socket.close();
  }
});

test('structural undo is personal, atomic, repeatable and detects intervening writes', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Structural undo' } })
  ).json();
  const access = async (token: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/' + project.id + '/access',
      payload: { token },
    });
    return response.cookies.map((c) => c.name + '=' + c.value).join('; ');
  };
  const cookieA = await access(project.ownerToken),
    cookieB = await access(project.editorToken);
  const create = async (x: number) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/dialogues/' + project.dialogueId + '/nodes',
        headers: { cookie: cookieA },
        payload: { kind: 'line', x, y: 20 },
      })
    ).json();
  const first = await create(10),
    second = await create(30);
  currentDialogue = project.dialogueId;
  const a = connect(cookieA),
    b = connect(cookieB);
  const send = async (
    peer: ReturnType<typeof connect>,
    command: Record<string, unknown>,
    outcome = 'saved',
  ) => {
    const operationId = crypto.randomUUID();
    peer.send({ ...command, operationId });
    await peer.next(outcome);
    return operationId;
  };
  const read = async () =>
    (
      await app.inject({
        url: '/api/dialogues/' + project.dialogueId,
        headers: { cookie: cookieA },
      })
    ).json();
  try {
    await a.next('ready');
    await b.next('ready');
    const move = await send(a, {
      type: 'move-nodes',
      positions: [
        { nodeId: first.id, x: 100, y: 100 },
        { nodeId: second.id, x: 120, y: 100 },
      ],
    });
    const later = await send(a, {
      type: 'move-nodes',
      positions: [{ nodeId: first.id, x: 200, y: 200 }],
    });
    const undoLater = await send(a, { type: 'reverse-graph', targetOperationId: later });
    const undoMove = await send(a, { type: 'reverse-graph', targetOperationId: move });
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id)).toMatchObject({
      x: 10,
      y: 20,
    });
    expect((await read()).nodes.find((n: { id: string }) => n.id === second.id)).toMatchObject({
      x: 30,
      y: 20,
    });
    await send(a, { type: 'reverse-graph', targetOperationId: undoMove });
    await send(a, { type: 'reverse-graph', targetOperationId: undoLater });
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id)).toMatchObject({
      x: 200,
      y: 200,
    });
    // A replay of a prior undo must not overwrite the redo.
    a.send({ type: 'reverse-graph', targetOperationId: later, operationId: undoLater });
    await a.next('saved');
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id)).toMatchObject({
      x: 200,
      y: 200,
    });
    await send(b, { type: 'reverse-graph', targetOperationId: later }, 'error');
    await send(a, { type: 'reverse-graph', targetOperationId: later });
    await send(b, { type: 'move-nodes', positions: [{ nodeId: second.id, x: 999, y: 999 }] });
    await send(b, { type: 'move-nodes', positions: [{ nodeId: second.id, x: 120, y: 100 }] });
    await send(a, { type: 'reverse-graph', targetOperationId: move }, 'error');
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id)).toMatchObject({
      x: 100,
      y: 100,
    });
    expect((await read()).nodes.find((n: { id: string }) => n.id === second.id)).toMatchObject({
      x: 120,
      y: 100,
    });
    const fresh = await create(50);
    const undoCreation = await send(a, {
      type: 'reverse-graph',
      targetOperationId: fresh.operationId,
    });
    expect((await read()).nodes.map((n: { id: string }) => n.id)).not.toContain(fresh.id);
    await send(a, { type: 'reverse-graph', targetOperationId: undoCreation });
    expect((await read()).nodes.map((n: { id: string }) => n.id)).toContain(fresh.id);
    b.send({ type: 'open-text', nodeId: fresh.id });
    await b.next('text-state');
    const foreign = new Y.Doc();
    foreign.getText('text').insert(0, 'Коллега');
    await send(b, {
      type: 'text-update',
      nodeId: fresh.id,
      data: Buffer.from(Y.encodeStateAsUpdate(foreign)).toString('base64'),
    });
    a.send({ type: 'open-text', nodeId: fresh.id });
    const current = await a.next('text-state');
    const own = new Y.Doc();
    Y.applyUpdate(own, Buffer.from(String(current.data), 'base64'));
    own.getText('text').insert(own.getText('text').length, ' и я');
    await send(a, {
      type: 'text-update',
      nodeId: fresh.id,
      data: Buffer.from(Y.encodeStateAsUpdate(own)).toString('base64'),
    });
    await send(a, { type: 'reverse-graph', targetOperationId: fresh.operationId }, 'error');
    expect((await read()).nodes.find((n: { id: string }) => n.id === fresh.id).preview).toBe(
      'Коллега и я',
    );
    own.destroy();
    foreign.destroy();
  } finally {
    a.socket.close();
    b.socket.close();
  }
});

test('undo deletion retains late text and restores only valid edges', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Restore' } })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: '/api/projects/' + project.id + '/access',
    payload: { token: project.ownerToken },
  });
  const cookie = grant.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const editorGrant = await app.inject({
    method: 'POST',
    url: '/api/projects/' + project.id + '/access',
    payload: { token: project.editorToken },
  });
  const editorCookie = editorGrant.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const create = async () =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/dialogues/' + project.dialogueId + '/nodes',
        headers: { cookie },
        payload: { kind: 'line', x: 20, y: 20 },
      })
    ).json();
  const first = await create(),
    target = await create();
  currentDialogue = project.dialogueId;
  const peer = connect(cookie);
  const editor = connect(editorCookie);
  const send = async (command: Record<string, unknown>) => {
    const operationId = crypto.randomUUID();
    peer.send({ ...command, operationId });
    return { operationId, receipt: await peer.next('saved') };
  };
  const read = async () =>
    (await app.inject({ url: '/api/dialogues/' + project.dialogueId, headers: { cookie } })).json();
  try {
    await peer.next('ready');
    await editor.next('ready');
    const edgeId = crypto.randomUUID();
    await send({ type: 'connect-edge', edgeId, source: first.id, target: target.id });
    const bend = await send({ type: 'bend-edge', edgeId, bend: { x: 12, y: 34 } });
    await send({ type: 'reverse-graph', targetOperationId: bend.operationId });
    expect((await read()).edges[0].bend).toBeNull();
    const removed = await send({ type: 'delete-node', nodeId: first.id });
    const doc = new Y.Doc();
    doc.getText('text').insert(0, 'Late text survives');
    editor.send({
      type: 'text-update',
      operationId: crypto.randomUUID(),
      nodeId: first.id,
      data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
    });
    await editor.next('saved');
    doc.destroy();
    const intact = await send({ type: 'reverse-graph', targetOperationId: removed.operationId });
    expect((await read()).edges.map((edge: { id: string }) => edge.id)).toContain(edgeId);
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id).preview).toBe(
      'Late text survives',
    );
    await send({ type: 'reverse-graph', targetOperationId: intact.operationId });
    await send({ type: 'delete-node', nodeId: target.id });
    const restored = await send({ type: 'reverse-graph', targetOperationId: removed.operationId });
    expect(restored.receipt.notice).toContain('часть связей пропущена');
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id).preview).toBe(
      'Late text survives',
    );
    expect((await read()).edges).toHaveLength(0);
    const deletedAgain = await send({
      type: 'reverse-graph',
      targetOperationId: restored.operationId,
    });
    expect((await read()).nodes.map((n: { id: string }) => n.id)).not.toContain(first.id);
    await send({ type: 'reverse-graph', targetOperationId: deletedAgain.operationId });
    expect((await read()).nodes.find((n: { id: string }) => n.id === first.id).preview).toBe(
      'Late text survives',
    );
  } finally {
    peer.socket.close();
    editor.socket.close();
  }
});

test('undo assignment preserves other fields and edge restoration rechecks branching', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Field history' } })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: '/api/projects/' + project.id + '/access',
    payload: { token: project.ownerToken },
  });
  const cookie = grant.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const post = async (url: string, payload: unknown) =>
    (
      await app.inject({
        method: 'POST',
        url,
        headers: { cookie },
        payload: payload as Record<string, unknown>,
      })
    ).json();
  const source = await post('/api/dialogues/' + project.dialogueId + '/nodes', {
    kind: 'line',
    x: 10,
    y: 20,
  });
  const target = await post('/api/dialogues/' + project.dialogueId + '/nodes', {
    kind: 'line',
    x: 30,
    y: 20,
  });
  const choice = await post('/api/dialogues/' + project.dialogueId + '/nodes', {
    kind: 'choice',
    x: 50,
    y: 20,
  });
  const character = await post('/api/projects/' + project.id + '/characters', { name: 'Narrator' });
  currentDialogue = project.dialogueId;
  const peer = connect(cookie);
  const send = async (command: Record<string, unknown>) => {
    const operationId = crypto.randomUUID();
    peer.send({ ...command, operationId });
    return { operationId, receipt: await peer.next('saved') };
  };
  const read = async () =>
    (await app.inject({ url: '/api/dialogues/' + project.dialogueId, headers: { cookie } })).json();
  try {
    await peer.next('ready');
    const assignment = await send({
      type: 'set-character',
      nodeId: source.id,
      characterId: character.id,
    });
    await send({ type: 'move-nodes', positions: [{ nodeId: source.id, x: 200, y: 300 }] });
    await send({ type: 'reverse-graph', targetOperationId: assignment.operationId });
    expect((await read()).nodes.find((n: { id: string }) => n.id === source.id)).toMatchObject({
      x: 200,
      y: 300,
      characterId: null,
    });
    const edgeId = crypto.randomUUID();
    await send({ type: 'connect-edge', edgeId, source: source.id, target: target.id });
    const deletion = await send({ type: 'delete-edge', edgeId });
    await send({
      type: 'connect-edge',
      edgeId: crypto.randomUUID(),
      source: source.id,
      target: choice.id,
    });
    const restored = await send({ type: 'reverse-graph', targetOperationId: deletion.operationId });
    expect(restored.receipt.notice).toContain('часть связей пропущена');
    expect((await read()).edges.map((e: { target: string }) => e.target)).toEqual([choice.id]);
  } finally {
    peer.socket.close();
  }
});

test('structural history and reversal receipts survive a server restart', async () => {
  const project = (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Persistent history' },
    })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.ownerToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  currentDialogue = project.dialogueId;
  const read = async () =>
    (
      await app.inject({
        url: `/api/dialogues/${currentDialogue}`,
        headers: { cookie },
      })
    ).json();
  const start = (await read()).nodes[0];
  let peer = connect(cookie);
  const send = async (command: Record<string, unknown>) => {
    peer.send(command);
    const receipt = await peer.next('saved');
    expect(receipt.operationId).toBe(command.operationId);
  };
  const restart = async () => {
    peer.socket.terminate();
    await app.close();
    app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    peer = connect(cookie);
    await peer.next('ready');
  };
  const moveId = crypto.randomUUID();
  const undo = {
    type: 'reverse-graph',
    operationId: crypto.randomUUID(),
    targetOperationId: moveId,
  };
  const redo = {
    type: 'reverse-graph',
    operationId: crypto.randomUUID(),
    targetOperationId: undo.operationId,
  };
  try {
    await peer.next('ready');
    await send({
      type: 'move-nodes',
      operationId: moveId,
      positions: [{ nodeId: start.id, x: 321, y: 654 }],
    });
    await restart();
    await send(undo);
    expect((await read()).nodes[0]).toMatchObject({ x: start.x, y: start.y });
    await restart();
    await send(undo);
    await send(redo);
    expect((await read()).nodes[0]).toMatchObject({ x: 321, y: 654 });
    await restart();
    await send(undo);
    await send(redo);
    expect((await read()).nodes[0]).toMatchObject({ x: 321, y: 654 });
    await send({
      type: 'reverse-graph',
      operationId: crypto.randomUUID(),
      targetOperationId: redo.operationId,
    });
    expect((await read()).nodes[0]).toMatchObject({ x: start.x, y: start.y });
  } finally {
    peer.socket.terminate();
  }
});

test('group deletion is atomic, protects start, and restores its nodes and edges in one step', async () => {
  const project = (
    await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Delete group' } })
  ).json();
  const grant = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/access`,
    payload: { token: project.ownerToken },
  });
  const cookie = grant.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  currentDialogue = project.dialogueId;
  const read = async () =>
    (await app.inject({ url: `/api/dialogues/${currentDialogue}`, headers: { cookie } })).json();
  const start = (await read()).nodes[0];
  const nodes = [];
  for (const x of [300, 600])
    nodes.push(
      (
        await app.inject({
          method: 'POST',
          url: `/api/dialogues/${currentDialogue}/nodes`,
          headers: { cookie },
          payload: { kind: 'line', x, y: 200 },
        })
      ).json(),
    );
  const peer = connect(cookie);
  const send = async (command: Record<string, unknown>, outcome = 'saved') => {
    const operationId = crypto.randomUUID();
    peer.send({ ...command, operationId });
    const receipt = await peer.next(outcome);
    expect(receipt.operationId).toBe(operationId);
    return operationId;
  };
  try {
    await peer.next('ready');
    for (const [source, target] of [
      [start.id, nodes[0].id],
      [nodes[0].id, nodes[1].id],
    ]) {
      await send({ type: 'connect-edge', edgeId: crypto.randomUUID(), source, target });
    }
    const initial = await read();
    for (const ids of [
      [nodes[0].id, start.id],
      [nodes[0].id, crypto.randomUUID()],
      [nodes[0].id, nodes[0].id],
    ]) {
      await send({ type: 'delete-nodes', nodeIds: ids }, 'error');
      expect(await read()).toEqual(initial);
    }
    const nodeIds = nodes.map((n) => n.id);
    const deletion = await send({ type: 'delete-nodes', nodeIds });
    expect((await read()).nodes.map((n: { id: string }) => n.id)).toEqual([start.id]);
    expect((await read()).edges).toHaveLength(0);
    const restoration = await send({ type: 'reverse-graph', targetOperationId: deletion });
    expect(await read()).toEqual(initial);
    // A delayed duplicate deletion cannot delete the restored group again.
    peer.send({ type: 'delete-nodes', operationId: deletion, nodeIds });
    await peer.next('saved');
    expect(await read()).toEqual(initial);
    await send({ type: 'reverse-graph', targetOperationId: restoration });
    expect((await read()).nodes.map((n: { id: string }) => n.id)).toEqual([start.id]);
  } finally {
    peer.socket.terminate();
  }
});

import { expect, test } from 'vitest';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { defaultDatabaseUrl } from '../src/server/database';

test('COMMIT gates ACK and broadcast; database outage, lost ACK and process death recover without duplicates', async () => {
  const database = new URL(process.env.DATABASE_URL || defaultDatabaseUrl);
  const databaseHost = database.hostname,
    databasePort = Number(database.port || 5432);
  const connections = new Set<net.Socket>();
  let unavailable = false;
  let holdCommit = false;
  let held: (() => void) | undefined;
  // Control the real PostgreSQL wire connection, not application persistence.
  const proxy = net.createServer((client) => {
    if (unavailable) return client.destroy();
    const upstream = net.connect(databasePort, databaseHost);
    connections.add(client);
    connections.add(upstream);
    let startup = true;
    let buffer = Buffer.alloc(0);
    client.on('data', (data) => {
      buffer = Buffer.concat([buffer, typeof data === 'string' ? Buffer.from(data) : data]);
      while (buffer.length >= (startup ? 4 : 5)) {
        const length = buffer.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
        if (buffer.length < length) return;
        const packet = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        if (
          !startup &&
          packet[0] === 81 &&
          packet.subarray(5, -1).toString() === 'COMMIT' &&
          holdCommit
        ) {
          held = () => upstream.write(packet);
        } else upstream.write(packet);
        startup = false;
      }
    });
    upstream.pipe(client);
    for (const socket of [client, upstream]) {
      socket.on('error', () => {});
      socket.on('close', () => {
        connections.delete(socket);
        client.destroy();
        upstream.destroy();
      });
    }
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  database.hostname = '127.0.0.1';
  database.port = String((proxy.address() as net.AddressInfo).port);
  database.searchParams.set('sslmode', 'disable');
  const reserve = net.createServer().listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  let serverProcess: ChildProcess | undefined;
  let logs = '';
  const start = async () => {
    serverProcess = spawn(globalThis.process.execPath, ['--import', 'tsx', 'src/server/main.ts'], {
      env: { ...globalThis.process.env, DATABASE_URL: database.toString(), PORT: String(port) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout?.on('data', (chunk) => {
      logs += chunk;
    });
    serverProcess.stderr?.on('data', (chunk) => {
      logs += chunk;
    });
    await expect
      .poll(
        async () => {
          if (serverProcess?.exitCode !== null) throw new Error(logs);
          return fetch(base + '/api/health')
            .then((r) => r.ok)
            .catch(() => false);
        },
        { timeout: 15000 },
      )
      .toBe(true);
  };
  const stop = async () => {
    if (serverProcess && serverProcess.exitCode === null) {
      const exited = once(serverProcess, 'exit');
      serverProcess.kill('SIGKILL');
      await exited;
    }
  };
  let cookie = '';
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.ok).toBe(true);
    return response;
  };
  const sockets: WebSocket[] = [];
  const connect = (dialogueId: string) => {
    const socket = new WebSocket(base.replace('http', 'ws') + `/api/dialogues/${dialogueId}/live`, {
      headers: { cookie },
    });
    sockets.push(socket);
    const messages: Record<string, unknown>[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    socket.on('error', () => {});
    return {
      socket,
      messages,
      send: (message: unknown) => socket.send(JSON.stringify(message)),
      next: async (type: string) => {
        await expect
          .poll(
            () => {
              if (serverProcess?.exitCode !== null) throw new Error(logs);
              return messages.some((m) => m.type === type);
            },
            { timeout: 5000 },
          )
          .toBe(true);
        return messages.splice(
          messages.findIndex((m) => m.type === type),
          1,
        )[0];
      },
    };
  };
  const doc = new Y.Doc();
  try {
    await start();
    const project = await (await request('/projects', { name: 'Fault recovery' })).json();
    const access = await request(`/projects/${project.id}/access`, { token: project.ownerToken });
    cookie = access.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const node = await (
      await request(`/dialogues/${project.dialogueId}/nodes`, { kind: 'line', x: 200, y: 100 })
    ).json();
    const a = connect(project.dialogueId),
      b = connect(project.dialogueId);
    await Promise.all([a.next('ready'), b.next('ready')]);
    for (const peer of [a, b]) {
      peer.send({ type: 'open-text', nodeId: node.id });
      await peer.next('text-state');
    }
    doc.getText('text').insert(0, 'Accepted exactly once');
    const operation = {
      type: 'text-update',
      nodeId: node.id,
      operationId: crypto.randomUUID(),
      data: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
    };
    holdCommit = true;
    a.send(operation);
    await expect.poll(() => !!held).toBe(true);
    // While the actual COMMIT packet is held, public reads still see old state.
    expect(
      (await (await request(`/dialogues/${project.dialogueId}`)).json()).nodes.find(
        (n: { id: string }) => n.id === node.id,
      ).preview,
    ).toBe('');
    expect(a.messages.some((m) => m.type === 'saved')).toBe(false);
    expect(b.messages.some((m) => m.type === 'text-update')).toBe(false);
    // Lose every PostgreSQL connection before COMMIT; the real transaction rolls back.
    unavailable = true;
    holdCommit = false;
    held = undefined;
    for (const connection of connections) connection.destroy();
    expect((await a.next('error')).operationId).toBe(operation.operationId);
    expect(a.messages.some((m) => m.type === 'saved')).toBe(false);
    expect(serverProcess?.exitCode).toBe(null); // Includes errors emitted by idle pool clients.
    unavailable = false;
    a.send(operation);
    await b.next('text-update'); // Post-COMMIT proof while author loses its ACK.
    const move = {
      type: 'move-nodes',
      operationId: crypto.randomUUID(),
      positions: [{ nodeId: node.id, x: 410, y: 220 }],
    };
    a.send(move);
    await b.next('positions');
    a.socket.terminate();
    await stop(); // Actual abrupt process termination, no Fastify shutdown hooks.
    await start();
    const recovered = connect(project.dialogueId);
    await recovered.next('ready');
    recovered.send({ type: 'open-text', nodeId: node.id });
    await recovered.next('text-state');
    recovered.send(operation);
    expect((await recovered.next('saved')).operationId).toBe(operation.operationId);
    const newer = {
      ...move,
      operationId: crypto.randomUUID(),
      positions: [{ nodeId: node.id, x: 510, y: 320 }],
    };
    recovered.send(newer);
    expect((await recovered.next('saved')).operationId).toBe(newer.operationId);
    recovered.send(move);
    expect((await recovered.next('saved')).operationId).toBe(move.operationId);
    expect(
      (await (await request(`/dialogues/${project.dialogueId}`)).json()).nodes.find(
        (n: { id: string }) => n.id === node.id,
      ),
    ).toMatchObject({ x: 510, y: 320 });
    const fresh = connect(project.dialogueId);
    await fresh.next('ready');
    fresh.send({ type: 'open-text', nodeId: node.id });
    const state = await fresh.next('text-state');
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Buffer.from(String(state.data), 'base64'));
    expect(reopened.getText('text').toString()).toBe('Accepted exactly once');
    reopened.destroy();
    expect(serverProcess?.exitCode).toBe(null);
  } finally {
    for (const socket of sockets) socket.terminate();
    doc.destroy();
    await stop();
    for (const connection of connections) connection.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}, 45000);

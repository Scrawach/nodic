import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import * as Y from 'yjs';

// Public HTTP/UI/WebSocket operations only. Run against a disposable local database.
const origin = process.env.PROFILE_ORIGIN || 'http://127.0.0.1:3001';
const rounds = Number(process.env.PROFILE_ROUNDS || 10);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100)
  throw Error('PROFILE_ROUNDS must be an integer from 1 to 100');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' });
const contexts = [],
  pages = [],
  loads = [],
  heaps = [],
  drags = [],
  frames = [];
const started = new Date().toISOString();
const instrument = () => {
  window.profile = { sent: [], received: [], frames: [], socket: null };
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      window.profile.socket = this;
      this.addEventListener('message', (e) => {
        const message = JSON.parse(e.data);
        window.profile.received.push({
          at: performance.timeOrigin + performance.now(),
          message:
            message.type === 'graph'
              ? { type: 'graph', bytes: new TextEncoder().encode(e.data).length }
              : message,
        });
      });
    }
    send(data) {
      window.profile.sent.push({
        at: performance.timeOrigin + performance.now(),
        message: JSON.parse(data),
      });
      super.send(data);
    }
  };
};
const newPage = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  await context.addInitScript(instrument);
  const page = await context.newPage();
  pages.push(page);
  return page;
};
const saved = (page) =>
  expect(page.getByTestId('save-status')).toHaveText('Сохранено', { timeout: 60000 });
const quantiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
let projectId;
try {
  const owner = await newPage();
  await owner.goto(origin);
  await owner.getByLabel('Название проекта').fill('Load profile ' + started);
  await owner.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await saved(owner);
  const path = new URL(owner.url()).pathname;
  projectId = path.split('/')[2];
  await owner.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await owner.getByLabel('Ссылка редактора').inputValue();
  await owner.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const nodes = Array.from({ length: 999 }, (_, i) => ({
    id: randomUUID(),
    kind: 'line',
    x: 1000 + (i % 40) * 280,
    y: Math.floor(i / 40) * 170,
    characterId: null,
    text: `Реплика ${i}: ` + 'Текст диалога. '.repeat(12),
  }));
  const edges = nodes
    .slice(1)
    .map((n, i) => ({ id: randomUUID(), source: nodes[i].id, target: n.id, bend: null }));
  const operationId = randomUUID();
  await owner.evaluate((command) => window.profile.socket.send(JSON.stringify(command)), {
    type: 'paste-nodes',
    operationId,
    fragment: { projectId, nodes, edges },
  });
  await owner.waitForFunction(
    (id) =>
      window.profile.received.some(
        (r) => r.message.type === 'saved' && r.message.operationId === id,
      ),
    operationId,
    { timeout: 120000 },
  );
  console.log('Seeded 1000 nodes / 998 edges');
  for (let i = 0; i < 10; i++) {
    const page = i === 0 ? owner : await newPage();
    const begin = performance.now();
    await page.goto(i === 0 ? origin + path : invitation);
    await saved(page);
    await expect(page.locator('.react-flow__node')).toHaveCount(1000, { timeout: 60000 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    loads.push(performance.now() - begin);
  }
  await expect(owner.getByTestId('board-presence-count')).toHaveText('◉ 10 на доске');
  console.log('10 independent browser authors connected');
  // All authors issue one move concurrently per round; separate nodes prevent overwrite ambiguity.
  const graph = await owner.evaluate(
    () => window.profile.received.find((r) => r.message.type === 'ready').message,
  );
  const moveNodes = graph.nodes.filter((n) => n.kind === 'line').slice(0, 10);
  for (let round = 0; round < rounds; round++) {
    await Promise.all(
      pages.map((page, i) =>
        page.evaluate((command) => window.profile.socket.send(JSON.stringify(command)), {
          type: 'move-nodes',
          operationId: randomUUID(),
          positions: [{ nodeId: moveNodes[i].id, x: 500 + i * 280 + round, y: 400 + round }],
        }),
      ),
    );
    await Promise.all(
      pages.map((page) =>
        page.waitForFunction(
          () => {
            const last = window.profile.sent.filter((s) => s.message.type === 'move-nodes').at(-1);
            return window.profile.received.some(
              (r) =>
                r.message.type === 'saved' && r.message.operationId === last.message.operationId,
            );
          },
          null,
          { timeout: 60000 },
        ),
      ),
    );
    for (const page of pages) {
      const cdp = await page.context().newCDPSession(page);
      const usage = await cdp.send('Runtime.getHeapUsage');
      heaps.push(usage.usedSize / 1048576);
      await cdp.detach();
    }
    console.log(`Movement round ${round + 1}/${rounds}`);
  }
  const textNode = moveNodes[0].id;
  await Promise.all(
    pages.map((page) =>
      page.evaluate(
        (nodeId) => window.profile.socket.send(JSON.stringify({ type: 'open-text', nodeId })),
        textNode,
      ),
    ),
  );
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        (nodeId) =>
          window.profile.received.some(
            (r) => r.message.type === 'text-state' && r.message.nodeId === nodeId,
          ),
        textNode,
      ),
    ),
  );
  for (let round = 0; round < rounds; round++) {
    await Promise.all(
      pages.map(async (page, i) => {
        const doc = new Y.Doc();
        const state = await page.evaluate(
          (nodeId) =>
            window.profile.received
              .filter(
                (r) =>
                  r.message.nodeId === nodeId &&
                  ['text-state', 'text-update'].includes(r.message.type),
              )
              .map((r) => r.message.data),
          textNode,
        );
        for (const data of state) Y.applyUpdate(doc, Buffer.from(data, 'base64'));
        const vector = Y.encodeStateVector(doc);
        doc.getText('text').insert(0, `${round}/${i} `);
        const data = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64');
        doc.destroy();
        const id = randomUUID();
        await page.evaluate((command) => window.profile.socket.send(JSON.stringify(command)), {
          type: 'text-update',
          operationId: id,
          nodeId: textNode,
          data,
        });
        await page.waitForFunction(
          (id) =>
            window.profile.received.some(
              (r) => r.message.type === 'saved' && r.message.operationId === id,
            ),
          id,
          { timeout: 60000 },
        );
      }),
    );
    console.log(`Text round ${round + 1}/${rounds}`);
  }
  // Actual pointer gesture through React Flow and IndexedDB, with peers connected.
  for (let i = 0; i < 20; i++) {
    const page = pages[i % 10];
    const visibleId = await page.locator('.react-flow__node').evaluateAll((elements) =>
      elements
        .find((element) => {
          const r = element.getBoundingClientRect(),
            x = r.x + r.width / 2,
            y = r.y + r.height / 2;
          return (
            x > 400 &&
            x < innerWidth - 250 &&
            y > 180 &&
            y < innerHeight - 250 &&
            document.elementFromPoint(x, y)?.closest('.react-flow__node') === element
          );
        })
        ?.getAttribute('data-id'),
    );
    if (!visibleId) throw Error('No unobstructed node in the viewport');
    const node = page.locator(`.react-flow__node[data-id="${visibleId}"]`);
    const box = await node.boundingBox();
    if (!box) throw Error('Missing visible node');
    await page.evaluate(() => {
      window.profile.frames = [];
      window.profile.tracking = true;
      let previous = performance.now();
      const tick = (now) => {
        window.profile.frames.push(now - previous);
        previous = now;
        if (window.profile.tracking) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const before = await node.getAttribute('style');
    const sentBefore = await page.evaluate(
      () => window.profile.sent.filter((s) => s.message.type === 'move-nodes').length,
    );
    const begin = performance.now();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (i % 2 ? -12 : 12), box.y + box.height / 2 + 4, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForFunction(
      (count) => window.profile.sent.filter((s) => s.message.type === 'move-nodes').length > count,
      sentBefore,
      { timeout: 60000 },
    );
    await saved(page);
    await expect(node).not.toHaveAttribute('style', before);
    drags.push(performance.now() - begin);
    frames.push(
      ...(await page.evaluate(() => {
        window.profile.tracking = false;
        return window.profile.frames;
      })),
    );
    console.log(`Pointer gesture ${i + 1}/20`);
  }
  const logs = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => ({ sent: window.profile.sent, received: window.profile.received })),
    ),
  );
  const acknowledgements = [],
    deliveries = [],
    graphBytes = [],
    textAcks = [],
    textDeliveries = [];
  for (let author = 0; author < logs.length; author++)
    for (const sent of logs[author].sent.filter((s) => s.message.type === 'text-update')) {
      const ack = logs[author].received.find(
        (r) => r.message.type === 'saved' && r.message.operationId === sent.message.operationId,
      );
      if (!ack) throw Error('Unacknowledged text');
      textAcks.push(ack.at - sent.at);
      for (let peer = 0; peer < logs.length; peer++)
        if (peer !== author) {
          const delivery = logs[peer].received.find(
            (r) => r.message.type === 'text-update' && r.message.data === sent.message.data,
          );
          if (!delivery) throw Error('Text not delivered to every author');
          textDeliveries.push(delivery.at - sent.at);
        }
    }
  for (let author = 0; author < logs.length; author++)
    for (const sent of logs[author].sent.filter((s) => s.message.type === 'move-nodes')) {
      const ack = logs[author].received.find(
        (r) => r.message.type === 'saved' && r.message.operationId === sent.message.operationId,
      );
      if (!ack) throw Error('Unacknowledged movement');
      acknowledgements.push(ack.at - sent.at);
      const position = sent.message.positions[0];
      for (let peer = 0; peer < logs.length; peer++)
        if (peer !== author) {
          const delivery = logs[peer].received.find(
            (r) =>
              r.at >= sent.at &&
              r.message.type === 'positions' &&
              r.message.positions.some(
                (p) => p.nodeId === position.nodeId && p.x === position.x && p.y === position.y,
              ),
          );
          if (!delivery) throw Error('Movement not delivered to every author');
          deliveries.push(delivery.at - sent.at);
        }
    }
  for (const entry of logs[0].received.filter((r) => r.message.type === 'graph'))
    graphBytes.push(entry.message.bytes);
  const result = {
    started,
    environment: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      ramGiB: os.totalmem() / 2 ** 30,
      node: process.version,
      browser: browser.version(),
      origin,
    },
    profile: {
      nodes: 1000,
      edges: 998,
      authors: 10,
      rounds,
      textCharactersPerNode: nodes[0].text.length,
    },
    metrics: {
      loadMs: quantiles(loads),
      moveAckMs: quantiles(acknowledgements),
      moveDeliveryMs: quantiles(deliveries),
      textAckMs: quantiles(textAcks),
      textDeliveryMs: quantiles(textDeliveries),
      pointerGestureThroughSavedMs: quantiles(drags),
      gestureFrameIntervalMs: quantiles(frames),
      browserUsedHeapMiB: quantiles(heaps),
      graphMessageBytes: quantiles(graphBytes),
    },
  };
  await mkdir('test-results', { recursive: true });
  result.samples = {
    loadMs: loads,
    moveAckMs: acknowledgements,
    moveDeliveryMs: deliveries,
    textAckMs: textAcks,
    textDeliveryMs: textDeliveries,
    pointerGestureThroughSavedMs: drags,
    gestureFrameIntervalMs: frames,
    browserUsedHeapMiB: heaps,
    graphMessageBytes: graphBytes,
  };
  await writeFile(
    process.env.PROFILE_OUTPUT || 'test-results/load-profile.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  await owner.screenshot({ path: 'test-results/load-profile.png' });
  console.log(JSON.stringify({ ...result, samples: undefined }, null, 2));
} finally {
  try {
    if (projectId && contexts[0]) {
      const response = await contexts[0].request.post(`${origin}/api/projects/${projectId}/delete`);
      if (!response.ok()) throw Error(`Profile project cleanup failed: ${response.status()}`);
    }
  } finally {
    await browser.close();
  }
}

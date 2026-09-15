import { expect, test, type Page } from '@playwright/test';

async function create(page: Page) {
  const project = await (
    await page.request.post('/api/projects', { data: { name: 'Recovery' } })
  ).json();
  await page.request.post(`/api/projects/${project.id}/access`, {
    data: { token: project.ownerToken },
  });
  const node = await (
    await page.request.post(`/api/dialogues/${project.dialogueId}/nodes`, {
      data: { kind: 'line', x: 300, y: 200 },
    })
  ).json();
  return { project, node, path: `/p/${project.id}/d/${project.dialogueId}` };
}

for (const projectDeleted of [false, true]) {
  test(`offline author discovers deleted ${projectDeleted ? 'project' : 'dialogue'} and clears its removed outboxes`, async ({
    page,
    browser,
  }) => {
    const { project, path } = await create(page);
    await page.request.post(`/api/projects/${project.id}/dialogues`, {
      data: { name: 'Remaining' },
    });
    const context = await browser.newContext();
    const other = await context.newPage();
    let pendingId = '';
    let socketCount = 0;
    await other.routeWebSocket('**/live', (socket) => {
      socketCount++;
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'text-update') pendingId = message.operationId;
        else server.send(raw); // A durable operation whose delivery is still in flight.
      });
    });
    try {
      await context.request.post(`/api/projects/${project.id}/access`, {
        data: { token: project.editorToken },
      });
      await other.goto(path);
      await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
      await other.getByTestId('node-line').dblclick();
      await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Unconfirmed');
      await expect.poll(() => pendingId).not.toBe('');
      await expect(other.getByTestId('save-status')).toHaveText('Сохраняется…');
      let creationAttempts = 0;
      await other.route(`**/api/dialogues/${project.dialogueId}/nodes`, (route) => {
        creationAttempts++;
        return route.abort();
      });
      await other.getByRole('button', { name: 'Закрыть', exact: true }).click();
      // Keep the pane action away from the reply after its text changes its height.
      await other
        .locator('.react-flow__pane')
        .click({ button: 'right', position: { x: 50, y: 200 } });
      await other.getByRole('button', { name: 'Реплика', exact: true }).click();
      await expect.poll(() => creationAttempts).toBe(2);
      await context.setOffline(true);
      await other.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(other.getByTestId('save-status')).toHaveText('Нет соединения');
      const deletion = projectDeleted
        ? `/api/projects/${project.id}/delete`
        : `/api/dialogues/${project.dialogueId}/delete`;
      expect((await page.request.post(deletion, { data: {} })).ok()).toBe(true);
      await context.setOffline(false);
      await other.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(other.getByRole('alert')).toContainText(
        projectDeleted ? 'Проект удалён владельцем' : 'Диалог удалён владельцем',
      );
      if (projectDeleted) await expect(other).toHaveURL('http://127.0.0.1:5173/');
      else await expect(other.getByRole('link', { name: 'Remaining' })).toBeVisible();
      const pending = await other.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('keyval-store');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const stored = await new Promise<{ keys: IDBValidKey[]; creations: unknown[] }>(
          (resolve) => {
            const store = db.transaction('keyval').objectStore('keyval');
            const keys = store.getAllKeys();
            const creations = store.get('nodic-http-creations-v1');
            creations.onsuccess = () =>
              resolve({ keys: keys.result, creations: creations.result || [] });
          },
        );
        db.close();
        return { keys: stored.keys.map(String), creations: stored.creations };
      });
      expect(pending.keys.some((key) => key.endsWith(pendingId))).toBe(false);
      expect(pending.creations).toEqual([]);
      expect(socketCount).toBeLessThanOrEqual(3);
    } finally {
      await context.close();
    }
  });
}

test('a lost text ACK survives closing and restoring the tab without duplicates', async ({
  page,
  browser,
}) => {
  const { project, node, path } = await create(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  let pendingId = '';
  let attempts = 0;
  await page.routeWebSocket('**/live', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'text-update') {
        pendingId = message.operationId;
        attempts++;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      if (JSON.parse(raw.toString()).type !== 'saved') socket.send(raw);
    });
  });
  try {
    await context.request.post(`/api/projects/${project.id}/access`, {
      data: { token: project.editorToken },
    });
    await other.goto(path);
    await page.goto(path);
    for (const p of [page, other]) {
      await expect(p.getByTestId('save-status')).toHaveText('Сохранено');
      await p.getByTestId('node-line').dblclick();
    }
    await page.getByRole('textbox', { name: 'Текст реплики' }).fill('One durable update');
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toContainText(
      'One durable update',
    );
    await expect(page.getByTestId('save-status')).toHaveText('Сохраняется…');
    const tabId = await page.evaluate(() => sessionStorage.getItem('nodic-tab'));
    expect(attempts).toBe(1);
    await page.close();
    // Browser tab restoration restores sessionStorage. A new unrelated tab does
    // not claim an old tab's queue; emulate only that browser-owned restoration.
    const restored = await page.context().newPage();
    await restored.addInitScript((id) => sessionStorage.setItem('nodic-tab', id!), tabId);
    const replay: string[] = [];
    await restored.routeWebSocket('**/live', (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((raw) => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'text-update') replay.push(message.operationId);
        server.send(raw);
      });
    });
    await restored.goto(path);
    await expect(restored.getByTestId('save-status')).toHaveText('Сохранено');
    expect(replay).toEqual([pendingId]);
    await restored.getByTestId('node-line').dblclick();
    await expect(restored.getByRole('textbox', { name: 'Текст реплики' })).toContainText(
      'One durable update',
    );
    await other.reload();
    await other.getByTestId('node-line').dblclick();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toContainText(
      'One durable update',
    );
    const copy = await other.request.post(`/api/dialogues/${project.dialogueId}/copy`, {
      data: { nodeIds: [node.id] },
    });
    expect((await copy.json()).nodes[0].text).toBe('One durable update');
    await restored.close();
  } finally {
    await context.close();
  }
});

test('closing before the IndexedDB transaction completes never sends or reports the edit saved', async ({
  page,
  browser,
}) => {
  const { project, path } = await create(page);
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const result = put.call(this, value, key);
      if (value && typeof value === 'object' && 'type' in value && value.type === 'text-update') {
        const store = this;
        // Keep the real transaction active until this browsing context closes.
        // No transaction complete event, and therefore no durable send, can occur.
        const keepAlive = () => {
          store.get('__hold__').onsuccess = keepAlive;
        };
        keepAlive();
      }
      return result;
    };
  });
  let sent = 0;
  await page.routeWebSocket('**/live', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      if (JSON.parse(raw.toString()).type === 'text-update') sent++;
      server.send(raw);
    });
  });
  await page.goto(path);
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByTestId('node-line').dblclick();
  await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Not yet durable');
  await expect(page.getByTestId('save-status')).toHaveText('Сохраняется…');
  expect(sent).toBe(0);
  await page.close();
  const context = await browser.newContext();
  try {
    await context.request.post(`/api/projects/${project.id}/access`, {
      data: { token: project.editorToken },
    });
    const other = await context.newPage();
    await other.goto(path);
    await other.getByTestId('node-line').dblclick();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toHaveText('');
  } finally {
    await context.close();
  }
});

test('an ambiguous access or database failure preserves the outbox until recovery', async ({
  page,
  browser,
}) => {
  const { project, node, path } = await create(page);
  let failed = false;
  let responseStatus = 403;
  const attempts: string[] = [];
  await page.route(`**/api/projects/${project.id}/removals`, (route) =>
    failed
      ? route.fulfill({
          status: responseStatus,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporarily unavailable' }),
        })
      : route.continue(),
  );
  await page.routeWebSocket('**/live', (socket) => {
    if (failed) {
      socket.close();
      return;
    }
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'text-update') {
        attempts.push(message.operationId);
        if (attempts.length === 1) {
          failed = true;
          socket.close();
          server.close();
          return;
        }
      }
      server.send(raw);
    });
  });
  await page.goto(path);
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByTestId('node-line').dblclick();
  await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Retained through refusal');
  await expect(page.getByTestId('save-status')).toHaveText('Нет соединения');
  const outbox = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('keyval-store');
        request.onsuccess = () => resolve(request.result);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = db.transaction('keyval').objectStore('keyval').getAllKeys();
        request.onsuccess = () => resolve(request.result);
      });
      db.close();
      return keys.map(String);
    });
  expect((await outbox()).some((key) => key.endsWith(attempts[0]))).toBe(true);
  responseStatus = 503;
  const outage = page.waitForResponse(
    (response) => response.url().endsWith('/removals') && response.status() === 503,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await outage;
  expect((await outbox()).some((key) => key.endsWith(attempts[0]))).toBe(true);
  failed = false;
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  expect(attempts).toEqual([attempts[0], attempts[0]]);
  const context = await browser.newContext();
  try {
    await context.request.post(`/api/projects/${project.id}/access`, {
      data: { token: project.editorToken },
    });
    const copy = await context.request.post(`/api/dialogues/${project.dialogueId}/copy`, {
      data: { nodeIds: [node.id] },
    });
    expect((await copy.json()).nodes[0].text).toBe('Retained through refusal');
  } finally {
    await context.close();
  }
});

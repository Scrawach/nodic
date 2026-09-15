import { test, expect } from '@playwright/test';

test('two browser sessions edit one reply and undo only their own text', async ({
  browser,
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Forest encounter');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forest encounter' })).toBeVisible();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const editorLink = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 400, y: 220 } });
  await page.getByRole('button', { name: 'Реплика', exact: true }).click();
  await page.getByTestId('node-line').dblclick();
  const editorA = page.getByRole('textbox', { name: 'Текст реплики' });
  await expect(editorA).toBeEditable();
  await editorA.fill('Привет, путник.');
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');

  const contextB = await browser.newContext();
  const other = await contextB.newPage();
  try {
    await other.goto(editorLink);
    await other.getByTestId('node-line').dblclick();
    const editorB = other.getByRole('textbox', { name: 'Текст реплики' });
    await expect(editorB).toContainText('Привет, путник.');
    await editorB.press('End');
    await editorB.pressSequentially(' Я Борис.');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Привет, путник. Я Борис.');
    await expect(page.getByTestId('editor-presence')).toContainText('2');
    await editorA.press('End');
    await editorA.pressSequentially(' Я Аня.');
    await expect(other.getByTestId('node-line').locator('p')).toHaveText(
      'Привет, путник. Я Борис. Я Аня.',
    );
    await page.getByRole('button', { name: 'Отменить ввод' }).click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText(
      'Привет, путник. Я Борис.',
    );
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await page.reload();
    await page.getByTestId('node-line').dblclick();
    await expect(page.getByRole('textbox', { name: 'Текст реплики' })).toContainText(
      'Привет, путник. Я Борис.',
    );
    await page.context().setOffline(true);
    await expect(page.getByTestId('save-status')).toHaveText('Нет соединения');
    await expect(page.getByRole('textbox', { name: 'Текст реплики' })).not.toBeEditable();
    await editorB.press('End');
    await editorB.pressSequentially(' Жду тебя.');
    await page.context().setOffline(false);
    await expect(page.getByRole('textbox', { name: 'Текст реплики' })).toBeEditable();
    await expect(page.getByTestId('node-line').locator('p')).toHaveText(
      'Привет, путник. Я Борис. Жду тебя.',
    );
  } finally {
    await contextB.close();
  }
});

test('dragging a node is shared and survives reload', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Moving nodes');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    const node = page.locator('.react-flow__node').first();
    const peerNode = other.locator('.react-flow__node').first();
    const transform = (target: typeof node) =>
      target.evaluate((element) => (element as HTMLElement).style.transform);
    const before = await transform(node);
    const box = await page.getByTestId('node-start').boundingBox();
    if (!box) throw new Error('Start node is not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 70, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => transform(node)).not.toBe(before);
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    const position = await transform(node);
    await expect.poll(() => transform(peerNode)).toBe(position);
    await page.reload();
    await expect.poll(() => transform(node)).toBe(position);
    await page.context().setOffline(true);
    await expect(page.getByTestId('save-status')).toHaveText('Нет соединения');
    await expect(node).not.toHaveClass(/draggable/);
  } finally {
    await context.close();
  }
});

test('authors connect and shape edges, assign characters, delete nodes and add dialogues', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Graph review');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.node-toolbar')).toHaveCount(0);
  const pane = page.locator('.react-flow__pane');
  await pane.click({ button: 'right', position: { x: 930, y: 250 } });
  await page.getByRole('button', { name: 'Реплика', exact: true }).click();
  await pane.click({ button: 'right', position: { x: 1040, y: 610 } });
  await page.getByRole('button', { name: 'Вариант', exact: true }).click();
  const line = page.getByTestId('node-line');
  await line.click();
  await expect(line.locator('..')).toHaveClass(/selected/);
  const source = page.getByTestId('node-start').locator('[aria-label="Выход"]');
  const target = line.locator('[aria-label="Вход"]');
  await expect(source).toHaveCSS('width', '20px');
  const sourceBox = await source.boundingBox(),
    targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Missing handles');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  const edge = page.locator('.story-edge');
  await expect(edge).toHaveCount(1);
  await expect(edge.locator('.react-flow__edge-path')).toHaveAttribute('marker-end', /url/);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.locator('.story-edge')).toHaveCount(1);
    const path = edge.locator('.react-flow__edge-path');
    const midpoint = await path.evaluate((element) => {
      const path = element as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.move(midpoint.x, midpoint.y);
    await page.mouse.down();
    await page.mouse.move(midpoint.x, midpoint.y - 65, { steps: 12 });
    await page.mouse.up();
    await expect(edge).toHaveClass(/is-selected/);
    await expect(path).toHaveAttribute('d', / Q /);
    const bent = await path.getAttribute('d');
    await expect(other.locator('.story-edge .react-flow__edge-path')).toHaveAttribute('d', bent!);
    // Pull an arbitrary point onto the line between the sockets: the control point snaps to its midpoint.
    const geometry = await path.evaluate((element) => {
      const p = element as SVGPathElement,
        m = p.getScreenCTM()!;
      const a = p.getPointAtLength(0),
        b = p.getPointAtLength(p.getTotalLength());
      const hit = p.getPointAtLength(p.getTotalLength() * 0.4);
      const screenHit = new DOMPoint(hit.x, hit.y).matrixTransform(m);
      const screenMiddle = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(m);
      return {
        hit: { x: screenHit.x, y: screenHit.y },
        middle: { x: screenMiddle.x, y: screenMiddle.y },
      };
    });
    await page.mouse.move(geometry.hit.x, geometry.hit.y);
    await page.mouse.down();
    await page.mouse.move(geometry.middle.x, geometry.middle.y, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() =>
        path.evaluate((element) => {
          const p = element as SVGPathElement,
            a = p.getPointAtLength(0),
            b = p.getPointAtLength(p.getTotalLength()),
            m = p.getPointAtLength(p.getTotalLength() / 2);
          return Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
        }),
      )
      .toBeLessThan(1);
    await line.dblclick();
    await page.getByRole('button', { name: 'Новый персонаж' }).click();
    await page.getByLabel('Имя персонажа').fill('Лесник');
    await page.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
    await expect(page.getByLabel('Персонаж', { exact: true }).locator('option:checked')).toHaveText(
      'Лесник',
    );
    await expect(other.getByTestId('node-line').locator('.node-character')).toHaveText('Лесник');
    const originalBackground = await other
      .getByTestId('node-line')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByLabel('Цвет персонажа', { exact: true }).fill('#487fbd');
    await page.getByRole('button', { name: 'Сохранить цвет' }).click();
    await expect
      .poll(() =>
        other
          .getByTestId('node-line')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(originalBackground);
    const colouredBackground = await other
      .getByTestId('node-line')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Куда идёшь?');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByTestId('node-choice').dblclick();
    await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Пойти к реке');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByTestId('node-choice')).toHaveText('Пойти к реке');
    await page.screenshot({ path: test.info().outputPath('board-review.png') });
    await page.reload();
    await expect(page.getByTestId('node-line').locator('.node-character')).toHaveText('Лесник');
    await expect(page.locator('.story-edge')).toHaveCount(1);
    await page.getByTestId('node-line').dblclick();
    await expect(page.getByRole('textbox', { name: 'Текст реплики' })).toHaveText('Куда идёшь?');
    await expect(page.getByLabel('Цвет персонажа', { exact: true })).toHaveValue('#487fbd');
    await expect
      .poll(() =>
        page
          .getByTestId('node-line')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe(colouredBackground);
    await page.getByLabel('Персонаж', { exact: true }).selectOption('');
    await expect
      .poll(() =>
        other
          .getByTestId('node-line')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(colouredBackground);
    await page.getByLabel('Персонаж', { exact: true }).selectOption({ label: 'Лесник' });
    await expect
      .poll(() =>
        other
          .getByTestId('node-line')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe(colouredBackground);
    await other.getByTestId('node-line').click({ button: 'right' });
    await other.getByRole('button', { name: 'Удалить ноду' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Нода удалена');
    await expect(page.locator('.story-edge')).toHaveCount(0);
    await expect(page.getByTestId('node-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await page.getByLabel('Название диалога').fill('У костра');
    await page.getByRole('button', { name: 'Создать диалог', exact: true }).click();
    await expect(page.locator('.dialogue-link.active')).toHaveText(/У костра/);
    await expect(page.getByTestId('node-start')).toHaveCount(1);
    await expect(page.getByTestId('node-choice')).toHaveCount(0);
    await expect(other.getByRole('link', { name: 'У костра' })).toBeVisible();
    await page.getByRole('link', { name: 'Первый диалог' }).click();
    await expect(page.getByTestId('node-choice')).toHaveCount(1);
    await expect(page.getByTestId('node-line')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a lost creation response is replayed after reload without duplicate nodes', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Durable creation');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Durable creation' })).toBeVisible();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const editorLink = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(editorLink);
    await expect(other.getByTestId('node-start')).toBeVisible();
    const keys: string[] = [];
    await page.route('**/api/dialogues/*/nodes', async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort('failed');
    });
    await page
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 400, y: 220 } });
    await page.getByRole('button', { name: 'Реплика', exact: true }).click();
    await expect.poll(() => keys.length).toBe(2);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await page.unroute('**/api/dialogues/*/nodes');
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/dialogues\/[^/]+\/nodes$/.test(new URL(request.url()).pathname)
      ) {
        keys.push(request.headers()['idempotency-key']!);
      }
    });
    await page.reload();
    await expect(page.getByTestId('node-line')).toHaveCount(1);
    await expect.poll(() => keys.length).toBe(3);
    expect(keys[0]).toBeTruthy();
    expect(new Set(keys).size).toBe(1);
    await other.reload();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

for (const kind of ['dialogues', 'characters'] as const) {
  test('lost ' + kind + ' creation response recovers on reopening project', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Название проекта').fill('Project recovery');
    await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project recovery' })).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    if (kind === 'characters') {
      await page
        .locator('.react-flow__pane')
        .click({ button: 'right', position: { x: 400, y: 220 } });
      await page.getByRole('button', { name: 'Реплика', exact: true }).click();
      await page.getByTestId('node-line').dblclick();
      await page.getByRole('button', { name: 'Новый персонаж' }).click();
      await page.getByLabel('Имя персонажа').fill('Recovered');
    } else {
      await page.getByRole('button', { name: 'Новый диалог' }).click();
      await page.getByLabel('Название диалога').fill('Recovered');
    }
    const pattern = '**/api/projects/*/' + kind;
    const keys: string[] = [];
    await page.route(pattern, async (route) => {
      keys.push(route.request().headers()['idempotency-key']!);
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
    });
    await page
      .getByRole('button', {
        name: kind === 'characters' ? 'Создать персонажа' : 'Создать диалог',
        exact: true,
      })
      .click();
    await expect.poll(() => keys.length).toBe(2);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.unroute(pattern);
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/' + kind))
        keys.push(request.headers()['idempotency-key']!);
    });
    await page.reload();
    await expect.poll(() => keys.length).toBe(3);
    expect(new Set(keys).size).toBe(1);
    if (kind === 'characters') {
      await page.getByTestId('node-line').dblclick();
      await expect(
        page
          .getByLabel('Персонаж', { exact: true })
          .locator('option')
          .filter({ hasText: 'Recovered' }),
      ).toHaveCount(1);
    } else {
      await expect(page.getByRole('link', { name: 'Recovered' })).toHaveCount(1);
    }
  });
}

test('structural undo and redo are shared and preserve a later colleague move', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('History');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  const transform = (p: typeof page) =>
    p
      .getByTestId('node-start')
      .locator('..')
      .evaluate((el) => (el as HTMLElement).style.transform);
  const move = async (p: typeof page, dx: number) => {
    const box = await p.getByTestId('node-start').boundingBox();
    if (!box) throw Error('Missing node');
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + 30, { steps: 10 });
    await p.mouse.up();
    await expect(p.getByTestId('save-status')).toHaveText('Сохранено');
  };
  try {
    await other.goto(link);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    const initial = await transform(page);
    await move(page, 90);
    await expect(
      page.getByRole('button', { name: 'Отменить структуру', exact: true }),
    ).toBeEnabled();
    const moved = await transform(page);
    await page.getByRole('button', { name: 'Отменить структуру', exact: true }).click();
    await expect.poll(() => transform(other)).toBe(initial);
    await page.getByRole('button', { name: 'Повторить структуру', exact: true }).click();
    await expect.poll(() => transform(other)).toBe(moved);
    await move(other, 70);
    const foreign = await transform(other);
    await expect.poll(() => transform(page)).toBe(foreign);
    await page.getByRole('button', { name: 'Отменить структуру', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Отмена пропущена');
    await expect.poll(() => transform(page)).toBe(foreign);
  } finally {
    await context.close();
  }
});

test('creation and deletion undo restore the same node and its shared text', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Restoration');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    await page
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 400, y: 220 } });
    await page.getByRole('button', { name: 'Реплика', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await page.getByRole('button', { name: 'Отменить структуру', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить структуру', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Текст коллеги');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await page.getByTestId('node-line').click({ button: 'right' });
    await page.getByRole('button', { name: 'Удалить ноду' }).click();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить структуру', exact: true }).click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await other.getByTestId('node-line').dblclick();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toHaveText('Текст коллеги');
    await page.getByRole('button', { name: 'Повторить структуру', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить структуру', exact: true }).click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Новая правка коллеги');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Новая правка коллеги');
    await page.getByRole('button', { name: 'Повторить структуру', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('текст другого автора');
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Новая правка коллеги');
  } finally {
    await context.close();
  }
});

test('lost Undo and Redo receipts replay after reconnect without losing history', async ({
  page,
  browser,
}) => {
  const attempts = new Map<string, number>();
  const dropped = new Set<string>();
  await page.routeWebSocket('**/live', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'reverse-graph') {
        attempts.set(message.operationId, (attempts.get(message.operationId) || 0) + 1);
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (
        message.type === 'saved' &&
        attempts.has(message.operationId) &&
        !dropped.has(message.operationId)
      ) {
        dropped.add(message.operationId);
        socket.close();
        server.close();
        return;
      }
      socket.send(raw);
    });
  });
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Reversal reconnect');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    await page
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 400, y: 220 } });
    await page.getByRole('button', { name: 'Реплика', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    for (const [button, count] of [
      ['Отменить структуру', 0],
      ['Повторить структуру', 1],
      ['Отменить структуру', 0],
    ] as const) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(other.getByTestId('node-line')).toHaveCount(count);
      await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
      await expect(page.getByTestId('node-line')).toHaveCount(count);
    }
    expect(dropped.size).toBe(3);
    expect([...attempts.values()]).toEqual([2, 2, 2]);
    await expect(
      page.getByRole('button', { name: 'Повторить структуру', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Отменить структуру', exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

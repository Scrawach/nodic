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
    await page.getByRole('dialog').getByRole('button', { name: 'Отменить', exact: true }).click();
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
    await expect(other.getByTestId('remote-edge-selection')).toHaveCount(1);
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
    await page.getByRole('dialog').getByRole('button', { name: 'Новый персонаж' }).click();
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
      await page.getByRole('dialog').getByRole('button', { name: 'Новый персонаж' }).click();
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
    await expect(page.getByRole('button', { name: 'Отменить', exact: true }).first()).toBeEnabled();
    const moved = await transform(page);
    await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
    await expect.poll(() => transform(other)).toBe(initial);
    await page.getByRole('button', { name: 'Повторить', exact: true }).first().click();
    await expect.poll(() => transform(other)).toBe(moved);
    await move(other, 70);
    const foreign = await transform(other);
    await expect.poll(() => transform(page)).toBe(foreign);
    await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
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
    await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить', exact: true }).first().click();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Текст коллеги');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await page.getByTestId('node-line').click({ button: 'right' });
    await page.getByRole('button', { name: 'Удалить ноду' }).click();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await other.getByTestId('node-line').dblclick();
    await expect(other.getByRole('textbox', { name: 'Текст реплики' })).toHaveText('Текст коллеги');
    await page.getByRole('button', { name: 'Повторить', exact: true }).first().click();
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить', exact: true }).first().click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Текст коллеги');
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Новая правка коллеги');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Новая правка коллеги');
    await page.getByRole('button', { name: 'Повторить', exact: true }).first().click();
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
      ['Отменить', 0],
      ['Повторить', 1],
      ['Отменить', 0],
    ] as const) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(other.getByTestId('node-line')).toHaveCount(count);
      await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
      await expect(page.getByTestId('node-line')).toHaveCount(count);
    }
    expect(dropped.size).toBe(3);
    expect([...attempts.values()]).toEqual([2, 2, 2]);
    await expect(
      page.getByRole('button', { name: 'Повторить', exact: true }).first(),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Отменить', exact: true }).first(),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test('one history follows text, movement and another editor despite focus and foreign text', async ({
  page,
  browser,
}) => {
  let movementId: string | undefined;
  let releaseMovement: (() => void) | undefined;
  await page.routeWebSocket('**/live', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'move-nodes' && !movementId) movementId = message.operationId;
      server.send(raw);
    });
    server.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'saved' && message.operationId === movementId && !releaseMovement) {
        releaseMovement = () => socket.send(raw);
        return;
      }
      socket.send(raw);
    });
  });
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Unified history');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  for (const [x, kind] of [
    [400, 'Реплика'],
    [720, 'Вариант'],
  ] as const) {
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x, y: 280 } });
    await page.getByRole('button', { name: kind, exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  }
  const context = await browser.newContext();
  const other = await context.newPage();
  const position = (p: typeof page) =>
    p
      .getByTestId('node-line')
      .locator('..')
      .evaluate((el) => (el as HTMLElement).style.transform);
  const editor = page.getByRole('textbox', { name: 'Текст реплики' });
  const saved = () => expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  try {
    await other.goto(link);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    await page.getByTestId('node-line').dblclick();
    await editor.fill('Первый');
    await saved();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const initial = await position(page);
    const box = await page.getByTestId('node-line').boundingBox();
    if (!box) throw Error('Missing start');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => position(page)).not.toBe(initial);
    const moved = await position(page);
    await page.getByTestId('node-choice').dblclick();
    await editor.fill('Второй');
    await expect(page.getByTestId('save-status')).toHaveText('Сохраняется…');
    await expect.poll(() => Boolean(releaseMovement)).toBe(true);
    releaseMovement!();
    await saved();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await other.getByTestId('node-line').dblclick();
    const foreign = other.getByRole('textbox', { name: 'Текст реплики' });
    await foreign.press('End');
    await foreign.pressSequentially(' коллега');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Первый коллега');
    // Focus the first editor: Undo must still start with the second editor's text.
    await page.getByTestId('node-line').dblclick();
    await editor.press('Control+z');
    await saved();
    await expect(other.getByTestId('node-choice').locator('p')).toHaveText('');
    await editor.press('Control+z');
    await saved();
    await expect.poll(() => position(other)).toBe(initial);
    await editor.press('Control+z');
    await saved();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('коллега');
    await editor.press('Control+Shift+z');
    await saved();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Первый коллега');
    await editor.press('Control+y');
    await saved();
    await expect.poll(() => position(other)).toBe(moved);
    await editor.press('Control+Shift+z');
    await saved();
    await expect(other.getByTestId('node-choice').locator('p')).toHaveText('Второй');
    // A new local action clears Redo across editors. A foreign deletion then
    // makes that action empty, but must not make Undo reach the older first text.
    await editor.press('Control+z');
    await saved();
    await editor.press('End');
    await editor.pressSequentially(' лишнее');
    await saved();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Повторить', exact: true }),
    ).toBeDisabled();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Первый коллега лишнее');
    await foreign.press('End');
    for (let i = 0; i < ' лишнее'.length; i++) await foreign.press('Shift+ArrowLeft');
    await foreign.press('Backspace');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Первый коллега');
    await editor.press('Control+z');
    await saved();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Первый коллега');
    await expect.poll(() => position(other)).toBe(moved);
    // A colleague's later movement conflicts with the next structural Undo.
    await other.keyboard.press('Escape');
    await expect(other.getByRole('dialog')).toHaveCount(0);
    const otherBox = await other.getByTestId('node-line').boundingBox();
    if (!otherBox) throw Error('Missing line');
    await other.mouse.move(otherBox.x + otherBox.width / 2, otherBox.y + otherBox.height / 2);
    await other.mouse.down();
    await other.mouse.move(
      otherBox.x + otherBox.width / 2 + 60,
      otherBox.y + otherBox.height / 2 + 30,
      { steps: 10 },
    );
    await other.mouse.up();
    await expect.poll(() => position(other)).not.toBe(moved);
    const foreignPosition = await position(other);
    await expect.poll(() => position(page)).toBe(foreignPosition);
    await editor.press('Control+z');
    await expect(page.getByRole('alert')).toContainText('Отмена пропущена');
    await expect.poll(() => position(page)).toBe(foreignPosition);
    await editor.press('Control+z');
    await saved();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('коллега');
  } finally {
    await context.close();
  }
});

test('a delayed creation receipt keeps creation before later text in history', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Delayed creation history');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/dialogues/*/nodes', async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 400, y: 280 } });
    await page.getByRole('button', { name: 'Реплика', exact: true }).click();
    await expect(page.getByTestId('node-line')).toHaveCount(1);
    await page.getByTestId('node-line').dblclick();
    const editor = page.getByRole('textbox', { name: 'Текст реплики' });
    await editor.fill('После создания');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Отменить', exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Отменить', exact: true }),
    ).toBeEnabled();
    await editor.press('Control+z');
    await expect(editor).toHaveText('');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await editor.press('Control+z');
    await expect(page.getByTestId('node-line')).toHaveCount(0);
  } finally {
    release();
  }
});

test('selected nodes delete together and undo together while start stays protected', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Delete selection');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  for (const [x, kind] of [
    [400, 'Реплика'],
    [720, 'Вариант'],
  ] as const) {
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x, y: 280 } });
    await page.getByRole('button', { name: kind, exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  }
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await page.getByTestId('node-line').click();
    await page.getByTestId('node-choice').click({ modifiers: ['Shift'] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await page.getByTestId('node-choice').click({ button: 'right' });
    await page.getByRole('button', { name: 'Удалить выделенные (2)' }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await expect(other.getByTestId('node-choice')).toHaveCount(0);
    await expect(other.getByTestId('node-start')).toHaveCount(1);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    await expect(other.getByTestId('node-choice')).toHaveCount(1);
    await page.getByTestId('node-line').click();
    await page.getByTestId('node-choice').click({ modifiers: ['Shift'] });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await page.keyboard.press('Delete');
    await expect(other.getByTestId('node-line')).toHaveCount(0);
    await expect(other.getByTestId('node-choice')).toHaveCount(0);
    await page.getByTestId('node-start').click();
    await page.keyboard.press('Delete');
    await expect(other.getByTestId('node-start')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('a branch copies between dialogues and undo removes the whole independent paste', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Paste branch');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  for (const [x, kind] of [
    [400, 'Реплика'],
    [720, 'Вариант'],
  ] as const) {
    await page.locator('.react-flow__pane').click({ button: 'right', position: { x, y: 280 } });
    await page.getByRole('button', { name: kind, exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  }
  await page.getByTestId('node-line').dblclick();
  await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Исходник');
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const from = await page.getByTestId('node-line').locator('[aria-label="Выход"]').boundingBox();
  const to = await page.getByTestId('node-choice').locator('[aria-label="Вход"]').boundingBox();
  if (!from || !to) throw Error('Missing handles');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.story-edge')).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByTestId('node-line').click();
  await page.getByTestId('node-choice').click({ modifiers: ['Shift'] });
  await page.getByTestId('node-choice').click({ button: 'right' });
  await page.getByRole('button', { name: 'Копировать ноды', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Копировать ноды', exact: true })).toHaveCount(0);
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(invitation);
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Изменён исходник');
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Изменён исходник');
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await page
      .getByRole('dialog', { name: 'Новый диалог' })
      .getByRole('textbox')
      .fill('Копия ветки');
    await page.getByRole('button', { name: 'Создать диалог', exact: true }).click();
    await expect(page.getByTestId('node-line')).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await page
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 380, y: 280 } });
    await page.getByRole('button', { name: 'Вставить ноды', exact: true }).click();
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Исходник');
    await expect(page.getByTestId('node-choice')).toHaveCount(1);
    await expect(page.locator('.story-edge')).toHaveCount(1);
    await expect(page.getByTestId('node-start')).toHaveCount(1);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByTestId('node-line')).toHaveCount(0);
    await expect(page.getByTestId('node-choice')).toHaveCount(0);
    await expect(page.locator('.story-edge')).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Исходник');
    await page.getByTestId('node-line').dblclick();
    await page.getByRole('textbox', { name: 'Текст реплики' }).fill('Независимая копия');
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Изменён исходник');
    await other.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await other.getByRole('link', { name: 'Копия ветки' }).click();
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Независимая копия');
  } finally {
    await context.close();
  }
});

test('sidebar characters can be created and edited by independent authors with project isolation', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Персонажи в проекте');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  const projectId = new URL(page.url()).pathname.split('/')[2];
  const list = (p: typeof page) => p.getByRole('region', { name: 'Персонажи проекта' });
  const character = (p: typeof page, name: string) =>
    list(p).getByRole('button', { name: new RegExp(name) });
  await expect(list(page).getByText('Персонажей пока нет')).toBeVisible();
  const charactersBox = await list(page).boundingBox();
  const dialogueBox = await page.getByRole('link', { name: 'Первый диалог' }).boundingBox();
  expect(charactersBox!.y + charactersBox!.height).toBeLessThan(dialogueBox!.y);
  await page.screenshot({ path: 'test-results/character-sidebar-empty.png' });
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const isolatedContext = await browser.newContext();
  const other = await context.newPage();
  const isolated = await isolatedContext.newPage();
  try {
    await other.goto(invitation);
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    await isolated.goto('/');
    await isolated.getByLabel('Название проекта').fill('Отдельный проект');
    await isolated.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(isolated.getByTestId('save-status')).toHaveText('Сохранено');
    await page.getByRole('button', { name: 'Новый персонаж' }).click();
    const create = page.getByRole('dialog', { name: 'Новый персонаж', exact: true });
    await create.getByLabel('Имя нового персонажа').fill('Проводник');
    await create.getByLabel('Цвет нового персонажа').fill('#123456');
    await create.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
    await expect(create).toHaveCount(0);
    for (const p of [page, other]) {
      await expect(character(p, 'Проводник')).toBeVisible();
      await expect(character(p, 'Проводник').getByRole('img')).toHaveCSS(
        'background-color',
        'rgb(18, 52, 86)',
      );
    }
    await expect(list(isolated).getByText('Персонажей пока нет')).toBeVisible();
    const denied = await isolated.request.post(`/api/projects/${projectId}/characters`, {
      data: { name: 'Чужой', color: '#111111' },
    });
    expect(denied.status()).toBe(403);
    await page.screenshot({ path: 'test-results/character-sidebar-list.png' });
    await character(page, 'Проводник').click();
    await character(other, 'Проводник').click();
    const edit = (p: typeof page) => p.getByRole('dialog', { name: 'Редактирование персонажа' });
    await edit(other).getByLabel('Имя персонажа', { exact: true }).fill('Наставник');
    await edit(other).getByRole('button', { name: 'Сохранить имя', exact: true }).click();
    await expect(edit(page).getByLabel('Имя персонажа', { exact: true })).toHaveValue('Наставник');
    await edit(other).getByLabel('Цвет персонажа', { exact: true }).fill('#654321');
    await edit(other).getByRole('button', { name: 'Сохранить цвет', exact: true }).click();
    await expect(edit(page).getByLabel('Цвет персонажа', { exact: true })).toHaveValue('#654321');
    for (const p of [page, other]) {
      await expect(character(p, 'Наставник')).toHaveAttribute('aria-pressed', 'true');
      await expect(character(p, 'Наставник').getByRole('img')).toHaveCSS(
        'background-color',
        'rgb(101, 67, 33)',
      );
    }
    await page.screenshot({ path: 'test-results/character-sidebar-editor.png' });
    await page.reload();
    await expect(character(page, 'Наставник')).toBeVisible();
    await character(page, 'Наставник').click();
    await edit(other).getByRole('button', { name: 'Удалить персонажа', exact: true }).click();
    await edit(other).getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(character(page, 'Наставник')).toBeVisible();
    await expect(edit(other).getByRole('button', { name: 'Подтвердить удаление' })).toHaveCount(0);
    await context.setOffline(true);
    await expect(edit(other).getByLabel('Имя персонажа', { exact: true })).toBeDisabled();
    await context.setOffline(false);
    await expect(edit(other).getByLabel('Имя персонажа', { exact: true })).toBeEnabled();
    await edit(other).getByRole('button', { name: 'Удалить персонажа', exact: true }).click();
    await page.screenshot({ path: 'test-results/character-sidebar-open.png' });
    await other.screenshot({ path: 'test-results/character-sidebar-confirm.png' });
    await edit(other).getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
    for (const p of [page, other]) {
      await expect(edit(p)).toHaveCount(0);
      await expect(list(p).getByText('Персонажей пока нет')).toBeVisible();
    }
    await expect(list(isolated).getByText('Персонажей пока нет')).toBeVisible();
    await page.reload();
    await expect(list(page).getByText('Персонажей пока нет')).toBeVisible();
    const longName = 'ОченьДлинноеИмяПерсонажа'.repeat(5);
    for (let index = 0; index < 14; index++) {
      const response = await page.request.post(`/api/projects/${projectId}/characters`, {
        data: { name: index === 0 ? longName : `Персонаж ${index}`, color: '#456789' },
      });
      expect(response.ok()).toBe(true);
    }
    await expect(list(page).getByRole('button')).toHaveCount(15);
    await character(page, longName).scrollIntoViewIfNeeded();
    const longBox = await character(page, longName).boundingBox();
    const sidebarBox = await page.locator('.sidebar').boundingBox();
    expect(longBox!.x + longBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);
    await page.screenshot({ path: 'test-results/character-sidebar-long-name.png' });
    await page.getByRole('link', { name: 'Первый диалог' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Новый диалог' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/character-sidebar-scroll.png' });
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await expect(page.getByRole('dialog', { name: 'Новый диалог' })).toBeVisible();
  } finally {
    await context.close();
    await isolatedContext.close();
  }
});

test('the character catalogue updates authors in different dialogues and preserves their text', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Shared characters');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const directoryPath = await page
    .getByRole('link', { name: 'Персонажи', exact: true })
    .getAttribute('href');
  const directory = await page.context().newPage();
  const context = await browser.newContext();
  const other = await context.newPage();
  const line = async (p: typeof page, text: string) => {
    await p.locator('.react-flow__pane').click({ button: 'right', position: { x: 400, y: 280 } });
    await p.getByRole('button', { name: 'Реплика', exact: true }).click();
    await p.getByTestId('node-line').dblclick();
    await p.getByRole('textbox', { name: 'Текст реплики' }).fill(text);
    await p.getByLabel('Персонаж', { exact: true }).selectOption({ label: 'Проводник' });
    await expect(p.getByTestId('save-status')).toHaveText('Сохранено');
  };
  try {
    await directory.goto(directoryPath!);
    await expect(directory.getByRole('heading', { name: 'Персонажи', exact: true })).toBeVisible();
    await directory.getByLabel('Имя нового персонажа').fill('Проводник');
    await directory.getByLabel('Цвет нового персонажа').fill('#123456');
    await directory.getByRole('button', { name: 'Создать персонажа', exact: true }).click();
    await expect(directory.getByRole('article', { name: 'Проводник' })).toBeVisible();
    await other.goto(invitation);
    await other.getByRole('link', { name: 'Первый диалог' }).click();
    await line(other, 'Первый диалог');
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await page
      .getByRole('dialog', { name: 'Новый диалог' })
      .getByRole('textbox')
      .fill('Второй диалог');
    await page.getByRole('button', { name: 'Создать диалог', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await line(page, 'Второй диалог');
    const row = directory.getByRole('article', { name: 'Проводник', exact: true });
    await row.getByLabel('Имя персонажа', { exact: true }).fill('Наставник');
    await row.getByRole('button', { name: 'Сохранить имя', exact: true }).click();
    for (const p of [page, other])
      await expect(p.getByTestId('node-line').locator('.node-character')).toHaveText('Наставник');
    const renamed = directory.getByRole('article', { name: 'Наставник', exact: true });
    await renamed.getByLabel('Цвет персонажа', { exact: true }).fill('#654321');
    await renamed.getByRole('button', { name: 'Сохранить цвет', exact: true }).click();
    for (const p of [page, other])
      await expect(p.getByTestId('node-line')).toHaveCSS('--character-color', '#654321');
    await renamed.getByRole('button', { name: 'Удалить персонажа', exact: true }).click();
    await renamed.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
    await expect(directory.getByRole('article')).toHaveCount(0);
    for (const p of [page, other]) {
      await expect(p.getByTestId('node-line').locator('.node-character')).toHaveText(
        'Неизвестный персонаж',
      );
      await expect(p.getByLabel('Персонаж', { exact: true })).toHaveValue('__missing');
      await expect(p.getByRole('option', { name: 'Наставник', exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId('node-line').locator('p')).toHaveText('Второй диалог');
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Первый диалог');
    await other.reload();
    await expect(other.getByTestId('node-line').locator('.node-character')).toHaveText(
      'Неизвестный персонаж',
    );
    await expect(other.getByTestId('node-line').locator('p')).toHaveText('Первый диалог');
    await directory.screenshot({ path: 'test-results/character-catalogue.png', fullPage: true });
  } finally {
    await directory.close();
    await context.close();
  }
});

test('owners delete open dialogues and projects while editors can rename and are redirected', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Before management');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const originalPath = new URL(page.url()).pathname;
  const directoryPath = await page
    .getByRole('link', { name: 'Персонажи', exact: true })
    .getAttribute('href');
  const directory = await page.context().newPage();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await directory.goto(directoryPath!);
    await expect(directory.getByRole('heading', { name: 'Персонажи', exact: true })).toBeVisible();
    await other.goto(invitation);
    await other.getByRole('link', { name: 'Первый диалог' }).click();
    await other.getByRole('button', { name: 'Управление проектом', exact: true }).click();
    const editorDialog = other.getByRole('dialog', { name: 'Управление проектом' });
    await expect(
      editorDialog.getByRole('button', { name: 'Удалить проект', exact: true }),
    ).toHaveCount(0);
    await editorDialog.getByLabel('Название проекта', { exact: true }).fill('After management');
    await editorDialog.getByRole('button', { name: 'Переименовать проект', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'After management', exact: true }),
    ).toBeVisible();
    await editorDialog.getByLabel('Название диалога', { exact: true }).fill('Удаляемый диалог');
    await editorDialog.getByRole('button', { name: 'Переименовать диалог', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Удаляемый диалог' })).toBeVisible();
    await editorDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await other
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 400, y: 280 } });
    await other.getByRole('button', { name: 'Реплика', exact: true }).click();
    await other.getByTestId('node-line').dblclick();
    await other.getByRole('textbox', { name: 'Текст реплики' }).fill('Открытый текст');
    await expect(other.getByTestId('save-status')).toHaveText('Сохранено');
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await page
      .getByRole('dialog', { name: 'Новый диалог' })
      .getByRole('textbox')
      .fill('Оставшийся диалог');
    await page.getByRole('button', { name: 'Создать диалог', exact: true }).click();
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(originalPath);
    await page.goto(originalPath);
    await page.getByRole('button', { name: 'Управление проектом', exact: true }).click();
    const ownerDialog = page.getByRole('dialog', { name: 'Управление проектом' });
    await ownerDialog.getByRole('button', { name: 'Удалить диалог', exact: true }).click();
    await ownerDialog.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
    for (const p of [page, other]) {
      await expect(p.getByRole('alert')).toContainText('Диалог удалён владельцем');
      await expect(p.getByRole('textbox', { name: 'Текст реплики' })).toHaveCount(0);
      await expect(p.getByRole('link', { name: 'Оставшийся диалог' })).toBeVisible();
      await expect(p.getByRole('link', { name: 'Удаляемый диалог' })).toHaveCount(0);
    }
    await expect(directory.getByRole('heading', { name: 'Персонажи', exact: true })).toBeVisible();
    await expect(
      directory.getByRole('button', { name: 'Создать персонажа', exact: true }),
    ).toBeDisabled();
    await directory.getByLabel('Имя нового персонажа').fill('После удаления диалога');
    await expect(
      directory.getByRole('button', { name: 'Создать персонажа', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Управление проектом', exact: true }).click();
    await expect(
      ownerDialog.getByRole('button', { name: 'Удалить диалог', exact: true }),
    ).toBeDisabled();
    await ownerDialog.getByRole('button', { name: 'Удалить проект', exact: true }).click();
    await ownerDialog.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click();
    for (const p of [page, other, directory]) {
      await expect(p).toHaveURL('http://127.0.0.1:5173/');
      await expect(p.getByRole('alert')).toContainText('Проект удалён владельцем');
      await expect(p.getByRole('link').filter({ hasText: 'After management' })).toHaveCount(0);
    }
  } finally {
    await directory.close();
    await context.close();
  }
});

test('board authors share cursor and selection identity and leave on disconnect or dialogue change', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Board presence');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const sourcePath = new URL(page.url()).pathname;
  await page.getByTestId('board-presence-count').click();
  await page.getByLabel('Ваше имя').fill('Аня');
  await page.getByLabel('Ваше имя').press('Enter');
  await page.getByTestId('board-presence-count').click();
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 400, y: 280 } });
  await page.getByRole('button', { name: 'Реплика', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(invitation);
    await other.getByRole('link', { name: 'Первый диалог' }).click();
    await expect(page.getByTestId('board-presence-count')).toHaveText('◉ 2 на доске');
    await other.getByTestId('board-presence-count').click();
    await other.getByLabel('Ваше имя').fill('Борис');
    await other.getByLabel('Ваше имя').press('Enter');
    await expect(other.getByRole('list', { name: 'Авторы на доске' })).toContainText('Аня');
    await other.getByTestId('board-presence-count').click();
    const box = await page.getByTestId('node-line').boundingBox();
    if (!box) throw Error('Missing node');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(other.getByTestId('remote-cursor')).toContainText('Аня');
    const initial = await other.getByTestId('remote-cursor').getAttribute('style');
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40);
    await expect(other.getByTestId('remote-cursor')).not.toHaveAttribute('style', initial!);
    await page.getByTestId('node-line').click();
    await expect(other.getByTestId('remote-node-selection')).toHaveText('Аня');
    await other.screenshot({ path: 'test-results/board-presence.png', fullPage: true });
    await page.getByTestId('node-line').dblclick();
    await other.getByTestId('node-line').dblclick();
    await expect(other.getByTestId('editor-presence')).toContainText('2');
    await expect(other.locator('.cm-ySelectionInfo')).toContainText('Аня');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await other.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.context().setOffline(true);
    await expect(other.getByTestId('board-presence-count')).toHaveText('◉ 1 на доске');
    await expect(other.getByTestId('remote-cursor')).toHaveCount(0);
    await expect(other.getByTestId('remote-node-selection')).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(other.getByTestId('board-presence-count')).toHaveText('◉ 2 на доске');
    await page.getByRole('button', { name: 'Новый диалог' }).click();
    await page
      .getByRole('dialog', { name: 'Новый диалог' })
      .getByRole('textbox')
      .fill('Другая доска');
    await page.getByRole('button', { name: 'Создать диалог', exact: true }).click();
    await expect(page.getByTestId('board-presence-count')).toHaveText('◉ 1 на доске');
    await expect(other.getByTestId('board-presence-count')).toHaveText('◉ 1 на доске');
    await expect(other.getByTestId('remote-node-selection')).toHaveCount(0);
    await page.goto(sourcePath);
    await expect(other.getByTestId('board-presence-count')).toHaveText('◉ 2 на доске');
    await page.getByTestId('board-presence-count').click();
    await expect(page.getByRole('list', { name: 'Авторы на доске' })).toContainText('Аня');
    await expect(page.getByRole('list', { name: 'Авторы на доске' })).toContainText('Борис');
  } finally {
    await context.close();
  }
});

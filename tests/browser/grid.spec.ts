import { test, expect, type Page } from '@playwright/test';

const aligned = async (p: Page, id: string) =>
  p.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => {
    const handle =
      el.querySelector('.react-flow__handle-left') || el.querySelector('.react-flow__handle');
    const rect = handle!.getBoundingClientRect();
    const viewport = document.querySelector('.react-flow__viewport')!;
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform);
    const flow = document.querySelector('.react-flow')!.getBoundingClientRect();
    const x = (rect.x + rect.width / 2 - flow.x - matrix.e) / matrix.a;
    const y = (rect.y + rect.height / 2 - flow.y - matrix.f) / matrix.a;
    return Math.max(Math.abs(x / 24 - Math.round(x / 24)), Math.abs(y / 24 - Math.round(y / 24)));
  });

test('socket grid aligns creation and zoomed dragging without moving old nodes', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Socket grid');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  const dialogueId = new URL(page.url()).pathname.split('/').at(-1)!;
  const snapshot = async (p = page) =>
    (await (await p.request.get(`/api/dialogues/${dialogueId}`)).json()).nodes as {
      id: string;
      x: number;
      y: number;
      kind: string;
    }[];
  const positions = async (p = page) => (await snapshot(p)).map(({ id, x, y }) => ({ id, x, y }));
  const before = await positions();
  const toggle = page.getByRole('button', { name: 'Привязка к сетке', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await toggle.click();
  expect(await positions()).toEqual(before);
  // Move the automatic start before creating other nodes, so later triangles cannot cover it.
  const start = (await page.getByTestId('node-start').boundingBox())!;
  await page.mouse.move(start.x + 30, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x - 120, start.y + 170, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => aligned(page, before[0].id)).toBeLessThan(0.002);
  for (const [index, [kind, name]] of [
    ['line', 'Реплика'],
    ['choice', 'Вариант'],
    ['end', 'Конец'],
  ].entries()) {
    await page.mouse.click(410 + index * 280, 230, { button: 'right' });
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByTestId(`node-${kind}`)).toHaveCount(1);
    await expect(page.locator('.socket-measurement')).toHaveCount(0);
    await expect(page.locator('.context-menu')).toHaveCount(0);
  }
  for (const node of (await snapshot()).filter((n) => n.kind !== 'start'))
    expect(await aligned(page, node.id)).toBeLessThan(0.002);
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const link = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  try {
    await other.goto(link);
    await expect(other.getByTestId('node-line')).toHaveCount(1);
    // Separate overlapping creations through real drags; test two viewport scales.
    const ordered = (await snapshot())
      .filter((node) => node.kind !== 'start')
      .sort(
        (a, b) =>
          ['start', 'line', 'choice', 'end'].indexOf(a.kind) -
          ['start', 'line', 'choice', 'end'].indexOf(b.kind),
      );
    for (const [index, node] of ordered.entries()) {
      await page.locator('.react-flow__controls-fitview').click();
      if (index % 2) await page.locator('.react-flow__controls-zoomout').click();
      await page.waitForTimeout(400); // Let the viewport zoom animation finish before pointer coordinates.
      const element = page.locator(`.react-flow__node[data-id="${node.id}"]`);
      const box = (await element.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.72);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 - 81 - index * 20,
        box.y + box.height * 0.72 - 43 - index * 30,
        { steps: 10 },
      );
      await page.mouse.up();
      await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
      await expect.poll(() => aligned(page, node.id), { message: node.kind }).toBeLessThan(0.002);
    }
    const moved = await positions();
    await expect.poll(() => positions(other)).toEqual(moved);
    await page.keyboard.press('Control+z');
    await expect.poll(() => positions()).not.toEqual(moved);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => positions()).toEqual(moved);
    await toggle.click();
    await page.reload();
    await expect(page.getByTestId('node-line')).toHaveCount(1);
    expect(await positions()).toEqual(moved);
    await page.screenshot({ path: 'test-results/socket-grid.png' });
  } finally {
    await context.close();
  }
});

test('group snap and paste preserve relative positions with dynamic line height and disabled snap', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Group socket grid');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  const dialogueId = new URL(page.url()).pathname.split('/').at(-1)!;
  for (const [x, y] of [
    [400, 100],
    [740, 147],
  ]) {
    expect(
      (
        await page.request.post(`/api/dialogues/${dialogueId}/nodes`, {
          data: { kind: 'line', x, y },
        })
      ).ok(),
    ).toBe(true);
  }
  await expect(page.getByTestId('node-line')).toHaveCount(2);
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  await page.getByTestId('node-line').first().dblclick();
  await page
    .getByRole('textbox', { name: 'Текст реплики' })
    .fill('Первая строка\nВторая строка\nТретья строка\nЧетвёртая строка');
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const nodes = page.locator('.react-flow__node').filter({ has: page.getByTestId('node-line') });
  const geometry = () =>
    nodes.evaluateAll((els) =>
      els
        .map((el) => {
          const matrix = new DOMMatrix((el as HTMLElement).style.transform);
          return { id: el.getAttribute('data-id')!, x: matrix.e, y: matrix.f };
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  const delta = (positions: { x: number; y: number }[]) => ({
    x: positions[1].x - positions[0].x,
    y: positions[1].y - positions[0].y,
  });
  const boxes = await Promise.all([nodes.nth(0).boundingBox(), nodes.nth(1).boundingBox()]);
  await page.mouse.move(
    Math.min(...boxes.map((b) => b!.x)) - 10,
    Math.min(...boxes.map((b) => b!.y)) - 10,
  );
  await page.mouse.down();
  await page.mouse.move(
    Math.max(...boxes.map((b) => b!.x + b!.width)) + 10,
    Math.max(...boxes.map((b) => b!.y + b!.height)) + 10,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const original = await geometry();
  const group = (await page.locator('.react-flow__nodesselection-rect').boundingBox())!;
  await page.mouse.move(group.x + 30, group.y + 15);
  await page.mouse.down();
  await page.mouse.move(group.x + 83, group.y + 52, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  await expect.poll(geometry).not.toEqual(original);
  const moved = await geometry();
  expect(delta(moved)).toEqual(delta(original));
  expect(Math.min(...(await Promise.all(moved.map((n) => aligned(page, n.id)))))).toBeLessThan(
    0.002,
  );
  await page.keyboard.press('Control+z');
  await expect.poll(geometry).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(geometry).toEqual(moved);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+v');
  await expect(nodes).toHaveCount(4);
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  const pasted = (await geometry()).filter((n) => !moved.some((old) => old.id === n.id));
  // New IDs may reverse sorting, so compare the absolute displacement.
  expect(Math.abs(delta(pasted).x)).toBeCloseTo(Math.abs(delta(moved).x), 4);
  expect(Math.abs(delta(pasted).y)).toBeCloseTo(Math.abs(delta(moved).y), 4);
  expect(Math.min(...(await Promise.all(pasted.map((n) => aligned(page, n.id)))))).toBeLessThan(
    0.002,
  );
  await page.keyboard.press('Control+z');
  await expect(nodes).toHaveCount(2);
  await page.getByRole('button', { name: 'Привязка к сетке' }).click();
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(400);
  const box = (await nodes.first().boundingBox())!;
  await page.mouse.click(350, 600);
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 43, box.y + 47, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  expect(await aligned(page, (await geometry())[0].id)).toBeGreaterThan(0.01);
});

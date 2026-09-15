import { test, expect } from '@playwright/test';

test('middle pan and left marquee preserve shared graph and atomic group movement', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await page.getByLabel('Название проекта').fill('Navigation gestures');
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
  const path = new URL(page.url()).pathname;
  const dialogueId = path.split('/').at(-1)!;
  // Public creation gives a deterministic layout independent of the initial fit-to-view.
  for (const position of [
    { x: 400, y: 100 },
    { x: 720, y: 100 },
  ]) {
    const response = await page.request.post(`/api/dialogues/${dialogueId}/nodes`, {
      data: { kind: 'line', ...position },
    });
    expect(response.ok()).toBe(true);
  }
  await expect(page.getByTestId('node-line')).toHaveCount(2);
  await page.getByRole('button', { name: 'Поделиться' }).click();
  const invitation = await page.getByLabel('Ссылка редактора').inputValue();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const context = await browser.newContext();
  const other = await context.newPage();
  const viewport = page.locator('.react-flow__viewport');
  const nodes = (p: typeof page) =>
    p.locator('.react-flow__node').filter({ has: p.getByTestId('node-line') });
  const positions = (p: typeof page) =>
    nodes(p).evaluateAll((elements) =>
      elements.map((el) => (el as HTMLElement).style.transform).sort(),
    );
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    button: 'left' | 'middle' = 'left',
  ) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up({ button });
  };
  try {
    await other.goto(invitation);
    await other.getByRole('link', { name: 'Первый диалог' }).click();
    await expect(other.getByTestId('node-line')).toHaveCount(2);
    await page.locator('.react-flow__controls-fitview').click();
    await expect(page.locator('.react-flow__pane')).toHaveCSS('cursor', 'default');
    await expect(nodes(page).first()).toHaveCSS('cursor', 'default');
    const original = await positions(page);
    const camera = await viewport.getAttribute('style');
    await drag({ x: 400, y: 570 }, { x: 350, y: 570 }, 'middle');
    await expect(viewport).not.toHaveAttribute('style', camera!);
    expect(await positions(page)).toEqual(original);
    expect(await positions(other)).toEqual(original);
    const nodeBox = (await nodes(page).first().boundingBox())!;
    const beforeNodePan = await viewport.getAttribute('style');
    await drag(
      { x: nodeBox.x + 30, y: nodeBox.y + 30 },
      { x: nodeBox.x + 10, y: nodeBox.y + 40 },
      'middle',
    );
    await expect(viewport).not.toHaveAttribute('style', beforeNodePan!);
    expect(await positions(page)).toEqual(original);
    await expect(page.locator('.story-edge')).toHaveCount(0);
    const beforeSelection = await viewport.getAttribute('style');
    const first = (await nodes(page).nth(0).boundingBox())!;
    const second = (await nodes(page).nth(1).boundingBox())!;
    await page.mouse.move(first.x - 15, first.y - 15);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width + 15, second.y + second.height + 15, {
      steps: 12,
    });
    await expect(page.locator('.react-flow__selection')).toBeVisible();
    await expect(page.locator('.react-flow__pane')).toHaveCSS('cursor', 'default');
    await page.screenshot({ path: 'test-results/navigation-marquee.png' });
    await page.mouse.up();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await expect(other.getByTestId('remote-node-selection')).toHaveCount(2);
    await expect(viewport).toHaveAttribute('style', beforeSelection!);
    expect(await positions(page)).toEqual(original);
    await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeDisabled();
    await page.mouse.click(first.x + 30, first.y + 25, { button: 'right' });
    await expect(page.getByRole('button', { name: 'Удалить выделенные (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Копировать ноды', exact: true }).click();
    await drag({ x: first.x + 30, y: first.y + 25 }, { x: first.x + 70, y: first.y + 65 });
    await expect.poll(() => positions(page)).not.toEqual(original);
    await expect(page.getByTestId('save-status')).toHaveText('Сохранено');
    const moved = await positions(page);
    expect(moved.every((position, i) => position !== original[i])).toBe(true);
    await expect.poll(() => positions(other)).toEqual(moved);
    await page.keyboard.press('Control+z');
    await expect.poll(() => positions(page)).toEqual(original);
    await expect.poll(() => positions(other)).toEqual(original);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => positions(other)).toEqual(moved);
    await page.reload();
    await expect.poll(() => positions(page)).toEqual(moved);
    const beforeZoom = await viewport.getAttribute('style');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -150);
    await expect(viewport).not.toHaveAttribute('style', beforeZoom!);
    await page.locator('.react-flow__controls-fitview').click();
    const minimap = page.locator('.react-flow__minimap');
    const mapBox = (await minimap.boundingBox())!;
    const beforeMap = await viewport.getAttribute('style');
    await drag({ x: mapBox.x + 40, y: mapBox.y + 40 }, { x: mapBox.x + 65, y: mapBox.y + 55 });
    await expect(viewport).not.toHaveAttribute('style', beforeMap!);
    expect(await positions(page)).toEqual(moved);
    await page.locator('.react-flow__controls-fitview').click();
    await page.screenshot({ path: 'test-results/navigation-group.png' });
    const beforeForm = await viewport.getAttribute('style');
    await page.getByTestId('board-presence-count').click();
    await page.getByLabel('Ваше имя').fill('Автор со средней кнопкой');
    await page.getByLabel('Ваше имя').press('Enter');
    await expect(viewport).toHaveAttribute('style', beforeForm!);
  } finally {
    await context.close();
  }
});

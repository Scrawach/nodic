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

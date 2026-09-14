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
  await page.getByRole('button', { name: 'Добавить реплику' }).click();
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

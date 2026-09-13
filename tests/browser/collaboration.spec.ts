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

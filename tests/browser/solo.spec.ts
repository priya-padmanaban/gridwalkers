import { expect, test } from '@playwright/test';

test('plays a solo puzzle without opening a room socket', async ({ page }) => {
  let socketAttempts = 0;
  await page.routeWebSocket('**/api/ws*', socket => {
    socketAttempts++;
    void socket.close();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  const setup = page.getByRole('dialog', { name: 'Play Solo' });
  await setup.getByLabel('Width').fill('5');
  await setup.getByLabel('Height').fill('5');
  await setup.getByLabel('Difficulty').selectOption('easy');
  await setup.getByRole('button', { name: 'Start Puzzle' }).click();

  const board = page.getByLabel(/Nonogram board/);
  await expect(board).toBeVisible();
  await expect(page.getByText('Solo', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await board.press('q');
  await expect(page.getByRole('button', { name: /FILL/ })).toBeVisible();
  await board.press('ArrowRight');
  await expect(page.getByText(/^Column 2(?: ✓)?$/)).toBeVisible();
  await board.press('q');
  await expect(page.getByRole('button', { name: /WALK/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toBeVisible();
  expect(socketAttempts).toBe(0);
});

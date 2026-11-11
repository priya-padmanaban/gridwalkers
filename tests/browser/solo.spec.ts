import { expect, test } from '@playwright/test';

test('plays a solo puzzle without opening a room socket', async ({ page }) => {
  let socketAttempts = 0;
  await page.routeWebSocket('**/api/ws*', socket => {
    socketAttempts++;
    void socket.close();
  });
  await page.emulateMedia({ colorScheme: 'light' });
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
  await board.press('ArrowUp');
  await expect(page.getByText('Outside the grid')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Grid movement only').check();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Row 1(?: ✓)?$/)).toBeVisible();
  await board.press('ArrowUp');
  await expect(page.getByText(/^Row 1(?: ✓)?$/)).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Grid movement only').uncheck();
  await page.keyboard.press('Escape');
  await board.focus();
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowRight');
  try {
    await expect(page.getByText(/^Column 3(?: ✓)?$/)).toBeVisible();
    await expect(page.getByText(/^Row [2-5](?: ✓)?$/)).toBeVisible();
  } finally {
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');
  }
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  expect(socketAttempts).toBe(0);
});

test('left-drag crosses every tile in its path and right-click leaves it alone', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const clues = Array.from({ length: 5 }, () => [1]);
  const puzzle = { rows: clues, columns: clues, solution: Array.from({ length: 25 }, (_, i) => Number(i % 6 === 0)) };
  await page.route('**/client/solo-worker.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'self.onmessage = () => self.postMessage(' + JSON.stringify({ puzzle }) + ');',
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByLabel('Width').fill('5');
  await page.getByLabel('Height').fill('5');
  await page.getByRole('button', { name: 'Start Puzzle' }).click();
  const board = page.getByLabel(/Nonogram board/);
  await expect(page.getByLabel('Zoom level')).toHaveText('113%');
  const box = (await board.boundingBox())!;
  const tile = 34;
  const inset = 34;
  const x = (column: number) => inset + (box.width - inset - tile * 5) / 2 + (column + 0.5) * tile;
  const y = inset + (box.height - inset - tile * 5) / 2 + tile / 2;
  const color = (column: number) => board.evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(canvas.getContext('2d')!.getImageData(point.x * scale, point.y * scale, 1, 1).data);
  }, { x: x(column), y });
  const before = await Promise.all([1, 2, 3].map(color));
  await board.click({ position: { x: x(1), y }, button: 'right' });
  await page.mouse.move(box.x - 4, box.y - 4);
  await expect.poll(() => color(1)).toEqual(before[0]);
  await page.mouse.move(box.x + x(1), box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x(3), box.y + y);
  await page.mouse.up();
  await page.mouse.move(box.x - 4, box.y - 4);
  for (const column of [1, 2, 3]) {
    await expect.poll(async () => (await color(column))[0]).toBeLessThan(before[column - 1][0] - 10);
  }
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
});

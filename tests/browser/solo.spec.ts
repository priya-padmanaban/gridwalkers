import { expect, test } from '@playwright/test';

test('starts a reference picture and converts a 5×5 upload cell for cell', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Picture Pack' }).click();
  const source = page.getByLabel('Puzzle source');
  await expect(source.locator('optgroup[label="Picture pack"] option')).toHaveCount(15);
  await page.getByRole('button', { name: 'Start Puzzle' }).click();
  await expect(page.getByText('Picture A', { exact: true })).toBeVisible();
  await expect(page.getByText('Squares with a gold corner are starting clues.')).toBeVisible();
  await page.getByRole('button', { name: 'Gridwalkers' }).click();
  await page.getByRole('button', { name: 'Leave game', exact: true }).click();

  await page.getByRole('button', { name: 'Play Solo' }).click();
  await source.selectOption('upload');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 5;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 5, 5);
    ctx.fillStyle = 'black';
    for (let i = 0; i < 5; i++) ctx.fillRect(i, i, 1, 1);
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByLabel('Upload puzzle image').setInputFiles({ name: 'diagonal.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const preview = page.getByRole('img', { name: 'Converted 5 by 5 grid' });
  await expect(preview).toBeVisible();
  expect(await preview.locator('i').evaluateAll(cells => cells.map(cell => Number(cell.hasAttribute('data-filled'))).join('')))
    .toBe('1000001000001000001000001');
  await page.getByRole('button', { name: 'Start Puzzle' }).click();
  await expect(page.getByText('Uploaded image', { exact: true })).toBeVisible();
  await expect(page.getByText('Squares with a gold corner are starting clues.')).toBeVisible();
});

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
  await board.press('ArrowRight', { delay: 150 });
  await expect(page.getByText(/^Column 2(?: ✓)?$/)).toBeVisible();
  await board.press('q');
  await expect(page.getByRole('button', { name: /WALK/ })).toBeVisible();
  await board.press('ArrowUp', { delay: 150 });
  await expect(page.getByText('Outside the grid')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Grid movement only').check();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Row 1(?: ✓)?$/)).toBeVisible();
  await board.press('ArrowUp', { delay: 150 });
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
  const stopped = await board.screenshot();
  await page.waitForTimeout(200);
  expect(await board.screenshot()).toEqual(stopped);
  await page.getByRole('button', { name: 'Gridwalkers' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave game?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Keep playing' }).click();
  await expect(board).toBeFocused();
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Gridwalkers' }).click();
  await leave.getByRole('button', { name: 'Leave game', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/room/ABCDEF');
  await page.getByRole('button', { name: 'Gridwalkers' }).click();
  await expect(page).toHaveURL(/\/$/);
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

test('rejects GIFs and saves and plays an uploaded video cross', async ({ page }) => {
  const clues = Array.from({ length: 5 }, () => [1]);
  const puzzle = { rows: clues, columns: clues, solution: Array.from({ length: 25 }, (_, i) => Number(i % 6 === 0)) };
  await page.route('**/client/solo-worker.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'self.onmessage = () => self.postMessage(' + JSON.stringify({ puzzle }) + ');',
  }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByRole('button', { name: 'My character' }).click();
  await expect(page.getByRole('button', { name: 'The Rock' })).toBeVisible();
  const upload = page.getByLabel('Upload image or video');
  await upload.setInputFiles({
    name: 'tiny.gif', mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  });
  await expect(page.getByRole('alert')).toHaveText('Choose a PNG, JPEG, WebP, MP4, or WebM file.');
  await upload.setInputFiles('client/assets/the-rock-cross.mp4');
  await expect(page.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByLabel('Width').fill('5');
  await page.getByLabel('Height').fill('5');
  await page.getByRole('button', { name: 'Start Puzzle' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  const board = page.getByLabel(/Nonogram board/);
  await expect(page.getByLabel('Zoom level')).toHaveText('113%');
  const box = (await board.boundingBox())!;
  const x = 34 + (box.width - 34 - 34 * 5) / 2 + 34 * 1.5;
  const y = 34 + (box.height - 34 - 34 * 5) / 2 + 34 / 2;
  await board.click({ position: { x, y } });
  await page.mouse.move(box.x - 4, box.y - 4);
  const frames = new Set<string>();
  await expect.poll(async () => {
    frames.add(await board.evaluate((element, point) => {
      const canvas = element as HTMLCanvasElement;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      return canvas.getContext('2d')!.getImageData((point.x - 8) * scale, (point.y - 8) * scale, 16 * scale, 16 * scale).data.join(',');
    }, { x, y }));
    return frames.size;
  }).toBeGreaterThanOrEqual(4);
});

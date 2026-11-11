import { expect, test } from '@playwright/test';
import { RoomStore } from '../../server/store.ts';

test('two walkers customize, join via invite, mark together, and share a victory', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const store = new RoomStore(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', process.env.PLAYWRIGHT_GRID_NAMESPACE!);
  try {
    await host.goto('/');
    await host.getByRole('button', { name: 'My character' }).click();
    await host.getByLabel('Display name').fill('Fern');
    await host.getByRole('button', { name: 'Shirt color 2' }).click();
    await host.getByRole('button', { name: 'Save Character' }).click();
    await host.getByRole('button', { name: 'Create Room' }).click();
    const create = host.getByRole('dialog', { name: 'Create a room' });
    await create.getByLabel('Width').fill('5');
    await create.getByLabel('Height').fill('5');
    await create.getByLabel('Difficulty').selectOption('easy');
    await create.getByRole('button', { name: 'Create Room' }).click();
    await expect(host.getByRole('heading', { name: 'The puzzle room' })).toBeVisible();
    const invite = await host.getByLabel('Shareable invite link').inputValue();
    const code = invite.split('/').at(-1)!;
    await guest.goto(invite);
    await guest.getByRole('button', { name: 'Join Room' }).click();
    await guest.getByLabel('Display name').fill('Pip');
    await guest.getByRole('dialog').getByRole('button', { name: 'Join Room' }).click();
    await guest.getByRole('button', { name: 'Mark ready' }).click();
    await expect(host.getByText('Ready', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Start Game' }).click();
    const board = host.getByLabel(/Nonogram board/);
    await expect(board).toBeVisible();
    await expect(guest.getByLabel(/Nonogram board/)).toBeVisible();
    const room = (await store.read(code))!;
    const player = room.sessions.find(session => session.player.profile.name === 'Fern')!.player;
    await board.press(player.position.x < 4 ? 'ArrowRight' : 'a');
    await expect.poll(async () => (await store.read(code))?.sessions[0].player.position.x).not.toBe(player.position.x);
    await expect(guest.getByRole('button', { name: /WALK/ })).toBeVisible();
    await board.press('q');
    await expect(host.getByRole('button', { name: /FILL/ })).toBeVisible();
    await expect(guest.getByRole('button', { name: /WALK/ })).toBeVisible();
    await board.press('q');
    await expect(host.getByRole('button', { name: /WALK/ })).toBeVisible();
    await host.getByRole('button', { name: 'Zoom in' }).click();
    await expect(host.getByLabel('Zoom level')).toHaveText('127%');
    await host.getByRole('button', { name: 'Zoom out' }).click();
    await expect(host.getByLabel('Zoom level')).toHaveText('113%');

    const box = (await board.boundingBox())!;
    const tile = 34;
    const left = Math.min(box.width * 0.42, Math.max(...room.game!.view.rows.map(line => line.length)) * 19 + 15);
    const top = Math.min(box.height * 0.42, Math.max(...room.game!.view.columns.map(line => line.length)) * 19 + 15);
    const origin = { x: left + (box.width - left - 5 * tile) / 2, y: top + (box.height - top - 5 * tile) / 2 };
    const position = (index: number) => ({ x: origin.x + (index % 5 + 0.5) * tile, y: origin.y + (Math.floor(index / 5) + 0.5) * tile });
    const latest = (await store.read(code))!;
    const available = latest.game!.view.cells.findIndex((mark, i) => mark === 0 && latest.game!.puzzle.solution[i] === 1);
    expect(available).toBeGreaterThanOrEqual(0);
    const empty = latest.game!.view.cells.findIndex((mark, i) => mark === 0 && latest.game!.puzzle.solution[i] === 0);
    if (empty >= 0) {
      await board.click({ position: position(empty), button: 'right' });
      await expect.poll(async () => (await store.read(code))?.game?.marks[empty]).toBe(2);
      await board.click({ position: position(empty), button: 'right' });
      await expect.poll(async () => (await store.read(code))?.game?.marks[empty]).toBe(0);
    }
    await board.click({ position: position(available), button: 'right' });
    await expect(guest.getByText((latest.game!.lives! - 1) + ' / 3', { exact: true })).toBeVisible();
    expect((await store.read(code))?.game?.marks[available]).toBe(0);
    await board.click({ position: position(available) });
    await expect.poll(async () => (await store.read(code))?.game?.marks[available]).toBe(1);
    await guest.reload();
    await expect(guest.getByLabel(/Nonogram board/)).toBeVisible();

    for (const [index, value] of latest.game!.puzzle.solution.entries()) {
      const current = (await store.read(code))!;
      if (Number(current.game!.marks[index] === 1) !== value) {
        await board.click({ position: position(index) });
        await expect.poll(async () => Number((await store.read(code))?.game?.marks[index] === 1)).toBe(value);
      }
    }
    await expect(host.getByRole('dialog', { name: 'Puzzle Complete!' })).toBeVisible();
    await expect(guest.getByRole('dialog', { name: 'Puzzle Complete!' })).toBeVisible();
    expect((await store.read(code))?.game?.view.cells.every(cell => cell === 1 || cell === 2)).toBe(true);
    await expect(host.getByRole('button', { name: 'Play Again' })).toBeVisible();
  } finally {
    store.redis.disconnect();
    store.subscriber.disconnect();
    await guestContext.close();
    await hostContext.close();
  }
});

test('a 60-cell board can be panned, fitted, and centered', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Room' }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Width').fill('60');
  await create.getByLabel('Height').fill('60');
  await create.getByLabel('Difficulty').selectOption('easy');
  await create.getByRole('button', { name: 'Create Room' }).click();
  await page.getByRole('button', { name: 'Start Game' }).click();
  const board = page.getByLabel(/Nonogram board/);
  await expect(board).toBeVisible();
  await expect(page.getByLabel('Zoom level')).toHaveText('93%');
  const box = (await board.boundingBox())!;
  const before = await board.evaluate(element => (element as HTMLCanvasElement).toDataURL());
  const row = await page.getByText(/^Row \d+$/).textContent();
  const delta = Number(row?.split(' ')[1]) <= 30 ? -180 : 180;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x, y + delta, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.mouse.move(box.x - 5, box.y - 5);
  await expect.poll(async () => (await board.evaluate(element => (element as HTMLCanvasElement).toDataURL())) !== before).toBe(true);
  await page.getByRole('button', { name: 'Fit Board' }).click();
  await expect.poll(async () => Number((await page.getByLabel('Zoom level').textContent())?.replace('%', ''))).toBeLessThan(93);
  await page.getByRole('button', { name: 'Center on Character' }).click();
  await expect(board).toBeFocused();
});

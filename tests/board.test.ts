import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attemptCrosses, attemptMark, markCell, newGame } from '../shared/board.ts';
import { describe as puzzleOf } from '../shared/puzzle.ts';
import { apply, applyCrosses, addSession, digest, grace, lease, profileOf, reconcile, returnToLobby, snapshot } from '../server/room.ts';
import type { Room } from '../server/store.ts';
import { defaultProfile, defaultSettings } from '../shared/protocol.ts';

function gameOf(rows: string[]) {
  return newGame('fixture', puzzleOf(rows.flatMap(row => [...row].map(Number)), rows[0].length, rows.length));
}
const fixture = () => gameOf(['11000', '00100', '00100', '00010', '00001']);

describe('board mutations', () => {
  it('rejects wrong fills and crosses, runs out of shared lives, and preserves correct marks', () => {
    const game = fixture();
    expect(attemptMark(game, 2, 0, 2)?.cells).toEqual([[2, 2]]);
    expect(attemptMark(game, 3, 0, 1)).toMatchObject({ lives: 2, cells: [], mistakes: [3] });
    expect(game.view.cells[2]).toBe(2);
    expect(attemptMark(game, 0, 0, 2)).toMatchObject({ lives: 1, cells: [] });
    expect(attemptMark(game, 0, 0, 1)).toMatchObject({ lives: 1 });
    expect(attemptMark(game, 1, 0, 1)).toMatchObject({
      cells: expect.arrayContaining([[1, 1], [3, 2], [4, 2]]), lives: 1,
    });
    expect(game.view.rowState[0].complete).toBe(true);
    expect(attemptMark(game, 2, 1, 2)).toMatchObject({ lives: 0, phase: 'failed', cells: [], mistakes: [7] });
    expect(attemptMark(game, 0, 0, 0)).toBeUndefined();
    expect(game.view.cells.slice(0, 5)).toEqual([1, 1, 2, 2, 2]);
    expect(fixture().lives).toBe(3);
  });
  it('skips manually and automatically crossed empty cells in Fill mode', () => {
    const game = fixture();
    attemptMark(game, 2, 0, 2);
    expect(attemptMark(game, 2, 0, 1)).toBeUndefined();
    attemptMark(game, 0, 0, 1);
    attemptMark(game, 1, 0, 1);
    expect(game.view.cells[3]).toBe(2);
    expect(attemptMark(game, 3, 0, 1)).toBeUndefined();
    expect(game.lives).toBe(3);
    expect(game.view.cells.slice(2, 4)).toEqual([2, 2]);
  });
  it('locks confirmed fills and reports each life-losing cell in a drag', () => {
    const game = fixture();
    attemptMark(game, 0, 0, 1);
    expect(attemptMark(game, 0, 0, 0)).toBeUndefined();
    expect(attemptMark(game, 0, 0, 2, false)).toBeUndefined();
    expect(attemptCrosses(game, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 0 }])).toMatchObject({
      cells: [[2, 2]], mistakes: [1, 7], lives: 1,
    });
    expect(game.view.cells[0]).toBe(1);
  });
  it('allows incorrect single and drag crosses without losing lives when cross penalties are off', () => {
    const game = fixture();
    expect(attemptMark(game, 0, 0, 2, false)).toMatchObject({ cells: [[0, 2]], lives: 3 });
    expect(attemptCrosses(game, [{ x: 1, y: 0 }, { x: 2, y: 0 }], false)).toMatchObject({
      cells: [[1, 2], [2, 2]], lives: 3,
    });
    expect(attemptMark(game, 3, 0, 1, false)).toMatchObject({ cells: [], lives: 2 });
    expect(attemptMark(game, 0, 0, 1, false)?.lives).toBe(2);
    expect(game.view.cells[0]).toBe(1);
  });
  it('toggles explicit fills and crosses, and filling replaces a manual cross', () => {
    const game = fixture();
    expect(markCell(game, 0, 0, 2)?.cells).toEqual([[0, 2]]);
    expect(markCell(game, 0, 0, 0)?.cells).toEqual([[0, 0]]);
    markCell(game, 0, 0, 2);
    expect(markCell(game, 0, 0, 1)?.cells[0]).toEqual([0, 1]);
    expect(markCell(game, 0, 0, 1)).toBeUndefined();
    expect(markCell(game, 0, 0, 0)?.cells[0]).toEqual([0, 0]);
  });

  it('requires exact locations for line completion', () => {
    const game = fixture();
    markCell(game, 1, 0, 1);
    markCell(game, 2, 0, 1);
    expect(game.view.rowState[0].complete).toBe(false);
    expect(game.view.cells[4]).toBe(0);
    markCell(game, 2, 0, 0);
    const patch = markCell(game, 0, 0, 1);
    expect(patch?.rows).toContainEqual([0, { complete: true, grey: [true] }]);
    expect(game.view.cells.slice(0, 5)).toEqual([1, 1, 2, 2, 2]);
  });

  it('preserves manual and independently inferred crosses when a line is reopened', () => {
    const game = fixture();
    markCell(game, 3, 0, 2);
    markCell(game, 0, 0, 1);
    expect(game.view.columnState[0].complete).toBe(true);
    expect(game.view.cells[5]).toBe(2);
    markCell(game, 1, 0, 1);
    markCell(game, 4, 4, 1);
    expect(markCell(game, 2, 0, 0)).toBeUndefined();
    markCell(game, 0, 0, 0);
    expect(game.view.rowState[0].grey).toEqual([false]);
    expect(game.view.cells.slice(0, 6)).toEqual([0, 1, 0, 2, 2, 0]);
    markCell(game, 4, 4, 0);
    expect(game.view.cells[4]).toBe(0);
  });

  it('greys bounded leading and trailing runs while leaving ambiguous runs active', () => {
    const game = gameOf(['11001000111', '00110111000']);
    for (const x of [0, 1, 8, 9, 10]) markCell(game, x, 0, 1);
    expect(game.view.rowState[0].grey).toEqual([false, false, false]);
    for (const x of [2, 7]) markCell(game, x, 0, 2);
    expect(game.view.rowState[0].grey).toEqual([true, false, true]);
    markCell(game, 1, 0, 0);
    expect(game.view.rowState[0].grey).toEqual([false, false, true]);
    const ambiguous = gameOf(['11000110000', '00111001111']);
    markCell(ambiguous, 4, 0, 1);
    markCell(ambiguous, 5, 0, 1);
    expect(ambiguous.view.rowState[0].grey).toEqual([false, false]);
  });
});

describe('room authority', () => {
  const makeRoom = (): Room => ({
    code: 'AAAAAA', host: '', settings: { ...defaultSettings, width: 5, height: 5 }, sessions: [], game: fixture(),
    version: 0, revision: 0, phase: 'playing', progress: 100, participants: [],
  });
  it('publishes a custom cross image once and preserves it with the finished board', () => {
    const room = makeRoom();
    const gif = readFileSync(new URL('../client/assets/the-rock-cross.gif', import.meta.url));
    const image = 'data:image/gif;base64,' + gif.toString('base64');
    const style = `upload:${digest(image)}` as const;
    const profile = profileOf({ ...defaultProfile, crossStyle: style, crossImage: image });
    expect(() => profileOf({ ...profile, crossImage: image + 'AAAA' })).toThrow();
    expect(() => profileOf({ ...profile, crossImage: image.replace('image/gif', 'image/svg+xml') })).toThrow();
    const player = addSession(room, 'socket-a', 'hash-a', profile, 1000);
    expect(apply(room, player, 2, 0, 2, 1100)).toMatchObject({ crossStyles: { 2: style }, crossImages: { [style]: image } });
    const second = apply(room, player, 3, 0, 2, 1100);
    expect(second?.crossStyles).toEqual({ 3: style });
    expect(second?.crossImages).toBeUndefined();
    expect(snapshot(room).board?.crossImages?.[style]).toBe(image);
    room.phase = 'completed';
    returnToLobby(room);
    expect(snapshot(room).lastResult?.crossImages?.[style]).toBe(image);
  });
  it('shares each manual cross style and uses the completing player’s style for new automatic crosses', () => {
    const room = makeRoom();
    const frog = addSession(room, 'socket-a', 'hash-a', { ...defaultProfile, crossStyle: 'frog' }, 1000);
    const troll = addSession(room, 'socket-b', 'hash-b', { ...defaultProfile, crossStyle: 'trollface' }, 1000);
    expect(applyCrosses(room, frog, [{ x: 2, y: 0 }, { x: 4, y: 0 }], 1100, 'drag')?.crossStyles).toEqual({ 2: 'frog', 4: 'frog' });
    apply(room, frog, 0, 0, 1, 1100);
    const finishRow = apply(room, troll, 1, 0, 1, 1100);
    expect(finishRow?.crossStyles).toMatchObject({ 3: 'trollface' });
    expect(finishRow?.crossStyles?.[2]).toBeUndefined();
    expect(snapshot(room).board?.crossStyles).toMatchObject({ 2: 'frog', 3: 'trollface', 4: 'frog' });
    troll.player.profile.crossStyle = 'poop';
    expect(apply(room, troll, 4, 1, 2, 1100)?.crossStyles).toEqual({ 9: 'poop' });
    expect(snapshot(room).board?.crossStyles?.[3]).toBe('trollface');
    apply(room, troll, 4, 1, 0, 1100);
    expect(snapshot(room).board?.crossStyles?.[9]).toBeUndefined();
  });
  it('restores a host within the grace period and transfers once if the lease expires', () => {
    const room = makeRoom();
    const first = addSession(room, 'socket-a', 'hash-a', defaultProfile, 1000);
    const next = addSession(room, 'socket-b', 'hash-b', defaultProfile, 1100);
    room.host = first.player.id;
    reconcile(room, 1000 + lease);
    expect(first.player.connected).toBe(false);
    const reclaimed = addSession(room, 'socket-c', 'hash-a', defaultProfile, 1000 + lease + 10);
    expect(reclaimed.player.id).toBe(first.player.id);
    expect(room.sessions).toHaveLength(2);
    expect(room.host).toBe(first.player.id);
    next.until = 100_000;
    reconcile(room, reclaimed.until + grace);
    expect(room.host).toBe(next.player.id);
    expect(reconcile(room, reclaimed.until + grace + 1)).toBe(false);
  });

  it('publishes only the visible board, detects exact completion, and advances revisions', () => {
    const room = makeRoom();
    const player = addSession(room, 'socket-a', 'secret-hash', defaultProfile, 1000);
    const visible = JSON.stringify(snapshot(room));
    for (const forbidden of ['solution', 'secret-hash', 'socket-a', 'marks', 'puzzle']) expect(visible).not.toContain(forbidden);
    let patch;
    for (const [i, value] of room.game!.puzzle.solution.entries()) {
      if (value) patch = apply(room, player, i % 5, Math.floor(i / 5), 1, 1100);
    }
    expect(patch?.revision).toBe(6);
    expect(patch?.finishedAt).toBe(1100);
    expect(room.phase).toBe('completed');
    expect(room.game?.view.cells.every(cell => cell !== 0)).toBe(true);
  });
});

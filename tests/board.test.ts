import { describe, expect, it } from 'vitest';
import { attemptMark, markCell, newGame } from '../shared/board.ts';
import { describe as puzzleOf } from '../shared/puzzle.ts';
import { apply, addSession, grace, lease, reconcile, snapshot } from '../server/room.ts';
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
    expect(attemptMark(game, 2, 0, 1)).toMatchObject({ lives: 2, cells: [] });
    expect(game.view.cells[2]).toBe(2);
    expect(attemptMark(game, 0, 0, 2)).toMatchObject({ lives: 1, cells: [] });
    expect(attemptMark(game, 0, 0, 1)).toMatchObject({ lives: 1 });
    expect(attemptMark(game, 1, 0, 1)).toMatchObject({
      cells: expect.arrayContaining([[1, 1], [3, 2], [4, 2]]), lives: 1,
    });
    expect(game.view.rowState[0].complete).toBe(true);
    expect(attemptMark(game, 0, 0, 2)).toMatchObject({ lives: 0, phase: 'failed', cells: [] });
    expect(attemptMark(game, 0, 0, 0)).toBeUndefined();
    expect(game.view.cells.slice(0, 5)).toEqual([1, 1, 2, 2, 2]);
    expect(fixture().lives).toBe(3);
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

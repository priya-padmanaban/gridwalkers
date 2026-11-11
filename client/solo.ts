import { useEffect, useRef, useState } from 'react';
import { markCell, newGame } from '../shared/board.ts';
import type { Game } from '../shared/board.ts';
import { directions } from '../shared/protocol.ts';
import type { Direction, Mark, Player, Profile, Settings, Snapshot } from '../shared/protocol.ts';
import type { SoloGeneration } from './solo-worker.ts';

export const soloPlayerId = 'solo';

export function useSolo() {
  const [room, setRoom] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<{ game: Game; room: Snapshot } | undefined>(undefined);
  const worker = useRef<Worker | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function stopGeneration() {
    worker.current?.terminate();
    worker.current = undefined;
    clearTimeout(timer.current);
  }

  useEffect(() => stopGeneration, []);

  function cancel() {
    stopGeneration();
    setBusy(false);
    setError('');
  }

  function start(settings: Settings, profile: Profile, onStarted: () => void) {
    if (worker.current) return;
    setError('');
    setBusy(true);
    function fail(message: string) {
      stopGeneration();
      setBusy(false);
      setError(message);
    }
    try {
      const job = new Worker(new URL('./solo-worker.ts', import.meta.url), { type: 'module' });
      worker.current = job;
      timer.current = setTimeout(() => fail('Puzzle generation timed out. Try again.'), 6500);
      job.onerror = () => fail('The puzzle generator could not start. Try again.');
      job.onmessage = ({ data }: MessageEvent<SoloGeneration>) => {
        if (worker.current !== job) return;
        if ('error' in data) { fail(data.error); return; }
        stopGeneration();
        const game = newGame(crypto.randomUUID(), data.puzzle);
        const player: Player = {
          id: soloPlayerId, profile, connected: true, ready: true, color: '#42604f',
          position: { x: 0, y: 0 }, direction: 'down', mode: 'walk',
        };
        const next: Snapshot = {
          code: '', version: 0, revision: 0, settings, host: soloPlayerId, phase: 'playing',
          board: { ...game.view, cells: [...game.view.cells] },
          players: [player], startedAt: Date.now(), participants: 1, progress: 100,
        };
        session.current = { game, room: next };
        setRoom(next);
        setBusy(false);
        onStarted();
      };
      job.postMessage(settings);
    } catch {
      fail('The puzzle generator could not start. Try again.');
    }
  }

  function update(player?: Player, cell?: { x: number; y: number; mark: Mark }) {
    const active = session.current;
    if (!active) return;
    const { game, room } = active;
    const patch = cell && room.phase === 'playing' ? markCell(game, cell.x, cell.y, cell.mark) : undefined;
    if (!patch && !player) return;
    const solved = patch && game.view.rowState.every(line => line.complete);
    const board = patch ? {
      ...game.view, cells: [...game.view.cells], rowState: [...game.view.rowState], columnState: [...game.view.columnState],
    } : room.board;
    active.room = {
      ...room, board, players: player ? [player] : room.players, revision: room.revision + Number(Boolean(patch)),
      phase: solved ? 'completed' : room.phase, finishedAt: solved ? Date.now() : room.finishedAt,
    };
    setRoom(active.room);
  }

  function move(direction: Direction) {
    const room = session.current?.room;
    if (room?.phase !== 'playing') return;
    const player = room.players[0];
    const x = player.position.x + directions[direction].x;
    const y = player.position.y + directions[direction].y;
    if (x < 0 || y < 0 || x >= room.settings.width || y >= room.settings.height) {
      if (player.direction !== direction) update({ ...player, direction });
      return;
    }
    update({ ...player, position: { x, y }, direction }, player.mode === 'fill' ? { x, y, mark: 1 } : undefined);
  }

  function toggle() {
    const room = session.current?.room;
    if (room?.phase !== 'playing') return;
    const player = room.players[0];
    const mode = player.mode === 'walk' ? 'fill' : 'walk';
    update({ ...player, mode }, mode === 'fill' ? { ...player.position, mark: 1 } : undefined);
  }

  return {
    room, busy, error, start, cancel, move, toggle,
    change: (x: number, y: number, mark: Mark) => update(undefined, { x, y, mark }),
    profile: (profile: Profile) => {
      const player = session.current?.room.players[0];
      if (player) update({ ...player, profile });
    },
    leave: () => { cancel(); session.current = undefined; setRoom(undefined); },
  };
}

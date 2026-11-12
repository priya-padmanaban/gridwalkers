import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { Identity, Notice, Patch, Profile, Settings, Snapshot, ToClient, ToServer } from '../shared/protocol.ts';

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
const savedToken = (code: string) => localStorage.getItem('gridwalkers:session:' + code);
function patchBoard(room: Snapshot, patch: Patch): Snapshot {
  if (!room.board || room.board.id !== patch.boardId || room.revision >= patch.revision) return room;
  const board = { ...room.board, cells: [...room.board.cells], rowState: [...room.board.rowState], columnState: [...room.board.columnState] };
  for (const [index, mark] of patch.cells) board.cells[index] = mark;
  for (const [index, line] of patch.rows) board.rowState[index] = line;
  for (const [index, line] of patch.columns) board.columnState[index] = line;
  if (board.crossStyles || patch.crossStyles) {
    board.crossStyles = { ...board.crossStyles, ...patch.crossStyles };
    for (const [index, mark] of patch.cells) if (mark !== 2) delete board.crossStyles[index];
  }
  return { ...room, board, revision: patch.revision, finishedAt: patch.finishedAt,
    lives: patch.lives ?? room.lives, phase: patch.phase ?? (patch.finishedAt ? 'completed' : room.phase) };
}

export function useConnection(profile: Profile, onRoom: (code: string) => void, flashMistakes: (boardId: string, cells: number[]) => void) {
  const [socket] = useState<Socket<ToClient, ToServer>>(() => io({ autoConnect: false, timeout: 6000, path: '/api/ws', addTrailingSlash: false, transports: ['websocket'] }));
  const [room, setRoom] = useState<Snapshot>();
  const [id, setId] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const route = useRef(onRoom);
  route.current = onRoom;
  const active = useRef<string | undefined>(undefined);
  const live = useRef<Snapshot | undefined>(undefined);
  const repairing = useRef(false);
  const cancelConnect = useRef<(() => void) | undefined>(undefined);
  const attempt = useRef(0);
  const latestNotice = useRef(0);
  function commit(next: Snapshot) {
    live.current = next;
    setRoom(next);
  }
  function accept(identity: Identity, secret: string) {
    const code = identity.room.code;
    localStorage.setItem('gridwalkers:session:' + code, secret);
    active.current = code;
    latestNotice.current = identity.room.version;
    commit(identity.room);
    setId(identity.id);
    route.current(code);
    setError('');
  }
  function request() {
    if (repairing.current || !active.current || !socket.connected) return;
    repairing.current = true;
    socket.timeout(5000).emit('room:snapshot', (err, result) => {
      repairing.current = false;
      if (!err && result?.ok && result.value.code === active.current && result.value.version >= (live.current?.version ?? 0)) {
        commit(result.value);
        if (latestNotice.current > result.value.version) request();
      }
    });
  }
  useEffect(() => {
    function joinActive() {
      setConnected(true);
      const code = active.current;
      if (!code) return;
      const secret = savedToken(code);
      if (!secret) return;
      socket.timeout(6000).emit('room:join', { code, token: secret, profile: profileRef.current }, (err, result) => {
        if (!err && result?.ok) { accept(result.value, secret); request(); }
        else { setError(result && !result.ok ? result.error : 'Unable to reconnect.'); setConnected(false); }
      });
    }
    function update(notice: Notice) {
      const previous = live.current;
      if (!previous || previous.code !== notice.code || notice.version <= previous.version) return;
      latestNotice.current = Math.max(latestNotice.current, notice.version);
      const { update } = notice;
      const patch = update.type === 'patch' || update.type === 'motion' ? update.patch : undefined;
      if (patch?.mistakes?.length && patch.boardId === previous.board?.id && patch.revision > previous.revision) {
        flashMistakes(patch.boardId, patch.mistakes);
      }
      if (update.type === 'snapshot') { commit({ ...update.room, version: notice.version }); return; }
      if (notice.version !== previous.version + 1) { request(); return; }
      let next = { ...previous, version: notice.version };
      if (update.type === 'patch') next = patchBoard(next, update.patch);
      if (update.type === 'motion') {
        const { boardId, id, ...motion } = update.motion;
        if (boardId === next.board?.id) next.players = next.players.map(player => player.id === id ? { ...player, ...motion } : player);
        if (update.patch) next = patchBoard(next, update.patch);
      }
      if (update.type === 'progress') next.progress = update.progress;
      if (update.type === 'lease') live.current = next;
      else commit(next);
    }
    const disconnect = () => { setConnected(false); repairing.current = false; };
    const replaced = () => { setConnected(false); setError('This session is active in another tab.'); };
    socket.on('connect', joinActive).on('disconnect', disconnect).on('room:update', update).on('room:replaced', replaced);
    const code = /^\/room\/([A-Z2-9]{6})\/?$/.exec(location.pathname)?.[1];
    if (code && savedToken(code)) {
      active.current = code;
      socket.connect();
    }
    return () => { cancelConnect.current?.(); socket.off(); socket.disconnect(); };
  }, [socket]);

  function enter(settings: Settings | string, chosen = profile) {
    if (busy || cancelConnect.current) return;
    const currentAttempt = ++attempt.current;
    setBusy(true);
    setError('');
    const secret = typeof settings === 'string' ? savedToken(settings) ?? token() : token();
    const done = (err: Error | null, result?: { ok: true; value: Identity } | { ok: false; error: string }) => {
      if (currentAttempt !== attempt.current) return;
      setBusy(false);
      if (!err && result?.ok) { accept(result.value, secret); request(); }
      else {
        if (!active.current) socket.disconnect();
        setError(result && !result.ok ? result.error : 'The room service did not respond. Try again.');
      }
    };
    function send() {
      cleanup();
      if (typeof settings === 'string') socket.timeout(7000).emit('room:join', { code: settings, token: secret, profile: chosen }, done);
      else socket.timeout(7000).emit('room:create', { settings, token: secret, profile: chosen }, done);
    }
    function failed(error: Error) { cleanup(); done(error); }
    function cleanup() {
      socket.off('connect', send).off('connect_error', failed);
      cancelConnect.current = undefined;
    }
    if (socket.connected) send();
    else {
      cancelConnect.current = cleanup;
      socket.once('connect', send).once('connect_error', failed).connect();
    }
  }
  function leave() {
    const leaving = ++attempt.current;
    cancelConnect.current?.();
    active.current = undefined;
    live.current = undefined;
    setRoom(undefined);
    setError('');
    setBusy(false);
    if (socket.connected) socket.timeout(1000).emit('room:leave', () => {
      if (leaving === attempt.current) socket.disconnect();
    });
    else socket.disconnect();
  }
  return { socket, room, id, connected, error, setError, enter, leave, busy, request, live };
}

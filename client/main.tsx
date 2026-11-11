import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { clues } from '../shared/clues.ts';
import { accessories, crossBatchLimit, defaultProfile, defaultSettings, difficulties, hairColors, insideBoard, puzzleLives, shirts, skins, styles } from '../shared/protocol.ts';
import type { Direction, Line, Mark, Point, Profile, PuzzleResult, Result, Settings, Snapshot } from '../shared/protocol.ts';
import { Avatar } from './sprite.tsx';
import { BoardCanvas, mistakeFlashDuration } from './Board.tsx';
import type { BoardControls, MistakeFlashes } from './Board.tsx';
import { useConnection } from './connection.ts';
import { soloPlayerId, useSolo } from './solo.ts';
import './style.css';

const roomRoute = () => /^\/room\/([a-z0-9]{6})\/?$/i.exec(location.pathname)?.[1].toUpperCase() ?? '';
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
function readProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem('gridwalkers:profile') ?? 'null');
    if (stored && typeof stored.name === 'string' && ['skin', 'hair', 'style', 'shirt', 'accessory'].every(key => Number.isInteger(stored[key]))) return stored as Profile;
  } catch { /* Use default profile. */ }
  return defaultProfile;
}

function Logo() {
  return <span className="logo"><span className="logo-icon" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>Gridwalkers</span>;
}
function Controls({ compact = false }: { compact?: boolean }) {
  return <div className={'controls-strip' + (compact ? ' compact' : '')}>
    <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
    <span><kbd>Q</kbd> Walk / Fill</span>
    <span><kbd>Left click / drag</kbd> Mark X</span>
    <span><kbd>Middle drag</kbd> Pan</span>
  </div>;
}
function Dialog({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="dialog-content">
      <div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon" onClick={close} aria-label="Close">×</button></div>
      {children}
    </div>
  </dialog>;
}
function SettingsFields({ settings, set, solo = false }: { settings: Settings; set(value: Settings): void; solo?: boolean }) {
  return <div className="settings-fields">
    {!solo && <label>Room name <span className="muted">(optional)</span><input maxLength={32} placeholder="e.g. Fern Grove" value={settings.name} onChange={e => set({ ...settings, name: e.target.value })}/></label>}
    <div className="field-row">
      <label>Width<input type="number" min={5} max={60} required value={settings.width || ''} onChange={e => set({ ...settings, width: Number(e.target.value) })}/></label>
      <label>Height<input type="number" min={5} max={60} required value={settings.height || ''} onChange={e => set({ ...settings, height: Number(e.target.value) })}/></label>
      <label>Difficulty<select value={settings.difficulty} onChange={e => set({ ...settings, difficulty: e.target.value as Settings['difficulty'] })}>
        {difficulties.map(d => <option key={d} value={d}>{cap(d)}</option>)}
      </select></label>
    </div>
    {!solo && <div className="toggles"><label><input type="checkbox" checked={settings.penalizeIncorrectCrosses ?? true}
      onChange={e => set({ ...settings, penalizeIncorrectCrosses: e.target.checked })}/> Incorrect crosses cost a life</label></div>}
  </div>;
}
function Customize({ profile, save, joining }: { profile: Profile; save(profile: Profile): void; joining: boolean }) {
  const [draft, setDraft] = useState(profile);
  function colors(label: string, key: 'skin' | 'hair' | 'shirt', options: string[]) {
    return <fieldset><legend>{label}</legend><div className="swatches">
      {options.map((color, i) => <button type="button" key={color} aria-label={label + ' ' + (i + 1)}
        aria-pressed={draft[key] === i} style={{ background: color }} onClick={() => setDraft({ ...draft, [key]: i })}/>)}
    </div></fieldset>;
  }
  return <form onSubmit={event => { event.preventDefault(); save(draft); }}>
    <div className="profile-preview"><Avatar profile={draft} size={96}/></div>
    <label>Display name<input value={draft.name} onChange={e => {
      const name = Array.from(new Intl.Segmenter().segment(e.target.value)).slice(0, 16).map(item => item.segment).join('');
      setDraft({ ...draft, name });
    }} placeholder="Walker"/></label>
    <div className="profile-options">{colors('Skin tone', 'skin', skins)}{colors('Hair color', 'hair', hairColors)}{colors('Shirt color', 'shirt', shirts)}</div>
    <div className="field-row">
      <label>Hairstyle<select value={draft.style} onChange={e => setDraft({ ...draft, style: Number(e.target.value) })}>{styles.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      <label>Accessory<select value={draft.accessory} onChange={e => setDraft({ ...draft, accessory: Number(e.target.value) })}>{accessories.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
    </div>
    <button type="submit" className="primary full-width">{joining ? 'Join Room' : 'Save Character'}</button>
  </form>;
}

const example = [
  '1100000111', '1100000111', '1100000111', '1000010110', '0000111110',
  '0000110010', '0000010000', '0000000000', '0000000111', '0000001111',
].map(row => Array.from(row, Number));
const exampleRows = example.map(clues);
const exampleColumns = example[0].map((_, x) => clues(example.map(row => row[x])));

function Preview() {
  return <figure className="example-board">
    <div className="example-layout" role="img" aria-label="Solved 10 by 10 nonogram with an abstract pattern">
      <div className="example-columns" aria-hidden="true">
        {exampleColumns.map((line, x) => <div key={x}>{line.map((n, i) => <span key={i}>{n}</span>)}</div>)}
      </div>
      <div className="example-rows" aria-hidden="true">
        {exampleRows.map((line, y) => <div key={y}>{line.map((n, i) => <span key={i}>{n}</span>)}</div>)}
      </div>
      <div className="example-cells" aria-hidden="true">
        {example.flatMap((row, y) => row.map((filled, x) =>
          <i key={y * 10 + x} className={filled ? 'filled' : undefined}/>))}
      </div>
    </div>
    <figcaption>Example puzzle <span>10 × 10</span></figcaption>
  </figure>;
}
function Players({ room, id }: { room: Snapshot; id: string }) {
  return <ul className="players">
    {room.players.map(player => <li key={player.id}>
      <div className="player-avatar" style={{ borderColor: player.color }}><Avatar profile={player.profile}/></div>
      <div className="player-copy"><strong>{player.profile.name}{player.id === id && <span className="muted"> (you)</span>}</strong>
        <small>{!player.connected ? 'Reconnecting' : room.host === player.id ? 'Host' : room.phase === 'lobby' && player.ready ? 'Ready' : 'Online'}</small>
      </div><span className={'presence' + (player.connected ? ' online' : '')} aria-hidden="true"/>
    </li>)}
  </ul>;
}
function Clue({ label, values, state }: { label: string; values: number[]; state: Line }) {
  return <div className="focus-clue"><span>{label}{state.complete && ' ✓'}</span><div>
    {values.map((value, i) => <b key={i} className={state.grey[i] ? 'grey-clue' : ''} aria-label={state.grey[i] ? value + ' complete' : String(value)}>{value}</b>)}
  </div></div>;
}
function Timer({ start, finish }: { start?: number; finish?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!start || finish) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, [start, finish]);
  const total = start ? Math.max(0, Math.floor(((finish ?? now) - start) / 1000)) : 0;
  return <span className="timer">{String(Math.floor(total / 60)).padStart(2, '0')}:{String(total % 60).padStart(2, '0')}</span>;
}
function playChime() {
  try {
    const audio = new AudioContext();
    const gain = audio.createGain();
    gain.connect(audio.destination);
    [392, 494, 587, 784].forEach((frequency, i) => {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const at = audio.currentTime + i * 0.11;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.045, at);
      volume.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      oscillator.connect(volume).connect(gain);
      oscillator.start(at);
      oscillator.stop(at + 0.3);
      if (i === 3) oscillator.onended = () => { void audio.close(); };
    });
  } catch { /* Audio may be unavailable or muted by the browser. */ }
}

function App() {
  const [profile, setProfile] = useState(readProfile);
  const [invite, setInvite] = useState(roomRoute);
  const [dialog, setDialog] = useState<'solo' | 'create' | 'profile' | 'join' | 'settings' | 'leave' | 'result'>();
  const [settings, setSettings] = useState<Settings>({ ...defaultSettings });
  const [zoom, setZoom] = useState(100);
  const [copied, setCopied] = useState('');
  const [muted, setMuted] = useState(() => localStorage.getItem('gridwalkers:mute') !== 'false');
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('gridwalkers:theme');
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [seenVictory, setSeenVictory] = useState('');
  const [readyFailure, setReadyFailure] = useState<string>();
  const activeBoard = useRef<string | undefined>(undefined);
  const controls = useRef<BoardControls>(null);
  const optimistic = useRef(new Map<number, Mark>());
  const pending = useRef(new Map<number, string>());
  const mistakes = useRef<MistakeFlashes | undefined>(undefined);
  const flashMistakes = useCallback((boardId: string, indices: number[]) => {
    if (mistakes.current?.boardId !== boardId) mistakes.current = { boardId, cells: new Map() };
    const now = performance.now();
    for (const index of indices) mistakes.current.cells.set(index, now);
  }, []);
  const connection = useConnection(profile, code => {
    if (location.pathname !== '/room/' + code) history.pushState(null, '', '/room/' + code);
    setInvite(code);
    setDialog(undefined);
  }, flashMistakes);
  const solo = useSolo(flashMistakes);
  const isSolo = Boolean(solo.room);
  const room = solo.room ?? connection.room;
  const id = isSolo ? soloPlayerId : connection.id;
  const connected = isSolo || connection.connected;
  const { socket, error, setError, busy } = connection;
  const me = room?.players.find(player => player.id === id);
  const host = room?.host === id;
  const boardId = room?.board?.id;
  const phase = room?.phase;
  const playing = phase === 'playing' && !!boardId;
  const ended = phase === 'completed' || phase === 'failed';
  const showResult = ended && !!boardId && activeBoard.current === boardId && seenVictory !== boardId;
  const showResultDialog = showResult && (phase !== 'failed' || readyFailure === boardId);
  const lobby = !!room && !isSolo && !playing && !showResult;
  const result: PuzzleResult | undefined = room?.board && (phase === 'completed' || phase === 'failed') ? {
    phase, settings: room.settings, cells: room.board.cells, startedAt: room.startedAt,
    finishedAt: room.finishedAt, participants: room.participants,
  } : room?.lastResult;
  const lives = room?.lives ?? puzzleLives;
  useEffect(() => {
    if (!showResult || phase !== 'failed') return;
    const timeout = setTimeout(() => setReadyFailure(boardId), mistakeFlashDuration);
    return () => clearTimeout(timeout);
  }, [boardId, phase, showResult]);
  useEffect(() => {
    optimistic.current.clear();
    pending.current.clear();
    if (playing) {
      activeBoard.current = boardId;
      setDialog(current => current === 'result' ? undefined : current);
      controls.current?.focus();
    }
  }, [boardId, playing, connected]);
  const chimeId = useRef('');
  useEffect(() => {
    if (showResult && phase === 'completed' && boardId && chimeId.current !== boardId) {
      chimeId.current = boardId;
      if (!muted) playChime();
    }
  }, [phase, boardId, muted, showResult]);

  function feedback(err: Error | null, result?: Result) {
    if (err || !result?.ok) setError(result && !result.ok ? result.error : 'The room service did not respond. Try again.');
  }
  function saveProfile(value: Profile) {
    const next = { ...value, name: value.name.trim() || 'Walker' };
    setProfile(next);
    localStorage.setItem('gridwalkers:profile', JSON.stringify(next));
    if (dialog === 'join') connection.enter(invite, next);
    else {
      if (isSolo) solo.profile(next);
      else if (room && connected) socket.timeout(4000).emit('player:profile', next, feedback);
      setDialog(undefined);
    }
  }
  async function copy(value: string, kind: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(current => current === kind ? '' : current), 1700);
    } catch { setError('Clipboard unavailable. Select and copy the invite code or link.'); }
  }
  function join(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(invite)) { setError('Enter a valid six-character room code.'); return; }
    setDialog('join');
  }
  function leave() {
    solo.leave();
    if (!isSolo) connection.leave();
    if (location.pathname !== '/') history.pushState(null, '', '/');
    setInvite('');
    setDialog(undefined);
  }
  function requestLeave() {
    if (playing) setDialog('leave');
    else leave();
  }
  function stay() {
    setDialog(undefined);
    requestAnimationFrame(() => controls.current?.focus());
  }
  function openSettings() {
    if (room) setSettings(room.settings);
    setDialog('settings');
  }
  useEffect(() => {
    const back = () => {
      const code = roomRoute();
      if (room?.code && room.code !== code) connection.leave();
      setInvite(code);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [room?.code]);

  function change(x: number, y: number, mark: Mark) {
    if (isSolo) { solo.change(x, y, mark); return; }
    const current = connection.live.current;
    if (!current?.board || !socket.connected || !connected || current.phase !== 'playing') return;
    const index = y * current.settings.width + x;
    const actionId = crypto.randomUUID();
    optimistic.current.set(index, mark);
    pending.current.set(index, actionId);
    socket.timeout(4000).emit('cell:set', { x, y, mark, boardId: current.board.id, revision: current.revision, actionId }, (err, result) => {
      if (pending.current.get(index) === actionId) {
        optimistic.current.delete(index);
        pending.current.delete(index);
      }
      feedback(err, result);
      if (err) connection.request();
    });
  }
  function move(direction: Direction) {
    if (isSolo) { solo.move(direction); return; }
    if (boardId && connected && socket.connected) socket.emit('player:move', { direction, boardId });
  }
  async function cross(points: Point[]) {
    if (isSolo) { solo.cross(points); return; }
    try {
      for (let i = 0; i < points.length; i += crossBatchLimit) {
        const current = connection.live.current;
        if (!socket.connected || current?.phase !== 'playing' || current.board?.id !== boardId || !boardId) return;
        const result = await socket.timeout(4000).emitWithAck('cell:set', {
          crosses: points.slice(i, i + crossBatchLimit), boardId, revision: current.revision, actionId: crypto.randomUUID(),
        });
        if (!result.ok) { feedback(null, result); return; }
      }
    } catch { setError('The room service did not respond. Try again.'); connection.request(); }
  }
  function grid(gridOnly: boolean) {
    if (isSolo) solo.grid(gridOnly);
    else if (boardId && socket.connected) socket.emit('player:grid', { boardId, gridOnly });
  }
  function theme(value: boolean) {
    setDark(value);
    localStorage.setItem('gridwalkers:theme', value ? 'dark' : 'light');
  }
  function toggle() {
    if (isSolo) { solo.toggle(); return; }
    if (boardId && socket.connected && connected) {
      const current = connection.live.current?.players.find(player => player.id === id);
      socket.emit('player:mode', { boardId, mode: current?.mode === 'fill' ? 'walk' : 'fill' });
    }
  }
  function openSolo() {
    connection.leave();
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    setInvite('');
    setDialog('solo');
  }

  const inviteLink = connection.room ? new URL('/room/' + connection.room.code, location.origin).href : '';
  const activeCount = room?.players.filter(player => player.connected).length ?? 0;
  return <div className="app-shell" data-theme={dark ? 'dark' : 'light'} data-reduced-motion={reduced || undefined}>
    <header className="header"><div className="header-inner">
      <button type="button" className="brand-button" onClick={requestLeave}><Logo/></button>
      {room && <div className="top-meta"><span className="room-tag">{isSolo ? 'Solo' : room.code}</span>
        {(playing || showResult || isSolo) && <><Timer start={room.startedAt} finish={room.finishedAt}/><span>{room.settings.width} × {room.settings.height}</span><span>{cap(room.settings.difficulty)}</span></>}
        {!isSolo && <span><i className="presence online"/> {activeCount}/4 online</span>}
      </div>}
      <div className="header-actions"><button type="button" className="header-button" aria-pressed={dark} onClick={() => theme(!dark)}>Dark mode</button>
      <button className="header-button" onClick={room ? openSettings : () => setDialog('profile')}>
        {room ? <><span aria-hidden="true">⚙</span> Settings</> : <><Avatar profile={profile} size={26}/> My character</>}
      </button>
      {room && !isSolo && <button type="button" className="header-button" onClick={requestLeave}>Leave room</button>}</div>
    </div></header>

    {!room && <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Play a nonogram</h1>
          <p>Solve a grid on your own or with up to three friends. Walk in Fill mode to fill cells, and click or drag to cross them out.</p>
          <div className="hero-actions">
            <button className="primary create-button" onClick={openSolo}>Play Solo</button>
            <button className="create-button" onClick={() => { setError(''); setDialog('create'); }}>Create Room</button>
            <form className="join-form" onSubmit={join}>
              <label className="sr-only" htmlFor="invite-code">Invite code</label>
              <input id="invite-code" autoComplete="off" spellCheck={false} placeholder="Invite code" value={invite} maxLength={6} onChange={e => setInvite(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}/>
              <button type="submit">Join Room</button>
            </form>
          </div>
          {error && !dialog && <p className="error" role="alert">{error}</p>}
        </div>
        <Preview/>
      </section>
      <section className="quick-start" aria-label="Game controls"><h2>How to play</h2><Controls/></section>
    </main>}

    {room && lobby && <main className="lobby">
      <div className="lobby-heading"><p className="eyebrow">PRIVATE ROOM</p><h1>{room.settings.name || 'The puzzle room'}</h1><p>Invite your friends or start walking solo.</p></div>
      {!connected && <p className="connection-note" role="status">{error || 'Reconnecting to the room…'}</p>}
      <div className="lobby-grid">
        <section className="panel lobby-panel"><h2>Invite friends</h2>
          <div className="code-box"><strong>{room.code}</strong><button onClick={() => void copy(room.code, 'code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button></div>
          <div className="invite-link"><input aria-label="Shareable invite link" readOnly value={inviteLink} onFocus={e => e.target.select()}/><button onClick={() => void copy(inviteLink, 'link')}>{copied === 'link' ? 'Copied!' : 'Copy link'}</button></div>
          <div className="lobby-settings"><h2>Puzzle</h2><p>{room.settings.width} × {room.settings.height} · {cap(room.settings.difficulty)}{room.board && !ended ? ' · Generated' : ''}</p>
            {host && (phase === 'lobby' || ended) && <button onClick={() => { setSettings(room.settings); setDialog('settings'); }}>Change board settings</button>}
          </div>
          {phase === 'generating' && <div role="status" className="generation"><strong>Generating a puzzle…</strong><progress value={room.progress} max={100}/></div>}
          {(error || room.error) && <p role="alert" className="error">{error || room.error}</p>}
          {ended && !host && <p className="muted">Waiting for the host to start a new puzzle.</p>}
          {(phase === 'lobby' || ended) && <div className="lobby-actions">
            {host ? <><button className="primary" disabled={!connected} onClick={() => { setError(''); socket.timeout(5000).emit('game:start', feedback); }}>Start Game <span aria-hidden="true">→</span></button>
              <button disabled={!connected} onClick={() => { setError(''); socket.timeout(5000).emit('game:generate', feedback); }}>{room.board ? 'Regenerate' : 'Generate puzzle'}</button></> : !ended &&
              <button className={me?.ready ? '' : 'primary'} disabled={!connected} onClick={() => socket.timeout(5000).emit('room:ready', feedback)}>{me?.ready ? 'Mark not ready' : 'Mark ready'}</button>}
            {result && <button onClick={() => setDialog('result')}>View last puzzle</button>}
          </div>}
        </section>
        <section className="panel lobby-panel"><h2>Walkers <small>{activeCount}/4</small></h2><Players room={room} id={id}/>
          <button onClick={() => setDialog('profile')}>Edit character</button>
        </section>
      </div>
    </main>}

    {room?.board && (playing || (ended && (showResult || isSolo))) && <main className="game">
      {!connected && <div className="connection-note" role="status">{error || 'Reconnecting to the room…'}</div>}
      <div className="game-grid">
        <section className="board-frame"><BoardCanvas room={room} id={id} controls={controls} reduced={reduced} dark={dark} change={change} cross={cross} move={move} toggle={toggle}
          enabled={playing && connected && !dialog} onZoom={setZoom} optimistic={optimistic} mistakes={mistakes}/></section>
        <aside className="game-sidebar">
          <section className="panel game-panel">
            <div className="lives" data-low={lives <= 1 || undefined} role="status">Lives <strong>{lives} / {puzzleLives}</strong></div>
            <h2>Movement</h2><button key={me?.mode} className={'mode ' + (me?.mode ?? 'walk')} disabled={!playing || !connected} onClick={() => { toggle(); controls.current?.focus(); }}>
              <strong>{(me?.mode ?? 'walk').toUpperCase()}</strong><kbd>Q</kbd>
            </button>
            <p className="muted">{me?.mode === 'fill' ? 'Walking fills cells.' : 'Walk without changing cells.'}</p>
            {me && insideBoard(me.position, room.settings) && <div className="focused">
              <Clue label={'Row ' + (me.position.y + 1)} values={room.board.rows[me.position.y]} state={room.board.rowState[me.position.y]}/>
              <Clue label={'Column ' + (me.position.x + 1)} values={room.board.columns[me.position.x]} state={room.board.columnState[me.position.x]}/>
            </div>}
            {me && !insideBoard(me.position, room.settings) && <p className="muted">Outside the grid</p>}
          </section>
          <section className="panel game-panel camera"><h2>Board view</h2><div className="zoom">
            <button className="icon" aria-label="Zoom out" onClick={() => controls.current?.camera('out')}>−</button>
            <output aria-label="Zoom level">{zoom}%</output>
            <button className="icon" aria-label="Zoom in" onClick={() => controls.current?.camera('in')}>+</button>
          </div><div className="camera-actions"><button onClick={() => controls.current?.camera('fit')}>Fit Board</button>
          <button onClick={() => { controls.current?.camera('center'); controls.current?.focus(); }}>Center on Character</button></div></section>
          {!isSolo && <section className="panel game-panel game-players"><h2>Walkers</h2><Players room={room} id={id}/></section>}
        </aside>
      </div>
      {error && connected && <div className="connection-note" role="alert">{error}<button className="icon" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      <Controls compact/>
    </main>}

    {dialog === 'solo' && <Dialog title="Play Solo" close={() => { solo.cancel(); setDialog(undefined); }}>
      <form onSubmit={event => {
        event.preventDefault();
        solo.start({ ...settings, name: '' }, profile, () => setDialog(undefined));
      }}>
        <SettingsFields solo settings={settings} set={setSettings}/>
        {solo.error && <p className="error" role="alert">{solo.error}</p>}
        <button className="primary full-width" disabled={solo.busy}>{solo.busy ? 'Generating…' : 'Start Puzzle'}</button>
      </form>
    </Dialog>}
    {dialog === 'create' && <Dialog title="Create a room" close={() => setDialog(undefined)}>
      <form onSubmit={event => { event.preventDefault(); connection.enter(settings); }}>
        <SettingsFields settings={settings} set={setSettings}/>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary full-width" disabled={busy}>{busy ? 'Creating…' : 'Create Room'}</button>
      </form>
    </Dialog>}
    {(dialog === 'profile' || dialog === 'join') && <Dialog title={dialog === 'join' ? 'Get ready to join' : 'My character'} close={() => setDialog(undefined)}>
      <Customize profile={profile} joining={dialog === 'join'} save={saveProfile}/>
      {busy && <p role="status">Joining room…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Dialog>}
    {dialog === 'leave' && <Dialog title="Leave game?" close={stay}>
      <p>Leave the current game and return to the home screen?</p>
      <div className="settings-actions"><button onClick={stay}>Keep playing</button><button className="primary" onClick={leave}>Leave game</button></div>
    </Dialog>}
    {dialog === 'settings' && room && <Dialog title="Settings" close={() => { setDialog(undefined); controls.current?.focus(); }}>
      {host && (phase === 'lobby' || ended) && <form onSubmit={event => {
        event.preventDefault();
        socket.timeout(4000).emit('room:settings', settings, (err, result) => {
          if (!err && result?.ok) setDialog(undefined);
          else feedback(err, result);
        });
      }}><SettingsFields settings={settings} set={setSettings}/><button className="primary full-width" disabled={!connected}>Save board settings</button></form>}
      <div className="toggles">
        {playing && <label><input type="checkbox" checked={me?.gridOnly ?? false} onChange={e => grid(e.target.checked)}/> Grid movement only</label>}
        <label><input type="checkbox" checked={dark} onChange={e => theme(e.target.checked)}/> Dark mode</label>
        <label><input type="checkbox" checked={!muted} onChange={e => { setMuted(!e.target.checked); localStorage.setItem('gridwalkers:mute', String(!e.target.checked)); }}/> Play completion sound</label>
        <label><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)}/> Reduce motion</label>
      </div>
      <div className="settings-actions"><button onClick={() => setDialog('profile')}>Edit character</button>{isSolo && <button onClick={leave}>Back to Home</button>}</div>
      {error && <p className="error" role="alert">{error}</p>}
    </Dialog>}
    {result && ((showResultDialog && !dialog) || dialog === 'result') && <Dialog
      title={result.phase === 'failed' ? 'Out of lives' : 'Puzzle Complete!'}
      close={() => { if (boardId) setSeenVictory(boardId); setDialog(undefined); }}>
      {result.phase === 'failed' && <p>The puzzle ended after three mistakes.</p>}
      <div className="victory-picture" style={{ gridTemplateColumns: 'repeat(' + result.settings.width + ', 1fr)', aspectRatio: result.settings.width + ' / ' + result.settings.height }} aria-label="Final puzzle board" role="img">
        {result.cells.map((cell, i) => <i className={cell === 1 ? 'filled' : cell === 2 ? 'crossed' : ''} key={i}/>)}
      </div>
      <p className="victory-details">{result.settings.width} × {result.settings.height} · {cap(result.settings.difficulty)} · <Timer start={result.startedAt} finish={result.finishedAt}/> · {result.participants} {result.participants === 1 ? 'walker' : 'walkers'}</p>
      <div className="settings-actions">
        {isSolo ? <>
          <button className="primary" onClick={() => { setSettings(result.settings); setDialog('solo'); }}>Play Again</button>
          <button onClick={leave}>Back to Home</button>
        </> : <>
          {showResult && host && <button className="primary" disabled={!connected} onClick={() => { setSeenVictory(boardId!); socket.timeout(5000).emit('game:start', feedback); }}>Play Again</button>}
          <button onClick={() => { if (boardId) setSeenVictory(boardId); setDialog(undefined); }}>Return to Lobby</button>
        </>}
      </div>
    </Dialog>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);

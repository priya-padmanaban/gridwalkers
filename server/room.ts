import { createHash, randomInt, randomUUID } from 'node:crypto';
import { accessories, crossStyleIds, difficulties, hairColors, shirts, skins, styles } from '../shared/protocol.ts';
import type { Mark, Patch, Point, Profile, PuzzleResult, Settings, Snapshot, Update } from '../shared/protocol.ts';
import { attemptCrosses, attemptMark, recordCrossStyles } from '../shared/board.ts';
import type { Room, Session } from './store.ts';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const colors = ['#58804f', '#b75d43', '#447da7', '#9364ab'];
export const lease = 22_000;
export const grace = 30_000;
export const roomCode = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
export function codeOf(value: unknown) {
  if (typeof value !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(value)) throw new Error('Enter a valid six-character room code.');
  return value;
}
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function tokenOf(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid session token.');
  return digest(value);
}
export function settingsOf(value: Settings) {
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 5 || value.width > 60
      || value.height < 5 || value.height > 60 || !difficulties.includes(value.difficulty) || typeof value.name !== 'string') {
    throw new Error('Choose a width and height between 5 and 60 and a valid difficulty.');
  }
  if (value.penalizeIncorrectCrosses !== undefined && typeof value.penalizeIncorrectCrosses !== 'boolean') {
    throw new Error('Choose whether incorrect crosses cost a life.');
  }
  return {
    width: value.width, height: value.height, difficulty: value.difficulty, name: value.name.trim().slice(0, 32),
    penalizeIncorrectCrosses: value.penalizeIncorrectCrosses ?? true,
  };
}
export function profileOf(value: Profile): Profile {
  const valid = (i: number, options: unknown[]) => Number.isInteger(i) && i >= 0 && i < options.length;
  if (!value || typeof value.name !== 'string' || !valid(value.skin, skins) || !valid(value.hair, hairColors)
      || !valid(value.shirt, shirts) || !valid(value.style, styles) || !valid(value.accessory, accessories)) {
    throw new Error('Choose valid character options.');
  }
  const name = Array.from(new Intl.Segmenter().segment(value.name.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim()))
    .slice(0, 16).map(({ segment }) => segment).join('') || 'Walker';
  const crossStyle = value.crossStyle && crossStyleIds.includes(value.crossStyle) ? value.crossStyle : undefined;
  return { name, skin: value.skin, hair: value.hair, shirt: value.shirt, style: value.style, accessory: value.accessory, crossStyle };
}

export function finishedPuzzle(room: Room): PuzzleResult | undefined {
  if (!room.game || (room.phase !== 'completed' && room.phase !== 'failed')) return room.lastResult;
  return {
    phase: room.phase, settings: room.settings, cells: room.game.view.cells, crossStyles: room.game.view.crossStyles,
    startedAt: room.startedAt, finishedAt: room.finishedAt, participants: room.participants.length,
  };
}

export function returnToLobby(room: Room) {
  room.lastResult = finishedPuzzle(room);
  room.phase = 'lobby';
  room.game = undefined;
  room.finishedAt = undefined;
  room.startedAt = undefined;
  room.progress = 0;
  room.participants = [];
}

export function snapshot(room: Room): Snapshot {
  return {
    version: room.version, code: room.code, settings: room.settings, host: room.host,
    players: room.sessions.map(({ player }) => player), phase: room.phase,
    board: room.game?.view, revision: room.revision, startedAt: room.startedAt,
    lives: room.game?.lives,
    finishedAt: room.finishedAt, participants: room.participants.length,
    progress: room.progress, error: room.error, lastResult: finishedPuzzle(room),
  };
}
export const full = (room: Room): Update => ({ type: 'snapshot', room: snapshot(room) });

export function reconcile(room: Room, now: number) {
  let changed = false;
  for (const session of room.sessions) {
    if (session.player.connected && session.until <= now) {
      session.player.connected = false;
      changed = true;
    }
  }
  const host = room.sessions.find(session => session.player.id === room.host);
  if (!host || (!host.player.connected && now - host.until >= grace)) {
    const successor = room.sessions.filter(session => session.player.connected).sort((a, b) => a.joined - b.joined)[0];
    if (successor && successor.player.id !== room.host) {
      room.host = successor.player.id;
      changed = true;
    }
  }
  if (room.generation && room.generation.until <= now) {
    room.generation = undefined;
    room.phase = 'lobby';
    room.progress = 0;
    room.error = 'Generation was interrupted. Generate a new puzzle to try again.';
    changed = true;
  }
  return changed;
}

export function spawn(room: Room) {
  const { width, height } = room.settings;
  const edges = Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width) }))
    .filter(({ x, y }) => x === 0 || y === 0 || x === width - 1 || y === height - 1);
  const occupied = room.sessions.map(session => session.player.position);
  const free = edges.filter(p => occupied.every(other => p.x !== other.x || p.y !== other.y));
  return free[randomInt(free.length)];
}
export function addSession(room: Room, socket: string, tokenHash: string, profile: Profile, now: number) {
  let existing = room.sessions.find(session => session.tokenHash === tokenHash);
  if (!existing) {
    if (room.sessions.length >= 4) {
      const vacancy = room.sessions.findIndex(session => !session.player.connected && session.player.id !== room.host && now - session.until >= grace);
      if (vacancy < 0) throw new Error('This room is full.');
      room.sessions.splice(vacancy, 1);
    }
    const color = colors.find(color => room.sessions.every(session => session.player.color !== color))!;
    existing = {
      player: { id: randomUUID(), profile, color, connected: true, ready: false, position: spawn(room), direction: 'down', mode: 'walk' },
      tokenHash, socket, until: now + lease, joined: now,
    };
    room.sessions.push(existing);
  }
  existing.socket = socket;
  if (profile.crossStyle) existing.player.profile = { ...existing.player.profile, crossStyle: profile.crossStyle };
  existing.player.connected = true;
  existing.until = now + lease;
  if (room.phase === 'playing' && !room.participants.includes(existing.player.id)) room.participants.push(existing.player.id);
  reconcile(room, now);
  return existing;
}

export function start(room: Room, now: number) {
  room.phase = 'playing';
  room.startedAt = now;
  room.finishedAt = undefined;
  room.participants = room.sessions.filter(s => s.player.connected).map(s => s.player.id);
  for (const { player } of room.sessions) {
    player.position = spawn(room);
    player.direction = 'down';
    player.mode = 'walk';
    player.ready = false;
  }
}

export function apply(room: Room, session: Session, x: number, y: number, mark: Mark, now: number, actionId?: string): Patch | undefined {
  return applyChanges(room, session, attemptMark(room.game!, x, y, mark, room.settings.penalizeIncorrectCrosses), now, actionId);
}

export function applyCrosses(room: Room, session: Session, points: Point[], now: number, actionId: string) {
  return applyChanges(room, session, attemptCrosses(room.game!, points, room.settings.penalizeIncorrectCrosses), now, actionId);
}

function applyChanges(room: Room, session: Session, changes: ReturnType<typeof attemptMark>, now: number, actionId?: string): Patch | undefined {
  if (!changes) return;
  if (changes.phase) {
    room.phase = changes.phase;
    room.finishedAt = now;
  }
  const crossStyles = recordCrossStyles(room.game!.view, changes.cells, session.player.profile.crossStyle ?? 'standard');
  return { ...changes, crossStyles, boardId: room.game!.id, revision: ++room.revision, actor: session.player.id, actionId, finishedAt: room.finishedAt };
}

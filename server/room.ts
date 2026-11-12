import { createHash, randomInt, randomUUID } from 'node:crypto';
import { accessories, crossStyleIds, crossUploadMaxBytes, crossUploadMaxDimension, difficulties, hairColors, isUploadedCrossStyle, shirts, skins, styles } from '../shared/protocol.ts';
import type { Mark, Patch, Point, Profile, PuzzleResult, SettingsInput, Snapshot, Update } from '../shared/protocol.ts';
import { attemptCrosses, attemptMark, recordCrossImage, recordCrossStyles } from '../shared/board.ts';
import { getPicture, validImageCells } from '../shared/pictures.ts';
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
export function settingsOf(value: SettingsInput) {
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 5 || value.width > 60
      || value.height < 5 || value.height > 60 || !difficulties.includes(value.difficulty) || typeof value.name !== 'string') {
    throw new Error('Choose a width and height between 5 and 60 and a valid difficulty.');
  }
  if (value.penalizeIncorrectCrosses !== undefined && typeof value.penalizeIncorrectCrosses !== 'boolean') {
    throw new Error('Choose whether incorrect crosses cost a life.');
  }
  const picture = getPicture(value.picture);
  if (value.picture !== undefined && value.picture !== 'upload' && !picture) throw new Error('Choose a picture from the pack.');
  return {
    width: picture?.width ?? value.width, height: picture?.height ?? value.height, difficulty: picture?.difficulty ?? value.difficulty,
    name: value.name.trim().slice(0, 32), picture: value.picture,
    penalizeIncorrectCrosses: value.penalizeIncorrectCrosses ?? true,
  };
}
export function imageCellsOf(settings: SettingsInput, cells?: string) {
  if (settings.picture !== 'upload') return;
  if (!validImageCells(settings.width, settings.height, cells)) throw new Error('Choose an image with both filled and empty cells.');
  return cells;
}
export function profileOf(value: Profile): Profile {
  const valid = (i: number, options: unknown[]) => Number.isInteger(i) && i >= 0 && i < options.length;
  if (!value || typeof value.name !== 'string' || !valid(value.skin, skins) || !valid(value.hair, hairColors)
      || !valid(value.shirt, shirts) || !valid(value.style, styles) || !valid(value.accessory, accessories)) {
    throw new Error('Choose valid character options.');
  }
  const name = Array.from(new Intl.Segmenter().segment(value.name.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim()))
    .slice(0, 16).map(({ segment }) => segment).join('') || 'Walker';
  const profile = { name, skin: value.skin, hair: value.hair, shirt: value.shirt, style: value.style, accessory: value.accessory };
  const crossStyle = crossStyleIds.find(style => style === value.crossStyle);
  if (crossStyle) return { ...profile, crossStyle };
  if (!isUploadedCrossStyle(value.crossStyle)) return profile;
  const image = value.crossImage;
  if (typeof image !== 'string' || image.length > Math.ceil(crossUploadMaxBytes / 3) * 4 + 22) {
    throw new Error('Upload a cross image up to 256 KB.');
  }
  const match = /^data:image\/(png|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  const bytes = Buffer.from(match?.[2] ?? '', 'base64');
  const png = match?.[1] === 'png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR';
  const gif = match?.[1] === 'gif' && bytes.length >= 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6));
  const width = png ? bytes.readUInt32BE(16) : gif ? bytes.readUInt16LE(6) : 0;
  const height = png ? bytes.readUInt32BE(20) : gif ? bytes.readUInt16LE(8) : 0;
  if (!width || !height || width > crossUploadMaxDimension || height > crossUploadMaxDimension ||
      bytes.length > crossUploadMaxBytes || bytes.toString('base64') !== match?.[2] || `upload:${digest(image)}` !== value.crossStyle) {
    throw new Error('Upload a valid image up to 256 KB and 512 × 512 pixels.');
  }
  return { ...profile, crossStyle: value.crossStyle, crossImage: image };
}

export function checkCrossImageCapacity(room: Room, profile: Profile, replacing?: Session) {
  if (!isUploadedCrossStyle(profile.crossStyle)) return;
  const images = new Set(Object.keys(room.game?.view.crossImages ?? {}));
  for (const session of room.sessions) {
    const style = session.player.profile.crossStyle;
    if (session !== replacing && isUploadedCrossStyle(style)) images.add(style);
  }
  images.add(profile.crossStyle);
  if (images.size > 16) throw new Error('This puzzle has reached its limit of 16 custom cross images.');
}
export function finishedPuzzle(room: Room): PuzzleResult | undefined {
  if (!room.game || (room.phase !== 'completed' && room.phase !== 'failed')) return room.lastResult;
  return {
    phase: room.phase, settings: room.settings, cells: room.game.view.cells, crossStyles: room.game.view.crossStyles, crossImages: room.game.view.crossImages,
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
  checkCrossImageCapacity(room, profile, existing);
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
  if (profile.crossStyle) existing.player.profile = { ...existing.player.profile, crossStyle: profile.crossStyle, crossImage: profile.crossImage };
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
  const game = room.game!;
  const { crossStyle = 'standard', crossImage } = session.player.profile;
  const crossStyles = recordCrossStyles(game.view, changes.cells, crossStyle);
  const crossImages = crossStyles && recordCrossImage(game.view, crossStyle, crossImage);
  return { ...changes, crossStyles, crossImages, boardId: game.id, revision: ++room.revision, actor: session.player.id, actionId, finishedAt: room.finishedAt };
}

export const difficulties = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = typeof difficulties[number];
export type Mode = 'walk' | 'fill';
export type Mark = 0 | 1 | 2;
export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right' | 'upLeft' | 'upRight' | 'downLeft' | 'downRight';
export const movementInterval = 150;
export const boardMargin = 3;
export const puzzleLives = 3;
export const crossBatchLimit = 120;
export const directions: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 }, upRight: { x: 1, y: -1 }, downLeft: { x: -1, y: 1 }, downRight: { x: 1, y: 1 },
};
export function insideBoard(point: Point, size: Pick<Settings, 'width' | 'height'>) {
  return point.x >= 0 && point.y >= 0 && point.x < size.width && point.y < size.height;
}
export function constrainPosition(point: Point, size: Pick<Settings, 'width' | 'height'>, margin = 0): Point {
  return {
    x: Math.max(-margin, Math.min(size.width - 1 + margin, point.x)),
    y: Math.max(-margin, Math.min(size.height - 1 + margin, point.y)),
  };
}
export const skins = ['#ffd6ad', '#dc9a69', '#925b40', '#5d3a31'];
export const hairColors = ['#523732', '#272c35', '#d59650', '#923f42'];
export const shirts = ['#6e9468', '#bb715a', '#688eae', '#9c77ae'];
export const styles = ['Crop', 'Sweep', 'Puffs'];
export const accessories = ['None', 'Cap', 'Bow'];
export type Profile = { name: string; skin: number; hair: number; style: number; shirt: number; accessory: number };
export const defaultProfile: Profile = { name: 'Walker', skin: 0, hair: 0, style: 1, shirt: 0, accessory: 0 };
export const defaultSettings = { width: 15, height: 15, difficulty: 'medium', name: '', penalizeIncorrectCrosses: true } as const;
export type Settings = { width: number; height: number; difficulty: Difficulty; name: string; penalizeIncorrectCrosses?: boolean };
export type Player = { id: string; profile: Profile; color: string; connected: boolean; ready: boolean; position: Point; direction: Direction; mode: Mode; gridOnly?: boolean };
export type Line = { complete: boolean; grey: boolean[] };
export type Board = { id: string; rows: number[][]; columns: number[][]; cells: Mark[]; rowState: Line[]; columnState: Line[] };
export type EndPhase = 'completed' | 'failed';
export type PuzzleResult = { phase: EndPhase; settings: Settings; cells: Mark[]; startedAt?: number; finishedAt?: number; participants: number };
export type Phase = 'lobby' | 'generating' | 'playing' | EndPhase;
export type Snapshot = {
  version: number;
  code: string; settings: Settings; host: string; players: Player[]; phase: Phase; board?: Board;
  revision: number; startedAt?: number; finishedAt?: number; participants: number; progress: number; error?: string;
  lives?: number;
  lastResult?: PuzzleResult;
};
export type Patch = {
  boardId: string; revision: number; cells: [number, Mark][]; rows: [number, Line][]; columns: [number, Line][];
  actor: string; actionId?: string; finishedAt?: number; phase?: EndPhase; lives?: number;
  mistakes?: number[];
};
export type Motion = Pick<Player, 'id' | 'position' | 'direction' | 'mode' | 'gridOnly'> & { boardId: string };
export type Update =
  | { type: 'snapshot'; room: Snapshot }
  | { type: 'motion'; motion: Motion; patch?: Patch }
  | { type: 'patch'; patch: Patch }
  | { type: 'progress'; progress: number }
  | { type: 'lease' };
export type Notice = { code: string; version: number; update: Update };
export type Identity = { id: string; room: Snapshot };
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
export type Ack<T = void> = (result: Result<T>) => void;
export interface ToServer {
  'room:create': (data: { token: string; profile: Profile; settings: Settings }, ack: Ack<Identity>) => void;
  'room:join': (data: { code: string; token: string; profile: Profile }, ack: Ack<Identity>) => void;
  'room:leave': (ack: Ack) => void;
  'room:ready': (ack: Ack) => void;
  'room:settings': (settings: Settings, ack: Ack) => void;
  'room:snapshot': (ack: Ack<Snapshot>) => void;
  'player:profile': (profile: Profile, ack: Ack) => void;
  'game:generate': (ack: Ack) => void;
  'game:start': (ack: Ack) => void;
  'game:lobby': (ack: Ack) => void;
  'player:move': (data: { direction: Direction; boardId: string }) => void;
  'player:mode': (data: { mode: Mode; boardId: string }) => void;
  'player:grid': (data: { gridOnly: boolean; boardId: string }) => void;
  'cell:set': (data: (Point & { mark: Mark } | { crosses: Point[] }) & { boardId: string; revision: number; actionId: string }, ack: Ack) => void;
}
export interface ToClient {
  'room:update': (notice: Notice) => void;
  'room:replaced': () => void;
}

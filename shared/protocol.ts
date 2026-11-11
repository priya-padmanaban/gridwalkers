export const difficulties = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = typeof difficulties[number];
export type Mode = 'walk' | 'fill';
export type Mark = 0 | 1 | 2;
export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right';
export const movementInterval = 110;
export const directions: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
export const skins = ['#ffd6ad', '#dc9a69', '#925b40', '#5d3a31'];
export const hairColors = ['#523732', '#272c35', '#d59650', '#923f42'];
export const shirts = ['#6e9468', '#bb715a', '#688eae', '#9c77ae'];
export const styles = ['Crop', 'Sweep', 'Puffs'];
export const accessories = ['None', 'Cap', 'Bow'];
export type Profile = { name: string; skin: number; hair: number; style: number; shirt: number; accessory: number };
export const defaultProfile: Profile = { name: 'Walker', skin: 0, hair: 0, style: 1, shirt: 0, accessory: 0 };
export const defaultSettings = { width: 15, height: 15, difficulty: 'medium', name: '' } as const;
export type Settings = { width: number; height: number; difficulty: Difficulty; name: string };
export type Player = { id: string; profile: Profile; color: string; connected: boolean; ready: boolean; position: Point; direction: Direction; mode: Mode };
export type Line = { complete: boolean; grey: boolean[] };
export type Board = { id: string; rows: number[][]; columns: number[][]; cells: Mark[]; rowState: Line[]; columnState: Line[] };
export type Phase = 'lobby' | 'generating' | 'playing' | 'completed';
export type Snapshot = {
  version: number;
  code: string; settings: Settings; host: string; players: Player[]; phase: Phase; board?: Board;
  revision: number; startedAt?: number; finishedAt?: number; participants: number; progress: number; error?: string;
};
export type Patch = {
  boardId: string; revision: number; cells: [number, Mark][]; rows: [number, Line][]; columns: [number, Line][];
  actor: string; actionId?: string; finishedAt?: number;
};
export type Motion = Pick<Player, 'id' | 'position' | 'direction' | 'mode'> & { boardId: string };
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
  'cell:set': (data: Point & { mark: Mark; boardId: string; revision: number; actionId: string }, ack: Ack) => void;
}
export interface ToClient {
  'room:update': (notice: Notice) => void;
  'room:replaced': () => void;
}

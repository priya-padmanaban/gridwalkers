import Redis from 'ioredis';
import type { Notice, Player, Settings, Snapshot, Update } from '../shared/protocol.ts';
import type { Game } from './board.ts';

export type Session = {
  player: Player; tokenHash: string; socket: string; until: number; joined: number;
  movedAt?: number; actionIds?: string[];
};
export type Room = {
  code: string; version: number; revision: number; host: string; settings: Settings;
  sessions: Session[]; phase: Snapshot['phase']; progress: number; game?: Game;
  startedAt?: number; finishedAt?: number; participants: string[]; error?: string;
  generation?: { id: string; until: number; start: boolean };
};
const commit = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('PUBLISH', ARGV[4], ARGV[5])
return 1
`;
const create = `
if not redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 0 end
return 1
`;
const rate = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`;
const ttl = 15 * 60_000;

export class RoomStore {
  redis: Redis;
  subscriber: Redis;
  prefix: string;
  channel: string;
  constructor(url: string, namespace: string) {
    this.prefix = 'gridwalkers:' + namespace + ':';
    this.channel = this.prefix + 'updates';
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 4000, commandTimeout: 5000 });
    this.subscriber = this.redis.duplicate({ commandTimeout: undefined });
    this.redis.on('error', () => {});
    this.subscriber.on('error', () => {});
  }
  async subscribe(listener: (notice: Notice) => void) {
    this.subscriber.on('message', (channel, message) => {
      if (channel === this.channel) listener(JSON.parse(message) as Notice);
    });
    await this.subscriber.subscribe(this.channel);
  }
  async read(code: string): Promise<Room | undefined> {
    const raw = await this.redis.get(this.prefix + code);
    return raw ? JSON.parse(raw) as Room : undefined;
  }
  async create(room: Room) {
    return Boolean(await this.redis.eval(create, 1, this.prefix + room.code, JSON.stringify(room), ttl));
  }
  async limit(key: string, count: number, window: number) {
    return Number(await this.redis.eval(rate, 1, this.prefix + 'rate:' + key, window)) <= count;
  }
  async change<T>(code: string, change: (room: Room) => { value: T; update?: Update }): Promise<{ value: T; room: Room }> {
    const key = this.prefix + code;
    for (let attempt = 0; attempt < 20; attempt++) {
      const raw = await this.redis.get(key);
      if (!raw) throw new Error('This room has expired or does not exist.');
      const room = JSON.parse(raw) as Room;
      const { value, update } = change(room);
      if (!update) return { value, room };
      room.version++;
      const notice: Notice = { code, version: room.version, update };
      if (await this.redis.eval(commit, 1, key, raw, JSON.stringify(room), ttl, this.channel, JSON.stringify(notice))) {
        return { value, room };
      }
    }
    throw new Error('The room is busy. Try again.');
  }
}

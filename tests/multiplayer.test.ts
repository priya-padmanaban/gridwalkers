import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from '../server/socket.ts';
import { defaultProfile, defaultSettings, directions } from '../shared/protocol.ts';
import type { Direction, Identity, Notice, Snapshot, ToClient, ToServer } from '../shared/protocol.ts';

const redisTests = process.env.RUN_REDIS_TESTS === '1';
const token = () => randomBytes(32).toString('hex');
type Client = Socket<ToClient, ToServer>;
const settings = { ...defaultSettings, width: 5, height: 5, difficulty: 'easy' as const };

describe.runIf(redisTests)('multiplayer across two Redis-backed servers', () => {
  const servers: ReturnType<typeof createGameServer>[] = [];
  const clients: Client[] = [];
  beforeAll(async () => {
    process.env.REDIS_NAMESPACE = 'vitest-' + randomUUID();
    for (let i = 0; i < 2; i++) {
      const instance = createGameServer();
      servers.push(instance);
      instance.server.listen(0, '127.0.0.1');
      await once(instance.server, 'listening');
    }
  });
  afterAll(async () => {
    clients.forEach(client => client.disconnect());
    for (const instance of servers) {
      await instance.io.close();
      instance.store.redis.disconnect();
      instance.store.subscriber.disconnect();
    }
  });
  async function clientAt(index: number): Promise<Client> {
    const address = servers[index].server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const client: Client = connect('http://127.0.0.1:' + address.port, { transports: ['websocket'], path: '/api/ws', addTrailingSlash: false, forceNew: true, autoConnect: false });
    clients.push(client);
    const ready = new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    client.connect();
    await ready;
    return client;
  }
  async function publicRoom(client: Client): Promise<Snapshot> {
    const result = await client.timeout(4000).emitWithAck('room:snapshot');
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it('enforces capacity and host rights, syncs concurrent writes, reclaims sessions, and completes on both instances', async () => {
    const [host, guest, third, fourth, extra] = await Promise.all([0, 1, 0, 1, 1].map(clientAt));
    const hostToken = token();
    const create = await host.timeout(4000).emitWithAck('room:create', { token: hostToken, profile: defaultProfile, settings });
    expect(create.ok).toBe(true);
    const original = (create as { ok: true; value: Identity }).value;
    const { code } = original.room;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const guestToken = token();
    const joins = await Promise.all([guest, third, fourth].map((client, i) => client.timeout(4000).emitWithAck('room:join', { token: i === 0 ? guestToken : token(), code, profile: { ...defaultProfile, name: 'Guest ' + i } })));
    expect(joins.every(join => join.ok)).toBe(true);
    expect(await extra.timeout(4000).emitWithAck('room:join', { token: token(), code, profile: defaultProfile })).toEqual({ ok: false, error: 'This room is full.' });
    expect((await guest.timeout(4000).emitWithAck('game:start')).ok).toBe(false);
    expect((await host.timeout(4000).emitWithAck('game:start')).ok).toBe(true);
    await expect.poll(async () => (await publicRoom(guest)).phase, { timeout: 8500 }).toBe('playing');
    const state = await publicRoom(host);
    expect(state.players).toHaveLength(4);
    expect(JSON.stringify(state)).not.toMatch(/solution|tokenHash|autoCrossSources/);
    const boardId = state.board!.id;
    const [x, y] = [state.players[0].position.x, state.players[0].position.y];
    const direction = (Object.keys(directions) as Direction[]).find(key => {
      const delta = directions[key];
      return x + delta.x >= 0 && y + delta.y >= 0 && x + delta.x < 5 && y + delta.y < 5;
    })!;
    const dest = { x: x + directions[direction].x, y: y + directions[direction].y };
    host.emit('player:move', { direction, boardId });
    await expect.poll(async () => (await publicRoom(guest)).players[0].position).toEqual(dest);
    expect((await publicRoom(guest)).revision).toBe(0);
    const destinationFilled = (await servers[0].store.read(code))!.game!.puzzle.solution[dest.y * 5 + dest.x];
    host.emit('player:mode', { mode: 'fill', boardId });
    await expect.poll(async () => (await publicRoom(guest)).revision).toBe(1);
    expect((await publicRoom(guest)).lives).toBe(destinationFilled ? 3 : 2);
    expect((await publicRoom(host)).revision).toBe(1);
    const activeGame = (await servers[0].store.read(code))!.game!;
    const target = activeGame.puzzle.solution.indexOf(1);
    let revision = 1;
    if (activeGame.marks[target] !== 1) {
      const fill = await host.timeout(4000).emitWithAck('cell:set', { x: target % 5, y: Math.floor(target / 5), boardId, revision, mark: 1, actionId: 'prepare-conflict' });
      expect(fill.ok).toBe(true);
      revision++;
      await new Promise(resolve => setTimeout(resolve, 26));
    }
    const updates: Notice[] = [];
    guest.on('room:update', notice => { updates.push(notice); });
    const move = { x: target % 5, y: Math.floor(target / 5), revision, boardId };
    const unfilled = activeGame.puzzle.solution.findIndex((value, i) => value === 1 && i !== target && activeGame.marks[i] !== 1);
    const actions = await Promise.all([
      host.timeout(4000).emitWithAck('cell:set', { ...move, mark: 0, actionId: 'clear' }),
      guest.timeout(4000).emitWithAck('cell:set', { boardId, revision, crosses: [
        { x: move.x, y: move.y }, { x: unfilled % 5, y: Math.floor(unfilled / 5) },
      ], actionId: 'cross' }),
    ]);
    expect(actions.every(action => action.ok)).toBe(true);
    await expect.poll(() => updates.filter(notice => notice.update.type === 'patch').length).toBe(1);
    const patches = updates.flatMap(notice => notice.update.type === 'patch' ? [notice.update.patch] : []);
    expect(patches).toMatchObject([{ revision: revision + 1, mistakes: [unfilled] }]);
    expect((await publicRoom(host)).board!.cells[target]).toBe(1);
    expect((await publicRoom(host)).lives).toBe(destinationFilled ? 2 : 1);
    expect((await publicRoom(guest)).board).toEqual((await publicRoom(host)).board);
    const guestIdentity = (joins[0] as { ok: true; value: Identity }).value;
    guest.disconnect();
    host.disconnect();
    const reconnectedGuest = await clientAt(0);
    const reconnectedHost = await clientAt(1);
    const restoredGuest = await reconnectedGuest.timeout(4000).emitWithAck('room:join', { token: guestToken, code, profile: defaultProfile });
    const restoredHost = await reconnectedHost.timeout(4000).emitWithAck('room:join', { token: hostToken, code, profile: defaultProfile });
    expect(restoredGuest.ok && restoredGuest.value.id).toBe(guestIdentity.id);
    expect(restoredGuest.ok && restoredGuest.value.room.revision).toBe(revision + 1);
    expect(restoredGuest.ok && restoredGuest.value.room.lives).toBe(destinationFilled ? 2 : 1);
    expect(restoredHost.ok && restoredHost.value.room.host).toBe(original.id);
    const authoritative = (await servers[0].store.read(code))!;
    for (const [i, value] of authoritative.game!.puzzle.solution.entries()) {
      const mark = value ? 1 : 0;
      if (authoritative.game!.marks[i] === mark || (!mark && authoritative.game!.marks[i] === 2)) continue;
      await new Promise(resolve => setTimeout(resolve, 28));
      const action = await reconnectedHost.timeout(4000).emitWithAck('cell:set', { boardId, revision: revision + 1, x: i % 5, y: Math.floor(i / 5), mark, actionId: 'solve-' + i });
      expect(action.ok).toBe(true);
    }
    await expect.poll(async () => (await publicRoom(reconnectedGuest)).phase).toBe('completed');
    expect((await publicRoom(reconnectedHost)).finishedAt).toBe((await publicRoom(reconnectedGuest)).finishedAt);
  });
});

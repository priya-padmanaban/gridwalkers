import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { directions, movementInterval } from '../shared/protocol.ts';
import type { Ack, Identity, Motion, Snapshot, ToClient, ToServer, Update } from '../shared/protocol.ts';
import { newGame } from '../shared/board.ts';
import { generateAsync } from './generation.ts';
import { addSession, apply, codeOf, digest, full, lease, profileOf, reconcile, roomCode, settingsOf, snapshot, start, tokenOf } from './room.ts';
import { RoomStore } from './store.ts';
import type { Room, Session } from './store.ts';

export function createGameServer() {
  if (process.env.VERCEL && !process.env.REDIS_URL) throw new Error('REDIS_URL is required on Vercel.');
  const store = new RoomStore(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    process.env.REDIS_NAMESPACE ?? process.env.VERCEL_ENV ?? 'local');
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404);
    res.end(req.url === '/health' ? 'Gridwalkers' : 'Not found');
  });
  const origin = process.env.PUBLIC_APP_URL ? new URL(process.env.PUBLIC_APP_URL).origin : undefined;
  const io = new Server<ToServer, ToClient>(server, {
    path: '/api/ws', addTrailingSlash: false, transports: ['websocket'], maxHttpBufferSize: 8192,
    allowRequest: (req, done) => {
      const requestOrigin = req.headers.origin;
      const forwardedHost = req.headers['x-forwarded-host'] ?? req.headers.host;
      let allowed = !requestOrigin;
      try { allowed ||= requestOrigin === origin || new URL(requestOrigin!).host === forwardedHost; } catch { /* Invalid origin. */ }
      done(null, allowed);
    },
  });
  const subscription = store.subscribe(notice => io.to(notice.code).emit('room:update', notice));
  subscription.catch(() => { /* Join requests report connection failures. */ });
  io.on('connection', socket => {
    let binding: { code: string; id: string } | undefined;
    let joining = false;
    let moving = false;
    let inputWindow = 0;
    let inputCount = 0;

    function allowBoardInput() {
      const now = Date.now();
      if (now >= inputWindow) {
        inputWindow = now + 1000;
        inputCount = 0;
      }
      return ++inputCount <= 35;
    }

    async function answer<T>(ack: Ack<T>, work: () => Promise<T>) {
      if (typeof ack !== 'function') return;
      try { ack({ ok: true, value: await work() }); }
      catch (error) { ack({ ok: false, error: error instanceof Error && !('code' in error) ? error.message : 'The room service is unavailable. Try again.' }); }
    }
    function current(room: Room, identity = binding) {
      const session = room.sessions.find(s => s.player.id === identity?.id && s.socket === socket.id);
      if (!session) throw new Error('This session was opened in another tab.');
      return session;
    }
    async function mutate(change: (room: Room, session: Session, now: number) => Update | undefined, host = false) {
      const identity = binding;
      if (!identity) throw new Error('Join a room first.');
      const result = await store.change(identity.code, room => {
        const now = Date.now();
        const changed = reconcile(room, now);
        const session = current(room, identity);
        if (host && room.host !== session.player.id) throw new Error('Only the host can do that.');
        const update = change(room, session, now);
        return { value: undefined, update: changed ? full(room) : update };
      });
      return result.room;
    }
    async function enter(work: () => Promise<{ room: Room; session: Session }>): Promise<Identity> {
      if (joining || binding) throw new Error('Leave your current room first.');
      joining = true;
      try {
        await subscription;
        const { room, session } = await work();
        binding = { code: room.code, id: session.player.id };
        await socket.join(room.code);
        if (!socket.connected) {
          await disconnect(false);
          throw new Error('Connection lost while joining.');
        }
        const latest = await store.read(room.code);
        return { id: session.player.id, room: snapshot(latest ?? room) };
      } finally { joining = false; }
    }
    async function disconnect(explicit: boolean) {
      const identity = binding;
      binding = undefined;
      if (!identity) return;
      await socket.leave(identity.code);
      await store.change(identity.code, room => {
        const session = room.sessions.find(s => s.player.id === identity.id && s.socket === socket.id);
        if (!session) return { value: undefined };
        session.player.connected = false;
        session.until = Date.now();
        if (explicit) room.sessions.splice(room.sessions.indexOf(session), 1);
        reconcile(room, Date.now());
        return { value: undefined, update: full(room) };
      });
    }
    socket.on('room:create', (data, ack) => void answer(ack, () => enter(async () => {
      const token = tokenOf(data?.token);
      const settings = settingsOf(data?.settings);
      const profile = profileOf(data?.profile);
      const ip = String(socket.handshake.headers['x-forwarded-for'] ?? socket.handshake.address).split(',')[0].trim();
      if (!await store.limit('create:' + digest(ip), 12, 60_000)) throw new Error('Too many rooms created. Try again shortly.');
      for (let i = 0; i < 12; i++) {
        const room: Room = { code: roomCode(), host: '', settings, sessions: [], version: 0, revision: 0, phase: 'lobby', progress: 0, participants: [] };
        const session = addSession(room, socket.id, token, profile, Date.now());
        room.host = session.player.id;
        if (await store.create(room)) return { room, session };
      }
      throw new Error('Could not allocate a room code. Try again.');
    })));
    socket.on('room:join', (data, ack) => void answer(ack, () => enter(async () => {
      const code = codeOf(data?.code);
      const token = tokenOf(data?.token);
      const profile = profileOf(data?.profile);
      const { room, value } = await store.change(code, room => {
        reconcile(room, Date.now());
        const session = addSession(room, socket.id, token, profile, Date.now());
        return { value: session, update: full(room) };
      });
      return { room, session: value };
    })));
    socket.on('room:leave', ack => void answer(ack, () => disconnect(true)));
    socket.on('room:snapshot', ack => void answer<Snapshot>(ack, async () => {
      const room = await mutate(() => undefined);
      return snapshot(room);
    }));
    socket.on('room:ready', ack => void answer(ack, async () => {
      await mutate((room, { player }) => {
        if (room.phase !== 'lobby') throw new Error('Ready status is available in the lobby.');
        player.ready = !player.ready;
        return full(room);
      });
    }));
    socket.on('player:profile', (data, ack) => void answer(ack, async () => {
      const profile = profileOf(data);
      await mutate((room, session) => { session.player.profile = profile; return full(room); });
    }));
    socket.on('room:settings', (data, ack) => void answer(ack, async () => {
      const settings = settingsOf(data);
      await mutate(room => {
        if (room.phase !== 'lobby') throw new Error('Settings can only change in the lobby.');
        const previous = room.settings;
        room.settings = settings;
        if (settings.width !== previous.width || settings.height !== previous.height || settings.difficulty !== previous.difficulty) room.game = undefined;
        room.error = undefined;
        return full(room);
      }, true);
    }));
    socket.on('game:lobby', ack => void answer(ack, async () => {
      await mutate(room => {
        if (room.phase !== 'completed') throw new Error('Finish the puzzle first.');
        room.phase = 'lobby';
        room.game = undefined;
        room.finishedAt = undefined;
        room.startedAt = undefined;
        room.progress = 0;
        room.participants = [];
        return full(room);
      }, true);
    }));

    async function launch(play: boolean) {
      const generationId = randomUUID();
      const room = await mutate((room, _, now) => {
        if (room.phase !== 'lobby' && !(play && room.phase === 'completed')) throw new Error('A game is already in progress.');
        if (play && room.phase === 'lobby' && room.game) { start(room, now); return full(room); }
        room.game = undefined;
        room.startedAt = undefined;
        room.finishedAt = undefined;
        room.phase = 'generating';
        room.generation = { id: generationId, until: now + (Number(process.env.GENERATION_MS) || 4500) + 6000, start: play };
        room.error = undefined;
        room.progress = 0;
        return full(room);
      }, true);
      if (room.generation?.id !== generationId) return;
      const updateJob = (work: (room: Room) => Update | undefined) => store.change(room.code, current => ({
        value: undefined, update: current.generation?.id === generationId ? work(current) : undefined,
      }));
      void (async () => {
        try {
          const puzzle = await generateAsync(room.settings, progress => {
            void updateJob(current => {
              if (progress <= current.progress) return;
              current.progress = progress;
              return { type: 'progress', progress };
            }).catch(() => {});
          });
          await updateJob(current => {
            current.game = newGame(generationId, puzzle);
            current.phase = 'lobby';
            current.progress = 100;
            current.generation = undefined;
            if (play) start(current, Date.now());
            return full(current);
          });
        } catch {
          await updateJob(current => {
            current.phase = 'lobby';
            current.generation = undefined;
            current.progress = 0;
            current.error = 'No puzzle was found within the generation budget. Try again for a new seed.';
            return full(current);
          }).catch(() => {});
        }
      })();
    }
    socket.on('game:generate', ack => void answer(ack, () => launch(false)));
    socket.on('game:start', ack => void answer(ack, () => launch(true)));

    const motionOf = (room: Room, { player }: Session): Motion => ({
      id: player.id, position: player.position, direction: player.direction, mode: player.mode, boardId: room.game!.id,
    });
    socket.on('player:move', data => {
      if (moving || !data || !Object.hasOwn(directions, data.direction)) return;
      moving = true;
      void mutate((room, session, now) => {
        if (room.phase !== 'playing' || data.boardId !== room.game?.id || now - (session.movedAt ?? 0) < movementInterval - 14) return;
        const player = session.player;
        const delta = directions[data.direction];
        const x = player.position.x + delta.x;
        const y = player.position.y + delta.y;
        player.direction = data.direction;
        session.movedAt = now;
        let patch;
        if (x >= 0 && y >= 0 && x < room.settings.width && y < room.settings.height) {
          player.position = { x, y };
          if (player.mode === 'fill') patch = apply(room, session, x, y, 1, now);
        }
        return { type: 'motion', motion: motionOf(room, session), patch };
      }).catch(() => {}).finally(() => { moving = false; });
    });
    socket.on('player:mode', data => {
      if (!data || (data.mode !== 'walk' && data.mode !== 'fill') || !allowBoardInput()) return;
      void mutate((room, session, now) => {
        if (room.phase !== 'playing' || data.boardId !== room.game?.id || data.mode === session.player.mode) return;
        session.player.mode = data.mode;
        const { x, y } = session.player.position;
        const patch = data.mode === 'fill' ? apply(room, session, x, y, 1, now) : undefined;
        return { type: 'motion', motion: motionOf(room, session), patch };
      }).catch(() => {});
    });
    socket.on('cell:set', (data, ack) => void answer(ack, async () => {
      if (!data || !Number.isInteger(data.x) || !Number.isInteger(data.y) || ![0, 1, 2].includes(data.mark)
        || !Number.isSafeInteger(data.revision) || typeof data.actionId !== 'string' || !/^[\w-]{1,64}$/.test(data.actionId)) {
        throw new Error('Invalid cell action.');
      }
      if (!allowBoardInput()) throw new Error('Too many cell actions.');
      await mutate((room, session, now) => {
        if (room.phase !== 'playing' || data.boardId !== room.game?.id || data.revision > room.revision) throw new Error('This puzzle is no longer active.');
        if (data.x < 0 || data.y < 0 || data.x >= room.settings.width || data.y >= room.settings.height) throw new Error('Cell is outside the puzzle.');
        if (session.actionIds?.includes(data.actionId)) return;
        const patch = apply(room, session, data.x, data.y, data.mark, now, data.actionId);
        session.actionIds = [...(session.actionIds ?? []).slice(-63), data.actionId];
        return patch ? { type: 'patch', patch } : { type: 'lease' };
      });
    }));
    let beating = false;
    const heartbeat = setInterval(() => {
      if (!binding || beating) return;
      beating = true;
      void mutate((_, session, now) => {
        session.until = now + lease;
        session.player.connected = true;
        return { type: 'lease' };
      }).catch(error => {
        if (error instanceof Error && (error.message.includes('another tab') || error.message.includes('expired'))) {
          socket.emit('room:replaced');
          socket.disconnect(true);
        }
      }).finally(() => { beating = false; });
    }, 5000);
    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      void disconnect(false).catch(() => {});
    });
  });
  return { server, io, store };
}

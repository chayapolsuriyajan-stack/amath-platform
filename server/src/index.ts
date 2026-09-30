import { createServer, type IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@amath/shared';
import { BotDriver } from './bot';
import { Rooms, StoreUnavailable, type Room } from './rooms';
import { MonitoredStore, storeFromEnv, type RoomStore } from './store';

/**
 * Browsers always send an Origin, so this stops other websites from driving the
 * game in a visitor's browser. Scripts can forge it, which is why every rule is
 * still enforced by the game logic itself. Requests with no Origin (tests, tools)
 * are allowed for the same reason.
 */
const DEFAULT_ORIGINS = [
  /^https:\/\/amath-platform(-[a-z0-9-]+)?\.vercel\.app$/,
  // the game server itself on Render, in whichever region it runs
  /^https:\/\/amath-[a-z0-9-]+\.onrender\.com$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export const originAllowed = (origin: string | undefined) =>
  !origin || extraOrigins.includes(origin) || DEFAULT_ORIGINS.some((re) => re.test(origin));

/**
 * The client's address. Render's proxy appends the address it saw to
 * X-Forwarded-For, so the last entry is the trustworthy one; anything before it
 * was sent by the client and could be made up to dodge the join limit.
 */
export const clientIp = (req: Pick<IncomingMessage, 'headers' | 'socket'>) => {
  const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] || req.socket.remoteAddress || 'unknown';
};

/** refills `rate` tokens a second up to `burst`; each call spends one */
function bucket(burst: number, rate: number) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** room codes are only 6 digits, so guessing them has to be slow */
const JOIN_ATTEMPTS_PER_MINUTE = 20;

export function createApp(opts: { botDelayScale?: number; store?: RoomStore | null } = {}) {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
    // the largest real message is a move of 8 placements, well under 2 KB
    maxHttpBufferSize: 16_000,
  });
  // undefined means "look at the environment"; null means "memory only", which tests ask for
  const chosen = opts.store === undefined ? storeFromEnv() : opts.store;
  const store = chosen ? new MonitoredStore(chosen) : null;
  const rooms = new Rooms({ store });
  const joinAttempts = new Map<string, number[]>();

  app.disable('x-powered-by');
  app.get('/health', (req, res) => {
    // the site polls this to show wake-up progress; Render's own "waking up" page has no CORS
    // header, so a response that can be read here means the real server is up
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    // `persistent` tells the page whether a restart would lose open games; the reason for a
    // database failure stays in the server log, not on a public page. `usage` is how many
    // commands this process has spent, to compare with the monthly allowance.
    const status = store?.status();
    res.json({
      ok: true,
      rooms: rooms.rooms.size,
      persistent: !!store,
      store: status ? { kind: status.kind, ok: status.ok, usage: status.usage } : null,
    });
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const sendTo = (room: Room, seat: 0 | 1) => {
    const id = room.seats[seat]?.socketId;
    if (id) io.to(id).emit('room:update', rooms.update(room, seat));
  };
  const sendAll = (room: Room) => room.seats.forEach((_, i) => sendTo(room, i as 0 | 1));
  const bots = new BotDriver(
    rooms,
    {
      broadcast: sendAll,
      sendTo,
      sticker: (room, ev) => room.seats.forEach((s) => s.socketId && io.to(s.socketId).emit('room:sticker', ev)),
    },
    { delayScale: opts.botDelayScale },
  );
  // every change goes to both players, and gives the computer its turn if it is due
  const broadcast = (room: Room) => {
    sendAll(room);
    bots.poke(room);
  };

  const recentAttempts = (ip: string) => {
    const now = Date.now();
    const recent = (joinAttempts.get(ip) ?? []).filter((t) => now - t < 60_000);
    joinAttempts.set(ip, recent);
    return recent;
  };
  /** spends one attempt; false once the address has used its budget for the minute */
  const joinAllowed = (ip: string) => {
    const recent = recentAttempts(ip);
    if (recent.length >= JOIN_ATTEMPTS_PER_MINUTE) return false;
    recent.push(Date.now());
    return true;
  };

  io.on('connection', (socket) => {
    let current: { room: Room; seat: 0 | 1 } | null = null;
    const ip = clientIp(socket.request);
    // generous for real play (drafts arrive a few times a second), tight for floods
    const allow = bucket(40, 20);

    const reply = (cb: unknown) => (typeof cb === 'function' ? (cb as (r: unknown) => void) : () => {});
    const guard = <T extends { ok: false; error: string }>(cb: unknown, fn: (c: { room: Room; seat: 0 | 1 }) => { ok: true } | T) => {
      const send = reply(cb);
      if (!allow()) return send({ ok: false, error: 'Too many requests, slow down' });
      if (!current) return send({ ok: false, error: 'You are not in a room', code: 'not-in-room' });
      const res = fn(current);
      send(res);
      if (res.ok) broadcast(current.room);
    };

    // the database could not be asked, so we cannot say the room does not exist: the client tries again
    const unavailable = {
      ok: false,
      error: 'The game database is not answering. Trying again in a moment.',
      code: 'unavailable',
    } as const;

    /** these handlers wait on the database; if the player left meanwhile, do not leave a dead connection in a seat */
    const dropIfGone = () => {
      if (socket.disconnected) {
        const room = rooms.disconnect(socket.id);
        if (room) broadcast(room);
        return true;
      }
      return false;
    };

    socket.on('room:create', async (a, cb) => {
      if (!allow()) return reply(cb)({ ok: false, error: 'Too many requests, slow down' });
      const res = await rooms.create(a?.name, a?.matchSeconds, socket.id, a?.bot);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 0 };
        if (!dropIfGone()) broadcast(current.room);
      }
      reply(cb)(res);
    });

    socket.on('room:join', async (a, cb) => {
      if (!allow() || !joinAllowed(ip)) return reply(cb)({ ok: false, error: 'Too many attempts, wait a minute', code: 'rate-limit' });
      // after a restart the room may only exist in the database
      try {
        await rooms.ensureLoaded(typeof a?.code === 'string' ? a.code : '');
      } catch (err) {
        if (err instanceof StoreUnavailable) return reply(cb)(unavailable);
        throw err;
      }
      const res = rooms.join(a?.code, a?.name, socket.id);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 1 };
        if (!dropIfGone()) broadcast(current.room);
      }
      reply(cb)(res);
    });

    socket.on('room:rejoin', async (a, cb) => {
      // Getting back into your own seat needs a 128-bit secret, so success is never counted:
      // everyone on one network can reload or reconnect as often as they like. Only failed
      // guesses spend the address's budget.
      const limited = { ok: false, error: 'Too many attempts, wait a minute', code: 'rate-limit' } as const;
      if (!allow() || recentAttempts(ip).length >= JOIN_ATTEMPTS_PER_MINUTE) return reply(cb)(limited);
      let room: Room | null;
      try {
        room = await rooms.ensureLoaded(typeof a?.code === 'string' ? a.code : '');
      } catch (err) {
        if (err instanceof StoreUnavailable) return reply(cb)(unavailable);
        throw err;
      }
      // with a database, asking about a room that is not there costs a lookup, so it counts as a
      // guess; without one it costs nothing
      if (!room && rooms.store) recentAttempts(ip).push(Date.now());
      const res = rooms.rejoin(a?.code, a?.token, socket.id);
      if (res.ok) {
        current = { room: res.room, seat: res.seat };
        if (!dropIfGone()) broadcast(res.room);
        return reply(cb)({ ok: true });
      }
      // a wrong token for a live room is a guess; a room that has simply expired is not
      if (res.code === 'no-seat') recentAttempts(ip).push(Date.now());
      reply(cb)(res);
    });

    socket.on('chat:send', (a, cb) => guard(cb, (c) => rooms.chat(c.room, c.seat, a?.text)));
    socket.on('game:move', (a, cb) => guard(cb, (c) => rooms.move(c.room, c.seat, a?.placements)));
    socket.on('game:exchange', (a, cb) => guard(cb, (c) => rooms.exchange(c.room, c.seat, a?.tileIds)));
    socket.on('game:pass', (cb) => guard(cb, (c) => rooms.pass(c.room, c.seat)));
    socket.on('game:resign', (cb) => guard(cb, (c) => rooms.resign(c.room, c.seat)));

    socket.on('game:draft', (a) => {
      if (!current || !allow()) return;
      // only the opponent needs to hear about it
      if (rooms.draft(current.room, current.seat, a?.placements)) sendTo(current.room, current.seat === 0 ? 1 : 0);
    });

    socket.on('chat:sticker', (a) => {
      if (!current || !allow()) return;
      const ev = rooms.sticker(current.room, current.seat, a?.sticker);
      if (!ev) return;
      for (const seat of current.room.seats) if (seat.socketId) io.to(seat.socketId).emit('room:sticker', ev);
    });

    socket.on('game:rematch', () => {
      if (!current || !allow()) return;
      rooms.rematch(current.room, current.seat);
      broadcast(current.room);
    });

    socket.on('disconnect', () => {
      const room = rooms.disconnect(socket.id);
      if (room) broadcast(room);
    });
  });

  const timer = setInterval(() => {
    rooms.sweep();
    const now = Date.now();
    for (const [ip, times] of joinAttempts) if (times.every((t) => now - t >= 60_000)) joinAttempts.delete(ip);
  }, 60_000);
  timer.unref();
  // a player who runs past their overtime loses even if they never act again
  const clock = setInterval(() => {
    for (const room of rooms.timedOut()) broadcast(room);
  }, 1000);
  clock.unref();
  return { app, http, io, rooms, store };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3001;
  const server = createApp();
  server.http.listen(port, () => {
    console.log(`A-Math server listening on http://localhost:${port}`);
    console.log(
      server.store
        ? `Games are saved to ${server.store.kind}, so they survive a restart.`
        : 'Games are kept in memory only and are lost on a restart. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to save them.',
    );
    // ask the database something harmless now, so a wrong URL or token shows up in the log at once
    // instead of on the first game
    server.store
      ?.has('000000')
      .then(() => console.log('Database check: reachable.'))
      .catch((err: Error) => console.error(`Database check FAILED: ${err.message}. Games will not be saved until this is fixed.`));
  });
  // Render stops the old server with SIGTERM when it deploys a new one: write every game first
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, saving games before stopping…`);
    await server.rooms.flush();
    const u = server.store?.status().usage;
    if (u) {
      // a line to add up from the log if the server restarts often
      const hours = ((Date.now() - u.since) / 3_600_000).toFixed(1);
      console.log(
        `Database use this run (${hours} h): ${u.commands} commands (${u.saves} saves, ${u.loads} loads, ${u.removes} deletes, ` +
          `${u.checks} checks), ${(u.bytesSent / 1024).toFixed(0)} KB sent, ${(u.bytesReceived / 1024).toFixed(0)} KB received, ${u.failures} failed.`,
      );
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

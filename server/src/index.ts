import { createServer, type IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@amath/shared';
import { Rooms, type Room } from './rooms';

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

export function createApp() {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
    // the largest real message is a move of 8 placements, well under 2 KB
    maxHttpBufferSize: 16_000,
  });
  const rooms = new Rooms();
  const joinAttempts = new Map<string, number[]>();

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const sendTo = (room: Room, seat: 0 | 1) => {
    const id = room.seats[seat]?.socketId;
    if (id) io.to(id).emit('room:update', rooms.update(room, seat));
  };
  const broadcast = (room: Room) => room.seats.forEach((_, i) => sendTo(room, i as 0 | 1));

  const joinAllowed = (ip: string) => {
    const now = Date.now();
    const recent = (joinAttempts.get(ip) ?? []).filter((t) => now - t < 60_000);
    const ok = recent.length < JOIN_ATTEMPTS_PER_MINUTE;
    if (ok) recent.push(now);
    joinAttempts.set(ip, recent);
    return ok;
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
      if (!current) return send({ ok: false, error: 'You are not in a room' });
      const res = fn(current);
      send(res);
      if (res.ok) broadcast(current.room);
    };

    socket.on('room:create', (a, cb) => {
      if (!allow()) return reply(cb)({ ok: false, error: 'Too many requests, slow down' });
      const res = rooms.create(a?.name, a?.turnSeconds, a?.matchSeconds, socket.id);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 0 };
        broadcast(current.room);
      }
      reply(cb)(res);
    });

    socket.on('room:join', (a, cb) => {
      if (!allow() || !joinAllowed(ip)) return reply(cb)({ ok: false, error: 'Too many attempts, wait a minute' });
      const res = rooms.join(a?.code, a?.name, socket.id);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 1 };
        broadcast(current.room);
      }
      reply(cb)(res);
    });

    socket.on('room:rejoin', (a, cb) => {
      if (!allow() || !joinAllowed(ip)) return reply(cb)({ ok: false, error: 'Too many attempts, wait a minute' });
      const res = rooms.rejoin(a?.code, a?.token, socket.id);
      if (res.ok) {
        current = { room: res.room, seat: res.seat };
        broadcast(res.room);
      }
      reply(cb)(res.ok ? { ok: true } : res);
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
  return { app, http, io, rooms };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3001;
  createApp().http.listen(port, () => console.log(`A-Math server listening on http://localhost:${port}`));
}

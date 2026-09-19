import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@amath/shared';
import { Rooms, type Room } from './rooms';

export function createApp() {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true } });
  const rooms = new Rooms();

  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const broadcast = (room: Room) => {
    room.seats.forEach((seat, i) => {
      if (seat.socketId) io.to(seat.socketId).emit('room:update', rooms.update(room, i as 0 | 1));
    });
  };

  io.on('connection', (socket) => {
    let current: { room: Room; seat: 0 | 1 } | null = null;

    const guard = <T extends { ok: false; error: string }>(cb: unknown, fn: (c: { room: Room; seat: 0 | 1 }) => { ok: true } | T) => {
      const reply = typeof cb === 'function' ? (cb as (r: unknown) => void) : () => {};
      if (!current) return reply({ ok: false, error: 'You are not in a room' });
      const res = fn(current);
      reply(res);
      if (res.ok) broadcast(current.room);
    };

    socket.on('room:create', (a, cb) => {
      const res = rooms.create(a?.name, socket.id);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 0 };
        broadcast(current.room);
      }
      if (typeof cb === 'function') cb(res);
    });

    socket.on('room:join', (a, cb) => {
      const res = rooms.join(a?.code, a?.name, socket.id);
      if (res.ok) {
        current = { room: rooms.rooms.get(res.code)!, seat: 1 };
        broadcast(current.room);
      }
      if (typeof cb === 'function') cb(res);
    });

    socket.on('room:rejoin', (a, cb) => {
      const res = rooms.rejoin(a?.code, a?.token, socket.id);
      if (res.ok) {
        current = { room: res.room, seat: res.seat };
        broadcast(res.room);
      }
      if (typeof cb === 'function') cb(res.ok ? { ok: true } : res);
    });

    socket.on('game:move', (a, cb) => guard(cb, (c) => rooms.move(c.room, c.seat, a?.placements)));
    socket.on('game:exchange', (a, cb) => guard(cb, (c) => rooms.exchange(c.room, c.seat, a?.tileIds)));
    socket.on('game:pass', (cb) => guard(cb, (c) => rooms.pass(c.room, c.seat)));
    socket.on('game:resign', (cb) => guard(cb, (c) => rooms.resign(c.room, c.seat)));
    socket.on('game:rematch', () => {
      if (!current) return;
      rooms.rematch(current.room, current.seat);
      broadcast(current.room);
    });

    socket.on('disconnect', () => {
      const room = rooms.disconnect(socket.id);
      if (room) broadcast(room);
    });
  });

  const timer = setInterval(() => rooms.sweep(), 60_000);
  timer.unref();
  return { app, http, io, rooms };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3001;
  createApp().http.listen(port, () => console.log(`A-Math server listening on http://localhost:${port}`));
}

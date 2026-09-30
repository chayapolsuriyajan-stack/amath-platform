import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/index';

let app: ReturnType<typeof createApp>;
let url: string;
const sockets: Socket[] = [];

const client = (base = url) => {
  const s = connect(base, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return s;
};
const emit = <T>(s: Socket, ev: string, ...args: unknown[]) =>
  new Promise<T>((resolve) => s.emit(ev, ...args, resolve));

type Fail = { ok: false; error: string; code?: string };
type Made = { ok: true; code: string; token: string };

beforeAll(async () => {
  app = createApp();
  await new Promise<void>((r) => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
});
afterAll(() => {
  sockets.forEach((s) => s.close());
  app.io.close();
  app.http.close();
});

/** GET with an Origin header, since browsers set one and fetch may not let us */
const get = (path: string, origin?: string) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.get(url + path, { headers: origin ? { Origin: origin } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
  });

describe('/health, used to show the wake-up progress', () => {
  it('can be read from the game site, and is never cached', async () => {
    const res = await get('/health', 'https://amath-platform.vercel.app');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBe('https://amath-platform.vercel.app');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('cannot be read from other sites', async () => {
    const res = await get('/health', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('getting back into a game', () => {
  it('lets a player reload as many times as they like without being limited', async () => {
    const a = client();
    const made = await emit<Made>(a, 'room:create', { name: 'Ann' });
    // 60 reloads from one address, far past the 20 a minute allowed for guessing codes
    for (let i = 0; i < 60; i++) {
      const s = client();
      const res = await emit<{ ok: boolean; code?: string }>(s, 'room:rejoin', { code: made.code, token: made.token });
      expect(res.ok).toBe(true);
      s.close();
    }
  });

  it('says why it failed: the room is gone, or the seat does not match', async () => {
    const a = client();
    const made = await emit<Made>(a, 'room:create', { name: 'Ann' });
    const gone = await emit<Fail>(client(), 'room:rejoin', { code: '000001', token: made.token });
    expect(gone).toMatchObject({ ok: false, code: 'no-room' });
    const wrong = await emit<Fail>(client(), 'room:rejoin', { code: made.code, token: 'f'.repeat(32) });
    expect(wrong).toMatchObject({ ok: false, code: 'no-seat' });
  });

  it('a room that has expired is not counted as a guess', async () => {
    const own = createApp();
    await new Promise<void>((r) => own.http.listen(0, r));
    const s = client(`http://localhost:${(own.http.address() as AddressInfo).port}`);
    for (let i = 0; i < 30; i++) {
      const res = await emit<Fail>(s, 'room:rejoin', { code: '000002', token: 'x' });
      expect(res.code).toBe('no-room');
    }
    s.close();
    own.io.close();
    own.http.close();
  });

  it('still slows down someone guessing seat tokens, and says so with a code', async () => {
    const own = createApp();
    await new Promise<void>((r) => own.http.listen(0, r));
    const base = `http://localhost:${(own.http.address() as AddressInfo).port}`;
    const owner = client(base);
    const made = await emit<Made>(owner, 'room:create', { name: 'Ann' });
    const guesser = client(base);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await emit<Fail>(guesser, 'room:rejoin', { code: made.code, token: String(i).padStart(32, '0') });
      codes.push(res.code);
    }
    expect(codes.slice(0, 20).every((c) => c === 'no-seat')).toBe(true);
    expect(codes.slice(20).every((c) => c === 'rate-limit')).toBe(true);
    owner.close();
    guesser.close();
    own.io.close();
    own.http.close();
  });

  it('tells a connection that has no seat yet when it tries to act', async () => {
    const res = await emit<Fail>(client(), 'game:pass');
    expect(res).toMatchObject({ ok: false, code: 'not-in-room' });
  });
});

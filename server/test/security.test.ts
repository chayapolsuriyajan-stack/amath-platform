import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomUpdate, StickerEvent, Tile } from '@amath/shared';
import { clientIp, createApp, originAllowed } from '../src/index';

let app: ReturnType<typeof createApp>;
let url: string;
const sockets: Socket[] = [];

const client = () => {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return s;
};
const emit = <T>(s: Socket, ev: string, ...args: unknown[]) =>
  new Promise<T>((resolve) => s.emit(ev, ...args, resolve));
const nextUpdate = (s: Socket, pred: (u: RoomUpdate) => boolean = () => true) =>
  new Promise<RoomUpdate>((resolve) => {
    const h = (u: RoomUpdate) => {
      if (pred(u)) {
        s.off('room:update', h);
        resolve(u);
      }
    };
    s.on('room:update', h);
  });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

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

/** create a room as A, join as B, and give A the turn with a known rack */
async function startGame() {
  const a = client();
  const b = client();
  const created = await emit<{ ok: boolean; code: string; token: string }>(a, 'room:create', { name: 'A' });
  const started = nextUpdate(b, (u) => u.status === 'playing');
  await emit(b, 'room:join', { code: created.code, name: 'B' });
  await started;
  const room = app.rooms.rooms.get(created.code)!;
  const g = room.game!;
  g.turn = 0;
  const mk = (id: number, face: string): Tile => ({ id, face, points: 1 });
  g.racks[0] = [mk(501, '1'), mk(502, '+/-'), mk(503, '2'), mk(504, '='), mk(505, '3'), mk(506, '4'), mk(507, '5'), mk(508, '6')];
  g.racks[1] = [mk(601, '7'), mk(602, '8'), mk(603, '9'), mk(604, '='), mk(605, '+'), mk(606, '0'), mk(607, '1'), mk(608, '2')];
  return { a, b, room };
}

/** 1+2=3 across the star, using A's rack above */
const opening = [501, 502, 503, 504, 505].map((tileId, i) => ({ tileId, row: 7, col: 5 + i, sym: tileId === 502 ? '+' : undefined }));

describe('anti-cheat: hidden information', () => {
  it('never sends a player the bag or the other rack', async () => {
    const { a, b } = await startGame();
    const seen: RoomUpdate[] = [];
    b.on('room:update', (u) => seen.push(u));
    await emit(a, 'game:move', { placements: opening });
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    for (const u of seen) {
      const st = u.state as unknown as Record<string, unknown>;
      expect(st.bag).toBeUndefined();
      expect(st.racks).toBeUndefined();
      // A kept 506-508; B must never learn they exist
      const json = JSON.stringify(u.state);
      for (const id of [506, 507, 508]) expect(json).not.toContain(`"id":${id}`);
    }
  });
});

describe('anti-cheat: drafts (watching the opponent build)', () => {
  it('relays the tiles to the opponent without tile ids', async () => {
    const { a, b } = await startGame();
    const got = nextUpdate(b, (u) => (u.state?.opponentDraft.length ?? 0) > 0);
    a.emit('game:draft', { placements: [{ tileId: 501, row: 7, col: 7 }, { tileId: 502, row: 7, col: 8, sym: '-' }] });
    const draft = (await got).state!.opponentDraft;
    expect(draft).toEqual([
      { row: 7, col: 7, face: '1', sym: '1', points: 1 },
      { row: 7, col: 8, face: '+/-', sym: '-', points: 1 },
    ]);
    expect(JSON.stringify(draft)).not.toContain('tileId');
  });

  it('ignores drafts with tiles the player does not own, from the wrong player, or onto bad squares', async () => {
    const { a, b, room } = await startGame();
    a.emit('game:draft', { placements: [{ tileId: 601, row: 7, col: 7 }] }); // B's tile
    b.emit('game:draft', { placements: [{ tileId: 601, row: 7, col: 7 }] }); // not B's turn
    a.emit('game:draft', { placements: [{ tileId: 501, row: 99, col: 0 }] }); // off the board
    a.emit('game:draft', { placements: [{ tileId: 502, row: 7, col: 7, sym: '×' }] }); // +/- cannot be ×
    a.emit('game:draft', { placements: [{ tileId: 501, row: 7, col: 7 }, { tileId: 501, row: 7, col: 8 }] }); // one tile twice
    a.emit('game:draft', { placements: 'lol' });
    await settle();
    expect(room.drafts).toEqual([[], []]);

    room.game!.board[3][3] = { tile: { id: 999, face: '9', points: 2 }, sym: '9' };
    a.emit('game:draft', { placements: [{ tileId: 501, row: 3, col: 3 }] }); // square already taken
    await settle();
    expect(room.drafts[0]).toEqual([]);
  });

  it('clears the draft once the move is submitted', async () => {
    const { a, room } = await startGame();
    a.emit('game:draft', { placements: [{ tileId: 501, row: 7, col: 7 }] });
    await settle();
    expect(room.drafts[0]).toHaveLength(1);
    expect((await emit<{ ok: boolean }>(a, 'game:move', { placements: opening })).ok).toBe(true);
    expect(room.drafts).toEqual([[], []]);
  });
});

describe('anti-cheat: the server decides every move', () => {
  it('rejects forged moves and leaves the score alone', async () => {
    const { a, b, room } = await startGame();
    const forged: unknown[] = [
      [{ tileId: 601, row: 7, col: 7 }], // a tile from the other rack
      [{ tileId: 12345, row: 7, col: 7 }], // a made-up tile
      Array.from({ length: 9 }, (_, i) => ({ tileId: 501, row: 7, col: i })), // more than 8 tiles
      opening.map((p) => ({ ...p, sym: '×' })), // +/- used as ×
      [502, 505, 504, 505].map((tileId, i) => ({ tileId, row: 7, col: 5 + i, sym: '+' })), // leading plus
      'give me points',
    ];
    for (const placements of forged) {
      expect((await emit<{ ok: boolean }>(a, 'game:move', { placements })).ok).toBe(false);
    }
    expect((await emit<{ ok: boolean }>(b, 'game:move', { placements: [{ tileId: 601, row: 7, col: 7 }] })).ok).toBe(false);
    expect(room.game!.log).toHaveLength(0);
    expect(room.game!.scores).toEqual([0, 0]);
  });
});

describe('stickers', () => {
  it('relays known stickers to both players and drops anything else', async () => {
    const { a, b } = await startGame();
    const atA: StickerEvent[] = [];
    const atB: StickerEvent[] = [];
    a.on('room:sticker', (e) => atA.push(e));
    b.on('room:sticker', (e) => atB.push(e));
    a.emit('chat:sticker', { sticker: 'gg' });
    a.emit('chat:sticker', { sticker: '<img src=x onerror=alert(1)>' });
    b.emit('chat:sticker', { sticker: 'thumbs' });
    await settle();
    expect(atB.map((e) => [e.player, e.sticker])).toEqual([[0, 'gg'], [1, 'thumbs']]);
    expect(atA.map((e) => e.sticker)).toEqual(['gg', 'thumbs']);
  });

  it('allows a burst of presses but caps a flood', async () => {
    const { a, b } = await startGame();
    const atB: StickerEvent[] = [];
    b.on('room:sticker', (e) => atB.push(e));
    for (let i = 0; i < 30; i++) a.emit('chat:sticker', { sticker: 'happy' });
    await settle(250);
    expect(atB).toHaveLength(8);
  });
});

describe('connection hardening', () => {
  it('only accepts browsers from the game site', () => {
    expect(originAllowed('https://amath-platform.vercel.app')).toBe(true);
    expect(originAllowed('https://amath-platform-91k4dbglt-acme-ed21.vercel.app')).toBe(true);
    expect(originAllowed('http://localhost:5173')).toBe(true);
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed('https://amath-platform.vercel.app.evil.example')).toBe(false);
  });

  it('refuses a socket opened from another site', async () => {
    const s = connect(url, {
      transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { origin: 'https://evil.example' },
    });
    sockets.push(s);
    const outcome = await new Promise<string>((resolve) => {
      s.on('connect', () => resolve('connected'));
      s.on('connect_error', () => resolve('refused'));
    });
    expect(outcome).toBe('refused');
  });

  it('reads the client address from the proxy, not from a header the client can fake', () => {
    const socket = { remoteAddress: '10.0.0.1' } as never;
    expect(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }, socket })).toBe('203.0.113.9');
    expect(clientIp({ headers: {}, socket })).toBe('10.0.0.1');
  });

  it('slows down room-code guessing', async () => {
    // a separate server so this limit cannot leak into the other tests
    const own = createApp();
    await new Promise<void>((r) => own.http.listen(0, r));
    const s = connect(`http://localhost:${(own.http.address() as AddressInfo).port}`, { transports: ['websocket'], forceNew: true });
    const limited: boolean[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await emit<{ ok: boolean; error?: string }>(s, 'room:join', { code: String(100000 + i), name: 'x' });
      limited.push(res.error === 'Too many attempts, wait a minute');
    }
    s.close();
    own.io.close();
    own.http.close();
    expect(limited.slice(0, 20).some(Boolean)).toBe(false);
    expect(limited.slice(20).every(Boolean)).toBe(true);
  });
});

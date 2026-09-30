import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomUpdate, Tile } from '@amath/shared';
import { createApp } from '../src/index';
import { MemoryStore, StoreError } from '../src/store';
import type { RoomStore } from '../src/store';

type App = ReturnType<typeof createApp>;
interface Booted { app: App; url: string }

const apps: App[] = [];
const sockets: Socket[] = [];

/** start a server on a free port; each call is a "process" that shares only the store */
async function boot(store: RoomStore | null, opts: { botDelayScale?: number } = {}): Promise<Booted> {
  const app = createApp({ store, ...opts });
  await new Promise<void>((r) => app.http.listen(0, r));
  apps.push(app);
  return { app, url: `http://localhost:${(app.http.address() as AddressInfo).port}` };
}

/** "restart": stop a server after it has saved its games */
async function shutDown(b: Booted) {
  await b.app.rooms.flush();
  sockets.splice(0).forEach((s) => s.close());
  b.app.io.close();
  b.app.http.close();
}

const client = (b: Booted) => {
  const s = connect(b.url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return s;
};
const emit = <T>(s: Socket, ev: string, ...args: unknown[]) => new Promise<T>((resolve) => s.emit(ev, ...args, resolve));
const waitFor = (s: Socket, pred: (u: RoomUpdate) => boolean, ms = 8000) =>
  new Promise<RoomUpdate>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for an update')), ms);
    const h = (u: RoomUpdate) => {
      if (pred(u)) {
        clearTimeout(t);
        s.off('room:update', h);
        resolve(u);
      }
    };
    s.on('room:update', h);
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Made = { ok: true; code: string; token: string };
type Fail = { ok: false; error: string; code?: string };

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  for (const a of apps.splice(0)) {
    a.io.close();
    a.http.close();
  }
});

const mk = (id: number, face: string): Tile => ({ id, face, points: 1 });

/** two players in a room, A holding a rack that can play 1+2=3 across the star */
async function twoPlayers(b: Booted) {
  const a = client(b);
  const made = await emit<Made>(a, 'room:create', { name: 'Ann' });
  const bs = client(b);
  const started = waitFor(bs, (u) => u.status === 'playing');
  const joined = await emit<Made>(bs, 'room:join', { code: made.code, name: 'Bob' });
  await started;
  const g = b.app.rooms.rooms.get(made.code)!.game!;
  g.turn = 0;
  g.turnStartedAt = Date.now();
  g.racks[0] = [mk(501, '1'), mk(502, '+/-'), mk(503, '2'), mk(504, '='), mk(505, '3'), mk(506, '4'), mk(507, '5'), mk(508, '6')];
  return { a, bs, code: made.code, aToken: made.token, bToken: joined.token };
}

const opening = [501, 502, 503, 504, 505].map((tileId, i) => ({ tileId, row: 7, col: 5 + i, sym: tileId === 502 ? '+' : undefined }));

describe('a game survives the server restarting', () => {
  it('both players come back to the same board, racks, score, chat and seats', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { a, code, aToken, bToken } = await twoPlayers(one);
    expect((await emit<{ ok: boolean }>(a, 'game:move', { placements: opening })).ok).toBe(true);
    await emit(a, 'chat:send', { text: 'good luck' });
    const before = one.app.rooms.update(one.app.rooms.rooms.get(code)!, 0).state!;
    await shutDown(one);

    const two = await boot(store); // a fresh process: nothing in memory
    expect(two.app.rooms.rooms.size).toBe(0);
    const ann = client(two);
    const annBack = waitFor(ann, (u) => u.state !== null);
    expect((await emit<{ ok: boolean }>(ann, 'room:rejoin', { code, token: aToken })).ok).toBe(true);
    const st = (await annBack).state!;

    expect(st.names).toEqual(['Ann', 'Bob']);
    expect(st.you).toBe(0);
    expect(st.scores).toEqual(before.scores);
    expect(st.log).toEqual(before.log);
    expect(st.turn).toBe(1);
    expect(st.board[7].slice(5, 10).map((c) => c?.sym)).toEqual(['1', '+', '2', '=', '3']);
    expect(st.myRack.map((t) => t.id)).toEqual(before.myRack.map((t) => t.id));
    expect(st.chat.map((m) => m.text)).toEqual(['good luck']);
    expect(st.bagCount).toBe(before.bagCount);

    const bob = client(two);
    expect((await emit<{ ok: boolean }>(bob, 'room:rejoin', { code, token: bToken })).ok).toBe(true);
    expect(two.app.rooms.rooms.size).toBe(1);

    // and play carries on: it is Bob's turn, and he crosses Ann's = with 4+2=6 going down
    const game = two.app.rooms.rooms.get(code)!.game!;
    game.racks[1] = [mk(601, '4'), mk(602, '+'), mk(603, '2'), mk(604, '6'), mk(605, '9')];
    const reply = await emit<{ ok: boolean; error?: string }>(bob, 'game:move', {
      placements: [
        { tileId: 601, row: 4, col: 8 },
        { tileId: 602, row: 5, col: 8, sym: '+' },
        { tileId: 603, row: 6, col: 8 },
        { tileId: 604, row: 8, col: 8 },
      ],
    });
    expect(reply).toEqual({ ok: true });
    expect(game.log).toHaveLength(2);
    expect(game.log[1]).toMatchObject({ player: 1, type: 'move', equations: ['4+2=6'] });
    expect(game.scores[1]).toBeGreaterThan(0);
  });

  it('never keeps a seat token in the store, only its hash', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { code, aToken, bToken } = await twoPlayers(one);
    await shutDown(one);
    const stored = store.data.get(code)!.json;
    expect(stored).not.toContain(aToken);
    expect(stored).not.toContain(bToken);
    expect(stored).toMatch(/"tokenHash":"[0-9a-f]{64}"/);
  });

  it('still tells a wrong token from a missing room after a restart', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { code } = await twoPlayers(one);
    await shutDown(one);
    const two = await boot(store);
    const wrong = await emit<Fail>(client(two), 'room:rejoin', { code, token: 'f'.repeat(32) });
    expect(wrong).toMatchObject({ ok: false, code: 'no-seat' });
    const missing = await emit<Fail>(client(two), 'room:rejoin', { code: '000009', token: 'f'.repeat(32) });
    expect(missing).toMatchObject({ ok: false, code: 'no-room' });
  });

  it('lets the second player join a room that was still waiting when the server restarted', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const a = client(one);
    const made = await emit<Made>(a, 'room:create', { name: 'Ann' });
    await shutDown(one);

    const two = await boot(store);
    const bob = client(two);
    const joined = await emit<Made>(bob, 'room:join', { code: made.code, name: 'Bob' });
    expect(joined.ok).toBe(true);
    const ann = client(two);
    const annBack = waitFor(ann, (u) => u.status === 'playing');
    expect((await emit<{ ok: boolean }>(ann, 'room:rejoin', { code: made.code, token: made.token })).ok).toBe(true);
    expect((await annBack).state!.names).toEqual(['Ann', 'Bob']);
  });

  it('carries on against the computer: it takes its turn after the restart', async () => {
    const store = new MemoryStore();
    // in the first process the bot pauses far too long to move, so the game is saved on its turn
    const one = await boot(store, { botDelayScale: 500 });
    const a = client(one);
    const made = await emit<Made>(a, 'room:create', { name: 'Ann', bot: 'easy' });
    const room = one.app.rooms.rooms.get(made.code)!;
    room.game!.turn = 1;
    room.game!.turnStartedAt = Date.now();
    one.app.rooms.markDirty(room);
    await shutDown(one);

    const two = await boot(store, { botDelayScale: 0.02 });
    const ann = client(two);
    const moved = waitFor(ann, (u) => (u.state?.log.length ?? 0) >= 1, 10_000);
    expect((await emit<{ ok: boolean }>(ann, 'room:rejoin', { code: made.code, token: made.token })).ok).toBe(true);
    const st = (await moved).state!;
    expect(st.log[0].player).toBe(1);
    expect(st.opponentBot).toBe('easy');
  });

  it('does not count the time the server was down against the player whose turn it was', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { code, aToken } = await twoPlayers(one);
    await shutDown(one);
    await sleep(1500); // the server is "down" for a while

    const two = await boot(store);
    const ann = client(two);
    const back = waitFor(ann, (u) => u.state !== null);
    await emit(ann, 'room:rejoin', { code, token: aToken });
    const st = (await back).state!;
    const spentOnTurn = st.serverNow - st.turnStartedAt;
    expect(spentOnTurn).toBeLessThan(500); // not the 1.5 s it was down
    expect(st.bank[0]).toBe(1200 * 1000);
  });
});

describe('saving', () => {
  /** counts what is asked of it */
  class CountingStore extends MemoryStore {
    saves = 0;
    loads = 0;
    override async save(code: string, json: string, ttl: number) {
      this.saves++;
      return super.save(code, json, ttl);
    }
    override async load(code: string) {
      this.loads++;
      return super.load(code);
    }
  }

  it('saves a move within a moment on its own, without waiting for a shutdown', async () => {
    const store = new CountingStore();
    const one = await boot(store);
    const { a, code } = await twoPlayers(one);
    await sleep(500);
    const savesBefore = store.saves;
    await emit(a, 'game:move', { placements: opening });
    await sleep(600);
    expect(store.saves).toBeGreaterThan(savesBefore);
    const saved = JSON.parse(store.data.get(code)!.json) as { game: { log: unknown[] } };
    expect(saved.game.log).toHaveLength(1);
  });

  it('turns a burst of changes into one write', async () => {
    const store = new CountingStore();
    const one = await boot(store);
    const a = client(one);
    const made = await emit<Made>(a, 'room:create', { name: 'Ann' });
    await sleep(500);
    const before = store.saves;
    const room = one.app.rooms.rooms.get(made.code)!;
    for (let i = 0; i < 50; i++) one.app.rooms.markDirty(room);
    await sleep(600);
    expect(store.saves - before).toBe(1);
  });

  it('does not save what nobody needs saved: a refused move, a draft, a sticker', async () => {
    const store = new CountingStore();
    const one = await boot(store);
    const { a, code } = await twoPlayers(one);
    await sleep(500);
    const before = store.saves;
    await emit(a, 'game:move', { placements: [{ tileId: 501, row: 0, col: 0 }] }); // not on the star
    a.emit('game:draft', { placements: [{ tileId: 501, row: 7, col: 7 }] });
    a.emit('chat:sticker', { sticker: 'gg' });
    await sleep(600);
    expect(store.saves).toBe(before);
    expect(store.data.has(code)).toBe(true);
  });

  it('asks the database once when two players return at the same moment', async () => {
    // a lookup that takes a while, as a real network call does, so the two requests overlap
    class SlowStore extends CountingStore {
      override async load(code: string) {
        await sleep(150);
        return super.load(code);
      }
    }
    const store = new SlowStore();
    const one = await boot(store);
    const { code, aToken, bToken } = await twoPlayers(one);
    await shutDown(one);
    store.loads = 0;
    const two = await boot(store);
    const [ra, rb] = await Promise.all([
      emit<{ ok: boolean }>(client(two), 'room:rejoin', { code, token: aToken }),
      emit<{ ok: boolean }>(client(two), 'room:rejoin', { code, token: bToken }),
    ]);
    expect([ra.ok, rb.ok]).toEqual([true, true]);
    expect(store.loads).toBe(1);
    expect(two.app.rooms.rooms.size).toBe(1);
  });

  it('flushes everything on shutdown, even changes made a moment before', async () => {
    const store = new CountingStore();
    const one = await boot(store);
    const { a, code } = await twoPlayers(one);
    await emit(a, 'game:move', { placements: opening });
    // no waiting: the save timer has not fired yet
    await shutDown(one);
    const saved = JSON.parse(store.data.get(code)!.json) as { game: { log: unknown[] } };
    expect(saved.game.log).toHaveLength(1);
  });
});

describe('when the database has trouble', () => {
  /** works until told not to */
  class Flaky extends MemoryStore {
    failLoad = false;
    failSave = false;
    override async load(code: string) {
      if (this.failLoad) throw new StoreError('the database could not be reached');
      return super.load(code);
    }
    override async save(code: string, json: string, ttl: number) {
      if (this.failSave) throw new StoreError('the database could not be reached');
      return super.save(code, json, ttl);
    }
  }

  it('says "unavailable", not "no such game", when it cannot look the room up, and recovers', async () => {
    const store = new Flaky();
    const one = await boot(store);
    const { code, aToken } = await twoPlayers(one);
    await shutDown(one);

    const two = await boot(store);
    store.failLoad = true;
    const down = await emit<Fail>(client(two), 'room:rejoin', { code, token: aToken });
    expect(down).toMatchObject({ ok: false, code: 'unavailable' });
    const downJoin = await emit<Fail>(client(two), 'room:join', { code, name: 'Cy' });
    expect(downJoin).toMatchObject({ ok: false, code: 'unavailable' });

    store.failLoad = false;
    expect((await emit<{ ok: boolean }>(client(two), 'room:rejoin', { code, token: aToken })).ok).toBe(true);
  });

  it('keeps the game going in memory when saving fails, and reports it on /health', async () => {
    const store = new Flaky();
    const one = await boot(store);
    const { a, bs } = await twoPlayers(one);
    store.failSave = true;
    expect((await emit<{ ok: boolean }>(a, 'game:move', { placements: opening })).ok).toBe(true);
    expect((await emit<{ ok: boolean }>(bs, 'chat:send', { text: 'still here' })).ok).toBe(true);
    await sleep(600);
    const health = (await (await fetch(`${one.url}/health`)).json()) as { persistent: boolean; store: { kind: string; ok: boolean } };
    expect(health.persistent).toBe(true);
    expect(health.store).toEqual({ kind: 'memory', ok: false });
    // and it heals itself
    store.failSave = false;
    await emit(bs, 'chat:send', { text: 'back' });
    await sleep(700);
    const after = (await (await fetch(`${one.url}/health`)).json()) as { store: { ok: boolean } };
    expect(after.store.ok).toBe(true);
  });

  it('says whether games are being saved, and never says why the database failed', async () => {
    const plain = await boot(null);
    const h1 = (await (await fetch(`${plain.url}/health`)).json()) as Record<string, unknown>;
    expect(h1).toMatchObject({ ok: true, persistent: false, store: null });

    const store = new Flaky();
    store.failSave = true;
    const saved = await boot(store);
    const a = client(saved);
    await emit<Made>(a, 'room:create', { name: 'Ann' });
    await sleep(600);
    const text = await (await fetch(`${saved.url}/health`)).text();
    expect(text).not.toContain('could not be reached');
    expect(JSON.parse(text).store).toEqual({ kind: 'memory', ok: false });
  });
});

describe('clearing out old rooms', () => {
  const MIN = 60_000;

  it('never takes a room away from players who are still connected', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { code } = await twoPlayers(one);
    one.app.rooms.sweep(Date.now() + 120 * MIN);
    expect(one.app.rooms.rooms.has(code)).toBe(true);
  });

  it('lets an abandoned room out of memory but keeps it saved, and it comes back when someone returns', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { a, bs, code, aToken } = await twoPlayers(one);
    await emit(a, 'game:move', { placements: opening });
    a.close();
    bs.close();
    await sleep(300); // both disconnected
    one.app.rooms.sweep(Date.now() + 31 * MIN);
    expect(one.app.rooms.rooms.has(code)).toBe(false);
    expect(store.data.has(code)).toBe(true);

    const back = client(one);
    const ok = await emit<{ ok: boolean }>(back, 'room:rejoin', { code, token: aToken });
    expect(ok.ok).toBe(true);
    expect(one.app.rooms.rooms.get(code)!.game!.log).toHaveLength(1);
  });

  it('removes a finished game from the store for good, and does not write it back', async () => {
    const store = new MemoryStore();
    const one = await boot(store);
    const { a, code } = await twoPlayers(one);
    await emit(a, 'game:resign');
    await one.app.rooms.flush();
    expect(store.data.has(code)).toBe(true); // kept briefly so the result survives a restart

    const room = one.app.rooms.rooms.get(code)!;
    one.app.rooms.sweep(Date.now() + 11 * MIN);
    expect(one.app.rooms.rooms.has(code)).toBe(false);
    one.app.rooms.markDirty(room); // a late change must not bring it back
    await one.app.rooms.flush();
    expect(store.data.has(code)).toBe(false);
  });
});

describe('guessing room codes', () => {
  it('counts a lookup that finds nothing as a guess when there is a database to ask, so it cannot be used to run up its bill', async () => {
    const one = await boot(new MemoryStore());
    const s = client(one);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 25; i++) codes.push((await emit<Fail>(s, 'room:rejoin', { code: String(200000 + i), token: 'x' })).code);
    expect(codes.slice(0, 20).every((c) => c === 'no-room')).toBe(true);
    expect(codes.slice(20).every((c) => c === 'rate-limit')).toBe(true);
  });

  it('does not count them without a database, since they cost nothing', async () => {
    const one = await boot(null);
    const s = client(one);
    for (let i = 0; i < 30; i++) {
      const res = await emit<Fail>(s, 'room:rejoin', { code: String(300000 + i), token: 'x' });
      expect(res.code).toBe('no-room');
    }
  });

  it('a new room never takes the code of one that is saved but not in memory', async () => {
    const store = new MemoryStore();
    await store.save('555555', '{}', 600);
    const one = await boot(store);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const res = await emit<Made>(client(one), 'room:create', { name: 'x' });
      seen.add(res.code);
    }
    expect(seen.has('555555')).toBe(false);
    expect(seen.size).toBe(40);
  });
});

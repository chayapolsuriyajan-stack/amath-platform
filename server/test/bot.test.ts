import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomUpdate, StickerEvent } from '@amath/shared';
import { createApp } from '../src/index';

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
const waitFor = (s: Socket, pred: (u: RoomUpdate) => boolean, ms = 15_000) =>
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

beforeAll(async () => {
  // pauses shrunk to 2%, so a bot turn takes a fraction of a second
  app = createApp({ botDelayScale: 0.02 });
  await new Promise<void>((r) => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
});
afterAll(() => {
  sockets.forEach((s) => s.close());
  app.io.close();
  app.http.close();
});

describe('playing against the computer', () => {
  it('starts straight away, with a real start draw and a bot seat', async () => {
    const a = client();
    const first = waitFor(a, (u) => u.status === 'playing');
    const res = await emit<{ ok: boolean; code: string }>(a, 'room:create', { name: 'Ann', bot: 'easy' });
    expect(res.ok).toBe(true);
    const st = (await first).state!;
    expect(st.names).toEqual(['Ann', 'Bot · Easy']);
    expect(st.opponentBot).toBe('easy');
    expect(st.connected).toEqual([true, true]);
    expect(st.startDraw?.faces).toHaveLength(2);
  });

  it('rejects an unknown level', async () => {
    const res = await emit<{ ok: boolean }>(client(), 'room:create', { name: 'x', bot: 'godlike' });
    expect(res.ok).toBe(false);
  });

  it('plays its turn, showing its tiles to the player first', async () => {
    const a = client();
    const res = await emit<{ ok: boolean; code: string }>(a, 'room:create', { name: 'Ann', bot: 'hard' });
    const room = app.rooms.rooms.get(res.code)!;
    const g = room.game!;
    // make sure the bot is the one to move, then nudge it
    const drafts: number[] = [];
    a.on('room:update', (u) => { if (u.state?.opponentDraft.length) drafts.push(u.state.opponentDraft.length); });
    if (g.turn !== 1) {
      g.turn = 1;
      g.turnStartedAt = Date.now();
    }
    const moved = waitFor(a, (u) => (u.state?.log.length ?? 0) >= 1);
    // any broadcast gives the bot its turn; a chat message is the simplest trigger
    await emit(a, 'chat:send', { text: 'your go' });
    const st = (await moved).state!;
    expect(st.log[0].player).toBe(1);
    expect(['move', 'exchange', 'pass']).toContain(st.log[0].type);
    if (st.log[0].type === 'move') {
      expect(drafts.length).toBeGreaterThan(0);
      expect(st.turn).toBe(0);
      expect(st.opponentDraft).toEqual([]);
    }
  });

  it('keeps answering move after move', async () => {
    const a = client();
    const res = await emit<{ ok: boolean; code: string }>(a, 'room:create', { name: 'Ann', bot: 'medium' });
    const room = app.rooms.rooms.get(res.code)!;
    const g = room.game!;
    // let the human keep exchanging or passing; the bot must always reply
    for (let round = 0; round < 3; round++) {
      if (g.turn === 1) await waitFor(a, (u) => u.state?.turn === 0);
      const n = g.log.length;
      const r = g.bag.length >= 5
        ? await emit<{ ok: boolean }>(a, 'game:exchange', { tileIds: [g.racks[0][0].id] })
        : await emit<{ ok: boolean }>(a, 'game:pass');
      expect(r.ok).toBe(true);
      await waitFor(a, (u) => (u.state?.log.length ?? 0) >= n + 2);
    }
    expect(g.log.filter((l) => l.player === 1).length).toBeGreaterThanOrEqual(3);
  });

  it('cannot be taken over, says gg at the end, and always accepts a rematch', async () => {
    const a = client();
    const res = await emit<{ ok: boolean; code: string }>(a, 'room:create', { name: 'Ann', bot: 'easy' });
    // the bot seat has no token, so an empty one must not claim it
    const hijack = await emit<{ ok: boolean }>(client(), 'room:rejoin', { code: res.code, token: '' });
    expect(hijack.ok).toBe(false);
    expect((await emit<{ ok: boolean }>(client(), 'room:join', { code: res.code, name: 'Eve' })).ok).toBe(false);

    const gg = new Promise<StickerEvent>((resolve) => a.on('room:sticker', resolve));
    const over = waitFor(a, (u) => u.status === 'finished');
    await emit(a, 'game:resign');
    await over;
    expect((await gg).sticker).toBe('gg');

    const again = waitFor(a, (u) => u.status === 'playing');
    a.emit('game:rematch');
    const st = (await again).state!;
    expect(st.log).toHaveLength(0);
    expect(st.names[1]).toBe('Bot · Easy');
  });
});

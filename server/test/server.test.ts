import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomUpdate, Tile } from '@amath/shared';
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

describe('room lifecycle', () => {
  it('creates a 6-digit room, seats a second player, validates moves, and supports rejoin', async () => {
    const a = client();
    const b = client();
    const created = await emit<{ ok: boolean; code: string; token: string }>(a, 'room:create', { name: 'Ann' });
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^\d{6}$/);

    const badJoin = await emit<{ ok: boolean }>(b, 'room:join', { code: '000000', name: 'Bob' });
    expect(badJoin.ok).toBe(false);

    const started = nextUpdate(a, (u) => u.status === 'playing');
    const joined = await emit<{ ok: boolean; token: string }>(b, 'room:join', { code: created.code, name: 'Bob' });
    expect(joined.ok).toBe(true);
    const first = await started;
    expect(first.state?.names).toEqual(['Ann', 'Bob']);
    expect(first.state?.myRack).toHaveLength(8);
    expect(first.state?.opponentRackCount).toBe(8);

    // a third player cannot join
    const c = client();
    expect((await emit<{ ok: boolean }>(c, 'room:join', { code: created.code, name: 'Cy' })).ok).toBe(false);

    const room = app.rooms.rooms.get(created.code)!;
    const game = room.game!;
    game.turn = 0;
    const mk = (id: number, face: string): Tile => ({ id, face, points: 1 });
    game.racks[0] = [mk(9001, '1'), mk(9002, '+'), mk(9003, '2'), mk(9004, '='), mk(9005, '3'), mk(9006, '4'), mk(9007, '5'), mk(9008, '6')];

    // wrong player
    const notTurn = await emit<{ ok: boolean; error?: string }>(b, 'game:move', { placements: [] });
    expect(notTurn.ok).toBe(false);

    // invalid equation from the right player
    const bad = await emit<{ ok: boolean; error?: string }>(a, 'game:move', {
      placements: [9001, 9002, 9003, 9004, 9006].map((tileId, i) => ({ tileId, row: 7, col: 5 + i })),
    });
    expect(bad.ok).toBe(false);
    expect(game.log).toHaveLength(0);

    // valid: 1+2=3
    const upd = nextUpdate(b, (u) => (u.state?.log.length ?? 0) === 1);
    const good = await emit<{ ok: boolean }>(a, 'game:move', {
      placements: [9001, 9002, 9003, 9004, 9005].map((tileId, i) => ({ tileId, row: 7, col: 5 + i })),
    });
    expect(good.ok).toBe(true);
    const seenByB = (await upd).state!;
    expect(seenByB.log[0].equations).toEqual(['1+2=3']);
    expect(seenByB.turn).toBe(1);
    expect(seenByB.board[7][7]?.sym).toBe('2'); // ★ square
    expect(JSON.stringify(seenByB)).not.toContain('9006'); // opponent rack is hidden

    // rejoin with a new socket restores the seat
    const a2 = client();
    const back = nextUpdate(a2);
    expect((await emit<{ ok: boolean }>(a2, 'room:rejoin', { code: created.code, token: created.token })).ok).toBe(true);
    const restored = await back;
    expect(restored.state?.you).toBe(0);
    expect((await emit<{ ok: boolean }>(client(), 'room:rejoin', { code: created.code, token: 'nope' })).ok).toBe(false);
  });
});

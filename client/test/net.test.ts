import { describe, expect, it } from 'vitest';
import {
  WARMUP_EXPECTED_MS, WARMUP_SLOW_MS, formatElapsed, warmupProgress, warmupText,
} from '../src/net/warmup';
import {
  SEAT_TTL_MS, ago, forgetSeat, lastGame, saveSeat, savedSeats, type Store,
} from '../src/net/session';
import { parseHealth } from '../src/net/serverStatus';

/** a stand-in for localStorage */
class FakeStore implements Store {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

/** a store that refuses everything, like storage blocked by the browser */
const blocked: Store = {
  length: 0,
  key() { throw new Error('blocked'); },
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
  removeItem() { throw new Error('blocked'); },
};

const T0 = 1_000_000_000;
const MIN = 60_000;

describe('wake-up progress', () => {
  it('starts empty, only ever moves forward, and is never full before the server answers', () => {
    expect(warmupProgress(0)).toBe(0);
    let prev = 0;
    for (let t = 1000; t <= 10 * MIN; t += 1000) {
      const p = warmupProgress(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThan(0.951);
      prev = p;
    }
    expect(warmupProgress(-500)).toBe(0);
  });

  it('is well on the way by the time a cold start usually finishes', () => {
    expect(warmupProgress(WARMUP_EXPECTED_MS)).toBeGreaterThan(0.8);
    expect(warmupProgress(WARMUP_EXPECTED_MS / 2)).toBeGreaterThan(0.5);
    expect(warmupProgress(5000)).toBeLessThan(0.2);
  });

  it('formats the time waited as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(23_400)).toBe('0:23');
    expect(formatElapsed(65_000)).toBe('1:05');
  });

  it('says how long is left, then admits when it is taking longer', () => {
    const early = warmupText(2000);
    expect(early.headline).toBe('Waking up the game server');
    expect(early.detail).toMatch(/About \d+ seconds to go/);
    const later = warmupText(40_000);
    const secs = (t: string) => Number(/About (\d+) seconds/.exec(t)![1]);
    expect(secs(later.detail)).toBeLessThan(secs(early.detail));
    expect(secs(warmupText(59_000).detail)).toBeGreaterThanOrEqual(5);
    expect(warmupText(WARMUP_EXPECTED_MS + 1000).headline).toBe('Almost there');
    expect(warmupText(WARMUP_SLOW_MS + 1000).headline).toBe('Still waiting for the server');
  });
});

describe('reading /health', () => {
  it('knows whether the server saves games', () => {
    expect(parseHealth({ ok: true, rooms: 0, persistent: true })).toEqual({ persistent: true });
    expect(parseHealth({ ok: true, rooms: 0, persistent: false })).toEqual({ persistent: false });
    expect(parseHealth({ ok: true })).toEqual({ persistent: false }); // an older server that does not say
  });
  it('does not take anything else for the game server', () => {
    expect(parseHealth(null)).toBeNull();
    expect(parseHealth('<html>waking up</html>')).toBeNull();
    expect(parseHealth({ ok: false })).toBeNull();
    expect(parseHealth({})).toBeNull();
  });
});

describe('wake-up wording when the server is lost mid-game', () => {
  it('does not claim the server was asleep, and admits when it is taking too long', () => {
    const early = warmupText(3000, 'reconnect');
    expect(early.headline).toBe('Trying to reach the game server');
    expect(early.detail).not.toMatch(/sleeps|nobody has played/);
    expect(warmupText(WARMUP_EXPECTED_MS + 1000, 'reconnect').headline).toBe('Still trying');
    expect(warmupText(WARMUP_SLOW_MS + 1000, 'reconnect').headline).toBe('Still can’t reach the server');
  });
});

describe('remembering seats', () => {
  it('saves a seat and finds it again', () => {
    const s = new FakeStore();
    saveSeat('111111', 'tok-a', 'Ann', s, T0);
    expect(savedSeats('111111', s, T0 + MIN)).toEqual([{ token: 'tok-a', name: 'Ann', at: T0 }]);
    expect(savedSeats('222222', s, T0)).toEqual([]);
  });

  it('keeps one seat per player, newest first, and refreshes rather than duplicates', () => {
    const s = new FakeStore();
    saveSeat('111111', 'tok-a', 'Ann', s, T0);
    saveSeat('111111', 'tok-b', 'Bob', s, T0 + MIN);
    saveSeat('111111', 'tok-a', 'Ann', s, T0 + 2 * MIN); // refreshed, not added again
    const seats = savedSeats('111111', s, T0 + 3 * MIN);
    expect(seats.map((x) => x.name)).toEqual(['Ann', 'Bob']);
    expect(seats).toHaveLength(2);
    saveSeat('111111', 'tok-c', 'Cy', s, T0 + 4 * MIN); // a room only has two seats
    expect(savedSeats('111111', s, T0 + 5 * MIN)).toHaveLength(2);
  });

  it('lets old seats expire', () => {
    const s = new FakeStore();
    saveSeat('111111', 'tok-a', 'Ann', s, T0);
    expect(savedSeats('111111', s, T0 + SEAT_TTL_MS - 1)).toHaveLength(1);
    expect(savedSeats('111111', s, T0 + SEAT_TTL_MS + 1)).toEqual([]);
  });

  it('forgets one seat, or the whole room', () => {
    const s = new FakeStore();
    saveSeat('111111', 'tok-a', 'Ann', s, T0);
    saveSeat('111111', 'tok-b', 'Bob', s, T0);
    forgetSeat('111111', 'tok-a', s, T0);
    expect(savedSeats('111111', s, T0).map((x) => x.name)).toEqual(['Bob']);
    forgetSeat('111111', undefined, s, T0);
    expect(savedSeats('111111', s, T0)).toEqual([]);
    expect(s.length).toBe(0);
  });

  it('offers the most recent game across rooms', () => {
    const s = new FakeStore();
    saveSeat('111111', 'tok-a', 'Ann', s, T0);
    saveSeat('222222', 'tok-b', 'Bob', s, T0 + 5 * MIN);
    expect(lastGame(s, T0 + 6 * MIN)).toEqual({ code: '222222', name: 'Bob', at: T0 + 5 * MIN });
    forgetSeat('222222', undefined, s, T0);
    expect(lastGame(s, T0 + 6 * MIN)?.code).toBe('111111');
    expect(lastGame(s, T0 + SEAT_TTL_MS + MIN)).toBeNull();
  });

  it('keeps only the most recent few rooms', () => {
    const s = new FakeStore();
    for (let i = 0; i < 12; i++) saveSeat(String(100000 + i), `tok-${i}`, 'Ann', s, T0 + i * MIN);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(lastGame(s, T0 + 20 * MIN)?.code).toBe('100011');
  });

  it('ignores damaged data and never throws when storage is blocked', () => {
    const s = new FakeStore();
    s.setItem('amath.seats.111111', '{not json');
    s.setItem('amath.seats.222222', JSON.stringify([{ token: 5 }, null, { token: '', name: 'x', at: T0 }]));
    expect(savedSeats('111111', s, T0)).toEqual([]);
    expect(savedSeats('222222', s, T0)).toEqual([]);
    expect(lastGame(s, T0)).toBeNull();

    expect(() => saveSeat('111111', 'tok', 'Ann', blocked, T0)).not.toThrow();
    expect(savedSeats('111111', blocked, T0)).toEqual([]);
    expect(lastGame(blocked, T0)).toBeNull();
    expect(() => forgetSeat('111111', undefined, blocked, T0)).not.toThrow();
    expect(savedSeats('111111', null, T0)).toEqual([]);
  });

  it('says how long ago', () => {
    expect(ago(20_000)).toBe('just now');
    expect(ago(12 * MIN)).toBe('12 min ago');
    expect(ago(135 * MIN)).toBe('2 h 15 min ago');
  });
});

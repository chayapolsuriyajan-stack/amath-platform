import { describe, expect, it } from 'vitest';
import {
  OVERTIME_SECONDS, checkTimeout, exchange, formatClockSeconds, matchLeftMs, newGame, parseClock, playMove, resign,
} from '../src';
import type { Tile } from '../src';

const T0 = 1_000_000;
const MIN = 60_000;
let nextId = 5000;
const tiles = (faces: string[]): Tile[] => faces.map((face) => ({ id: nextId++, face, points: 1 }));

/** a game where player 0 moves first; the default match clock is 20:00 each */
const start = (opts: { matchSeconds?: number } = {}) =>
  newGame(() => 0.5, { first: 0, now: T0, ...opts });

/** give player 0 a rack that can play 1+2=3 across the star */
function playOpening(g: ReturnType<typeof start>, now: number) {
  g.racks[0] = tiles(['1', '+', '2', '=', '3']);
  const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
  return playMove(g, 0, pl, now);
}

describe('writing and reading clock times', () => {
  it('parses minutes:seconds, plain minutes, and rejects nonsense', () => {
    expect(parseClock('20:00')).toBe(1200);
    expect(parseClock('5:30')).toBe(330);
    expect(parseClock(' 45 ')).toBe(2700);
    expect(parseClock('0:45')).toBe(45);
    expect(parseClock('5:60')).toBeNull();
    expect(parseClock('0:00')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('181:00')).toBeNull(); // over three hours
  });
  it('formats seconds, including negative overtime', () => {
    expect(formatClockSeconds(1200)).toBe('20:00');
    expect(formatClockSeconds(65)).toBe('1:05');
    expect(formatClockSeconds(-47)).toBe('-0:47');
  });
});

describe('match clock', () => {
  it('gives each player 20:00 by default and only runs on their own turn', () => {
    const g = start();
    expect(g.matchSeconds).toBe(1200);
    expect(matchLeftMs(g, 0, T0 + 3 * MIN)).toBe(17 * MIN);
    expect(matchLeftMs(g, 1, T0 + 3 * MIN)).toBe(20 * MIN); // not their turn
  });

  it('keeps what a player used when the turn passes, and starts the other clock', () => {
    const g = start();
    expect(playOpening(g, T0 + 2 * MIN).ok).toBe(true);
    expect(matchLeftMs(g, 0, T0 + 10 * MIN)).toBe(18 * MIN); // frozen at 18:00
    expect(matchLeftMs(g, 1, T0 + 5 * MIN)).toBe(17 * MIN); // B has used 3 minutes
  });

  it('runs negative, and loses the game 5 minutes past zero', () => {
    const g = start({ matchSeconds: 60 });
    const edge = T0 + (60 + OVERTIME_SECONDS) * 1000;
    expect(matchLeftMs(g, 0, T0 + 90_000)).toBe(-30_000);
    expect(checkTimeout(g, edge - 1)).toBe(false);
    expect(checkTimeout(g, edge + 1)).toBe(true);
    expect(g.endReason).toBe('timeout');
    expect(g.winner).toBe(1);
  });

  it('can still play while in match overtime', () => {
    const g = start({ matchSeconds: 60 });
    expect(playOpening(g, T0 + 4 * MIN).ok).toBe(true); // 3 minutes over, inside the grace
    expect(g.finished).toBe(false);
    expect(matchLeftMs(g, 0, T0 + 99 * MIN)).toBe(-3 * MIN);
  });

  it('adds up over several turns', () => {
    const g = start({ matchSeconds: 600 });
    expect(playOpening(g, T0 + 2 * MIN).ok).toBe(true); // A: 2 min
    g.racks[1] = tiles(['1', '2', '3']);
    expect(exchange(g, 1, [g.racks[1][0].id], T0 + 5 * MIN).ok).toBe(true); // B: 3 min
    g.racks[0] = tiles(['4', '5', '6']);
    expect(exchange(g, 0, [g.racks[0][0].id], T0 + 6 * MIN).ok).toBe(true); // A: 1 min
    expect(matchLeftMs(g, 0, T0 + 20 * MIN)).toBe(7 * MIN);
    expect(matchLeftMs(g, 1, T0 + 6 * MIN)).toBe(7 * MIN);
  });

  it('can be switched off', () => {
    const g = start({ matchSeconds: 0 });
    expect(matchLeftMs(g, 0, T0 + 10 ** 9)).toBe(Infinity);
    expect(checkTimeout(g, T0 + 10 ** 9)).toBe(false);
  });

  it('stops when the game ends', () => {
    const g = start();
    expect(resign(g, 0, T0 + 4 * MIN).ok).toBe(true);
    expect(matchLeftMs(g, 0, T0 + 50 * MIN)).toBe(16 * MIN);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { MoveBreakdown, ScoredTile } from '@amath/shared';
import { buildSteps, paceFor, punchFor } from '../src/components/comboTiming';
import { getFxSpeed, setFxSpeed } from '../src/storage/prefs';

const tile = (sym: string, value = 1): ScoredTile => ({ sym, face: sym, base: value, premium: '', value, isNew: true });
const tiles = (n: number) => Array.from({ length: n }, (_, i) => tile(String(i % 10)));

/** a move with one equation of n tiles */
const move = (n: number, opts: { eqMult?: number; bingo?: boolean; equations?: number } = {}): MoveBreakdown => ({
  n: 1,
  player: 0,
  bingo: opts.bingo ?? false,
  total: 20,
  equations: Array.from({ length: opts.equations ?? 1 }, () => ({
    text: 'x',
    tiles: tiles(n),
    eqMult: opts.eqMult ?? 1,
    subtotal: 10,
  })),
});

const end = (m: MoveBreakdown, pace: number) => buildSteps(m, pace).at(-1)!.at;

describe('the speeds', () => {
  it('makes 4x the pace the animation always had, and 1x four times slower', () => {
    expect(paceFor(4)).toBe(1);
    expect(paceFor(2)).toBe(2);
    expect(paceFor(1)).toBe(4);
  });

  it('keeps the original timing exactly at 4x', () => {
    // 5 tiles: equation 420, tiles 5 x 130, a pause of 120, subtotal 520, then the total's 1500
    expect(end(move(5), paceFor(4))).toBe(420 + 5 * 130 + 120 + 520 + 1500);
    expect(end(move(5), paceFor(4))).toBe(3210);
  });

  it('makes 1x four times as long, and 2x twice as long', () => {
    expect(end(move(5), paceFor(1))).toBe(3210 * 4);
    expect(end(move(5), paceFor(2))).toBe(3210 * 2);
  });

  it('stretches the hits less than the pauses, so slams still land', () => {
    expect(punchFor(4)).toBe(1);
    expect(punchFor(1)).toBe(2); // pauses x4, hits x2
    expect(punchFor(2)).toBeCloseTo(Math.SQRT2);
    for (const s of [1, 2, 4]) {
      expect(punchFor(s)).toBeLessThanOrEqual(paceFor(s));
      expect(punchFor(s)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the sequence itself', () => {
  it('has the same beats in the same order at every speed', () => {
    const m = move(6, { eqMult: 3, bingo: true, equations: 2 });
    const kinds = (pace: number) => buildSteps(m, pace).map((s) => JSON.stringify(s.step));
    expect(kinds(1)).toEqual(kinds(4));
    expect(kinds(1)).toEqual(kinds(2));
    const names = buildSteps(m, 1).map((s) => s.step.kind);
    expect(names.filter((k) => k === 'tile')).toHaveLength(12);
    expect(names.filter((k) => k === 'mult')).toHaveLength(2);
    expect(names.filter((k) => k === 'subtotal')).toHaveLength(2);
    expect(names).toContain('bingo');
    expect(names.at(-2)).toBe('total');
    expect(names.at(-1)).toBe('done');
  });

  it('only ever moves forward in time, at every speed', () => {
    for (const pace of [1, 2, 4]) {
      const at = buildSteps(move(8, { eqMult: 2, bingo: true, equations: 3 }), pace).map((s) => s.at);
      expect(at[0]).toBe(0);
      for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    }
  });

  it('still speeds up a long equation so it does not drag', () => {
    const perTile = (n: number) => {
      const t = buildSteps(move(n), 1).filter((s) => s.step.kind === 'tile').map((s) => s.at);
      return t[1] - t[0];
    };
    expect(perTile(5)).toBe(130);
    expect(perTile(10)).toBe(95);
    expect(perTile(15)).toBe(70);
  });

  it('is longer for a bigger move but still finishes', () => {
    expect(end(move(8, { equations: 3, bingo: true, eqMult: 3 }), 4)).toBeGreaterThan(end(move(3), 4));
    // the slowest setting on a big move is long, which is why it can be skipped
    expect(end(move(8, { equations: 3, bingo: true, eqMult: 3 }), 4) / 1000).toBeGreaterThan(10);
  });
});

/** a stand-in for localStorage */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = store;
  return data;
}

describe('the saved speed', () => {
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  it('starts at the slow 1x when nothing has been chosen', () => {
    fakeStorage();
    expect(getFxSpeed()).toBe(1);
  });

  it('remembers a choice', () => {
    const data = fakeStorage();
    setFxSpeed(4);
    expect(getFxSpeed()).toBe(4);
    expect(data.get('amath.fxSpeed2')).toBe('4');
    setFxSpeed(2);
    expect(getFxSpeed()).toBe(2);
  });

  it('does not read a speed saved under the old meaning, so nobody is silently switched', () => {
    // before, "4x" meant twice as fast as now; reading it as the new 4x would be wrong,
    // and the old "1x" is today's 4x
    fakeStorage({ 'amath.fxSpeed': '4' });
    expect(getFxSpeed()).toBe(1);
    fakeStorage({ 'amath.fxSpeed': '2' });
    expect(getFxSpeed()).toBe(1);
  });

  it('ignores nonsense and works when storage is blocked', () => {
    fakeStorage({ 'amath.fxSpeed2': '7' });
    expect(getFxSpeed()).toBe(1);
    fakeStorage({ 'amath.fxSpeed2': 'fast' });
    expect(getFxSpeed()).toBe(1);
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(getFxSpeed()).toBe(1);
    expect(() => setFxSpeed(2)).not.toThrow();
  });
});

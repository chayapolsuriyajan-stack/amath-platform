import { describe, expect, it } from 'vitest';
import {
  FACE_ORDER, PREMIUMS, TILE_SET, TOTAL_TILES, checkEquation, createBag, emptyBoard,
  OVERTIME_SECONDS, checkTimeout, evaluateMove, exchange, newGame, pass, playMove, resign, timeLeftMs,
} from '../src';
import type { Cell, Placement, Tile } from '../src';

/** '1+2=3' style helper: one symbol per character, [12] is the whole 12 tile */
function syms(s: string): string[] {
  return [...s.matchAll(/\[(\d+)\]|./g)].map((m) => m[1] ?? m[0]);
}
const ok = (s: string) => checkEquation(syms(s)).ok;

describe('Junior Edition tile set', () => {
  it('has 70 tiles, numbers 0-16 and 20 only', () => {
    expect(TOTAL_TILES).toBe(70);
    expect(createBag()).toHaveLength(70);
    for (const f of ['17', '18', '19']) expect(TILE_SET[f]).toBeUndefined();
    expect(FACE_ORDER).toContain('20');
    expect(FACE_ORDER).toContain('16');
  });
  it('has no separate x or division tiles, and 8 equals tiles', () => {
    expect(TILE_SET['×']).toBeUndefined();
    expect(TILE_SET['÷']).toBeUndefined();
    expect(TILE_SET['×/÷'][0]).toBe(4);
    expect(TILE_SET['+/-'][0]).toBe(5);
    expect(TILE_SET['='][0]).toBe(8);
    expect(TILE_SET['?'][0]).toBe(4);
  });
  it('matches the counts and values printed on the sheet', () => {
    expect(TILE_SET['0']).toEqual([4, 1]);
    expect(TILE_SET['7']).toEqual([2, 2]);
    expect(TILE_SET['13']).toEqual([1, 6]);
    expect(TILE_SET['20']).toEqual([1, 5]);
  });
  it('gives every tile a unique id', () => {
    expect(new Set(createBag().map((t) => t.id)).size).toBe(70);
  });
  it('hands out ids after shuffling, so an id reveals nothing about the face', () => {
    // with ids assigned first, id 0 would always be a '0' tile
    const faces = new Set(Array.from({ length: 40 }, () => createBag().find((t) => t.id === 0)!.face));
    expect(faces.size).toBeGreaterThan(3);
    const bag = createBag();
    expect(bag.every((t, i) => t.id === i)).toBe(true);
  });
});

describe('equations (rules page examples)', () => {
  it('accepts a minus in front of a non-zero number', () => {
    expect(ok('-6=4-10')).toBe(true);
    expect(ok('-5=-5')).toBe(true);
  });
  it('never allows a plus in front of a number, on either side', () => {
    expect(ok('+7=5+2')).toBe(false);
    expect(ok('7=+7')).toBe(false);
    expect(checkEquation(syms('+7=5+2'))).toEqual({ ok: false, error: 'A plus sign cannot go in front of a number, only a minus can' });
  });
  it('never allows x or division in front of a number', () => {
    expect(ok('×2=2')).toBe(false);
    expect(ok('2=÷2')).toBe(false);
  });
  it('says what each side came to when they differ', () => {
    expect(checkEquation(syms('2+2=5'))).toEqual({ ok: false, error: 'The two sides are not equal (4 ≠ 5)' });
    expect(checkEquation(syms('1÷2=1'))).toEqual({ ok: false, error: 'The two sides are not equal (1/2 ≠ 1)' });
  });
  it('rejects a sign before zero', () => {
    expect(ok('-0=0')).toBe(false);
  });
  it('allows at most 3 joined digits', () => {
    expect(ok('123=100+23')).toBe(true);
    expect(ok('1234=1000+234')).toBe(false);
  });
  it('rejects zero padding', () => {
    expect(ok('012=011+1')).toBe(false);
    expect(ok('0=0')).toBe(true);
  });
  it('never joins 10-16 / 20 tiles with other digits', () => {
    expect(ok('[12]=6+6')).toBe(true);
    expect(checkEquation(['1', '12', '=', '13']).ok).toBe(false); // 1 next to the 12 tile
    expect(checkEquation(['12', '3', '=', '15']).ok).toBe(false);
    expect(checkEquation(['10', '10', '=', '20']).ok).toBe(false);
    expect(ok('[20]=[10]+[10]')).toBe(true);
  });
  it('follows order of operations and uses exact fractions', () => {
    expect(ok('2+3×4=14')).toBe(true);
    expect(ok('3÷2=6÷4')).toBe(true);
    expect(ok('1÷3×3=1')).toBe(true);
    expect(ok('6÷0=1')).toBe(false);
  });
  it('supports chained equalities and rejects bad shapes', () => {
    expect(ok('3+3=6=2×3')).toBe(true);
    expect(ok('3+3=6=7')).toBe(false);
    expect(ok('3+=6')).toBe(false);
    expect(ok('3++3=6')).toBe(false);
    expect(ok('3+3')).toBe(false);
    expect(ok('=6')).toBe(false);
    expect(ok('6=')).toBe(false);
    expect(ok('3×-2=-6')).toBe(false); // operator next to operator
  });
  it('allows a minus right after =', () => {
    expect(ok('5-10=-5')).toBe(true);
  });
});

let nextId = 1000;
const tile = (face: string, points = 1): Tile => ({ id: nextId++, face, points });

function rackFor(str: string): { rack: Tile[]; ids: number[] } {
  const rack = syms(str).map((s) => tile(s, 1));
  return { rack, ids: rack.map((t) => t.id) };
}

describe('move evaluation', () => {
  it('first move must cover the star', () => {
    const { rack } = rackFor('1+2=3');
    const bad = rack.map((t, i) => ({ tileId: t.id, row: 0, col: i }));
    const res = evaluateMove(emptyBoard(), rack, bad, true);
    expect(res.ok).toBe(false);
  });

  it('scores a first move with premiums (star has none)', () => {
    const { rack } = rackFor('1+2=3');
    // row 7, cols 5..9 → col 7 is star. Row 7 premiums: cols 3 and 11 are 2P, 0 and 14 are 3E
    const pl = rack.map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    const res = evaluateMove(emptyBoard(), rack, pl, true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(PREMIUMS[7][7]).toBe('★');
      // 5 tiles × 1 point, and the tile on ★ is tripled (+2)
      expect(res.move.score).toBe(7);
      expect(res.move.equations).toEqual(['1+2=3']);
      const star = res.move.breakdown[0].tiles[2];
      expect(star.premium).toBe('★');
      expect(star.value).toBe(3);
    }
  });

  it('applies piece and equation multipliers only to newly placed tiles', () => {
    const { rack } = rackFor('1+2=3');
    // put tiles on row 7 cols 3..7: col 3 is 2P, col 7 star
    const pl = rack.map((t, i) => ({ tileId: t.id, row: 7, col: 3 + i }));
    const res = evaluateMove(emptyBoard(), rack, pl, true);
    expect(res.ok).toBe(true);
    // first tile doubled by 2P (+1), last tile tripled by ★ (+2)
    if (res.ok) expect(res.move.score).toBe(8);
  });

  it('equation multiplier triples the whole line', () => {
    const rack = syms('1+2=3').map((s) => tile(s, 1));
    // row 7 cols 0..4 has 3E at col 0, and it does not cover the star → check with existing tiles instead
    const board = emptyBoard();
    // place existing tiles to the right so the line stays connected: 1+2=3 at cols 0..4 then extend to star
    const existing = syms('+4=7').map((s, i) => ({ tile: tile(s, 1), sym: s } as Cell));
    // full line: 1+2=3+4=7 is invalid (3+4=7 ≠ 3), so build: 1+2+4=7 with existing '+4=7' from col 3
    const rack2 = syms('1+2').map((s) => tile(s, 1));
    existing.forEach((c, i) => { board[7][3 + i] = c; });
    const pl = rack2.map((t, i) => ({ tileId: t.id, row: 7, col: i }));
    const res = evaluateMove(board, rack2, pl, false);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.move.score).toBe(7 * 3); // 7 tiles × 1, 3E at col 0
    void rack;
  });

  it('rejects gaps, mixed rows, disconnected and invalid equations', () => {
    const { rack } = rackFor('1+2=3');
    const gap = evaluateMove(emptyBoard(), rack, [0, 1, 2, 3, 4].map((i) => ({ tileId: rack[i].id, row: 7, col: i === 4 ? 10 : 5 + i })), true);
    expect(gap.ok).toBe(false);
    const diag = evaluateMove(emptyBoard(), rack, rack.map((t, i) => ({ tileId: t.id, row: 7 + (i % 2), col: 5 + i })), true);
    expect(diag.ok).toBe(false);
    const wrong = rackFor('1+2=4');
    const bad = evaluateMove(emptyBoard(), wrong.rack, wrong.rack.map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i })), true);
    expect(bad.ok).toBe(false);
    const board = emptyBoard();
    syms('1+2=3').forEach((s, i) => { board[7][5 + i] = { tile: tile(s), sym: s }; });
    const far = rackFor('4+5=9');
    const disc = evaluateMove(board, far.rack, far.rack.map((t, i) => ({ tileId: t.id, row: 1, col: i })), false);
    expect(disc.ok).toBe(false);
  });

  it('requires a chosen symbol for +/-, ×/÷ and blanks', () => {
    const t = [tile('1'), tile('+/-'), tile('2'), tile('='), tile('3')];
    const pl: Placement[] = t.map((x, i) => ({ tileId: x.id, row: 7, col: 5 + i }));
    expect(evaluateMove(emptyBoard(), t, pl, true).ok).toBe(false);
    pl[1].sym = '+';
    const res = evaluateMove(emptyBoard(), t, pl, true);
    expect(res.ok).toBe(true);
    const blank = [tile('?', 0), tile('+'), tile('2'), tile('='), tile('3')];
    const bp = blank.map((x, i) => ({ tileId: x.id, row: 7, col: 5 + i, sym: i === 0 ? '1' : undefined }));
    expect(evaluateMove(emptyBoard(), blank, bp, true).ok).toBe(true);
    const badBlank = bp.map((p, i) => (i === 0 ? { ...p, sym: '17' } : p));
    expect(evaluateMove(emptyBoard(), blank, badBlank, true).ok).toBe(false);
  });

  it('gives the 8-tile bonus only when all 8 tiles are used', () => {
    const seven = syms('9-3=2×3').map((s) => tile(s, 1));
    const r7 = evaluateMove(emptyBoard(), seven, seven.map((t, i) => ({ tileId: t.id, row: 7, col: 4 + i })), true);
    expect(r7.ok).toBe(true);
    if (r7.ok) expect(r7.move.bingo).toBe(false);
    const eight = syms('10=1+2+7').map((s) => tile(s, 1));
    expect(eight).toHaveLength(8);
    const r8 = evaluateMove(emptyBoard(), eight, eight.map((t, i) => ({ tileId: t.id, row: 7, col: 3 + i })), true);
    expect(r8.ok).toBe(true);
    if (r8.ok) {
      expect(r8.move.bingo).toBe(true);
      // 8 tiles × 1, 2P at col 3 (+1), ★ at col 7 (+2), then the 40 bonus
      expect(r8.move.score).toBe(8 + 1 + 2 + 40);
    }
  });
});

describe('game flow', () => {
  const seeded = () => {
    let s = 42;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };

  it('deals 8 tiles each and leaves 54 in the bag', () => {
    const g = newGame(seeded(), { first: 0 });
    expect(g.racks[0]).toHaveLength(8);
    expect(g.racks[1]).toHaveLength(8);
    expect(g.bag).toHaveLength(54);
  });

  it('only lets the player on turn act, and exchange needs 5+ tiles in the bag', () => {
    const g = newGame(seeded(), { first: 0 });
    expect(exchange(g, 1, [g.racks[1][0].id]).ok).toBe(false);
    const give = g.racks[0][0].id;
    expect(exchange(g, 0, [give]).ok).toBe(true);
    expect(g.turn).toBe(1);
    expect(g.racks[0].some((t) => t.id === give)).toBe(false);
    expect(g.bag).toHaveLength(54);
    g.bag = g.bag.slice(0, 4);
    expect(exchange(g, 1, [g.racks[1][0].id]).ok).toBe(false);
  });

  it('pass is only allowed when the bag is empty and 6 passes end the game', () => {
    const g = newGame(seeded(), { first: 0 });
    expect(pass(g, 0).ok).toBe(false);
    g.bag = [];
    g.scores = [10, 10];
    for (let i = 0; i < 6; i++) expect(pass(g, (i % 2) as 0 | 1).ok).toBe(true);
    expect(g.finished).toBe(true);
    expect(g.endReason).toBe('passes');
    expect(g.scores[0]).toBeLessThan(10);
  });

  it('ending by an empty rack gives the winner 2× the opponent rack', () => {
    const g = newGame(seeded(), { first: 0 });
    g.bag = [];
    g.racks[0] = syms('1+2=3').map((s) => tile(s, 1));
    g.racks[1] = [tile('9', 2), tile('8', 2)];
    const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    expect(playMove(g, 0, pl).ok).toBe(true);
    expect(g.finished).toBe(true);
    expect(g.endReason).toBe('rack-empty');
    expect(g.scores[0]).toBe(7 + 8);
    expect(g.winner).toBe(0);
  });

  it('resign hands the win to the opponent', () => {
    const g = newGame(seeded(), { first: 0 });
    expect(resign(g, 0).ok).toBe(true);
    expect(g.winner).toBe(1);
  });
});

describe('turn clock', () => {
  const seeded = () => {
    let s = 7;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };
  const T0 = 1_000_000;
  const start = () => newGame(seeded(), { first: 0, turnSeconds: 180, now: T0 });

  it('reports time left and lets it run negative', () => {
    const g = start();
    expect(timeLeftMs(g, T0)).toBe(180_000);
    expect(timeLeftMs(g, T0 + 200_000)).toBe(-20_000);
  });

  it('keeps playing while the player is into overtime', () => {
    const g = start();
    g.racks[0] = syms('1+2=3').map((s) => tile(s, 1));
    const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    // 4 minutes over the limit, still inside the 5 minute grace
    const res = playMove(g, 0, pl, T0 + (180 + 240) * 1000);
    expect(res.ok).toBe(true);
    expect(g.finished).toBe(false);
  });

  it('loses the game once a player passes the overtime grace', () => {
    const g = start();
    const late = T0 + (180 + OVERTIME_SECONDS) * 1000 + 1;
    expect(checkTimeout(g, late)).toBe(true);
    expect(g.finished).toBe(true);
    expect(g.endReason).toBe('timeout');
    expect(g.winner).toBe(1);
  });

  it('resets the clock when the turn changes, and never times out with no limit', () => {
    const g = start();
    g.racks[0] = syms('1+2=3').map((s) => tile(s, 1));
    const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    playMove(g, 0, pl, T0 + 30_000);
    expect(g.turn).toBe(1);
    expect(g.turnStartedAt).toBe(T0 + 30_000);

    const free = newGame(seeded(), { first: 0, turnSeconds: 0, matchSeconds: 0, now: T0 });
    expect(timeLeftMs(free, T0 + 10 ** 9)).toBe(Infinity);
    expect(checkTimeout(free, T0 + 10 ** 9)).toBe(false);
  });
});

describe('scoring breakdown for the combo screen', () => {
  it('lists every tile with its premium, multiplier and subtotal', () => {
    const rack = syms('1+2=3').map((s) => tile(s, 1));
    const res = evaluateMove(emptyBoard(), rack, rack.map((t, i) => ({ tileId: t.id, row: 7, col: 3 + i })), true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const eq = res.move.breakdown[0];
    expect(eq.text).toBe('1+2=3');
    expect(eq.tiles).toHaveLength(5);
    expect(eq.tiles[0]).toMatchObject({ sym: '1', premium: '2P', value: 2, isNew: true });
    expect(eq.tiles[4]).toMatchObject({ sym: '3', premium: '★', value: 3 });
    expect(eq.eqMult).toBe(1);
    expect(eq.subtotal).toBe(res.move.score);
  });

  it('records the breakdown on the game state for both players', () => {
    const g = newGame(() => 0.5, { first: 0, turnSeconds: 0 });
    g.racks[0] = syms('1+2=3').map((s) => tile(s, 1));
    const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    expect(playMove(g, 0, pl).ok).toBe(true);
    expect(g.lastMove).toMatchObject({ n: 1, player: 0, bingo: false, total: 7 });
    expect(g.lastMove?.equations[0].tiles).toHaveLength(5);
  });
});

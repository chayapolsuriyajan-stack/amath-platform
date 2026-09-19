import { describe, expect, it } from 'vitest';
import {
  FACE_ORDER, PREMIUMS, TILE_SET, TOTAL_TILES, checkEquation, createBag, emptyBoard,
  evaluateMove, exchange, newGame, pass, playMove, resign,
} from '../src';
import type { Cell, Placement, Tile } from '../src';

/** '1+2=3' style helper: one symbol per character, [12] is the whole 12 tile */
function syms(s: string): string[] {
  return [...s.matchAll(/\[(\d+)\]|./g)].map((m) => m[1] ?? m[0]);
}
const ok = (s: string) => checkEquation(syms(s)).ok;

describe('tile set', () => {
  it('has 97 tiles and no 17/18/19', () => {
    expect(TOTAL_TILES).toBe(97);
    expect(createBag()).toHaveLength(97);
    for (const f of ['17', '18', '19']) expect(TILE_SET[f]).toBeUndefined();
    expect(FACE_ORDER).toContain('20');
    expect(FACE_ORDER).toContain('16');
  });
  it('gives every tile a unique id', () => {
    expect(new Set(createBag().map((t) => t.id)).size).toBe(97);
  });
});

describe('equations (rules page examples)', () => {
  it('accepts unary minus / plus in front of a non-zero number', () => {
    expect(ok('-6=4-10')).toBe(true);
    expect(ok('+7=5+2')).toBe(true);
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
      expect(res.move.score).toBe(5); // 5 tiles × 1 point, no premium hit
      expect(res.move.equations).toEqual(['1+2=3']);
    }
  });

  it('applies piece and equation multipliers only to newly placed tiles', () => {
    const { rack } = rackFor('1+2=3');
    // put tiles on row 7 cols 3..7: col 3 is 2P, col 7 star
    const pl = rack.map((t, i) => ({ tileId: t.id, row: 7, col: 3 + i }));
    const res = evaluateMove(emptyBoard(), rack, pl, true);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.move.score).toBe(6); // first tile doubled
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
      expect(r8.move.score).toBe(8 + 1 + 40); // 2P at col 3 doubles one tile
    }
  });
});

describe('game flow', () => {
  const seeded = () => {
    let s = 42;
    return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  };

  it('deals 8 tiles each and leaves 81 in the bag', () => {
    const g = newGame(seeded(), 0);
    expect(g.racks[0]).toHaveLength(8);
    expect(g.racks[1]).toHaveLength(8);
    expect(g.bag).toHaveLength(81);
  });

  it('only lets the player on turn act, and exchange needs 5+ tiles in the bag', () => {
    const g = newGame(seeded(), 0);
    expect(exchange(g, 1, [g.racks[1][0].id]).ok).toBe(false);
    const give = g.racks[0][0].id;
    expect(exchange(g, 0, [give]).ok).toBe(true);
    expect(g.turn).toBe(1);
    expect(g.racks[0].some((t) => t.id === give)).toBe(false);
    expect(g.bag).toHaveLength(81);
    g.bag = g.bag.slice(0, 4);
    expect(exchange(g, 1, [g.racks[1][0].id]).ok).toBe(false);
  });

  it('pass is only allowed when the bag is empty and 6 passes end the game', () => {
    const g = newGame(seeded(), 0);
    expect(pass(g, 0).ok).toBe(false);
    g.bag = [];
    g.scores = [10, 10];
    for (let i = 0; i < 6; i++) expect(pass(g, (i % 2) as 0 | 1).ok).toBe(true);
    expect(g.finished).toBe(true);
    expect(g.endReason).toBe('passes');
    expect(g.scores[0]).toBeLessThan(10);
  });

  it('ending by an empty rack gives the winner 2× the opponent rack', () => {
    const g = newGame(seeded(), 0);
    g.bag = [];
    g.racks[0] = syms('1+2=3').map((s) => tile(s, 1));
    g.racks[1] = [tile('9', 2), tile('8', 2)];
    const pl = g.racks[0].map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i }));
    expect(playMove(g, 0, pl).ok).toBe(true);
    expect(g.finished).toBe(true);
    expect(g.endReason).toBe('rack-empty');
    expect(g.scores[0]).toBe(5 + 8);
    expect(g.winner).toBe(0);
  });

  it('resign hands the win to the opponent', () => {
    const g = newGame(seeded(), 0);
    expect(resign(g, 0).ok).toBe(true);
    expect(g.winner).toBe(1);
  });
});

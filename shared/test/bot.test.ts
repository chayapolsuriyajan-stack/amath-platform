import { describe, expect, it } from 'vitest';
import {
  CENTER, LEVELS, TILE_SET, chooseExchange, drawForStart, drawRank, emptyBoard, evaluateMove, exchange, findMovesSync,
  newGame, pass, pickMove, playMove, prefixOk, searchMoves,
} from '../src';
import type { Board, Tile } from '../src';

let nextId = 9000;
const rackOf = (faces: string[]): Tile[] => faces.map((face) => ({ id: nextId++, face, points: TILE_SET[face]?.[1] ?? 1 }));
const syms = (s: string) => [...s.matchAll(/\[(\d+)\]|./g)].map((m) => m[1] ?? m[0]);

describe('who starts', () => {
  it('ranks symbols lowest, numbers by value, and a blank highest', () => {
    expect(drawRank('+')).toBe(drawRank('×/÷'));
    expect(drawRank('=')).toBeLessThan(drawRank('0'));
    expect(drawRank('9')).toBeLessThan(drawRank('10'));
    expect(drawRank('16')).toBeLessThan(drawRank('20'));
    expect(drawRank('20')).toBeLessThan(drawRank('?'));
  });

  it('gives the start to whoever drew nearer to 20, and never ends on a tie', () => {
    for (let i = 0; i < 200; i++) {
      const { first, draw } = drawForStart();
      const [a, b] = draw.faces.map(drawRank);
      expect(a).not.toBe(b);
      expect(first).toBe(a > b ? 0 : 1);
    }
  });

  it('lets either player start', () => {
    const firsts = new Set(Array.from({ length: 60 }, () => newGame().turn));
    expect(firsts).toEqual(new Set([0, 1]));
    expect(newGame().startDraw?.faces).toHaveLength(2);
  });
});

describe('prefix check', () => {
  it('accepts sequences that can still become equations', () => {
    for (const s of ['1', '12', '123', '1+', '-6', '6=', '6=-', '[12]+', '3×4=1']) expect(prefixOk(syms(s))).toBe(true);
  });
  it('rejects sequences no later tile can fix', () => {
    for (const s of ['+', '=', '×2', '1++', '1+=', '1234', '01', '-0', '[12]3', '3[12]', '6=+', '6==']) {
      expect(prefixOk(syms(s))).toBe(false);
    }
  });
});

describe('bot move search', () => {
  it('finds a legal opening that covers the star, for every level', () => {
    const rack = rackOf(['1', '2', '3', '+', '=', '4', '5', '6']);
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const cands = findMovesSync(searchMoves(emptyBoard(), rack, true, LEVELS[level].limits), 5000);
      expect(cands.length).toBeGreaterThan(0);
      for (const m of cands.slice(0, 50)) {
        expect(m.placements.some((p) => p.row === CENTER && p.col === CENTER)).toBe(true);
        expect(evaluateMove(emptyBoard(), rack, m.placements, true).ok).toBe(true);
      }
      expect(Math.max(...cands.map((m) => m.placements.length))).toBeLessThanOrEqual(LEVELS[level].limits.maxTiles);
    }
  });

  it('builds onto tiles already on the board', () => {
    const board: Board = emptyBoard();
    syms('1+2=3').forEach((s, i) => { board[7][5 + i] = { tile: { id: 1 + i, face: s, points: 1 }, sym: s }; });
    const rack = rackOf(['4', '5', '6', '+', '=', '-', '9', '2']);
    const cands = findMovesSync(searchMoves(board, rack, false, LEVELS.hard.limits), 5000);
    expect(cands.length).toBeGreaterThan(0);
    for (const m of cands) expect(evaluateMove(board, rack, m.placements, false).ok).toBe(true);
  });

  it('uses blanks only up to the level allows', () => {
    const rack = rackOf(['?', '?', '2', '+', '=', '4', '6', '8']);
    const easy = findMovesSync(searchMoves(emptyBoard(), rack, true, LEVELS.easy.limits), 5000);
    expect(easy.every((m) => m.blanks === 0)).toBe(true);
    const hard = findMovesSync(searchMoves(emptyBoard(), rack, true, LEVELS.hard.limits), 5000);
    expect(hard.some((m) => m.blanks > 0)).toBe(true);
    expect(hard.every((m) => m.blanks <= 2)).toBe(true);
  });

  it('finds nothing when nothing can be played', () => {
    const rack = rackOf(['=', '=', '=', '+', '+', '-', '×/÷', '+/-']);
    expect(findMovesSync(searchMoves(emptyBoard(), rack, true, LEVELS.hard.limits), 5000)).toEqual([]);
  });

  it('is quick enough to run on the server', () => {
    const rack = rackOf(['1', '2', '3', '4', '+', '-', '=', '×/÷']);
    const t0 = Date.now();
    findMovesSync(searchMoves(emptyBoard(), rack, true, LEVELS.hard.limits), 20_000);
    expect(Date.now() - t0).toBeLessThan(LEVELS.hard.budgetMs);
  });
});

describe('choosing a move', () => {
  const cands = [10, 30, 50, 5, 20, 40, 60, 15].map((score, i) => ({
    placements: [{ tileId: i, row: 7, col: 7 }], score, equations: [], blanks: 0,
  }));

  it('hard takes the best move, easy never takes one from the top half', () => {
    expect(pickMove(cands, 'hard')!.score).toBe(60);
    for (let i = 0; i < 50; i++) expect(pickMove(cands, 'easy')!.score).toBeLessThanOrEqual(20);
  });

  it('medium picks from the better quarter', () => {
    for (let i = 0; i < 50; i++) expect(pickMove(cands, 'medium')!.score).toBeGreaterThanOrEqual(50);
  });

  it('hard saves a blank unless it earns more than it costs', () => {
    const withBlank = { ...cands[6], score: 62, blanks: 1 };
    expect(pickMove([cands[6], withBlank], 'hard')!.blanks).toBe(0);
    const bigBlank = { ...cands[6], score: 90, blanks: 1 };
    expect(pickMove([cands[6], bigBlank], 'hard')!.blanks).toBe(1);
  });

  it('returns nothing when there is nothing to choose', () => {
    expect(pickMove([], 'hard')).toBeNull();
  });
});

describe('when the bot is stuck', () => {
  it('throws back tiles but keeps an equals sign and an operator', () => {
    const rack = rackOf(['=', '=', '=', '+', '+', '-', '×/÷', '+/-']);
    const give = chooseExchange(rack);
    const kept = rack.filter((t) => !give.includes(t.id)).map((t) => t.face);
    expect(kept).toContain('=');
    expect(kept.some((f) => ['+', '-', '+/-', '×/÷'].includes(f))).toBe(true);
    expect(give.length).toBeGreaterThan(0);
  });

  it('can always pass when it has nothing to play', () => {
    const g = newGame(() => 0.5, { first: 0, matchSeconds: 0 });
    g.bag = g.bag.slice(0, 3); // too few to exchange
    expect(pass(g, 0).ok).toBe(true);
  });

  it('plays a whole game against itself without getting stuck', () => {
    const g = newGame(undefined, { matchSeconds: 0 });
    for (let turn = 0; turn < 120 && !g.finished; turn++) {
      const p = g.turn;
      const cands = findMovesSync(searchMoves(g.board, g.racks[p], g.firstMove, LEVELS.medium.limits), 1500);
      const pick = pickMove(cands, 'hard');
      if (pick) expect(playMove(g, p, pick.placements).ok).toBe(true);
      else if (g.bag.length >= 5) {
        expect(exchange(g, p, chooseExchange(g.racks[p])).ok).toBe(true);
      } else expect(pass(g, p).ok).toBe(true);
    }
    expect(g.finished).toBe(true);
    expect(g.log.filter((l) => l.type === 'move').length).toBeGreaterThan(5);
  }, 120_000);
});

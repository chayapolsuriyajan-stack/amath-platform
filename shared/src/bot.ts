import { CENTER, SIZE, inBounds } from './board';
import { checkEquation } from './expression';
import { evaluateMove } from './move';
import { MULTI_DIGITS, OPERATORS, SINGLE_DIGITS, allowedSyms } from './tiles';
import type { Board, Placement, Tile } from './types';

export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const isBotLevel = (v: unknown): v is BotLevel => typeof v === 'string' && (BOT_LEVELS as readonly string[]).includes(v);

export interface Candidate {
  placements: Placement[];
  score: number;
  equations: string[];
  blanks: number;
}

export interface SearchLimits {
  /** most tiles the bot will put down in one move */
  maxTiles: number;
  /** most blanks it may use in one move */
  maxBlanks: number;
  /** what a blank may stand for */
  blankSyms: string[];
}

export interface LevelConfig {
  limits: SearchLimits;
  /** how long the search may run, in ms */
  budgetMs: number;
  /** pause before moving, so the bot does not answer instantly: [min, max] ms */
  thinkMs: [number, number];
}

export const LEVELS: Record<BotLevel, LevelConfig> = {
  easy: {
    // five tiles is the smallest opening from your own rack, like 1+2=3
    limits: { maxTiles: 5, maxBlanks: 0, blankSyms: [] },
    budgetMs: 300,
    thinkMs: [1500, 3000],
  },
  medium: {
    limits: { maxTiles: 6, maxBlanks: 1, blankSyms: [...SINGLE_DIGITS, '=', '+', '-'] },
    budgetMs: 1800,
    thinkMs: [1500, 3200],
  },
  hard: {
    limits: { maxTiles: 8, maxBlanks: 2, blankSyms: allowedSyms('?') },
    // enough to finish on almost every turn; otherwise it plays the best found so far
    budgetMs: 3000,
    thinkMs: [1000, 2500],
  },
};

const isDigit = (s: string) => SINGLE_DIGITS.includes(s);
const isMulti = (s: string) => MULTI_DIGITS.includes(s);
const isNum = (s: string) => isDigit(s) || isMulti(s);
const isOp = (s: string) => OPERATORS.includes(s);

/**
 * Could this run of symbols still grow into a valid equation? It rejects only
 * what no later symbol can fix: two operators in a row, a line starting with
 * anything but a number or minus, four joined digits, a leading zero, a 10-20
 * tile touching another number, or a minus in front of zero.
 */
export function prefixOk(syms: string[]): boolean {
  let run = 0;
  let runStart = '';
  for (let i = 0; i < syms.length; i++) {
    const s = syms[i];
    const prev = i > 0 ? syms[i - 1] : null;
    const sideStart = prev === null || prev === '=';
    if (s === '=') {
      if (prev === null || prev === '=' || isOp(prev)) return false;
      run = 0;
    } else if (isOp(s)) {
      if (sideStart ? s !== '-' : isOp(prev!)) return false;
      run = 0;
    } else if (isMulti(s)) {
      if (prev !== null && isNum(prev)) return false;
      run = 0;
    } else {
      if (prev !== null && isMulti(prev)) return false;
      if (prev !== null && isDigit(prev)) {
        run++;
        if (run > 3 || runStart === '0') return false;
      } else {
        run = 1;
        runStart = s;
        // a leading minus may not go in front of zero
        const unary = prev === '-' && (i === 1 || syms[i - 2] === '=');
        if (unary && s === '0') return false;
      }
    }
  }
  return true;
}

const DIRS: [number, number][] = [[0, 1], [1, 0]];

/**
 * Every legal move for this rack, found square by square along each row and
 * column. A generator: it yields `null` every so often so a caller can spread
 * the work out, and yields each legal move as it finds it.
 */
export function* searchMoves(
  board: Board,
  rack: Tile[],
  firstMove: boolean,
  limits: SearchLimits,
  rand: () => number = Math.random,
): Generator<Candidate | null> {
  const filled = (r: number, c: number) => inBounds(r, c) && board[r][c] !== null;
  const anchor: boolean[][] = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  if (firstMove) anchor[CENTER][CENTER] = true;
  else {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!board[r][c] && (filled(r - 1, c) || filled(r + 1, c) || filled(r, c - 1) || filled(r, c + 1))) anchor[r][c] = true;
      }
    }
  }

  // does placing `sym` at (r,c) make a valid equation in the other direction?
  const crossCache = new Map<string, boolean>();
  const crossOk = (r: number, c: number, dr: number, dc: number, sym: string) => {
    const [pr, pc] = [dc, dr];
    if (!filled(r - pr, c - pc) && !filled(r + pr, c + pc)) return true;
    const key = `${r},${c},${pr},${sym}`;
    const hit = crossCache.get(key);
    if (hit !== undefined) return hit;
    let sr = r;
    let sc = c;
    while (filled(sr - pr, sc - pc)) {
      sr -= pr;
      sc -= pc;
    }
    const line: string[] = [];
    for (let cr = sr, cc = sc; inBounds(cr, cc) && (board[cr][cc] || (cr === r && cc === c)); cr += pr, cc += pc) {
      line.push(cr === r && cc === c ? sym : board[cr][cc]!.sym);
    }
    const ok = checkEquation(line).ok;
    crossCache.set(key, ok);
    return ok;
  };

  // is there an '=' already on the board further along this line?
  const eqAhead = (r: number, c: number, dr: number, dc: number) => {
    for (let cr = r, cc = c; inBounds(cr, cc); cr += dr, cc += dc) if (board[cr][cc]?.sym === '=') return true;
    return false;
  };
  const blankCanEq = limits.blankSyms.includes('=');

  const seen = new Set<string>();
  const used = rack.map(() => false);
  const syms: string[] = [];
  const placed: Placement[] = [];
  let nodes = 0;
  let blanks = 0;
  let eqInLine = 0;

  function* extend(r: number, c: number, dr: number, dc: number, touched: boolean): Generator<Candidate | null> {
    if (++nodes % 256 === 0) yield null;
    const edge = !inBounds(r, c);
    const last = syms[syms.length - 1];
    // the word may end here. Cheap tests first: it needs an '=' and must end in a number
    if (
      (edge || !board[r][c]) && placed.length > 0 && syms.length >= 3 && touched &&
      eqInLine > 0 && last !== '=' && !OPERATORS.includes(last) && checkEquation(syms).ok
    ) {
      const key = placed.map((p) => `${p.row},${p.col},${p.tileId},${p.sym ?? ''}`).sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        const res = evaluateMove(board, rack, placed, firstMove);
        if (res.ok) {
          yield { placements: placed.map((p) => ({ ...p })), score: res.move.score, equations: res.move.equations, blanks };
        }
      }
    }
    if (edge) return;

    // no '=' yet and none reachable: this line can never balance
    if (eqInLine === 0) {
      const inRack = rack.some((t, i) => !used[i] && t.face === '=');
      const byBlank = blankCanEq && blanks < limits.maxBlanks && rack.some((t, i) => !used[i] && t.face === '?');
      if (!inRack && !byBlank && !eqAhead(r, c, dr, dc)) return;
    }

    const cell = board[r][c];
    if (cell) {
      syms.push(cell.sym);
      if (cell.sym === '=') eqInLine++;
      if (prefixOk(syms)) yield* extend(r + dr, c + dc, dr, dc, true);
      if (cell.sym === '=') eqInLine--;
      syms.pop();
      return;
    }
    if (placed.length >= limits.maxTiles) return;

    // symbols the unused real tiles can already make: a blank never stands in for these
    const real = new Set<string>();
    for (let i = 0; i < rack.length; i++) if (!used[i] && rack[i].face !== '?') for (const s of allowedSyms(rack[i].face)) real.add(s);

    const tried = new Set<string>();
    for (let i = 0; i < rack.length; i++) {
      if (used[i]) continue;
      const tile = rack[i];
      if (tried.has(tile.face)) continue;
      tried.add(tile.face);
      const isBlank = tile.face === '?';
      if (isBlank && blanks >= limits.maxBlanks) continue;
      const options = isBlank ? limits.blankSyms.filter((s) => !real.has(s)) : allowedSyms(tile.face);
      const needsSym = isBlank || allowedSyms(tile.face).length > 1;
      for (const sym of options) {
        syms.push(sym);
        if (prefixOk(syms) && crossOk(r, c, dr, dc, sym)) {
          used[i] = true;
          if (isBlank) blanks++;
          if (sym === '=') eqInLine++;
          placed.push(needsSym ? { tileId: tile.id, row: r, col: c, sym } : { tileId: tile.id, row: r, col: c });
          yield* extend(r + dr, c + dc, dr, dc, touched || anchor[r][c]);
          placed.pop();
          if (sym === '=') eqInLine--;
          if (isBlank) blanks--;
          used[i] = false;
        }
        syms.pop();
      }
    }
  }

  // every (direction, line, start) — shuffled, so a search cut short is not biased to one corner
  const starts: [number, number, number, number][] = [];
  for (const [dr, dc] of DIRS) {
    for (let line = 0; line < SIZE; line++) {
      for (let s = 0; s < SIZE; s++) {
        const r = dr ? s : line;
        const c = dr ? line : s;
        if (filled(r - dr, c - dc)) continue; // a word must begin at a gap or the edge
        // skip starts too far from anything to connect to
        let gaps = 0;
        let reach = false;
        for (let k = s; k < SIZE; k++) {
          const rr = dr ? k : line;
          const cc = dr ? line : k;
          if (board[rr][cc] || anchor[rr][cc]) {
            reach = true;
            break;
          }
          if (++gaps >= limits.maxTiles) break;
        }
        if (reach) starts.push([r, c, dr, dc]);
      }
    }
  }
  for (let i = starts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }
  for (const [r, c, dr, dc] of starts) yield* extend(r, c, dr, dc, false);
}

/** run a search to the end or until `maxMs` is up, all at once (for tests and small searches) */
export function findMovesSync(gen: Generator<Candidate | null>, maxMs = Infinity): Candidate[] {
  const out: Candidate[] = [];
  const end = Date.now() + maxMs;
  for (let r = gen.next(); !r.done; r = gen.next()) {
    if (r.value) out.push(r.value);
    else if (Date.now() > end) break;
  }
  return out;
}

/**
 * Choose among the legal moves. Hard plays the best one, holding blanks back
 * unless they earn their keep. Medium picks from the better quarter. Easy
 * picks from the weaker half, so it plays like a beginner.
 */
export function pickMove(cands: Candidate[], level: BotLevel, rand: () => number = Math.random): Candidate | null {
  if (cands.length === 0) return null;
  if (level === 'hard') {
    const value = (m: Candidate) => m.score - m.blanks * 8;
    return cands.reduce((best, m) => (value(m) > value(best) ? m : best));
  }
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  if (level === 'medium') {
    const band = Math.max(1, Math.ceil(sorted.length * 0.25));
    return sorted[Math.floor(rand() * band)];
  }
  const from = Math.floor(sorted.length * 0.5);
  return sorted[from + Math.floor(rand() * (sorted.length - from))];
}

/**
 * When there is nothing to play: which tiles to throw back. Keeps one equals
 * sign, one operator, blanks and a few small numbers, and swaps the rest.
 */
export function chooseExchange(rack: Tile[]): number[] {
  const keep = new Set<number>();
  const take = (pred: (t: Tile) => boolean, n: number) => {
    for (const t of rack) {
      if (n <= 0) break;
      if (!keep.has(t.id) && pred(t)) {
        keep.add(t.id);
        n--;
      }
    }
  };
  take((t) => t.face === '?', 2);
  take((t) => t.face === '=', 1);
  take((t) => ['+', '-', '+/-', '×/÷'].includes(t.face), 1);
  take((t) => isDigit(t.face), 3);
  const give = rack.filter((t) => !keep.has(t.id)).map((t) => t.id);
  // a rack that already looks balanced but still cannot play: swap half of it
  return give.length ? give : rack.slice(0, Math.ceil(rack.length / 2)).map((t) => t.id);
}

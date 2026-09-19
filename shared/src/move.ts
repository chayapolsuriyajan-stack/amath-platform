import { CENTER, PREMIUMS, SIZE, inBounds } from './board';
import { checkEquation } from './expression';
import { RACK_SIZE, allowedSyms } from './tiles';
import type { Board, Cell, MoveResult, Placement, Tile } from './types';

export interface Line {
  cells: { r: number; c: number; cell: Cell; isNew: boolean }[];
}

export interface ScoredMove {
  score: number;
  bingo: boolean;
  equations: string[];
  placed: { r: number; c: number; cell: Cell }[];
}

/** contiguous run through (r,c) in one direction */
function runThrough(board: Board, newKeys: Set<number>, r: number, c: number, dr: number, dc: number): Line {
  let sr = r;
  let sc = c;
  while (inBounds(sr - dr, sc - dc) && board[sr - dr][sc - dc]) {
    sr -= dr;
    sc -= dc;
  }
  const cells: Line['cells'] = [];
  let cr = sr;
  let cc = sc;
  while (inBounds(cr, cc) && board[cr][cc]) {
    cells.push({ r: cr, c: cc, cell: board[cr][cc]!, isNew: newKeys.has(cr * SIZE + cc) });
    cr += dr;
    cc += dc;
  }
  return { cells };
}

/**
 * Validate a move against the board and the player's rack, and score it.
 * `board` must be the board BEFORE the move.
 */
export function evaluateMove(
  board: Board,
  rack: Tile[],
  placements: Placement[],
  firstMove: boolean,
): MoveResult<{ move: ScoredMove }> {
  if (placements.length === 0) return { ok: false, error: 'Place at least one tile' };

  const seenTiles = new Set<number>();
  const seenSquares = new Set<number>();
  const placed: { r: number; c: number; cell: Cell }[] = [];
  for (const p of placements) {
    const tile = rack.find((t) => t.id === p.tileId);
    if (!tile) return { ok: false, error: 'That tile is not in your rack' };
    if (seenTiles.has(p.tileId)) return { ok: false, error: 'A tile was placed twice' };
    if (!Number.isInteger(p.row) || !Number.isInteger(p.col) || !inBounds(p.row, p.col)) {
      return { ok: false, error: 'Tile is outside the board' };
    }
    if (board[p.row][p.col]) return { ok: false, error: 'That square is already taken' };
    const key = p.row * SIZE + p.col;
    if (seenSquares.has(key)) return { ok: false, error: 'Two tiles on one square' };
    const options = allowedSyms(tile.face);
    const sym = options.length === 1 ? options[0] : p.sym;
    if (!sym || !options.includes(sym)) return { ok: false, error: `Choose what ${tile.face} stands for` };
    seenTiles.add(p.tileId);
    seenSquares.add(key);
    placed.push({ r: p.row, c: p.col, cell: { tile, sym } });
  }

  const sameRow = placed.every((p) => p.r === placed[0].r);
  const sameCol = placed.every((p) => p.c === placed[0].c);
  if (!sameRow && !sameCol) return { ok: false, error: 'Tiles must be placed in one row or one column' };

  // temporary board with the new tiles in place
  const next: Board = board.map((row) => row.slice());
  for (const p of placed) next[p.r][p.c] = p.cell;
  const newKeys = new Set(placed.map((p) => p.r * SIZE + p.c));

  const lines: Line[] = [];
  if (placed.length > 1) {
    const [dr, dc] = sameRow ? [0, 1] : [1, 0];
    const main = runThrough(next, newKeys, placed[0].r, placed[0].c, dr, dc);
    if (placed.some((p) => !main.cells.some((x) => x.r === p.r && x.c === p.c))) {
      return { ok: false, error: 'Tiles must be placed without gaps' };
    }
    lines.push(main);
    const [pr, pc] = sameRow ? [1, 0] : [0, 1];
    for (const p of placed) {
      const cross = runThrough(next, newKeys, p.r, p.c, pr, pc);
      if (cross.cells.length > 1) lines.push(cross);
    }
  } else {
    const p = placed[0];
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const l = runThrough(next, newKeys, p.r, p.c, dr, dc);
      if (l.cells.length > 1) lines.push(l);
    }
  }

  if (firstMove) {
    if (!placed.some((p) => p.r === CENTER && p.c === CENTER)) {
      return { ok: false, error: 'The first move must cover the ★ square' };
    }
  } else if (!lines.some((l) => l.cells.some((x) => !x.isNew))) {
    return { ok: false, error: 'Tiles must connect to tiles already on the board' };
  }
  if (lines.length === 0) return { ok: false, error: 'Tiles do not form an equation' };

  let score = 0;
  const equations: string[] = [];
  for (const line of lines) {
    const syms = line.cells.map((x) => x.cell.sym);
    const text = syms.join('');
    const res = checkEquation(syms);
    if (!res.ok) return { ok: false, error: `${text} — ${res.error}` };
    equations.push(text);

    let sum = 0;
    let eqMult = 1;
    for (const x of line.cells) {
      let pts = x.cell.tile.points;
      if (x.isNew) {
        const prem = PREMIUMS[x.r][x.c];
        if (prem === '2P') pts *= 2;
        else if (prem === '3P') pts *= 3;
        else if (prem === '2E') eqMult *= 2;
        else if (prem === '3E') eqMult *= 3;
      }
      sum += pts;
    }
    score += sum * eqMult;
  }

  const bingo = placed.length === RACK_SIZE;
  if (bingo) score += 40;
  return { ok: true, move: { score, bingo, equations, placed } };
}

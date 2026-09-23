import { emptyBoard } from './board';
import { evaluateMove } from './move';
import { RACK_SIZE, createBag, secureRandom, shuffle, tileValue } from './tiles';
import type { GameState, LogEntry, MoveResult, Placement, Tile } from './types';

export const MIN_BAG_FOR_EXCHANGE = 5;
/** 3 passes each, both players combined */
const MAX_PASSES = 6;

/** how far past the limit a player may run before they lose */
export const OVERTIME_SECONDS = 300;
/** each player's whole-match clock: 20:00 unless the room says otherwise */
export const DEFAULT_MATCH_SECONDS = 1200;
export const MAX_MATCH_SECONDS = 3 * 60 * 60;

export interface GameOptions {
  /** seconds each player gets for the whole match, 0 for no limit */
  matchSeconds?: number;
  first?: 0 | 1;
  now?: number;
}

/** "20:00" / "5:30" / "20" (minutes) → seconds; null when it doesn't parse or is out of range */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,3})(?::([0-5]\d))?$/.exec(t);
  if (!m) return null;
  const secs = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return secs >= 1 && secs <= MAX_MATCH_SECONDS ? secs : null;
}

/** seconds → "20:00"; negative values get a leading minus */
export function formatClockSeconds(total: number): string {
  const neg = total < 0;
  const s = Math.abs(Math.round(total));
  return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Who starts, per the Junior rules: both players draw one tile and the one nearest
 * to 20 goes first. Symbol tiles all rank lowest and equal, a blank ranks highest.
 */
export function drawRank(face: string): number {
  if (face === '?') return 100;
  if (/^\d+$/.test(face)) return Number(face) + 1;
  return 0;
}

export interface StartDraw {
  /** the tile each player drew on the deciding draw */
  faces: [string, string];
  /** how many tied draws came before it */
  redraws: number;
}

/** draw a tile each from a fresh bag, redrawing on a tie; the tiles go back afterwards */
export function drawForStart(rand: () => number = secureRandom): { first: 0 | 1; draw: StartDraw } {
  for (let redraws = 0; ; redraws++) {
    const [a, b] = createBag(rand);
    const ra = drawRank(a.face);
    const rb = drawRank(b.face);
    if (ra !== rb) return { first: ra > rb ? 0 : 1, draw: { faces: [a.face, b.face], redraws } };
  }
}

export function newGame(rand: () => number = secureRandom, opts: GameOptions = {}): GameState {
  const start = opts.first === undefined ? drawForStart(rand) : null;
  const bag = createBag(rand);
  const racks: [Tile[], Tile[]] = [bag.splice(0, RACK_SIZE), bag.splice(0, RACK_SIZE)];
  return {
    board: emptyBoard(),
    bag,
    racks,
    scores: [0, 0],
    turn: opts.first ?? start!.first,
    startDraw: start?.draw,
    passes: 0,
    log: [],
    finished: false,
    firstMove: true,
    turnStartedAt: opts.now ?? Date.now(),
    matchSeconds: opts.matchSeconds ?? DEFAULT_MATCH_SECONDS,
    bank: [(opts.matchSeconds ?? DEFAULT_MATCH_SECONDS) * 1000, (opts.matchSeconds ?? DEFAULT_MATCH_SECONDS) * 1000],
    lastPlaced: [[], []],
  };
}

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);

function push(g: GameState, entry: Omit<LogEntry, 'n'>) {
  g.log.push({ n: g.log.length + 1, ...entry });
}

/** charge the player on turn for the time this turn took, so their match clock stops */
function settleClock(g: GameState, now: number) {
  if (g.matchSeconds > 0) g.bank[g.turn] -= Math.max(0, now - g.turnStartedAt);
  g.turnStartedAt = now;
}

function finish(g: GameState, now: number) {
  settleClock(g, now);
  g.finished = true;
  g.winner = g.scores[0] === g.scores[1] ? null : g.scores[0] > g.scores[1] ? 0 : 1;
}

function nextTurn(g: GameState, player: 0 | 1, now: number) {
  settleClock(g, now);
  g.turn = other(player);
}

/** milliseconds left on a player's match clock; it only runs during their own turns */
export function matchLeftMs(g: GameState, player: 0 | 1, now = Date.now()): number {
  if (g.matchSeconds <= 0) return Infinity;
  const running = !g.finished && g.turn === player ? now - g.turnStartedAt : 0;
  return g.bank[player] - running;
}

/**
 * End the game if the player on turn has run more than OVERTIME_SECONDS past
 * their match clock. Call before acting on any move and from the server's ticker.
 */
export function checkTimeout(g: GameState, now = Date.now()): boolean {
  if (g.finished) return false;
  if (matchLeftMs(g, g.turn, now) > -OVERTIME_SECONDS * 1000) return false;
  settleClock(g, now);
  g.endReason = 'timeout';
  g.finished = true;
  g.winner = other(g.turn);
  return true;
}

export function playMove(g: GameState, player: 0 | 1, placements: Placement[], now = Date.now()): MoveResult {
  if (checkTimeout(g, now)) return { ok: false, error: 'You ran out of time' };
  if (g.finished) return { ok: false, error: 'The game is over' };
  if (g.turn !== player) return { ok: false, error: 'It is not your turn' };
  const res = evaluateMove(g.board, g.racks[player], placements, g.firstMove);
  if (!res.ok) return res;

  const { move } = res;
  const used = new Set(move.placed.map((p) => p.cell.tile.id));
  for (const p of move.placed) g.board[p.r][p.c] = p.cell;
  g.racks[player] = g.racks[player].filter((t) => !used.has(t.id));
  g.racks[player].push(...g.bag.splice(0, RACK_SIZE - g.racks[player].length));
  g.scores[player] += move.score;
  g.lastPlaced[player] = move.placed.map((p) => [p.r, p.c]);
  g.passes = 0;
  g.firstMove = false;
  push(g, { player, type: 'move', equations: move.equations, score: move.score, bingo: move.bingo });
  g.lastMove = {
    n: g.log.length,
    player,
    equations: move.breakdown,
    bingo: move.bingo,
    total: move.score,
  };

  if (g.racks[player].length === 0 && g.bag.length === 0) {
    // rule 1 and 2: the other player's leftover tiles count double, for the player who finished
    g.endReason = 'rack-empty';
    const left = tileValue(g.racks[other(player)]);
    g.leftover = player === 0 ? [0, left] : [left, 0];
    g.endAdjust = player === 0 ? [left * 2, 0] : [0, left * 2];
    g.scores[player] += left * 2;
    finish(g, now);
  } else {
    nextTurn(g, player, now);
  }
  return { ok: true };
}

export function exchange(g: GameState, player: 0 | 1, tileIds: number[], now = Date.now()): MoveResult {
  if (checkTimeout(g, now)) return { ok: false, error: 'You ran out of time' };
  if (g.finished) return { ok: false, error: 'The game is over' };
  if (g.turn !== player) return { ok: false, error: 'It is not your turn' };
  if (g.bag.length < MIN_BAG_FOR_EXCHANGE) return { ok: false, error: 'Fewer than 5 tiles left in the bag' };
  const ids = new Set(tileIds);
  if (ids.size === 0 || ids.size !== tileIds.length) return { ok: false, error: 'Pick tiles to exchange' };
  const give = g.racks[player].filter((t) => ids.has(t.id));
  if (give.length !== ids.size) return { ok: false, error: 'That tile is not in your rack' };

  g.racks[player] = g.racks[player].filter((t) => !ids.has(t.id));
  g.racks[player].push(...g.bag.splice(0, give.length));
  g.bag = shuffle([...g.bag, ...give]);
  g.passes = 0;
  push(g, { player, type: 'exchange', equations: [], score: 0 });
  nextTurn(g, player, now);
  return { ok: true };
}

export function pass(g: GameState, player: 0 | 1, now = Date.now()): MoveResult {
  if (checkTimeout(g, now)) return { ok: false, error: 'You ran out of time' };
  if (g.finished) return { ok: false, error: 'The game is over' };
  if (g.turn !== player) return { ok: false, error: 'It is not your turn' };
  g.passes++;
  push(g, { player, type: 'pass', equations: [], score: 0 });
  if (g.passes >= MAX_PASSES) {
    // rule 3: three passes each in a row, and each player loses what is left on their own rack
    g.endReason = 'passes';
    g.leftover = [tileValue(g.racks[0]), tileValue(g.racks[1])];
    g.endAdjust = [-g.leftover[0], -g.leftover[1]];
    g.scores[0] += g.endAdjust[0];
    g.scores[1] += g.endAdjust[1];
    finish(g, now);
  } else {
    nextTurn(g, player, now);
  }
  return { ok: true };
}

export function resign(g: GameState, player: 0 | 1, now = Date.now()): MoveResult {
  if (g.finished) return { ok: false, error: 'The game is over' };
  push(g, { player, type: 'resign', equations: [], score: 0 });
  g.endReason = 'resign';
  settleClock(g, now);
  g.finished = true;
  g.winner = other(player);
  return { ok: true };
}

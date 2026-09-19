import { emptyBoard } from './board';
import { evaluateMove } from './move';
import { RACK_SIZE, createBag, shuffle, tileValue } from './tiles';
import type { GameState, LogEntry, MoveResult, Placement, Tile } from './types';

const MIN_BAG_FOR_EXCHANGE = 5;
/** 3 passes each, both players combined */
const MAX_PASSES = 6;

export function newGame(rand: () => number = Math.random, first?: 0 | 1): GameState {
  const bag = createBag(rand);
  const racks: [Tile[], Tile[]] = [bag.splice(0, RACK_SIZE), bag.splice(0, RACK_SIZE)];
  return {
    board: emptyBoard(),
    bag,
    racks,
    scores: [0, 0],
    turn: first ?? (rand() < 0.5 ? 0 : 1),
    passes: 0,
    log: [],
    finished: false,
    firstMove: true,
  };
}

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);

function push(g: GameState, entry: Omit<LogEntry, 'n'>) {
  g.log.push({ n: g.log.length + 1, ...entry });
}

function finish(g: GameState) {
  g.finished = true;
  g.winner = g.scores[0] === g.scores[1] ? null : g.scores[0] > g.scores[1] ? 0 : 1;
}

export function playMove(g: GameState, player: 0 | 1, placements: Placement[]): MoveResult {
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
  g.passes = 0;
  g.firstMove = false;
  push(g, { player, type: 'move', equations: move.equations, score: move.score, bingo: move.bingo });

  if (g.racks[player].length === 0 && g.bag.length === 0) {
    g.endReason = 'rack-empty';
    g.scores[player] += tileValue(g.racks[other(player)]) * 2;
    finish(g);
  } else {
    g.turn = other(player);
  }
  return { ok: true };
}

export function exchange(g: GameState, player: 0 | 1, tileIds: number[]): MoveResult {
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
  g.turn = other(player);
  return { ok: true };
}

export function pass(g: GameState, player: 0 | 1): MoveResult {
  if (g.finished) return { ok: false, error: 'The game is over' };
  if (g.turn !== player) return { ok: false, error: 'It is not your turn' };
  if (g.bag.length > 0) return { ok: false, error: 'You can only pass when the bag is empty' };
  g.passes++;
  push(g, { player, type: 'pass', equations: [], score: 0 });
  if (g.passes >= MAX_PASSES) {
    g.endReason = 'passes';
    g.scores[0] -= tileValue(g.racks[0]);
    g.scores[1] -= tileValue(g.racks[1]);
    finish(g);
  } else {
    g.turn = other(player);
  }
  return { ok: true };
}

export function resign(g: GameState, player: 0 | 1): MoveResult {
  if (g.finished) return { ok: false, error: 'The game is over' };
  push(g, { player, type: 'resign', equations: [], score: 0 });
  g.endReason = 'resign';
  g.finished = true;
  g.winner = other(player);
  return { ok: true };
}

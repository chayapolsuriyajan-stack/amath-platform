export interface Tile {
  id: number;
  /** what is printed on the tile: '0'..'16','20','+','-','+/-','×/÷','=','?' */
  face: string;
  points: number;
}

/** A tile sitting on the board together with the symbol it stands for. */
export interface Cell {
  tile: Tile;
  /** resolved symbol: '0'..'16','20','+','-','×','÷','=' */
  sym: string;
}

export type Board = (Cell | null)[][];

export interface Placement {
  tileId: number;
  row: number;
  col: number;
  /** required for '+/-', '×/÷' and blank tiles */
  sym?: string;
}

export type LogType = 'move' | 'exchange' | 'pass' | 'resign';

/** one tile's contribution, for the scoring animation */
export interface ScoredTile {
  sym: string;
  face: string;
  base: number;
  /** premium that applied to this tile, '' when none or the tile was already there */
  premium: string;
  /** base after any piece multiplier */
  value: number;
  isNew: boolean;
}

export interface EquationScore {
  text: string;
  tiles: ScoredTile[];
  /** product of the equation multipliers this move covered */
  eqMult: number;
  subtotal: number;
}

/** everything the client needs to replay a move's scoring */
export interface MoveBreakdown {
  /** matches LogEntry.n so the client can tell a new move from a re-render */
  n: number;
  player: 0 | 1;
  equations: EquationScore[];
  bingo: boolean;
  total: number;
}

export interface LogEntry {
  n: number;
  player: number;
  type: LogType;
  equations: string[];
  score: number;
  bingo?: boolean;
}

export interface ChatMessage {
  id: number;
  player: 0 | 1;
  text: string;
  at: number;
}

export type EndReason = 'rack-empty' | 'passes' | 'resign' | 'timeout';

export interface GameState {
  board: Board;
  bag: Tile[];
  racks: [Tile[], Tile[]];
  scores: [number, number];
  turn: 0 | 1;
  /** consecutive passes, both players combined */
  passes: number;
  log: LogEntry[];
  finished: boolean;
  endReason?: EndReason;
  /** null on a draw */
  winner?: 0 | 1 | null;
  firstMove: boolean;
  /** seconds allowed per turn; 0 means no limit */
  turnSeconds: number;
  /** epoch ms when the current turn started */
  turnStartedAt: number;
  lastMove?: MoveBreakdown;
}

/** What one player is allowed to see. */
export interface PublicState {
  board: Board;
  myRack: Tile[];
  opponentRackCount: number;
  bagCount: number;
  scores: [number, number];
  turn: 0 | 1;
  you: 0 | 1;
  names: [string, string];
  connected: [boolean, boolean];
  passes: number;
  log: LogEntry[];
  finished: boolean;
  endReason?: EndReason;
  winner?: 0 | 1 | null;
  firstMove: boolean;
  /** face -> how many tiles you have not seen yet (bag + opponent rack) */
  unseen: Record<string, number>;
  rematchVotes: [boolean, boolean];
  turnSeconds: number;
  turnStartedAt: number;
  /** server clock, so the client can correct for clock skew */
  serverNow: number;
  lastMove?: MoveBreakdown;
  chat: ChatMessage[];
}

export type MoveResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

export interface Tile {
  id: number;
  /** what is printed on the tile: '0'..'16','20','+','-','+/-','×','÷','×/÷','=','?' */
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

export interface LogEntry {
  n: number;
  player: number;
  type: LogType;
  equations: string[];
  score: number;
  bingo?: boolean;
}

export type EndReason = 'rack-empty' | 'passes' | 'resign';

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
}

export type MoveResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

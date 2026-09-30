import { evaluateMove } from '@amath/shared';
import type { Board, Tile } from '@amath/shared';

/** a tile the player has put down but not submitted */
export interface DraftTile {
  tile: Tile;
  row: number;
  col: number;
  sym: string;
}

export type DraftCheck = { ok: true } | { ok: false; reason: string };

/**
 * Would the tiles on the board right now be accepted as a move? This is the very same
 * check the server makes (it is shared code), so the submit button can show the answer
 * before anything is sent. The server still checks again: this is a courtesy, not the rule.
 * Null means there is nothing to judge yet.
 */
export function checkDraft(board: Board, rack: Tile[], pending: DraftTile[], firstMove: boolean): DraftCheck | null {
  if (pending.length === 0) return null;
  const res = evaluateMove(
    board,
    rack,
    pending.map((p) => ({ tileId: p.tile.id, row: p.row, col: p.col, sym: p.sym })),
    firstMove,
  );
  return res.ok ? { ok: true } : { ok: false, reason: res.error };
}

import type { DragEvent } from 'react';
import { PREMIUMS, SIZE } from '@amath/shared';
import type { Board as BoardT, DraftTile, Tile } from '@amath/shared';

export interface PendingTile {
  tile: Tile;
  row: number;
  col: number;
  sym: string;
}

const PREMIUM_LABEL: Record<string, { top: string; bottom: string; title: string }> = {
  '3E': { top: '3X', bottom: 'Equation', title: 'TRIPPLE 3X Equation' },
  '2E': { top: '2X', bottom: 'Equation', title: 'DOUBLE 2X Equation' },
  '3P': { top: '3X', bottom: 'PIECE', title: 'TRIPPLE 3X PIECE' },
  '2P': { top: '2X', bottom: 'PIECE', title: 'DOUBLE 2X PIECE' },
};

interface Props {
  board: BoardT;
  pending: PendingTile[];
  /** what the opponent is trying out on their turn */
  draft: DraftTile[];
  /** squares from each side's most recent move */
  lastMine: [number, number][];
  lastTheirs: [number, number][];
  onCellClick: (row: number, col: number) => void;
  onCellDrop: (row: number, col: number, e: DragEvent) => void;
  onPendingClick: (tileId: number) => void;
  onPendingDragStart: (tileId: number, e: DragEvent) => void;
}

const keyOf = (r: number, c: number) => r * SIZE + c;

export function Board({
  board, pending, draft, lastMine, lastTheirs, onCellClick, onCellDrop, onPendingClick, onPendingDragStart,
}: Props) {
  const pend = new Map(pending.map((p) => [keyOf(p.row, p.col), p]));
  const drafted = new Map(draft.map((d) => [keyOf(d.row, d.col), d]));
  const mine = new Set(lastMine.map(([r, c]) => keyOf(r, c)));
  const theirs = new Set(lastTheirs.map(([r, c]) => keyOf(r, c)));
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const k = keyOf(r, c);
      const placed = board[r][c];
      const p = pend.get(k);
      const d = drafted.get(k);
      const prem = PREMIUMS[r][c];
      const key = `${r}-${c}`;
      if (placed) {
        const last = theirs.has(k) ? ' last-theirs' : mine.has(k) ? ' last-mine' : '';
        cells.push(
          <div key={key} className="cell">
            <div data-tid={placed.tile.id} className={`tile on-board${placed.tile.face === '?' ? ' blank' : ''}${last}`}>
              <span>{placed.sym}</span>
              <sub>{placed.tile.points}</sub>
            </div>
          </div>,
        );
      } else if (p) {
        cells.push(
          <div key={key} className="cell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onCellDrop(r, c, e)}>
            <div
              data-tid={p.tile.id}
              className="tile pending"
              draggable
              onDragStart={(e) => onPendingDragStart(p.tile.id, e)}
              onClick={() => onPendingClick(p.tile.id)}
              title="Click to take back"
            >
              <span>{p.sym}</span>
              <sub>{p.tile.points}</sub>
            </div>
          </div>,
        );
      } else {
        const label = PREMIUM_LABEL[prem];
        cells.push(
          <div
            key={key}
            className={`cell empty prem-${prem === '★' ? 'star' : prem || 'none'}`}
            title={label?.title}
            onClick={() => onCellClick(r, c)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onCellDrop(r, c, e)}
          >
            {prem === '★' ? <span className="star">★</span> : label ? (
              <>
                <b>{label.top}</b>
                <i>{label.bottom}</i>
              </>
            ) : null}
            {d ? (
              <div className="tile draft" title="Your opponent is trying this">
                <span>{d.sym}</span>
                <sub>{d.points}</sub>
              </div>
            ) : null}
          </div>,
        );
      }
    }
  }
  return <div className="board">{cells}</div>;
}

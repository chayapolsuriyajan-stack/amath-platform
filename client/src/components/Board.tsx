import type { DragEvent } from 'react';
import { PREMIUMS, SIZE } from '@amath/shared';
import type { Board as BoardT, Tile } from '@amath/shared';

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

export const symText = (s: string) => s;

interface Props {
  board: BoardT;
  pending: PendingTile[];
  onCellClick: (row: number, col: number) => void;
  onCellDrop: (row: number, col: number, e: DragEvent) => void;
  onPendingClick: (tileId: number) => void;
  onPendingDragStart: (tileId: number, e: DragEvent) => void;
}

export function Board({ board, pending, onCellClick, onCellDrop, onPendingClick, onPendingDragStart }: Props) {
  const pend = new Map(pending.map((p) => [p.row * SIZE + p.col, p]));
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const placed = board[r][c];
      const p = pend.get(r * SIZE + c);
      const prem = PREMIUMS[r][c];
      const key = `${r}-${c}`;
      if (placed) {
        cells.push(
          <div key={key} className="cell">
            <div className={`tile on-board${placed.tile.face === '?' ? ' blank' : ''}`}>
              <span>{symText(placed.sym)}</span>
              <sub>{placed.tile.points}</sub>
            </div>
          </div>,
        );
      } else if (p) {
        cells.push(
          <div key={key} className="cell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onCellDrop(r, c, e)}>
            <div
              className="tile pending"
              draggable
              onDragStart={(e) => onPendingDragStart(p.tile.id, e)}
              onClick={() => onPendingClick(p.tile.id)}
              title="Click to take back"
            >
              <span>{symText(p.sym)}</span>
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
          </div>,
        );
      }
    }
  }
  return <div className="board">{cells}</div>;
}

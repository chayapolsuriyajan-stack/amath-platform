import { useState, type ReactNode } from 'react';
import { MULTI_DIGITS, OPERATORS, SINGLE_DIGITS, allowedSyms } from '@amath/shared';
import type { PublicState, Tile } from '@amath/shared';

function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog">
        {children}
      </div>
    </div>
  );
}

export function ChoiceDialog({ tile, onPick, onCancel }: { tile: Tile; onPick: (sym: string) => void; onCancel: () => void }) {
  const opts = allowedSyms(tile.face);
  const blank = tile.face === '?';
  return (
    <Modal onClose={onCancel}>
      <h2>{blank ? 'Blank tile stands for…' : `Use ${tile.face} as…`}</h2>
      {blank ? (
        <>
          <div className="choice-row">{SINGLE_DIGITS.map((s) => <button key={s} onClick={() => onPick(s)}>{s}</button>)}</div>
          <div className="choice-row">{MULTI_DIGITS.map((s) => <button key={s} onClick={() => onPick(s)}>{s}</button>)}</div>
          <div className="choice-row">{[...OPERATORS, '='].map((s) => <button key={s} onClick={() => onPick(s)}>{s}</button>)}</div>
        </>
      ) : (
        <div className="choice-row">{opts.map((s) => <button key={s} className="big" onClick={() => onPick(s)}>{s}</button>)}</div>
      )}
      <button className="ghost" onClick={onCancel}>Cancel</button>
    </Modal>
  );
}

export function ExchangeDialog({ rack, onConfirm, onCancel }: { rack: Tile[]; onConfirm: (ids: number[]) => void; onCancel: () => void }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Modal onClose={onCancel}>
      <h2>Exchange tiles</h2>
      <p>Pick the tiles to swap with the bag. This uses your turn.</p>
      <div className="choice-row">
        {rack.map((t) => (
          <button key={t.id} className={`tile-btn${sel.has(t.id) ? ' on' : ''}`} onClick={() => toggle(t.id)}>
            {t.face}
            <sub>{t.points}</sub>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button disabled={sel.size === 0} onClick={() => onConfirm([...sel])}>Exchange {sel.size || ''}</button>
      </div>
    </Modal>
  );
}

const REASON: Record<string, string> = {
  'rack-empty': 'A player used all their tiles. The other player’s remaining tiles were counted double for the winner.',
  passes: 'Three passes each in a row. Each player lost the value of their remaining tiles.',
  resign: 'A player resigned.',
};

export function GameOverDialog({
  state, onRematch, onHome, onHistory, onClose,
}: { state: PublicState; onRematch: () => void; onHome: () => void; onHistory: () => void; onClose: () => void }) {
  const me = state.you;
  const opp = me === 0 ? 1 : 0;
  const title = state.winner == null ? 'Draw' : state.winner === me ? 'You win!' : `${state.names[opp]} wins`;
  const voted = state.rematchVotes[me];
  const oppVoted = state.rematchVotes[opp];
  return (
    <Modal onClose={onClose}>
      <h2>{title}</h2>
      <div className="final-scores">
        <div><span>{state.names[me]} (you)</span><b>{state.scores[me]}</b></div>
        <div><span>{state.names[opp]}</span><b>{state.scores[opp]}</b></div>
      </div>
      <p className="muted">{state.endReason ? REASON[state.endReason] : ''}</p>
      <p className="muted">Saved to your match history on this device.</p>
      <div className="modal-actions">
        <button className="ghost" onClick={onHome}>Home</button>
        <button className="ghost" onClick={onHistory}>History</button>
        <button className="ghost" onClick={onClose}>View board</button>
        <button disabled={voted || !state.connected[opp]} onClick={onRematch}>
          {voted ? 'Waiting for opponent…' : oppVoted ? 'Accept rematch' : 'Rematch'}
        </button>
      </div>
    </Modal>
  );
}

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

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** why the game ended, and what the ending did to each score, in plain words */
function endingLines(state: PublicState): string[] {
  const me = state.you;
  const who = (p: 0 | 1) => (p === me ? 'You' : state.names[p]);
  const loser = state.winner === 0 ? 1 : 0;
  const left = state.leftover;
  const adj = state.endAdjust;
  switch (state.endReason) {
    case 'rack-empty': {
      const fin: 0 | 1 = adj && adj[1] > adj[0] ? 1 : 0;
      const other: 0 | 1 = fin === 0 ? 1 : 0;
      const lines = [`${who(fin)} used every tile with the bag empty.`];
      if (left && adj) {
        lines.push(
          left[other] > 0
            ? `${who(other)} had ${left[other]} points left, doubled to ${signed(adj[fin])} for ${fin === me ? 'you' : state.names[fin]}.`
            : `${who(other)} had nothing but blanks left, so no bonus.`,
        );
      }
      return lines;
    }
    case 'passes': {
      const lines = ['Three passes each in a row, so nobody could continue.'];
      if (left && adj) lines.push(`Tiles left: ${who(0)} ${signed(adj[0])}, ${who(1)} ${signed(adj[1])}.`);
      return lines;
    }
    case 'resign':
      return [`${who(loser)} resigned.`];
    case 'timeout':
      return [`${who(loser)} went 5 minutes past zero on the match clock.`];
    default:
      return [];
  }
}

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
      {endingLines(state).map((line) => (
        <p key={line} className="muted">{line}</p>
      ))}
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { clearHistory, deleteMatch, loadHistory, type HistoryMove, type MatchRecord } from '../storage/history';

const REASON: Record<string, string> = { 'rack-empty': 'Tiles used up', passes: 'Passes', resign: 'Resigned', timeout: 'Out of time' };

function moveText(m: HistoryMove): string {
  if (m.type === 'pass') return 'passed';
  if (m.type === 'exchange') return 'exchanged tiles';
  if (m.type === 'resign') return 'resigned';
  return `${m.equations.join(' · ')} (+${m.score}${m.bingo ? ', all 8 tiles' : ''})`;
}

export function History() {
  const [list, setList] = useState<MatchRecord[]>(loadHistory);
  const [open, setOpen] = useState<string | null>(null);
  const wins = list.filter((r) => r.result === 'win').length;
  const losses = list.filter((r) => r.result === 'loss').length;
  const draws = list.length - wins - losses;

  return (
    <div className="page">
      <article className="doc">
        <h1>Match history</h1>
        <p className="muted">Saved in this browser only. Clearing site data removes it.</p>
        <p className="totals">
          <span className="win">{wins} won</span> <span className="loss">{losses} lost</span> <span>{draws} drawn</span>
        </p>

        {list.length === 0 ? <p>No finished games yet.</p> : null}
        <ul className="history">
          {list.map((r) => (
            <li key={r.id} className={r.result}>
              <button className="row" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="badge">{r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Draw'}</span>
                <span className="who">{r.you} vs {r.opponent}</span>
                <span className="pts">{r.yourScore} – {r.opponentScore}</span>
                <span className="when">{new Date(r.date).toLocaleString()}</span>
              </button>
              {open === r.id ? (
                <div className="detail">
                  <p className="muted">Room {r.code}{r.endReason ? ` · ${REASON[r.endReason]}` : ''}</p>
                  <ol>
                    {r.moves.map((m) => (
                      <li key={m.n}><b>{m.mine ? 'You' : m.who}</b> {moveText(m)}</li>
                    ))}
                  </ol>
                  <button className="link" onClick={() => { deleteMatch(r.id); setList(loadHistory()); }}>Delete this game</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="doc-actions">
          <Link className="btn" to="/">Back</Link>
          {list.length ? (
            <button className="ghost" onClick={() => { if (window.confirm('Delete all saved games?')) { clearHistory(); setList([]); } }}>Clear history</button>
          ) : null}
        </p>
      </article>
    </div>
  );
}

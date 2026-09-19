import { FACE_ORDER, TILE_SET } from '@amath/shared';
import type { LogEntry, PublicState } from '@amath/shared';

export function TileTracker({ unseen }: { unseen: PublicState['unseen'] }) {
  return (
    <section className="tracker" aria-label="Tiles not yet seen">
      {FACE_ORDER.map((f) => (
        <div key={f} className={`tracker-item${unseen[f] === 0 ? ' zero' : ''}`} title={`${TILE_SET[f][0]} in the full set`}>
          <div className="tracker-face">{f === '?' ? '?' : f}</div>
          <span>{unseen[f]}</span>
        </div>
      ))}
    </section>
  );
}

export function ScoreCard({ label, name, score, active, sub }: { label: string; name: string; score: number; active: boolean; sub?: string }) {
  return (
    <div className={`score-card${active ? ' active' : ''}`}>
      <div className="score-top" />
      <div className="score-num">{score}</div>
      <div className="score-label" title={name}>
        {label}
      </div>
      {sub ? <div className="score-sub">{sub}</div> : null}
    </div>
  );
}

export function describeLog(l: LogEntry): string {
  if (l.type === 'pass') return 'passed';
  if (l.type === 'exchange') return 'exchanged tiles';
  if (l.type === 'resign') return 'resigned';
  return `${l.equations.join('  ·  ')}  (+${l.score}${l.bingo ? ', all 8 tiles!' : ''})`;
}

export function MoveLog({ log, names }: { log: LogEntry[]; names: [string, string] }) {
  if (log.length === 0) return <div className="move-log empty">No moves yet</div>;
  return (
    <ol className="move-log" reversed>
      {log.slice().reverse().map((l) => (
        <li key={l.n}>
          <b>{names[l.player]}</b> {describeLog(l)}
        </li>
      ))}
    </ol>
  );
}

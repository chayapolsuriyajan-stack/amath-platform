import { useState } from 'react';
import { ComboScreen } from '../components/ComboScreen';
import type { MoveBreakdown, ScoredTile } from '@amath/shared';

/** Dev-only sandbox for tuning the scoring animation. Not part of the built app. */
const tile = (sym: string, base: number, premium = '', isNew = true): ScoredTile => ({
  sym, face: sym, base, premium, value: premium === '3P' || premium === '★' ? base * 3 : premium === '2P' ? base * 2 : base, isNew,
});

const CASES: Record<string, MoveBreakdown> = {
  small: {
    n: 1, player: 0, bingo: false, total: 8,
    equations: [{ text: '1+2=3', tiles: [tile('1', 1), tile('+', 2), tile('2', 1), tile('=', 1), tile('3', 1, '★')], eqMult: 1, subtotal: 8 }],
  },
  multiplier: {
    n: 2, player: 0, bingo: false, total: 42,
    equations: [{
      text: '15-7=8',
      tiles: [tile('15', 4, '3P'), tile('-', 2), tile('7', 2, '2P'), tile('=', 1), tile('8', 2)],
      eqMult: 3, subtotal: 42,
    }],
  },
  monster: {
    n: 3, player: 0, bingo: true, total: 146,
    equations: [
      {
        text: '22-15+7=14',
        tiles: [tile('2', 1), tile('2', 1), tile('-', 2, '★'), tile('15', 4, '3P'), tile('+', 1), tile('7', 2), tile('=', 1, '2P'), tile('14', 4)],
        eqMult: 3, subtotal: 81,
      },
      {
        text: '3×4=12',
        tiles: [tile('3', 1), tile('×', 1), tile('4', 2, '2P'), tile('=', 1, '', false), tile('12', 3)],
        eqMult: 2, subtotal: 25,
      },
    ],
  },
};

export function ComboDemo() {
  const [key, setKey] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [speed, setSpeed] = useState(1);
  return (
    <div className="page center">
      <div className="panel">
        <h2>Combo screen preview</h2>
        <p className="muted">Development only — this route is not in the production build.</p>
        {Object.keys(CASES).map((k) => (
          <button key={k} onClick={() => { setKey(k); setRun((n) => n + 1); }}>{k}</button>
        ))}
        <div className="seg">
          {[1, 2, 4].map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}x</button>
          ))}
        </div>
      </div>
      {key ? (
        <ComboScreen key={`${key}-${run}`} move={CASES[key]} who="Ann" mine speed={speed} onDone={() => setKey(null)} />
      ) : null}
    </div>
  );
}

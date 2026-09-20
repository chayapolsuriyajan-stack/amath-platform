import { useEffect, useMemo, useRef, useState } from 'react';
import type { MoveBreakdown } from '@amath/shared';

/** one beat of the animation */
type Step =
  | { kind: 'equation'; eq: number }
  | { kind: 'tile'; eq: number; tile: number }
  | { kind: 'mult'; eq: number }
  | { kind: 'subtotal'; eq: number }
  | { kind: 'bingo' }
  | { kind: 'total' }
  | { kind: 'done' };

const PREMIUM_LABEL: Record<string, string> = {
  '2P': '×2 PIECE',
  '3P': '×3 PIECE',
  '★': '×3 STAR',
  '2E': '×2 EQUATION',
  '3E': '×3 EQUATION',
};

/** how loud the finale gets */
function tierOf(total: number): { name: string; shout: string } {
  if (total >= 120) return { name: 'cosmic', shout: 'UNREAL!!!' };
  if (total >= 80) return { name: 'insane', shout: 'INSANE!' };
  if (total >= 50) return { name: 'huge', shout: 'HUGE!' };
  if (total >= 30) return { name: 'big', shout: 'BIG!' };
  if (total >= 15) return { name: 'nice', shout: 'NICE' };
  return { name: 'plain', shout: '' };
}

function buildSteps(b: MoveBreakdown): { step: Step; at: number }[] {
  const out: { step: Step; at: number }[] = [];
  let t = 0;
  const tileCount = b.equations.reduce((n, e) => n + e.tiles.length, 0);
  // keep long equations from dragging
  const per = tileCount > 14 ? 70 : tileCount > 9 ? 95 : 130;
  b.equations.forEach((eq, i) => {
    out.push({ step: { kind: 'equation', eq: i }, at: t });
    t += 420;
    eq.tiles.forEach((_, j) => {
      out.push({ step: { kind: 'tile', eq: i, tile: j }, at: t });
      t += per;
    });
    t += 120;
    if (eq.eqMult > 1) {
      out.push({ step: { kind: 'mult', eq: i }, at: t });
      t += 620;
    }
    out.push({ step: { kind: 'subtotal', eq: i }, at: t });
    t += 520;
  });
  if (b.bingo) {
    out.push({ step: { kind: 'bingo' }, at: t });
    t += 780;
  }
  out.push({ step: { kind: 'total' }, at: t });
  t += 1500;
  out.push({ step: { kind: 'done' }, at: t });
  return out;
}

function useCountUp(target: number, ms: number, run: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    // a timer rather than animation frames: those are paused in a hidden tab and
    // in some embedded views, which would leave the figure sitting at zero
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      // ease out so it races up then settles
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 16);
    const backstop = window.setTimeout(() => setN(target), ms + 80);
    return () => {
      clearInterval(id);
      clearTimeout(backstop);
    };
  }, [target, ms, run]);
  return run ? n : 0;
}

function Particles({ n, kind }: { n: number; kind: string }) {
  const bits = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => ({
        i,
        a: (360 / n) * i + Math.random() * 18,
        d: 90 + Math.random() * 140,
        s: 5 + Math.random() * 9,
        delay: Math.random() * 90,
      })),
    [n],
  );
  return (
    <div className={`particles ${kind}`} aria-hidden>
      {bits.map((b) => (
        <span
          key={b.i}
          style={{
            // angle and distance drive the CSS keyframes
            ['--a' as string]: `${b.a}deg`,
            ['--d' as string]: `${b.d}px`,
            ['--s' as string]: `${b.s}px`,
            animationDelay: `${b.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function ComboScreen({ move, who, mine, onDone }: { move: MoveBreakdown; who: string; mine: boolean; onDone: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'equation', eq: 0 });
  const [shake, setShake] = useState('');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const timeline = buildSteps(move);
    const timers = timeline.map(({ step: s, at }) =>
      window.setTimeout(() => {
        if (s.kind === 'done') doneRef.current();
        else setStep(s);
        if (s.kind === 'mult') {
          setShake('shake-hard');
          window.setTimeout(() => setShake(''), 420);
        }
        if (s.kind === 'total' || s.kind === 'bingo') {
          setShake('shake-boom');
          window.setTimeout(() => setShake(''), 700);
        }
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [move]);

  const eqIndex = 'eq' in step ? step.eq : move.equations.length - 1;
  const eq = move.equations[Math.min(eqIndex, move.equations.length - 1)];
  const shownTiles = step.kind === 'tile' ? step.tile + 1 : step.kind === 'equation' ? 0 : eq.tiles.length;
  const chips = eq.tiles.slice(0, shownTiles).reduce((n, t) => n + t.value, 0);

  const showMult = step.kind === 'mult' || step.kind === 'subtotal' || step.kind === 'bingo' || step.kind === 'total';
  const multLive = step.kind === 'mult';
  const showSub = step.kind === 'subtotal' || step.kind === 'bingo' || step.kind === 'total';
  const showBingo = move.bingo && (step.kind === 'bingo' || step.kind === 'total');
  const finale = step.kind === 'total';

  // everything scored before this equation, so the running figure keeps climbing
  const before = move.equations.slice(0, eqIndex).reduce((n, e) => n + e.subtotal, 0);
  const tier = tierOf(move.total);
  const total = useCountUp(move.total, 900, finale);
  const sub = useCountUp(eq.subtotal, 380, showSub);

  return (
    <div className={`combo ${shake} ${finale ? `finale tier-${tier.name}` : ''}`} aria-live="polite">
      <div className="combo-inner">
        <div className="combo-who">{mine ? 'YOU SCORED' : `${who} SCORED`}</div>

        <div className="combo-eq" key={`eq-${eqIndex}`}>
          {eq.text}
          {move.equations.length > 1 ? <em>{eqIndex + 1}/{move.equations.length}</em> : null}
        </div>

        <div className="chip-row">
          {eq.tiles.map((t, i) => {
            const on = i < shownTiles;
            const hot = step.kind === 'tile' && step.tile === i;
            return (
              <span key={i} className={`chip${on ? ' on' : ''}${hot ? ' hot' : ''}${t.premium ? ' prem' : ''}${t.isNew ? '' : ' old'}`}>
                <b>{t.sym}</b>
                <i>+{t.value}</i>
                {hot && t.premium ? <u>{PREMIUM_LABEL[t.premium]}</u> : null}
              </span>
            );
          })}
        </div>

        <div className="combo-math">
          <span className="chips" key={`c-${chips}`}>{chips}</span>
          {showMult && eq.eqMult > 1 ? (
            <>
              <span className="times">×</span>
              <span className={`mult${multLive ? ' slam' : ''}`}>
                {eq.eqMult}
                {multLive ? <Particles n={14} kind="mult" /> : null}
              </span>
            </>
          ) : null}
          {showSub ? <span className="eqto">=</span> : null}
          {showSub ? <span className="sub" key={`s-${eqIndex}`}>{sub}</span> : null}
        </div>

        {before > 0 && !finale ? <div className="running">earlier equations +{before}</div> : null}

        {showBingo ? (
          <div className="bingo-banner">
            ALL 8 TILES <b>+40</b>
            <Particles n={18} kind="bingo" />
          </div>
        ) : null}

        {finale ? (
          <div className="combo-total">
            <span className="label">TOTAL</span>
            <span className="num">+{total}</span>
            {tier.shout ? <span className="shout">{tier.shout}</span> : null}
            <Particles n={tier.name === 'plain' ? 10 : 26} kind="total" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

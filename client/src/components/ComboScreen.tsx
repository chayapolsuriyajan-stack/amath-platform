import { useEffect, useMemo, useRef, useState } from 'react';
import type { MoveBreakdown } from '@amath/shared';
import { sfx } from '../sound/sfx';
import { buildSteps, paceFor, punchFor, type Step } from './comboTiming';

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

export function ComboScreen({
  move, who, mine, speed = 1, onDone,
}: { move: MoveBreakdown; who: string; mine: boolean; speed?: number; onDone: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'equation', eq: 0 });
  const [shake, setShake] = useState('');
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // pauses between beats stretch a lot at the slow speeds; the hits themselves only somewhat
  const pace = paceFor(speed);
  const punch = punchFor(speed);

  // a slow sequence can be cut short: Escape always, Space or Enter unless you are typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape' || (!typing && (e.key === ' ' || e.key === 'Enter'))) {
        e.preventDefault();
        doneRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const timeline = buildSteps(move, pace);
    const timers = timeline.map(({ step: s, at }) =>
      window.setTimeout(() => {
        if (s.kind === 'done') doneRef.current();
        else setStep(s);
        // each beat of the animation has its own sound
        if (s.kind === 'tile') sfx.chip(s.tile);
        else if (s.kind === 'mult') sfx.mult();
        else if (s.kind === 'subtotal') sfx.subtotal();
        else if (s.kind === 'bingo') sfx.bingo();
        else if (s.kind === 'total') sfx.total(move.total);
        if (s.kind === 'mult') {
          setShake('shake-hard');
          window.setTimeout(() => setShake(''), 420 * punch);
        }
        if (s.kind === 'total' || s.kind === 'bingo') {
          setShake('shake-boom');
          window.setTimeout(() => setShake(''), 700 * punch);
        }
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [move, pace, punch]);

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
  const total = useCountUp(move.total, 900 * punch, finale);
  const sub = useCountUp(eq.subtotal, 380 * punch, showSub);

  return (
    <div
      className={`combo ${shake} ${finale ? `finale tier-${tier.name}` : ''}`}
      style={{ ['--fxd' as string]: String(punch) }}
      aria-live="polite"
    >
      <button type="button" className="combo-skip" onClick={() => doneRef.current()} title="Skip (Esc or Space)">
        Skip ›
      </button>
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

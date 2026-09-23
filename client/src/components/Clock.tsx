import { useEffect, useState } from 'react';
import { OVERTIME_SECONDS } from '@amath/shared';

/** the server's current time, ticking four times a second while `running` */
export function useServerNow(offset: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  return now + offset;
}

const two = (n: number) => String(n).padStart(2, '0');

export function formatClock(ms: number): string {
  const neg = ms < 0;
  const total = Math.ceil(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(total / 60)}:${two(total % 60)}`;
}

function ClockFace() {
  return (
    <svg className="clock-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6.5V12l4 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A player's match clock. `ms` is null when the room has no time limit.
 * It counts down, warns under a minute, and goes red once it passes zero,
 * where it also shows how long is left before that player loses.
 */
export function MatchClock({ ms, active }: { ms: number | null; active: boolean }) {
  if (ms === null) return <div className="big-clock off"><ClockFace /><span className="t">--:--</span></div>;
  const over = ms < 0;
  const urgent = !over && ms < 60_000;
  return (
    <div className={`big-clock${active ? ' active' : ''}${over ? ' over' : ''}${urgent ? ' urgent' : ''}`}>
      <ClockFace />
      <span className="t">{formatClock(ms)}</span>
      {over ? <span className="lose-in">lose in {formatClock(Math.max(0, OVERTIME_SECONDS * 1000 + ms))}</span> : null}
    </div>
  );
}

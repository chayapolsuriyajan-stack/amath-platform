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

/** one clock line: counts down, turns orange near zero, red and "lose in" past it */
function Line({ label, ms, active }: { label: string; ms: number; active: boolean }) {
  const over = ms < 0;
  const urgent = !over && active && ms < 30_000;
  return (
    <span className={`clock${active ? ' active' : ''}${over ? ' over' : ''}${urgent ? ' urgent' : ''}`}>
      <em>{label}</em> {formatClock(ms)}
      {over ? <b>lose in {formatClock(Math.max(0, OVERTIME_SECONDS * 1000 + ms))}</b> : null}
    </span>
  );
}

/**
 * A player's clocks. `turn` is only passed while it is their turn; `match` is
 * their whole-game allowance and is shown all the time, frozen between turns.
 */
export function Clocks({ turn, match, active }: { turn: number | null; match: number | null; active: boolean }) {
  if (turn === null && match === null) return <span className="clock off">no time limit</span>;
  return (
    <span className="clocks">
      {match !== null ? <Line label="Match" ms={match} active={active} /> : null}
      {turn !== null ? <Line label="Turn" ms={turn} active={active} /> : null}
    </span>
  );
}

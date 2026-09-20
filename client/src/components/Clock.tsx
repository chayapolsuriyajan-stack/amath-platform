import { useEffect, useState } from 'react';
import { OVERTIME_SECONDS } from '@amath/shared';

/** ms left on the running turn, negative once the player is into overtime */
export function useTurnClock(turnSeconds: number, turnStartedAt: number, offset: number, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || turnSeconds <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running, turnSeconds, turnStartedAt]);
  if (turnSeconds <= 0) return null;
  return turnSeconds * 1000 - (now + offset - turnStartedAt);
}

const two = (n: number) => String(n).padStart(2, '0');

export function formatClock(ms: number): string {
  const neg = ms < 0;
  const total = Math.ceil(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(total / 60)}:${two(total % 60)}`;
}

export function Clock({ ms, active }: { ms: number | null; active: boolean }) {
  if (ms === null) return <span className="clock off">no limit</span>;
  const over = ms < 0;
  // once past the limit, show how long is left before the game is lost
  const graceLeft = OVERTIME_SECONDS * 1000 + ms;
  const urgent = !over && ms < 30_000;
  return (
    <span className={`clock${active ? ' active' : ''}${over ? ' over' : ''}${urgent ? ' urgent' : ''}`}>
      {formatClock(ms)}
      {over ? <b>lose in {formatClock(Math.max(0, graceLeft))}</b> : null}
    </span>
  );
}

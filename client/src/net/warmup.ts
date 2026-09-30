/**
 * Render's free plan puts the game server to sleep after 15 quiet minutes, and
 * the first visit afterwards waits about a minute for it to start. These are the
 * numbers and wording behind the progress card shown during that wait.
 */

/** how long a cold start usually takes */
export const WARMUP_EXPECTED_MS = 60_000;
/** past this the wait is longer than usual and the player gets a way out */
export const WARMUP_SLOW_MS = 90_000;
/** a check that finishes this fast is not worth showing anything for */
export const WARMUP_QUIET_MS = 1_200;

/**
 * How far along the wake-up probably is, 0 to 0.95. We cannot see inside the
 * server, so this is an estimate: quick at first, slowing as it nears the end,
 * and never full until the server actually answers.
 */
export function warmupProgress(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs);
  return 0.95 * (1 - Math.exp(-t / (WARMUP_EXPECTED_MS * 0.45)));
}

/** m:ss */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface WarmupText {
  headline: string;
  detail: string;
}

/**
 * honest wording for each point in the wait; no invented "stages".
 * `start` is a cold start when opening the site, `reconnect` is losing the server mid-game.
 */
export function warmupText(elapsedMs: number, mode: 'start' | 'reconnect' = 'start'): WarmupText {
  if (mode === 'reconnect') {
    if (elapsedMs < WARMUP_EXPECTED_MS) {
      return {
        headline: 'Trying to reach the game server',
        detail: 'It may be restarting, which usually takes up to a minute. We keep trying automatically.',
      };
    }
    if (elapsedMs < WARMUP_SLOW_MS) return { headline: 'Still trying', detail: 'Taking longer than usual. Hang on…' };
    return { headline: 'Still can’t reach the server', detail: 'Your connection or the server may be down. Keep waiting or try again.' };
  }
  if (elapsedMs < WARMUP_EXPECTED_MS) {
    const left = Math.max(5, Math.ceil((WARMUP_EXPECTED_MS - elapsedMs) / 5000) * 5000 / 1000);
    return {
      headline: 'Waking up the game server',
      detail: `It sleeps when nobody has played for a while. About ${left} seconds to go.`,
    };
  }
  if (elapsedMs < WARMUP_SLOW_MS) {
    return { headline: 'Almost there', detail: 'Taking a little longer than usual. Hang on…' };
  }
  return {
    headline: 'Still waiting for the server',
    detail: 'This is taking longer than it should. You can keep waiting or try again.',
  };
}

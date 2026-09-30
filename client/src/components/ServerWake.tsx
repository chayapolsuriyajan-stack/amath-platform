import { useLayoutEffect, useRef, useState } from 'react';
import { forceReady, restartWarmup, type ServerStatus } from '../net/serverStatus';
import { formatElapsed, warmupText } from '../net/warmup';
import { reconnectNow } from '../net/socket';

/**
 * The card shown while the game server wakes up: a progress bar that fills as the
 * wait goes on, the time so far, and a way out if it takes far too long. When the
 * server finally answers it turns green for a moment, so the change is noticed.
 */
export function ServerWake({ status, mode = 'start' }: { status: ServerStatus; mode?: 'start' | 'reconnect' }) {
  const [justReady, setJustReady] = useState(false);
  const wasWaking = useRef(false);

  // a layout effect, so the green card replaces the waking one without a blank frame between
  useLayoutEffect(() => {
    if (status.waking) wasWaking.current = true;
    if (status.ready && wasWaking.current) {
      wasWaking.current = false;
      setJustReady(true);
      const t = window.setTimeout(() => setJustReady(false), 2600);
      return () => clearTimeout(t);
    }
  }, [status.waking, status.ready]);

  if (justReady) {
    return (
      <div className="wake ready" role="status">
        <div className="wake-top"><span className="wake-check" aria-hidden>✓</span><b>Server is ready</b></div>
      </div>
    );
  }
  if (!status.waking) return null;

  const pct = Math.round(status.progress * 100);
  const text = warmupText(status.elapsed, mode);
  return (
    <div className={`wake${status.slow ? ' slow' : ''}`} role="status" aria-live="polite">
      <div className="wake-top">
        <span className="wake-spinner" aria-hidden />
        <b>{text.headline}</b>
        <span className="wake-time">{formatElapsed(status.elapsed)}</span>
      </div>
      <div className="wake-bar" role="progressbar" aria-label="Server wake-up progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="wake-detail">{text.detail}</p>
      {status.slow ? (
        <div className="wake-actions">
          <button type="button" onClick={restartWarmup}>Try again</button>
          <button type="button" className="ghost" onClick={forceReady}>Continue anyway</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shown over a game when the connection drops. The game stays visible underneath;
 * it reconnects on its own, and this says so, with a button to hurry it along.
 */
export function ConnectionBanner({ attempt, status }: { attempt: number; status: ServerStatus }) {
  return (
    <div className="conn-banner" role="alert">
      <div className="conn-row">
        <span className="wake-spinner" aria-hidden />
        <span className="conn-text">
          <b>Connection lost</b>
          <span>{attempt > 1 ? ` · reconnecting (try ${attempt})` : ' · reconnecting…'}</span>
        </span>
        <button type="button" className="ghost" onClick={reconnectNow}>Reconnect now</button>
      </div>
      {status.waking ? <ServerWake status={status} mode="reconnect" /> : null}
      <p className="conn-note">
        {status.waking
          ? status.persistent
            ? 'Your game is saved. It will be waiting for you when the server is back, and the time it was down will not count against you.'
            : 'If the server restarted, open games cannot be recovered. We will tell you as soon as we know.'
          : 'Your game is kept on the server. If it is your turn, your clock keeps running while you reconnect.'}
      </p>
    </div>
  );
}

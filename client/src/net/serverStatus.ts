import { useEffect, useState, useSyncExternalStore } from 'react';
import { SERVER_URL } from './config';
import { WARMUP_QUIET_MS, WARMUP_SLOW_MS, warmupProgress } from './warmup';

/**
 * Is the game server awake? On the free plan it sleeps when idle, and a request
 * to a sleeping server is answered by Render's own "waking up" page (which has no
 * CORS header, so we cannot read it) or hangs. So "we could read a proper answer
 * from /health" means the real server is up.
 */
interface Snapshot {
  ready: boolean;
  /** when the current wait began */
  since: number;
  /** does the server save games, so they survive a restart? null until we have heard from it */
  persistent: boolean | null;
}

/** what /health says, or null when it is not the game server's answer */
export function parseHealth(body: unknown): { persistent: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { ok?: unknown; persistent?: unknown };
  return b.ok === true ? { persistent: b.persistent === true } : null;
}

let snap: Snapshot = { ready: false, since: Date.now(), persistent: null };
let running = false;
let started = false;
const listeners = new Set<() => void>();

const set = (next: Snapshot) => {
  snap = next;
  listeners.forEach((l) => l());
};

async function ping(): Promise<{ persistent: boolean } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(`${SERVER_URL}/health`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return null;
    return parseHealth(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loop() {
  running = true;
  while (!snap.ready) {
    const health = await ping();
    if (health) {
      set({ ready: true, since: snap.since, persistent: health.persistent });
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  running = false;
}

/** begin checking; safe to call from anywhere, any number of times */
export function startWarmup() {
  if (started && (running || snap.ready)) return;
  started = true;
  if (!running) void loop();
}

/** the server answered, or a socket connected: no need to keep asking */
export function markServerReady() {
  if (!snap.ready) set({ ...snap, ready: true });
}

/** a connection failed: the server may have gone to sleep or restarted, so check again */
export function markServerDown() {
  if (snap.ready) set({ ...snap, ready: false, since: Date.now() });
  if (!running) void loop();
}

/** start the wait over (and check right away), for a "try again" button after a long wait */
export function restartWarmup() {
  if (snap.ready) return;
  set({ ...snap, ready: false, since: Date.now() });
}

/** let the player carry on even though the check could not confirm the server (a blocked request, say) */
export function forceReady() {
  markServerReady();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => snap;

export interface ServerStatus {
  ready: boolean;
  /** true once the wait is long enough to be worth showing */
  waking: boolean;
  /** longer than a cold start should take */
  slow: boolean;
  /** true if the server saves games so a restart does not lose them; null until known */
  persistent: boolean | null;
  elapsed: number;
  /** 0 to 1 */
  progress: number;
}

export function useServerStatus(): ServerStatus {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.ready) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [s.ready, s.since]);
  const elapsed = s.ready ? 0 : Math.max(0, now - s.since);
  return {
    ready: s.ready,
    waking: !s.ready && elapsed > WARMUP_QUIET_MS,
    slow: !s.ready && elapsed > WARMUP_SLOW_MS,
    persistent: s.persistent,
    elapsed,
    progress: s.ready ? 1 : warmupProgress(elapsed),
  };
}

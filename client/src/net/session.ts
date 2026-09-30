/**
 * Remembering which seat you hold in which room, so you can get back into a game
 * after closing the tab, opening the link in a new window, or restarting the browser.
 *
 * The seat token is the only thing that proves a seat is yours, so it is kept
 * in two places:
 *   sessionStorage  per tab: a reload goes straight back in, and two tabs of one
 *                   browser can still be two different players
 *   localStorage    per browser: survives a closed tab, offered as a choice
 * Every read and write is guarded, because storage can be blocked or full.
 */

export interface SavedSeat {
  token: string;
  name: string;
  /** epoch ms when this seat was last used */
  at: number;
}

/** a game left this long ago is not worth offering a way back into */
export const SEAT_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ROOMS_KEPT = 8;
const PREFIX = 'amath.seats.';

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const localStore = (): Store | null => safe(() => (typeof localStorage === 'undefined' ? null : localStorage), null);

function read(store: Store, code: string, now: number): SavedSeat[] {
  const raw = safe(() => store.getItem(PREFIX + code), null);
  if (!raw) return [];
  const list = safe(() => JSON.parse(raw) as unknown, []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is SavedSeat =>
      !!s && typeof s.token === 'string' && s.token.length > 0 && typeof s.name === 'string' && typeof s.at === 'number' && now - s.at < SEAT_TTL_MS,
  );
}

/** remember a seat (or refresh it). A room keeps at most two: one per player. */
export function saveSeat(code: string, token: string, name: string, store: Store | null = localStore(), now = Date.now()) {
  if (!store) return;
  const others = read(store, code, now).filter((s) => s.token !== token);
  const next = [...others, { token, name, at: now }].slice(-2);
  safe(() => store.setItem(PREFIX + code, JSON.stringify(next)), undefined);
  prune(store, now);
}

/** the seats saved for a room, most recently used first */
export function savedSeats(code: string, store: Store | null = localStore(), now = Date.now()): SavedSeat[] {
  if (!store) return [];
  return read(store, code, now).sort((a, b) => b.at - a.at);
}

/** forget one seat, or every seat in the room when no token is given */
export function forgetSeat(code: string, token?: string, store: Store | null = localStore(), now = Date.now()) {
  if (!store) return;
  const keep = token ? read(store, code, now).filter((s) => s.token !== token) : [];
  if (keep.length === 0) safe(() => store.removeItem(PREFIX + code), undefined);
  else safe(() => store.setItem(PREFIX + code, JSON.stringify(keep)), undefined);
}

export interface Resumable {
  code: string;
  name: string;
  at: number;
}

/** the game most recently played in, if it is recent enough to be worth resuming */
export function lastGame(store: Store | null = localStore(), now = Date.now()): Resumable | null {
  if (!store) return null;
  let best: Resumable | null = null;
  const n = safe(() => store.length, 0);
  for (let i = 0; i < n; i++) {
    const key = safe(() => store.key(i), null);
    if (!key || !key.startsWith(PREFIX)) continue;
    const code = key.slice(PREFIX.length);
    for (const s of read(store, code, now)) if (!best || s.at > best.at) best = { code, name: s.name, at: s.at };
  }
  return best;
}

/** drop expired rooms and keep the list short */
function prune(store: Store, now: number) {
  const rooms: { key: string; at: number }[] = [];
  const n = safe(() => store.length, 0);
  for (let i = 0; i < n; i++) {
    const key = safe(() => store.key(i), null);
    if (!key || !key.startsWith(PREFIX)) continue;
    const seats = read(store, key.slice(PREFIX.length), now);
    if (seats.length === 0) rooms.push({ key, at: 0 });
    else rooms.push({ key, at: Math.max(...seats.map((s) => s.at)) });
  }
  rooms.sort((a, b) => b.at - a.at);
  for (const r of rooms.filter((r, i) => r.at === 0 || i >= MAX_ROOMS_KEPT)) safe(() => store.removeItem(r.key), undefined);
}

const drawKey = (code: string) => `amath.draw.${code}`;

/** the opening draw this tab has already shown, so a reload does not replay it */
export function drawSeen(code: string): string | null {
  return safe(() => sessionStorage.getItem(drawKey(code)), null);
}
export function markDrawSeen(code: string, key: string) {
  safe(() => sessionStorage.setItem(drawKey(code), key), undefined);
}

/** "12 min ago", for the resume card */
export function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
}

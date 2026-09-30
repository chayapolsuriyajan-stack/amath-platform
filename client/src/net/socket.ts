import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@amath/shared';
import { SERVER_URL } from './config';
import { saveSeat } from './session';
import { markServerDown, markServerReady } from './serverStatus';

export const socket: Socket<ServerToClient, ClientToServer> = io(SERVER_URL || undefined, { autoConnect: false });

// development only: lets a test drop the connection to see the reconnect flow
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __amathSocket: unknown }).__amathSocket = socket;

// keep the "is the server awake" status honest from what the connection itself reports
socket.on('connect', markServerReady);
socket.on('connect_error', markServerDown);

export function ensureConnected() {
  if (!socket.connected && !socket.active) socket.connect();
}

// Phones freeze background tabs and drop their connections; on coming back, reconnect
// straight away instead of waiting for the next automatic retry.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket.connected && socket.active) reconnectNow();
  });
  window.addEventListener('online', () => {
    if (!socket.connected && socket.active) reconnectNow();
  });
}

/** skip the wait before the next automatic attempt */
export function reconnectNow() {
  markServerDown();
  socket.disconnect();
  socket.connect();
}

/** promise wrapper around an acknowledgement-style emit */
export function call<T>(event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => {
    ensureConnected();
    const send = () => (socket as Socket).emit(event, ...args, resolve);
    if (socket.connected) return send();
    // a sleeping server can take a minute to start, so wait longer than a normal connection
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve({ ok: false, error: 'Cannot reach the game server' } as T);
    }, 90_000);
    const onConnect = () => {
      clearTimeout(timer);
      send();
    };
    socket.once('connect', onConnect);
  });
}

export interface SocketState {
  connected: boolean;
  /** how many automatic reconnect attempts have been made since the connection dropped */
  attempt: number;
}

/** the live connection state, for the "reconnecting" banner */
export function useSocketState(): SocketState {
  const [state, setState] = useState<SocketState>({ connected: socket.connected, attempt: 0 });
  useEffect(() => {
    const up = () => setState({ connected: true, attempt: 0 });
    const down = () => setState((s) => ({ connected: false, attempt: s.attempt }));
    const retry = (n: number) => setState({ connected: false, attempt: n });
    socket.on('connect', up);
    socket.on('disconnect', down);
    socket.io.on('reconnect_attempt', retry);
    setState({ connected: socket.connected, attempt: 0 });
    return () => {
      socket.off('connect', up);
      socket.off('disconnect', down);
      socket.io.off('reconnect_attempt', retry);
    };
  }, []);
  return state;
}

const sessionKey = (code: string) => `amath.session.${code}`;

/** the seat token for this tab; a reload finds it here and goes straight back in */
export function getToken(code: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(code));
  } catch {
    return null;
  }
}

/** remember the seat for this tab, and for this browser so a closed tab can be resumed */
export function setToken(code: string, token: string, name = '') {
  try {
    sessionStorage.setItem(sessionKey(code), token);
  } catch {
    /* rejoin after a refresh will not work from this tab, but localStorage below may still help */
  }
  saveSeat(code, token, name);
}

/** this tab no longer holds the seat (it was lost or was never ours) */
export function clearToken(code: string) {
  try {
    sessionStorage.removeItem(sessionKey(code));
  } catch {
    /* nothing to clear */
  }
}

const NAME_KEY = 'amath.name';
export function getName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function setName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

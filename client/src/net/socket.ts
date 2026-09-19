import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@amath/shared';

// Same origin by default (the Node server serves the built client, and Vite proxies in dev).
// Set VITE_SERVER_URL when the client is hosted separately from the game server.
const URL = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;

export const socket: Socket<ServerToClient, ClientToServer> = io(URL as string, { autoConnect: false });

export function ensureConnected() {
  if (!socket.connected && !socket.active) socket.connect();
}

/** promise wrapper around an acknowledgement-style emit */
export function call<T>(event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => {
    ensureConnected();
    const send = () => (socket as Socket).emit(event, ...args, resolve);
    if (socket.connected) return send();
    // give up with a readable error when the game server cannot be reached
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve({ ok: false, error: 'Cannot reach the game server' } as T);
    }, 8000);
    const onConnect = () => {
      clearTimeout(timer);
      send();
    };
    socket.once('connect', onConnect);
  });
}

const sessionKey = (code: string) => `amath.session.${code}`;

/** the seat token lives in sessionStorage so two tabs can be two different players */
export function getToken(code: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(code));
  } catch {
    return null;
  }
}
export function setToken(code: string, token: string) {
  try {
    sessionStorage.setItem(sessionKey(code), token);
  } catch {
    /* rejoin after a refresh will not work, but the current game still does */
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

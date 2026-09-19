import type { Placement, PublicState } from './types';

export const ROOM_CODE_LENGTH = 6;
export const isRoomCode = (s: string) => /^\d{6}$/.test(s);

export type Ack = { ok: true } | { ok: false; error: string };
export type JoinAck = { ok: true; code: string; token: string } | { ok: false; error: string };

export interface ClientToServer {
  'room:create': (a: { name: string }, cb: (r: JoinAck) => void) => void;
  'room:join': (a: { code: string; name: string }, cb: (r: JoinAck) => void) => void;
  'room:rejoin': (a: { code: string; token: string }, cb: (r: Ack) => void) => void;
  'game:move': (a: { placements: Placement[] }, cb: (r: Ack) => void) => void;
  'game:exchange': (a: { tileIds: number[] }, cb: (r: Ack) => void) => void;
  'game:pass': (cb: (r: Ack) => void) => void;
  'game:resign': (cb: (r: Ack) => void) => void;
  'game:rematch': () => void;
}

export interface RoomUpdate {
  code: string;
  status: 'waiting' | 'playing' | 'finished';
  /** null while waiting for the second player */
  state: PublicState | null;
}

export interface ServerToClient {
  'room:update': (a: RoomUpdate) => void;
}

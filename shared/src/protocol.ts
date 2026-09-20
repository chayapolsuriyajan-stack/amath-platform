import type { Placement, PublicState } from './types';

export const ROOM_CODE_LENGTH = 6;
export const isRoomCode = (s: string) => /^\d{6}$/.test(s);

export const MAX_CHAT_LENGTH = 200;
/** how many messages a room keeps and sends to each player */
export const CHAT_HISTORY = 50;

export type Ack = { ok: true } | { ok: false; error: string };
export type JoinAck = { ok: true; code: string; token: string } | { ok: false; error: string };

export interface RoomSettings {
  /** seconds per turn, 0 for no limit */
  turnSeconds: number;
}

export interface ClientToServer {
  'room:create': (a: { name: string; turnSeconds?: number }, cb: (r: JoinAck) => void) => void;
  'room:join': (a: { code: string; name: string }, cb: (r: JoinAck) => void) => void;
  'room:rejoin': (a: { code: string; token: string }, cb: (r: Ack) => void) => void;
  'game:move': (a: { placements: Placement[] }, cb: (r: Ack) => void) => void;
  'game:exchange': (a: { tileIds: number[] }, cb: (r: Ack) => void) => void;
  'game:pass': (cb: (r: Ack) => void) => void;
  'game:resign': (cb: (r: Ack) => void) => void;
  'game:rematch': () => void;
  'chat:send': (a: { text: string }, cb: (r: Ack) => void) => void;
}

export interface RoomUpdate {
  code: string;
  status: 'waiting' | 'playing' | 'finished';
  /** null while waiting for the second player */
  state: PublicState | null;
  settings: RoomSettings;
}

export interface ServerToClient {
  'room:update': (a: RoomUpdate) => void;
}

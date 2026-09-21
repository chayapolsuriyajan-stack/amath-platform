import type { Placement, PublicState } from './types';

export const ROOM_CODE_LENGTH = 6;
export const isRoomCode = (s: string) => /^\d{6}$/.test(s);

export const MAX_CHAT_LENGTH = 200;

/** the only stickers the server will relay */
export const STICKERS = ['happy', 'sad', 'worried', 'angry', 'thumbs', 'gg'] as const;
export type Sticker = (typeof STICKERS)[number];
export const isSticker = (s: unknown): s is Sticker => typeof s === 'string' && (STICKERS as readonly string[]).includes(s);
/** how many messages a room keeps and sends to each player */
export const CHAT_HISTORY = 50;

export type Ack = { ok: true } | { ok: false; error: string };
export type JoinAck = { ok: true; code: string; token: string } | { ok: false; error: string };

export interface RoomSettings {
  /** seconds per turn, 0 for no limit */
  turnSeconds: number;
  /** seconds per player for the whole match, 0 for no limit */
  matchSeconds: number;
}

export interface ClientToServer {
  'room:create': (a: { name: string; turnSeconds?: number; matchSeconds?: number }, cb: (r: JoinAck) => void) => void;
  'room:join': (a: { code: string; name: string }, cb: (r: JoinAck) => void) => void;
  'room:rejoin': (a: { code: string; token: string }, cb: (r: Ack) => void) => void;
  'game:move': (a: { placements: Placement[] }, cb: (r: Ack) => void) => void;
  'game:exchange': (a: { tileIds: number[] }, cb: (r: Ack) => void) => void;
  'game:pass': (cb: (r: Ack) => void) => void;
  'game:resign': (cb: (r: Ack) => void) => void;
  'game:rematch': () => void;
  'chat:send': (a: { text: string }, cb: (r: Ack) => void) => void;
  /** fire and forget: the float animation needs no reply */
  'chat:sticker': (a: { sticker: Sticker }) => void;
  /** the tiles the player on turn has put down but not submitted, shown to the opponent */
  'game:draft': (a: { placements: Placement[] }) => void;
}

export interface StickerEvent {
  id: number;
  player: 0 | 1;
  sticker: Sticker;
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
  'room:sticker': (a: StickerEvent) => void;
}

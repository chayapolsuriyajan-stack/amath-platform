import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CHAT_HISTORY, MAX_MATCH_SECONDS, SIZE, TILE_SET, isBotLevel,
} from '@amath/shared';
import type { BotLevel, ChatMessage, GameState, RoomSettings, Tile } from '@amath/shared';

/** what is kept of a room: everything needed to carry on, nothing about connections */
export interface StoredRoom {
  v: 1;
  savedAt: number;
  code: string;
  seats: { name: string; tokenHash: string; bot?: BotLevel }[];
  game: GameState | null;
  settings: RoomSettings;
  chat: ChatMessage[];
  nextChatId: number;
  rematch: [boolean, boolean];
  lastActive: number;
  botSaidGG?: boolean;
}

/**
 * Seat tokens are only ever kept as a hash. The token is what proves a seat is
 * yours, so a copy of the database must not be enough to take someone's seat.
 */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** does this token match this stored hash (compared without leaking how much matched) */
export function tokenMatches(token: string, tokenHash: string): boolean {
  if (tokenHash === '') return false;
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(tokenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** how long a room is kept after its last change */
export const TTL = {
  /** a game in progress: long enough to pick up the next day */
  playing: 24 * 60 * 60,
  /** made but the second player has not come yet */
  waiting: 2 * 60 * 60,
  /** just finished: long enough to see the result after a restart */
  finished: 10 * 60,
};

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSeat = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

function validTile(t: unknown): t is Tile {
  if (!t || typeof t !== 'object') return false;
  const x = t as Record<string, unknown>;
  return isInt(x.id) && typeof x.face === 'string' && x.face in TILE_SET && isNum(x.points);
}

function validCell(c: unknown): boolean {
  if (c === null) return true;
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  return validTile(x.tile) && typeof x.sym === 'string';
}

const pairOfNumbers = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isNum);
const pairOfCells = (v: unknown) =>
  Array.isArray(v) && v.length === 2 && v.every((l) => Array.isArray(l) && l.every((p) => Array.isArray(p) && p.length === 2 && p.every(isInt)));

/** enough checking that a damaged or old record cannot crash the server or break the rules */
function validGame(g: unknown): g is GameState {
  if (!g || typeof g !== 'object') return false;
  const x = g as Record<string, unknown>;
  const board = x.board;
  if (!Array.isArray(board) || board.length !== SIZE) return false;
  if (!board.every((row) => Array.isArray(row) && row.length === SIZE && row.every(validCell))) return false;
  if (!Array.isArray(x.bag) || !x.bag.every(validTile)) return false;
  const racks = x.racks;
  if (!Array.isArray(racks) || racks.length !== 2 || !racks.every((r) => Array.isArray(r) && r.every(validTile))) return false;
  return (
    pairOfNumbers(x.scores) &&
    isSeat(x.turn) &&
    isInt(x.passes) &&
    Array.isArray(x.log) &&
    typeof x.finished === 'boolean' &&
    typeof x.firstMove === 'boolean' &&
    isNum(x.turnStartedAt) &&
    isInt(x.matchSeconds) &&
    pairOfNumbers(x.bank) &&
    pairOfCells(x.lastPlaced)
  );
}

function validChat(c: unknown): c is ChatMessage {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  return isInt(x.id) && isSeat(x.player) && typeof x.text === 'string' && isNum(x.at);
}

/** the parsed record, or null (with the reason) when it cannot be trusted */
export function parseStoredRoom(json: string): { room: StoredRoom } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'not valid JSON' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const x = raw as Record<string, unknown>;
  if (x.v !== 1) return { error: `unknown version ${String(x.v)}` };
  if (typeof x.code !== 'string' || !/^\d{6}$/.test(x.code)) return { error: 'bad room code' };
  if (!isNum(x.savedAt) || !isNum(x.lastActive)) return { error: 'bad timestamps' };

  const seats = x.seats;
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > 2) return { error: 'bad seats' };
  for (const s of seats) {
    const seat = s as Record<string, unknown> | null;
    const okHash = typeof seat?.tokenHash === 'string' && /^([0-9a-f]{64})?$/.test(seat.tokenHash);
    if (!seat || typeof seat.name !== 'string' || !okHash) return { error: 'bad seat' };
    if (seat.bot !== undefined && !isBotLevel(seat.bot)) return { error: 'bad bot level' };
  }

  const settings = x.settings as Record<string, unknown> | null;
  if (!settings || !isInt(settings.matchSeconds) || settings.matchSeconds < 0 || settings.matchSeconds > MAX_MATCH_SECONDS) {
    return { error: 'bad settings' };
  }
  if (x.game !== null && !validGame(x.game)) return { error: 'bad game' };
  if (!Array.isArray(x.chat) || !x.chat.every(validChat)) return { error: 'bad chat' };
  if (!isInt(x.nextChatId)) return { error: 'bad chat counter' };
  if (!Array.isArray(x.rematch) || x.rematch.length !== 2 || !x.rematch.every((b) => typeof b === 'boolean')) return { error: 'bad rematch votes' };

  return {
    room: {
      v: 1,
      savedAt: x.savedAt as number,
      code: x.code,
      seats: (seats as StoredRoom['seats']).map((s) => ({ name: s.name, tokenHash: s.tokenHash, ...(s.bot ? { bot: s.bot } : {}) })),
      game: x.game as GameState | null,
      settings: { matchSeconds: settings.matchSeconds as number },
      chat: (x.chat as ChatMessage[]).slice(-CHAT_HISTORY),
      nextChatId: x.nextChatId as number,
      rematch: x.rematch as [boolean, boolean],
      lastActive: x.lastActive as number,
      botSaidGG: x.botSaidGG === true,
    },
  };
}

/** the moment a record was loaded, which is when the game's clock picks up again */
export function resumeClock(game: GameState, savedAt: number, now: number): void {
  if (game.finished) return;
  // Time the server was down is not anyone's thinking time. A turn resumes with as much
  // elapsed as it had when it was last saved (nothing, for a turn that had just started).
  const elapsed = Math.max(0, savedAt - game.turnStartedAt);
  game.turnStartedAt = now - elapsed;
}

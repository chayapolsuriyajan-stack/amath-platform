import { randomBytes, randomInt } from 'node:crypto';
import {
  CHAT_HISTORY, DEFAULT_MATCH_SECONDS, FACE_ORDER, MAX_CHAT_LENGTH, MAX_MATCH_SECONDS, RACK_SIZE, SIZE, TILE_SET,
  allowedSyms, checkTimeout, exchange, inBounds, isBotLevel, isRoomCode, isSticker, newGame, pass, playMove, resign,
} from '@amath/shared';
import type { BotLevel } from '@amath/shared';
import type {
  Ack, ChatMessage, DraftTile, GameState, JoinAck, Placement, PublicState, RoomSettings, RoomUpdate, StickerEvent,
} from '@amath/shared';

interface Seat {
  name: string;
  token: string;
  socketId: string | null;
  /** set when this seat is played by the computer */
  bot?: BotLevel;
}

export interface Room {
  code: string;
  seats: Seat[];
  game: GameState | null;
  settings: RoomSettings;
  chat: ChatMessage[];
  nextChatId: number;
  lastChatAt: number;
  rematch: [boolean, boolean];
  lastActive: number;
  finishedAt: number | null;
  /** what each player has on the board but not yet submitted */
  drafts: [DraftTile[], DraftTile[]];
  nextStickerId: number;
  /** recent sticker times per seat, for rate limiting */
  stickerTimes: [number[], number[]];
  /** the bot already said "gg" for the game that just ended */
  botSaidGG?: boolean;
}

const IDLE_MS = 30 * 60 * 1000;
const FINISHED_MS = 10 * 60 * 1000;
const CHAT_MIN_GAP_MS = 400;
/** a hard cap so a flood of room creations cannot exhaust memory */
export const MAX_ROOMS = 5000;
/** stickers can be spammed on purpose, but not without limit */
const STICKER_BURST = 8;
const STICKER_WINDOW_MS = 2000;

const cleanName = (n: unknown, fallback: string) => {
  const s = typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || fallback;
};

/** whole seconds from 0 (no match clock) up to three hours; anything else falls back to 20:00 */
const cleanMatchSeconds = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_MATCH_SECONDS ? v : DEFAULT_MATCH_SECONDS;

export class Rooms {
  readonly rooms = new Map<string, Room>();

  private newCode(): string {
    for (;;) {
      const code = String(randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
  }

  create(name: unknown, matchSeconds: unknown, socketId: string, bot?: unknown): JoinAck {
    if (this.rooms.size >= MAX_ROOMS) return { ok: false, error: 'The server is busy, try again in a minute' };
    if (bot !== undefined && bot !== null && !isBotLevel(bot)) return { ok: false, error: 'Unknown bot level' };
    const code = this.newCode();
    const token = randomBytes(16).toString('hex');
    const seats: Seat[] = [{ name: cleanName(name, 'Player 1'), token, socketId }];
    // against the computer the game starts straight away; its seat has no token, so nobody can take it over
    if (bot) seats.push({ name: `Bot · ${bot[0].toUpperCase()}${bot.slice(1)}`, token: '', socketId: null, bot });
    const settings = { matchSeconds: cleanMatchSeconds(matchSeconds) };
    this.rooms.set(code, {
      code,
      seats,
      game: bot ? newGame(undefined, { matchSeconds: settings.matchSeconds }) : null,
      settings,
      chat: [],
      nextChatId: 1,
      lastChatAt: 0,
      rematch: [false, false],
      lastActive: Date.now(),
      finishedAt: null,
      drafts: [[], []],
      nextStickerId: 1,
      stickerTimes: [[], []],
    });
    return { ok: true, code, token };
  }

  join(code: unknown, name: unknown, socketId: string): JoinAck {
    if (typeof code !== 'string' || !isRoomCode(code)) return { ok: false, error: 'Room codes have 6 digits' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.seats.length >= 2) return { ok: false, error: 'This room is full' };
    const token = randomBytes(16).toString('hex');
    room.seats.push({ name: cleanName(name, 'Player 2'), token, socketId });
    room.game = newGame(undefined, { matchSeconds: room.settings.matchSeconds });
    room.lastActive = Date.now();
    return { ok: true, code, token };
  }

  /** returns the seat index when the token matches */
  rejoin(code: unknown, token: unknown, socketId: string): { ok: true; room: Room; seat: 0 | 1 } | { ok: false; error: string } {
    if (typeof code !== 'string' || typeof token !== 'string') return { ok: false, error: 'Bad request' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'Room not found' };
    const seat = room.seats.findIndex((s) => !s.bot && s.token !== '' && s.token === token);
    if (seat < 0) return { ok: false, error: 'Seat not found' };
    room.seats[seat].socketId = socketId;
    room.lastActive = Date.now();
    return { ok: true, room, seat: seat as 0 | 1 };
  }

  disconnect(socketId: string): Room | null {
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((s) => s.socketId === socketId);
      if (seat) {
        seat.socketId = null;
        return room;
      }
    }
    return null;
  }

  private touch(room: Room, res?: Ack) {
    // a finished action ends the turn, so nobody should still see a half-built move
    if (res?.ok) room.drafts = [[], []];
    room.lastActive = Date.now();
    if (room.game?.finished && room.finishedAt === null) room.finishedAt = Date.now();
    if (room.game && !room.game.finished) room.finishedAt = null;
  }

  move(room: Room, seat: 0 | 1, placements: Placement[]): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    if (!Array.isArray(placements) || placements.length > 8) return { ok: false, error: 'Bad move' };
    const res = playMove(room.game, seat, placements);
    this.touch(room, res);
    return res;
  }

  exchange(room: Room, seat: 0 | 1, tileIds: number[]): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    if (!Array.isArray(tileIds)) return { ok: false, error: 'Bad request' };
    const res = exchange(room.game, seat, tileIds);
    this.touch(room, res);
    return res;
  }

  pass(room: Room, seat: 0 | 1): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    const res = pass(room.game, seat);
    this.touch(room, res);
    return res;
  }

  resign(room: Room, seat: 0 | 1): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    const res = resign(room.game, seat);
    this.touch(room, res);
    return res;
  }

  chat(room: Room, seat: 0 | 1, text: unknown): Ack {
    if (typeof text !== 'string') return { ok: false, error: 'Bad message' };
    // strip control characters, collapse runs of whitespace
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!clean) return { ok: false, error: 'Type a message' };
    const now = Date.now();
    if (now - room.lastChatAt < CHAT_MIN_GAP_MS) return { ok: false, error: 'Slow down a little' };
    room.lastChatAt = now;
    room.chat.push({ id: room.nextChatId++, player: seat, text: clean, at: now });
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
    room.lastActive = now;
    return { ok: true };
  }

  /**
   * Record the tiles the player on turn is trying out. Every tile must come from
   * their own rack and sit on an empty square, so the relay cannot be used to
   * plant fake tiles on the opponent's screen. Returns true when it changed.
   */
  draft(room: Room, seat: 0 | 1, placements: unknown): boolean {
    const g = room.game;
    if (!g || g.finished || g.turn !== seat) return false;
    if (!Array.isArray(placements) || placements.length > RACK_SIZE) return false;
    const rack = g.racks[seat];
    const tiles = new Set<number>();
    const squares = new Set<number>();
    const out: DraftTile[] = [];
    for (const p of placements as Partial<Placement>[]) {
      if (!p || typeof p !== 'object') return false;
      const tile = rack.find((t) => t.id === p.tileId);
      if (!tile || tiles.has(tile.id)) return false;
      const { row, col } = p;
      if (!Number.isInteger(row) || !Number.isInteger(col) || !inBounds(row!, col!) || g.board[row!][col!]) return false;
      const key = row! * SIZE + col!;
      if (squares.has(key)) return false;
      const options = allowedSyms(tile.face);
      const sym = options.length === 1 ? options[0] : typeof p.sym === 'string' && options.includes(p.sym) ? p.sym : null;
      if (!sym) return false;
      tiles.add(tile.id);
      squares.add(key);
      // tile ids stay private: the opponent only learns what is on the board
      out.push({ row: row!, col: col!, face: tile.face, sym, points: tile.points });
    }
    room.drafts[seat] = out;
    return true;
  }

  sticker(room: Room, seat: 0 | 1, sticker: unknown, now = Date.now()): StickerEvent | null {
    if (!isSticker(sticker)) return null;
    const times = room.stickerTimes[seat].filter((t) => now - t < STICKER_WINDOW_MS);
    if (times.length >= STICKER_BURST) {
      room.stickerTimes[seat] = times;
      return null;
    }
    times.push(now);
    room.stickerTimes[seat] = times;
    room.lastActive = now;
    return { id: room.nextStickerId++, player: seat, sticker };
  }

  /** returns true when both players asked for a rematch and a fresh game started */
  rematch(room: Room, seat: 0 | 1): boolean {
    if (!room.game?.finished) return false;
    room.rematch[seat] = true;
    // the computer is always up for another game
    room.seats.forEach((s, i) => { if (s.bot) room.rematch[i as 0 | 1] = true; });
    room.lastActive = Date.now();
    if (room.rematch[0] && room.rematch[1]) {
      room.botSaidGG = false;
      room.game = newGame(undefined, { matchSeconds: room.settings.matchSeconds });
      room.drafts = [[], []];
      room.rematch = [false, false];
      room.finishedAt = null;
      return true;
    }
    return false;
  }

  /** rooms whose game just ended because a player ran out of overtime */
  timedOut(now = Date.now()): Room[] {
    const hit: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.game && !room.game.finished && checkTimeout(room.game, now)) {
        room.finishedAt = now;
        room.drafts = [[], []];
        hit.push(room);
      }
    }
    return hit;
  }

  sweep(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActive > IDLE_MS;
      const done = room.finishedAt !== null && now - room.finishedAt > FINISHED_MS;
      if (idle || done) this.rooms.delete(code);
    }
  }

  update(room: Room, seat: 0 | 1): RoomUpdate {
    const g = room.game;
    if (!g) return { code: room.code, status: 'waiting', state: null, settings: room.settings };
    const unseen: Record<string, number> = {};
    for (const f of FACE_ORDER) unseen[f] = TILE_SET[f][0];
    for (const row of g.board) for (const c of row) if (c) unseen[c.tile.face]--;
    for (const t of g.racks[seat]) unseen[t.face]--;
    const state: PublicState = {
      board: g.board,
      myRack: g.racks[seat],
      opponentRackCount: g.racks[seat === 0 ? 1 : 0].length,
      bagCount: g.bag.length,
      scores: g.scores,
      turn: g.turn,
      you: seat,
      names: [room.seats[0].name, room.seats[1]?.name ?? 'Player 2'],
      connected: [0, 1].map((i) => !!room.seats[i]?.bot || (room.seats[i]?.socketId ?? null) !== null) as [boolean, boolean],
      passes: g.passes,
      log: g.log,
      finished: g.finished,
      endReason: g.endReason,
      winner: g.winner,
      firstMove: g.firstMove,
      unseen,
      rematchVotes: room.rematch,
      startDraw: g.startDraw,
      opponentBot: room.seats[seat === 0 ? 1 : 0]?.bot,
      turnStartedAt: g.turnStartedAt,
      matchSeconds: g.matchSeconds,
      bank: g.bank,
      serverNow: Date.now(),
      lastMove: g.lastMove,
      lastPlaced: g.lastPlaced,
      leftover: g.leftover,
      endAdjust: g.endAdjust,
      opponentDraft: room.drafts[seat === 0 ? 1 : 0],
      chat: room.chat,
    };
    return { code: room.code, status: g.finished ? 'finished' : 'playing', state, settings: room.settings };
  }
}

/** the seat the computer plays in this room, if any */
export const botSeat = (room: Room): 0 | 1 | null => {
  const i = room.seats.findIndex((s) => s.bot);
  return i < 0 ? null : (i as 0 | 1);
};

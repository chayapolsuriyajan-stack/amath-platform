import { randomBytes, randomInt } from 'node:crypto';
import {
  FACE_ORDER, TILE_SET, exchange, isRoomCode, newGame, pass, playMove, resign,
} from '@amath/shared';
import type { Ack, GameState, JoinAck, Placement, PublicState, RoomUpdate } from '@amath/shared';

interface Seat {
  name: string;
  token: string;
  socketId: string | null;
}

export interface Room {
  code: string;
  seats: Seat[];
  game: GameState | null;
  rematch: [boolean, boolean];
  lastActive: number;
  finishedAt: number | null;
}

const IDLE_MS = 30 * 60 * 1000;
const FINISHED_MS = 10 * 60 * 1000;

const cleanName = (n: unknown, fallback: string) => {
  const s = typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || fallback;
};

export class Rooms {
  readonly rooms = new Map<string, Room>();

  private newCode(): string {
    for (;;) {
      const code = String(randomInt(100000, 1000000));
      if (!this.rooms.has(code)) return code;
    }
  }

  create(name: unknown, socketId: string): JoinAck {
    const code = this.newCode();
    const token = randomBytes(16).toString('hex');
    this.rooms.set(code, {
      code,
      seats: [{ name: cleanName(name, 'Player 1'), token, socketId }],
      game: null,
      rematch: [false, false],
      lastActive: Date.now(),
      finishedAt: null,
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
    room.game = newGame();
    room.lastActive = Date.now();
    return { ok: true, code, token };
  }

  /** returns the seat index when the token matches */
  rejoin(code: unknown, token: unknown, socketId: string): { ok: true; room: Room; seat: 0 | 1 } | { ok: false; error: string } {
    if (typeof code !== 'string' || typeof token !== 'string') return { ok: false, error: 'Bad request' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'Room not found' };
    const seat = room.seats.findIndex((s) => s.token === token);
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

  private touch(room: Room) {
    room.lastActive = Date.now();
    if (room.game?.finished && room.finishedAt === null) room.finishedAt = Date.now();
    if (room.game && !room.game.finished) room.finishedAt = null;
  }

  move(room: Room, seat: 0 | 1, placements: Placement[]): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    if (!Array.isArray(placements) || placements.length > 8) return { ok: false, error: 'Bad move' };
    const res = playMove(room.game, seat, placements);
    this.touch(room);
    return res;
  }

  exchange(room: Room, seat: 0 | 1, tileIds: number[]): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    if (!Array.isArray(tileIds)) return { ok: false, error: 'Bad request' };
    const res = exchange(room.game, seat, tileIds);
    this.touch(room);
    return res;
  }

  pass(room: Room, seat: 0 | 1): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    const res = pass(room.game, seat);
    this.touch(room);
    return res;
  }

  resign(room: Room, seat: 0 | 1): Ack {
    if (!room.game) return { ok: false, error: 'Waiting for an opponent' };
    const res = resign(room.game, seat);
    this.touch(room);
    return res;
  }

  /** returns true when both players asked for a rematch and a fresh game started */
  rematch(room: Room, seat: 0 | 1): boolean {
    if (!room.game?.finished) return false;
    room.rematch[seat] = true;
    room.lastActive = Date.now();
    if (room.rematch[0] && room.rematch[1]) {
      room.game = newGame();
      room.rematch = [false, false];
      room.finishedAt = null;
      return true;
    }
    return false;
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
    if (!g) return { code: room.code, status: 'waiting', state: null };
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
      names: [room.seats[0].name, room.seats[1].name],
      connected: [room.seats[0].socketId !== null, room.seats[1].socketId !== null],
      passes: g.passes,
      log: g.log,
      finished: g.finished,
      endReason: g.endReason,
      winner: g.winner,
      firstMove: g.firstMove,
      unseen,
      rematchVotes: room.rematch,
    };
    return { code: room.code, status: g.finished ? 'finished' : 'playing', state };
  }
}

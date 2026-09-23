import {
  LEVELS, MIN_BAG_FOR_EXCHANGE, chooseExchange, pickMove, searchMoves, secureRandom,
} from '@amath/shared';
import type { Candidate, GameState, StickerEvent } from '@amath/shared';
import { botSeat, type Room, type Rooms } from './rooms';

export interface BotHooks {
  /** send the room's state to both players */
  broadcast(room: Room): void;
  /** send the room's state to one seat */
  sendTo(room: Room, seat: 0 | 1): void;
  sticker(room: Room, ev: StickerEvent): void;
}

export interface BotOptions {
  /** multiplies every pause; tests use a small value */
  delayScale?: number;
  /** searches allowed to run at the same time, across all rooms */
  maxConcurrent?: number;
}

/** yields to the event loop between slices, so one search never holds up other games */
const defer = (fn: () => void) => (typeof setImmediate === 'function' ? setImmediate(fn) : setTimeout(fn, 0));
const SLICE_MS = 15;

function runSearch(gen: Generator<Candidate | null>, budgetMs: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const end = Date.now() + budgetMs;
  return new Promise((resolve) => {
    const step = () => {
      const sliceEnd = Math.min(end, Date.now() + SLICE_MS);
      for (;;) {
        const r = gen.next();
        if (r.done) return resolve(out);
        if (r.value) out.push(r.value);
        if (Date.now() >= sliceEnd) break;
      }
      if (Date.now() >= end) return resolve(out);
      defer(step);
    };
    step();
  });
}

/** Plays the computer's turns in any room that has a bot seat. */
export class BotDriver {
  private busy = new Set<string>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private scale: number;
  private maxConcurrent: number;

  constructor(private rooms: Rooms, private hooks: BotHooks, opts: BotOptions = {}) {
    this.scale = opts.delayScale ?? 1;
    this.maxConcurrent = opts.maxConcurrent ?? 2;
  }

  /** call after anything changes in a room: starts the bot's turn if it is due */
  poke(room: Room) {
    const seat = botSeat(room);
    const g = room.game;
    if (seat === null || !g) return;
    if (g.finished) {
      this.sayGG(room, seat);
      return;
    }
    if (g.turn !== seat || this.busy.has(room.code)) return;
    this.busy.add(room.code);
    void this.play(room, g, seat)
      .catch((err) => console.error('bot turn failed', err))
      .finally(() => {
        this.busy.delete(room.code);
        // if something changed while it was busy, look again
        if (this.rooms.rooms.get(room.code) === room) this.poke(room);
      });
  }

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms * this.scale));
  }

  /** still the same game, still the bot's turn, room not cleaned up */
  private live(room: Room, g: GameState, seat: 0 | 1) {
    return this.rooms.rooms.get(room.code) === room && room.game === g && !g.finished && g.turn === seat;
  }

  private async acquire(): Promise<() => void> {
    if (this.running >= this.maxConcurrent) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    return () => {
      this.running--;
      this.waiting.shift()?.();
    };
  }

  private async play(room: Room, g: GameState, seat: 0 | 1) {
    const level = room.seats[seat].bot!;
    const cfg = LEVELS[level];
    const [lo, hi] = cfg.thinkMs;
    const started = Date.now();

    const release = await this.acquire();
    let cands: Candidate[];
    try {
      if (!this.live(room, g, seat)) return;
      cands = await runSearch(searchMoves(g.board, g.racks[seat], g.firstMove, cfg.limits, secureRandom), cfg.budgetMs);
    } finally {
      release();
    }

    // a natural pause: the search counts towards it
    const think = lo + secureRandom() * (hi - lo);
    await this.sleep(Math.max(0, think - (Date.now() - started) / this.scale));
    if (!this.live(room, g, seat)) return;

    const pick = pickMove(cands, level, secureRandom);
    if (pick) {
      // put the tiles down one at a time, so the player sees them arrive in red
      const other: 0 | 1 = seat === 0 ? 1 : 0;
      for (let i = 1; i <= pick.placements.length; i++) {
        if (!this.live(room, g, seat)) return;
        if (this.rooms.draft(room, seat, pick.placements.slice(0, i))) this.hooks.sendTo(room, other);
        await this.sleep(280);
      }
      if (!this.live(room, g, seat)) return;
      if (this.rooms.move(room, seat, pick.placements).ok) return this.hooks.broadcast(room);
    }

    // nothing to play: swap tiles if the bag allows, otherwise pass
    const res = g.bag.length >= MIN_BAG_FOR_EXCHANGE
      ? this.rooms.exchange(room, seat, chooseExchange(g.racks[seat]))
      : this.rooms.pass(room, seat);
    if (!res.ok) console.error('bot could not exchange or pass:', res.error);
    this.hooks.broadcast(room);
  }

  private sayGG(room: Room, seat: 0 | 1) {
    if (room.botSaidGG) return;
    room.botSaidGG = true;
    const ev = this.rooms.sticker(room, seat, 'gg');
    if (!ev) return;
    setTimeout(() => {
      if (this.rooms.rooms.get(room.code) === room) this.hooks.sticker(room, ev);
    }, 900 * this.scale);
  }
}

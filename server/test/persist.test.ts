import { describe, expect, it } from 'vitest';
import { CHAT_HISTORY, matchLeftMs, newGame, playMove } from '@amath/shared';
import type { ChatMessage, Tile } from '@amath/shared';
import { TTL, hashToken, parseStoredRoom, resumeClock, tokenMatches } from '../src/persist';
import type { StoredRoom } from '../src/persist';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** a game a few moves in, so the record has a real board, racks and log */
function playedGame() {
  const g = newGame(() => 0.5, { first: 0, matchSeconds: 1200, now: T0 });
  const rack: Tile[] = ['1', '+', '2', '=', '3'].map((face, i) => ({ id: 900 + i, face, points: 1 }));
  g.racks[0] = [...rack, ...g.racks[0].slice(5)];
  playMove(g, 0, rack.map((t, i) => ({ tileId: t.id, row: 7, col: 5 + i })), T0 + MIN);
  return g;
}

function record(over: Partial<StoredRoom> = {}): StoredRoom {
  return {
    v: 1,
    savedAt: T0 + MIN,
    code: '123456',
    seats: [
      { name: 'Ann', tokenHash: hashToken('a'.repeat(32)) },
      { name: 'Bob', tokenHash: hashToken('b'.repeat(32)) },
    ],
    game: playedGame(),
    settings: { matchSeconds: 1200 },
    chat: [{ id: 1, player: 0, text: 'hi', at: T0 }],
    nextChatId: 2,
    rematch: [false, false],
    lastActive: T0 + MIN,
    ...over,
  };
}

const parse = (r: unknown) => parseStoredRoom(typeof r === 'string' ? r : JSON.stringify(r));
const failure = (r: unknown) => ('error' in parse(r) ? (parse(r) as { error: string }).error : null);

describe('seat tokens are only kept as hashes', () => {
  it('hashes the same way every time, and matches only the right token', () => {
    const t = 'f'.repeat(32);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(tokenMatches(t, hashToken(t))).toBe(true);
    expect(tokenMatches('e'.repeat(32), hashToken(t))).toBe(false);
    expect(tokenMatches(t, hashToken(t).replace(/.$/, '0'))).toBe(false);
  });

  it('never matches an empty hash (the bot seat) or a damaged one, and never throws', () => {
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches('anything', '')).toBe(false);
    expect(tokenMatches('anything', 'zz')).toBe(false);
    expect(tokenMatches('anything', 'abc')).toBe(false);
  });
});

describe('reading a saved room', () => {
  it('gives back exactly what was saved', () => {
    const before = record();
    const after = parse(JSON.stringify(before));
    expect('room' in after && after.room).toEqual({ ...before, botSaidGG: false });
  });

  it('accepts a room still waiting for its second player', () => {
    const waiting = record({ game: null, seats: [{ name: 'Ann', tokenHash: hashToken('a') }] });
    expect(failure(waiting)).toBeNull();
  });

  it('keeps a bot seat with no token', () => {
    const bot = record({ seats: [{ name: 'Ann', tokenHash: hashToken('a') }, { name: 'Bot · Easy', tokenHash: '', bot: 'easy' }] });
    const parsed = parse(bot);
    expect('room' in parsed && parsed.room.seats[1]).toEqual({ name: 'Bot · Easy', tokenHash: '', bot: 'easy' });
  });

  it('keeps only the most recent chat messages', () => {
    const chat: ChatMessage[] = Array.from({ length: CHAT_HISTORY + 20 }, (_, i) => ({ id: i + 1, player: 0, text: `m${i}`, at: T0 }));
    const parsed = parse(record({ chat }));
    expect('room' in parsed && parsed.room.chat).toHaveLength(CHAT_HISTORY);
    expect('room' in parsed && parsed.room.chat[CHAT_HISTORY - 1].text).toBe(`m${CHAT_HISTORY + 19}`);
  });

  it('refuses anything damaged, out of date or made up, saying why', () => {
    const good = record();
    const bad = (mut: (r: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
      mut(copy);
      return failure(copy);
    };
    expect(failure('{not json')).toBe('not valid JSON');
    expect(failure('[1,2]')).toBe('unknown version undefined');
    expect(failure('null')).toBe('not an object');
    expect(bad((r) => { r.v = 2; })).toBe('unknown version 2');
    expect(bad((r) => { r.code = '12345'; })).toBe('bad room code');
    expect(bad((r) => { r.code = '../../x'; })).toBe('bad room code');
    expect(bad((r) => { r.savedAt = 'yesterday'; })).toBe('bad timestamps');
    expect(bad((r) => { r.seats = []; })).toBe('bad seats');
    expect(bad((r) => { r.seats = [{}, {}, {}]; })).toBe('bad seats');
    expect(bad((r) => { (r.seats as { tokenHash: string }[])[0].tokenHash = 'plain-token'; })).toBe('bad seat');
    expect(bad((r) => { (r.seats as { bot?: string }[])[1].bot = 'godlike'; })).toBe('bad bot level');
    expect(bad((r) => { r.settings = { matchSeconds: 999_999 }; })).toBe('bad settings');
    expect(bad((r) => { r.chat = [{ id: 'x' }]; })).toBe('bad chat');
    expect(bad((r) => { r.rematch = [true]; })).toBe('bad rematch votes');
  });

  it('refuses a game whose board, tiles or clocks are not what the rules need', () => {
    const bad = (mut: (g: Record<string, unknown>) => void) => {
      const rec = JSON.parse(JSON.stringify(record())) as { game: Record<string, unknown> };
      mut(rec.game);
      return failure(rec);
    };
    expect(bad((g) => { g.board = (g.board as unknown[]).slice(1); })).toBe('bad game');
    expect(bad((g) => { (g.board as unknown[][])[0] = [1, 2, 3]; })).toBe('bad game');
    expect(bad((g) => { (g.bag as { face: string }[])[0].face = '99'; })).toBe('bad game'); // not a tile in this set
    expect(bad((g) => { g.racks = [[]]; })).toBe('bad game');
    expect(bad((g) => { g.scores = [1, 'x']; })).toBe('bad game');
    expect(bad((g) => { g.turn = 2; })).toBe('bad game');
    expect(bad((g) => { g.bank = [1]; })).toBe('bad game');
    expect(bad((g) => { g.turnStartedAt = null; })).toBe('bad game');
  });
});

describe('picking the clock back up', () => {
  it('does not charge anyone for the time the server was down', () => {
    const g = playedGame(); // player 1 to move, their turn began at T0 + 1 min
    expect(g.turn).toBe(1);
    const savedAt = T0 + MIN; // saved the moment their turn began
    const restart = T0 + 45 * MIN; // the server came back 44 minutes later
    resumeClock(g, savedAt, restart);
    expect(matchLeftMs(g, 1, restart)).toBe(20 * MIN); // nothing spent
    expect(matchLeftMs(g, 1, restart + 2 * MIN)).toBe(18 * MIN); // and it runs from now
    expect(matchLeftMs(g, 0, restart)).toBe(19 * MIN); // the other clock is as it was
  });

  it('keeps the thinking time already recorded when the save came part way through a turn', () => {
    const g = playedGame();
    const savedAt = g.turnStartedAt + 3 * MIN; // saved 3 minutes into the turn
    resumeClock(g, savedAt, T0 + 500 * MIN);
    expect(matchLeftMs(g, 1, T0 + 500 * MIN)).toBe(17 * MIN);
  });

  it('never gives negative elapsed time, and leaves a finished game alone', () => {
    const g = playedGame();
    const started = g.turnStartedAt;
    resumeClock(g, started - 10 * MIN, started + 100 * MIN); // saved "before" the turn began
    expect(g.turnStartedAt).toBe(started + 100 * MIN);

    const done = playedGame();
    done.finished = true;
    const before = done.turnStartedAt;
    resumeClock(done, T0, T0 + 999 * MIN);
    expect(done.turnStartedAt).toBe(before);
  });
});

describe('how long a room is kept', () => {
  it('keeps a game in progress the longest, and a finished one only briefly', () => {
    expect(TTL.playing).toBeGreaterThan(TTL.waiting);
    expect(TTL.waiting).toBeGreaterThan(TTL.finished);
    expect(TTL.finished).toBeGreaterThanOrEqual(5 * 60);
  });
});

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where a game is kept so that it outlives the server process. The game server
 * holds every room in memory while it runs; a store is only asked for a room
 * that memory does not have (after a restart) and is told about every change.
 *
 * A store deals in JSON strings and knows nothing about games. Every method may
 * throw a StoreError, and the caller carries on without persistence rather than
 * letting a database problem stop a game.
 */
export interface RoomStore {
  readonly kind: string;
  load(code: string): Promise<string | null>;
  save(code: string, json: string, ttlSeconds: number): Promise<void>;
  remove(code: string): Promise<void>;
  has(code: string): Promise<boolean>;
}

export class StoreError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'StoreError';
  }
}

/** room codes are exactly six digits; anything else never reaches a store */
const validCode = (code: string) => /^\d{6}$/.test(code);
function assertCode(code: string) {
  if (!validCode(code)) throw new StoreError('bad room code');
}

/** in this process only: for tests, and the fallback when nothing else is configured */
export class MemoryStore implements RoomStore {
  readonly kind = 'memory';
  readonly data = new Map<string, { json: string; expiresAt: number }>();
  constructor(private now: () => number = Date.now) {}

  async load(code: string) {
    assertCode(code);
    const hit = this.data.get(code);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.data.delete(code);
      return null;
    }
    return hit.json;
  }
  async save(code: string, json: string, ttlSeconds: number) {
    assertCode(code);
    this.data.set(code, { json, expiresAt: this.now() + ttlSeconds * 1000 });
  }
  async remove(code: string) {
    assertCode(code);
    this.data.delete(code);
  }
  async has(code: string) {
    return (await this.load(code)) !== null;
  }
}

/**
 * One JSON file per room in a folder. It survives restarts on a machine with a
 * disk, which is what makes it useful for running the game yourself, and for
 * testing a real restart. Render's free plan has no disk that persists.
 */
export class FileStore implements RoomStore {
  readonly kind = 'file';
  constructor(private dir: string, private now: () => number = Date.now) {}

  private file(code: string) {
    assertCode(code);
    return path.join(this.dir, `${code}.json`);
  }

  async load(code: string) {
    let raw: string;
    try {
      raw = await readFile(this.file(code), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StoreError(`could not read the room file: ${(err as Error).message}`);
    }
    try {
      const { expiresAt, json } = JSON.parse(raw) as { expiresAt: number; json: string };
      if (typeof json !== 'string' || typeof expiresAt !== 'number') return null;
      if (expiresAt <= this.now()) {
        await this.remove(code);
        return null;
      }
      return json;
    } catch {
      return null;
    }
  }
  async save(code: string, json: string, ttlSeconds: number) {
    const file = this.file(code);
    try {
      await mkdir(this.dir, { recursive: true });
      // write beside it and rename, so a crash mid-write never leaves half a file
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ expiresAt: this.now() + ttlSeconds * 1000, json }));
      await rename(tmp, file);
    } catch (err) {
      throw new StoreError(`could not write the room file: ${(err as Error).message}`);
    }
  }
  async remove(code: string) {
    await rm(this.file(code), { force: true });
  }
  async has(code: string) {
    return (await this.load(code)) !== null;
  }
}

export interface UpstashOptions {
  url: string;
  token: string;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Upstash Redis over its REST API: every command is a POST of a JSON array.
 * No connection to hold open, which suits a server that sleeps and wakes.
 * https://upstash.com/docs/redis/features/restapi
 */
export class UpstashStore implements RoomStore {
  readonly kind = 'upstash';
  private url: string;
  private token: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(opts: UpstashOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  private key(code: string) {
    assertCode(code);
    return `amath:room:${code}`;
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: ctl.signal,
      });
    } catch (err) {
      // never include the request: it holds the token
      throw new StoreError((err as Error).name === 'AbortError' ? 'the database timed out' : 'the database could not be reached');
    } finally {
      clearTimeout(timer);
    }
    let body: { result?: unknown; error?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* a non-JSON reply is handled by the status check below */
    }
    if (!res.ok || typeof body.error === 'string') {
      const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      throw new StoreError(`the database refused the request (${reason})`, res.status);
    }
    return body.result;
  }

  async load(code: string) {
    const result = await this.command(['GET', this.key(code)]);
    return typeof result === 'string' ? result : null;
  }
  async save(code: string, json: string, ttlSeconds: number) {
    await this.command(['SET', this.key(code), json, 'EX', Math.max(1, Math.round(ttlSeconds))]);
  }
  async remove(code: string) {
    await this.command(['DEL', this.key(code)]);
  }
  async has(code: string) {
    return (await this.command(['EXISTS', this.key(code)])) === 1;
  }
}

/**
 * What this process has asked of the database since it started. Every one of these is one
 * command against Upstash's monthly allowance, failed attempts included. The free server
 * restarts often, so these start again from zero each time.
 */
export interface StoreUsage {
  since: number;
  saves: number;
  loads: number;
  removes: number;
  checks: number;
  /** saves + loads + removes + checks */
  commands: number;
  bytesSent: number;
  bytesReceived: number;
  failures: number;
}

export interface StoreStatus {
  kind: string;
  /** did the most recent operation work */
  ok: boolean;
  lastOkAt: number | null;
  lastError: string | null;
  usage: StoreUsage;
}

/** passes everything through and remembers whether the last call worked, for /health */
export class MonitoredStore implements RoomStore {
  private lastOkAt: number | null = null;
  private lastError: string | null = null;
  private lastFailed = false;
  private counts = { saves: 0, loads: 0, removes: 0, checks: 0, bytesSent: 0, bytesReceived: 0, failures: 0 };
  private since = Date.now();
  constructor(private inner: RoomStore, private log: (msg: string) => void = console.error) {}

  get kind() {
    return this.inner.kind;
  }

  status(): StoreStatus {
    const c = this.counts;
    return {
      kind: this.kind,
      ok: !this.lastFailed,
      lastOkAt: this.lastOkAt,
      lastError: this.lastError,
      usage: { since: this.since, ...c, commands: c.saves + c.loads + c.removes + c.checks },
    };
  }

  private async run<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      this.lastOkAt = Date.now();
      this.lastFailed = false;
      this.lastError = null;
      return out;
    } catch (err) {
      this.counts.failures++;
      const message = err instanceof Error ? err.message : String(err);
      // log the first failure and each change, not every retry
      if (!this.lastFailed || this.lastError !== message) this.log(`room store ${what} failed: ${message}`);
      this.lastFailed = true;
      this.lastError = message;
      throw err;
    }
  }

  load(code: string) {
    this.counts.loads++;
    return this.run('load', async () => {
      const json = await this.inner.load(code);
      if (json !== null) this.counts.bytesReceived += Buffer.byteLength(json);
      return json;
    });
  }
  save(code: string, json: string, ttl: number) {
    this.counts.saves++;
    this.counts.bytesSent += Buffer.byteLength(json);
    return this.run('save', () => this.inner.save(code, json, ttl));
  }
  remove(code: string) {
    this.counts.removes++;
    return this.run('remove', () => this.inner.remove(code));
  }
  has(code: string) {
    this.counts.checks++;
    return this.run('has', () => this.inner.has(code));
  }
}

/** pick a store from the environment; null means games live in memory only */
export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): RoomStore | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return new UpstashStore({ url, token });
  if (env.ROOM_STORE_DIR?.trim()) return new FileStore(env.ROOM_STORE_DIR.trim());
  return null;
}

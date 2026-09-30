import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStore, MemoryStore, MonitoredStore, StoreError, UpstashStore, storeFromEnv } from '../src/store';
import type { RoomStore } from '../src/store';

const T0 = 1_000_000;

describe('MemoryStore', () => {
  it('keeps a room until its time is up', async () => {
    let now = T0;
    const s = new MemoryStore(() => now);
    await s.save('123456', '{"a":1}', 60);
    expect(await s.load('123456')).toBe('{"a":1}');
    expect(await s.has('123456')).toBe(true);
    now += 59_000;
    expect(await s.load('123456')).toBe('{"a":1}');
    now += 2_000;
    expect(await s.load('123456')).toBeNull();
    expect(await s.has('123456')).toBe(false);
  });

  it('removes a room, and refuses anything that is not a six digit code', async () => {
    const s = new MemoryStore();
    await s.save('123456', 'x', 60);
    await s.remove('123456');
    expect(await s.load('123456')).toBeNull();
    await expect(s.load('12345')).rejects.toBeInstanceOf(StoreError);
    await expect(s.save('../etc', 'x', 1)).rejects.toBeInstanceOf(StoreError);
  });
});

describe('FileStore', () => {
  const dirs: string[] = [];
  const tmp = async () => {
    const d = await mkdtemp(path.join(os.tmpdir(), 'amath-store-'));
    dirs.push(d);
    return d;
  };
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('survives a new instance, which is what a restart is', async () => {
    const dir = await tmp();
    await new FileStore(dir).save('654321', '{"game":"on"}', 600);
    const after = new FileStore(dir); // the "restarted" server
    expect(await after.load('654321')).toBe('{"game":"on"}');
    expect(await after.has('654321')).toBe(true);
  });

  it('forgets a room once its time is up, and deletes the file', async () => {
    const dir = await tmp();
    let now = T0;
    const s = new FileStore(dir, () => now);
    await s.save('654321', 'x', 10);
    now += 11_000;
    expect(await s.load('654321')).toBeNull();
    expect(await readdir(dir)).toEqual([]);
  });

  it('removes rooms, leaves no temporary files behind, and never touches paths outside its folder', async () => {
    const dir = await tmp();
    const s = new FileStore(dir);
    await s.save('111111', 'a', 60);
    await s.save('111111', 'b', 60); // overwrite
    expect(await s.load('111111')).toBe('b');
    expect(await readdir(dir)).toEqual(['111111.json']);
    await s.remove('111111');
    expect(await s.load('111111')).toBeNull();
    await expect(s.save('../../evil', 'x', 60)).rejects.toBeInstanceOf(StoreError);
    await expect(s.load('..\\..\\evil')).rejects.toBeInstanceOf(StoreError);
  });

  it('treats a damaged file as no room rather than crashing', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, '222222.json'), '{not json');
    await writeFile(path.join(dir, '333333.json'), JSON.stringify({ expiresAt: 'soon', json: 5 }));
    const s = new FileStore(dir);
    expect(await s.load('222222')).toBeNull();
    expect(await s.load('333333')).toBeNull();
    expect(await s.load('444444')).toBeNull(); // no file at all
  });
});

describe('UpstashStore', () => {
  const URL = 'https://example-db.upstash.io/';
  const TOKEN = 'AXsecretTOKENvalue123';

  /** a fetch that records each request and answers as the Upstash REST API does */
  function fake(answer: (cmd: unknown[]) => { status?: number; body: unknown }) {
    const calls: { url: string; headers: Record<string, string>; cmd: unknown[] }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const cmd = JSON.parse(String(init.body)) as unknown[];
      calls.push({ url, headers: init.headers as Record<string, string>, cmd });
      const { status = 200, body } = answer(cmd);
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, store: new UpstashStore({ url: URL, token: TOKEN, fetchImpl }) };
  }

  it('sends each command as a POST of a JSON array with the token, and reads the reply', async () => {
    const { calls, store } = fake((cmd) => ({ body: { result: cmd[0] === 'GET' ? '{"x":1}' : 'OK' } }));
    await store.save('123456', '{"x":1}', 3600);
    expect(calls[0].url).toBe('https://example-db.upstash.io'); // trailing slash trimmed
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].cmd).toEqual(['SET', 'amath:room:123456', '{"x":1}', 'EX', 3600]);
    expect(await store.load('123456')).toBe('{"x":1}');
    expect(calls[1].cmd).toEqual(['GET', 'amath:room:123456']);
  });

  it('reads a missing room as null, and existence as 1 or 0', async () => {
    const { calls, store } = fake((cmd) => ({ body: { result: cmd[0] === 'EXISTS' ? 0 : null } }));
    expect(await store.load('123456')).toBeNull();
    expect(await store.has('123456')).toBe(false);
    const yes = fake(() => ({ body: { result: 1 } }));
    expect(await yes.store.has('123456')).toBe(true);
    await yes.store.remove('123456');
    expect(yes.calls[1].cmd).toEqual(['DEL', 'amath:room:123456']);
    expect(calls[1].cmd).toEqual(['EXISTS', 'amath:room:123456']);
  });

  it('turns a refusal into an error that names the reason but never contains the token', async () => {
    const { store } = fake(() => ({ status: 401, body: { error: 'WRONGPASS invalid password' } }));
    const err = await store.load('123456').catch((e) => e as StoreError);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('WRONGPASS');
    expect(err.message).not.toContain(TOKEN);
  });

  it('handles a reply that is not JSON, an error inside a 200, and a bad gateway', async () => {
    const html = new UpstashStore({
      url: URL, token: TOKEN,
      fetchImpl: (async () => new Response('<html>bad gateway</html>', { status: 502 })) as unknown as typeof fetch,
    });
    await expect(html.load('123456')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('HTTP 502') });
    const inner = fake(() => ({ body: { error: 'ERR something' } }));
    await expect(inner.store.load('123456')).rejects.toBeInstanceOf(StoreError);
  });

  it('reports an unreachable database and a timeout without leaking the request', async () => {
    const down = new UpstashStore({
      url: URL, token: TOKEN,
      fetchImpl: (async () => { throw new TypeError(`fetch failed for ${TOKEN}`); }) as unknown as typeof fetch,
    });
    const err = await down.load('123456').catch((e) => e as StoreError);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.message).toBe('the database could not be reached');

    const hang = new UpstashStore({
      url: URL, token: TOKEN, timeoutMs: 30,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as unknown as typeof fetch,
    });
    await expect(hang.load('123456')).rejects.toMatchObject({ message: 'the database timed out' });
  });

  it('never sends anything for a code that is not six digits', async () => {
    const { calls, store } = fake(() => ({ body: { result: null } }));
    await expect(store.load('12345a')).rejects.toBeInstanceOf(StoreError);
    await expect(store.save('1 2 3', 'x', 1)).rejects.toBeInstanceOf(StoreError);
    expect(calls).toHaveLength(0);
  });
});

describe('MonitoredStore', () => {
  /** a store that fails while `broken` is true */
  function flaky() {
    const state = { broken: false };
    const inner: RoomStore = {
      kind: 'flaky',
      load: async () => { if (state.broken) throw new StoreError('down'); return null; },
      save: async () => { if (state.broken) throw new StoreError('down'); },
      remove: async () => undefined,
      has: async () => false,
    };
    return { state, inner };
  }

  it('reports whether the last call worked, and comes back when the database does', async () => {
    const { state, inner } = flaky();
    const logs: string[] = [];
    const m = new MonitoredStore(inner, (l) => logs.push(l));
    expect(m.status()).toMatchObject({ kind: 'flaky', ok: true, lastOkAt: null });
    await m.load('123456');
    expect(m.status().ok).toBe(true);
    expect(m.status().lastOkAt).not.toBeNull();

    state.broken = true;
    await expect(m.load('123456')).rejects.toThrow('down');
    expect(m.status()).toMatchObject({ ok: false, lastError: 'down' });
    state.broken = false;
    await m.save('123456', 'x', 1);
    expect(m.status()).toMatchObject({ ok: true, lastError: null });
  });

  it('counts every command and the bytes it carried, failed attempts included', async () => {
    const { state, inner } = flaky();
    const m = new MonitoredStore(inner, () => undefined);
    expect(m.status().usage).toMatchObject({ commands: 0, saves: 0, loads: 0, removes: 0, checks: 0, bytesSent: 0, bytesReceived: 0, failures: 0 });

    await m.save('123456', '{"a":"\u00e9"}', 60); // the accented letter is two bytes in UTF-8
    await m.save('123456', 'abc', 60);
    await m.load('123456');
    await m.has('123456');
    await m.remove('123456');
    expect(m.status().usage).toMatchObject({ saves: 2, loads: 1, checks: 1, removes: 1, commands: 5, failures: 0 });
    expect(m.status().usage.bytesSent).toBe(Buffer.byteLength('{"a":"\u00e9"}') + 3);

    state.broken = true;
    await m.save('123456', 'xyz', 60).catch(() => undefined);
    await m.load('123456').catch(() => undefined);
    expect(m.status().usage).toMatchObject({ saves: 3, loads: 2, commands: 7, failures: 2 });
    expect(m.status().usage.since).toBeLessThanOrEqual(Date.now());
  });

  it('counts what came back from a load, and nothing for a room that was not there', async () => {
    const inner = new MemoryStore();
    await inner.save('123456', '0123456789', 60);
    const m = new MonitoredStore(inner, () => undefined);
    await m.load('123456');
    await m.load('999999'); // not there
    expect(m.status().usage).toMatchObject({ loads: 2, bytesReceived: 10 });
  });

  it('logs a failure once, not on every retry', async () => {
    const { state, inner } = flaky();
    const logs: string[] = [];
    const m = new MonitoredStore(inner, (l) => logs.push(l));
    state.broken = true;
    for (let i = 0; i < 10; i++) await m.save('123456', 'x', 1).catch(() => undefined);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('down');
  });
});

describe('choosing a store from the environment', () => {
  it('uses Upstash when both settings are there', () => {
    expect(storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })?.kind).toBe('upstash');
  });
  it('uses a folder when one is given', () => {
    expect(storeFromEnv({ ROOM_STORE_DIR: './data' })?.kind).toBe('file');
  });
  it('keeps games in memory when nothing usable is set', () => {
    expect(storeFromEnv({})).toBeNull();
    expect(storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toBeNull(); // no token
    expect(storeFromEnv({ UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', ROOM_STORE_DIR: '  ' })).toBeNull();
  });
  it('prefers Upstash when both are set', () => {
    expect(
      storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', ROOM_STORE_DIR: './d' })?.kind,
    ).toBe('upstash');
  });
});

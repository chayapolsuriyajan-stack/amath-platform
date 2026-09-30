import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  // tests never talk to a real database, whatever the developer's environment holds
  env: { UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', ROOM_STORE_DIR: '' }, include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts', 'client/test/**/*.test.ts'] } });

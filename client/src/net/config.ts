/**
 * Where the game server lives. Empty means the same origin (the Node server serves
 * the built client, and Vite proxies to it in development). Set VITE_SERVER_URL
 * when the client is hosted separately, as it is on Vercel.
 */
export const SERVER_URL: string = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\/$/, '');

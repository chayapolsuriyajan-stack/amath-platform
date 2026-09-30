# A-Math Platform

A copy of [a-math.com](https://a-math.com), the number-and-operator crossword board game, with online 2-player rooms
and a local match history.

**Live:** https://amath-platform.vercel.app (client on Vercel, game server on Render's free plan at
https://amath-server.onrender.com). The free server sleeps after 15 minutes idle and takes about a minute to wake;
with saving switched on (below) open games survive that, and without it they are lost.

## Rules

Basic rules follow a-math.com: unary minus only in front of a non-zero number, at most 3 joined digits, no zero padding,
piece and equation multipliers, +40 for using all 8 tiles, game ends when the bag and one rack are empty or after passes.

**Two-digit tile variation.** The only two-digit tiles are **10–16** and a separate **20** (no 17, 18 or 19). Each one is a
whole number and can never be joined to another digit. The bag is the 70-tile Junior Edition set (see [shared/src/tiles.ts](shared/src/tiles.ts)).

Other choices worth knowing:
- The ★ start square has no multiplier.
- End by empty rack: that player gains 2× the other player's remaining tile value.
- End by passes: 3 passes each in a row (6 total), each player loses their own remaining tile value.
- Exchange is allowed while the bag holds at least 5 tiles; pass only once the bag is empty.

## Play

```bash
npm install
npm run dev        # server on :3001, client on http://localhost:5173
```

Click **New Game** to get a 6-digit room code. The second player types it on the home page (or opens `/room/<code>`).
Each browser tab is its own player, so two tabs on one machine work for testing. A refreshed tab takes its seat back.

Finished games are saved in `localStorage` under `amath.history` and listed on `/history`.

## Production

```bash
npm run build      # builds client/dist
npm start          # Node server serves client/dist and the Socket.IO endpoint on $PORT (default 3001)
```

The game server keeps rooms in memory and needs a long-lived process with WebSocket support (a VM, Render, Fly, Railway...).
Serverless platforms such as Vercel cannot host it. To use Vercel for the static client only, set `VITE_SERVER_URL` to the
game server's URL at build time.

### Deploying

Both halves are deployed from the command line. Pushing to GitHub does **not** deploy anything, because
Render has no webhook access to this repo — run the deploy yourself after pushing:

```bash
npm run deploy
```

That runs `deploy:server` (Render CLI, waits for the build and fails loudly if it breaks) then
`deploy:client` (Vercel CLI, which builds from [vercel.json](vercel.json) with `VITE_SERVER_URL`
pointing at the game server). Either half can be deployed on its own with `npm run deploy:server`
or `npm run deploy:client`.

First time on a new machine:

```bash
winget install --id Render.CLI
render login
render workspace set
```

The Render service id is in the `deploy:server` script; the service itself was created from
[render.yaml](render.yaml) (Node, `npm start`, health check `/health`, free plan).
The free plan sleeps after 15 minutes idle and takes about a minute to wake. Without a database (next section) it also
loses every open game each time it sleeps or redeploys.

## Saving games so they survive a restart

The server keeps every game in memory while it runs. To keep them across a sleep, a crash or a deploy it can also save
each game to a database, and load it back when a player returns. Nothing changes for players: they reconnect and
carry on, and the time the server was down is not charged to anyone's clock.

**Set up Upstash Redis (free, no card):**
1. Sign up at [upstash.com](https://upstash.com) and create a Redis database. Pick a region near the game server (the
   Render service is in Oregon, so *US-West*).
2. On the database page, under **REST API**, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. In the Render dashboard, open the `amath-server` service, then **Environment**, and add both as environment variables.
   Render redeploys by itself.
4. Check `https://amath-server.onrender.com/health`: it should say `"persistent":true` and `"store":{"kind":"upstash","ok":true}`.
   The service log also prints `Database check: reachable.` at startup, or says why it is not.

How it behaves:
- A game is saved a moment after each move, exchange, pass, resignation or rematch (changes that come close together
  go out as one save), and once more when the server is told to stop. Chat does not cost a save of its own: it goes out
  with the next one, and when the server stops or an idle room leaves memory, so only a crash can lose recent chat lines.
  A game is kept 24 hours after the last change, or 10 minutes after it finishes.
- If the database is down, games carry on in memory and `/health` reports `"ok":false`. Players trying to return get
  "the database is not answering" and it retries, rather than being told the game is gone.
- Seat tokens are stored only as hashes.
- `/health` shows how much of the allowance this run has used, under `store.usage` (commands, saves, loads, bytes, failures).
  The free server restarts often, so the counts start again then; it also prints a summary line to its log when it stops.
  A game is roughly 20 to 60 commands, so 500,000 a month is several thousand games.
- The free plan allows 500,000 commands a month, which is several thousand games. Free databases are archived after
  30 days with no data operations; if nobody plays for a month, create a new one and update the two variables.

To run it yourself on a machine with a disk, set `ROOM_STORE_DIR=./data/rooms` instead and games are saved as files.

## Layout

| Path | What |
| --- | --- |
| `shared/` | Rules engine used by both sides: tiles, board, equation checker (exact fractions), move scoring, game flow |
| `server/` | Express + Socket.IO; room codes, reconnect tokens, per-player state so opponent racks stay hidden |
| `client/` | React + Vite UI |

`npm test` runs the engine and server tests.

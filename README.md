# A-Math Platform

A copy of [a-math.com](https://a-math.com), the number-and-operator crossword board game, with online 2-player rooms
and a local match history.

**Live:** https://amath-platform.vercel.app (client on Vercel, game server on Render's free plan at
https://amath-server.onrender.com). The free server sleeps after 15 minutes idle and takes about a minute to wake;
open rooms are lost when it sleeps or restarts.

## Rules

Basic rules follow a-math.com: unary minus only in front of a non-zero number, at most 3 joined digits, no zero padding,
piece and equation multipliers, +40 for using all 8 tiles, game ends when the bag and one rack are empty or after passes.

**Two-digit tile variation.** The only two-digit tiles are **10–16** and a separate **20** (no 17, 18 or 19). Each one is a
whole number and can never be joined to another digit. That gives a 97-tile bag (see [shared/src/tiles.ts](shared/src/tiles.ts)).

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

1. **Game server** (needs WebSockets): deploy the repo to Render with [render.yaml](render.yaml), or any Node host. Start command `npm start`, health check `/health`.
2. **Client on Vercel**: import the repo (settings come from [vercel.json](vercel.json)) and add the environment variable
   `VITE_SERVER_URL=https://<your-game-server>` before building.

## Layout

| Path | What |
| --- | --- |
| `shared/` | Rules engine used by both sides: tiles, board, equation checker (exact fractions), move scoring, game flow |
| `server/` | Express + Socket.IO; room codes, reconnect tokens, per-player state so opponent racks stay hidden |
| `client/` | React + Vite UI |

`npm test` runs the engine and server tests.

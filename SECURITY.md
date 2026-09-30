# Anti-cheat and security review

Last reviewed 2026-09-21. The tests that back each point are in
[server/test/security.test.ts](server/test/security.test.ts).

## The model

The server is the only authority. Browsers send *intentions* (put these tiles
here, exchange these tiles); the server checks every one against the real game
and decides the result. Nothing a player changes in their own browser can change
the score, the board, the bag or the clock.

## What is protected, and how

| Threat | Protection |
| --- | --- |
| Seeing the opponent's tiles | Each player is sent only their own rack. The bag and the other rack never leave the server; the opponent's rack is sent as a count. |
| Predicting the bag | The bag is shuffled with the platform's cryptographic random generator, not `Math.random`, whose internal state can be recovered from enough output. |
| Working out a tile from its id | Tile ids are handed out *after* shuffling, so an id says nothing about the face. |
| Playing tiles you don't have, or illegal equations | Every move is re-validated on the server: tile ownership, one row or column, no gaps, connected, the ★ on the first move, every equation formed (including the no-leading-plus rule), and the score is computed there. |
| Acting out of turn, or after the game ends | Checked on every action. |
| Stalling past the clock | Each player's match clock is kept and charged on the server's own time. A player 5 minutes past zero loses, even if they never send anything again. |
| Faking the opponent's "building" tiles | A draft is accepted only from the player on turn, only with tiles in their own rack, only on empty squares. It is relayed without tile ids and cleared once the turn ends. |
| Taking over someone's seat | Rejoining needs a 128-bit random token that only that player's browser holds. The server keeps only a hash of it, in memory and in the database, so a copy of the database is not enough to take a seat. The token is kept in the tab (so a reload goes straight back in) and in the browser (so a closed tab can be resumed, after the player picks the seat). |
| Guessing room codes to crash other games | Joining is limited to 20 attempts per minute per address, read from the proxy header in a way the client cannot fake. |
| Guessing seat tokens | Only *failed* rejoin attempts spend that same budget. A successful rejoin needs the 128-bit token, so it is never counted; otherwise five friends on one Wi-Fi reloading or reconnecting could lock each other out of their own games. A room that has expired is not a failed guess either. |
| Flooding the server | Every connection has a request budget; messages over 16 KB are refused; stickers are capped at 8 per 2 seconds; the server holds at most 5,000 rooms. |
| Running up the database's usage by guessing codes | A rejoin or join for a room that is not there spends the same per-address budget as a wrong guess, when a database is in use. A room that is already in memory costs no lookup. |
| Damaged or old records in the database | Every record is checked when loaded (version, room code, seats, board size, tile faces, clocks, chat). Anything that fails is ignored and logged, so it cannot crash the server or bend the rules. |
| Other websites driving the game in a visitor's browser | Connections are accepted only from the game's own sites (the Vercel app, the Render server, localhost). |
| Script injection through names, chat or stickers | Names and chat are trimmed and stripped of control characters, and the page renders all text as text. Stickers must be one of six known names. |

## Fixed in this review

- A room that still had players connected could be swept out of memory after 30 idle minutes, leaving their game running on an object nothing else could find. Rooms with anyone connected are now kept.

- The bag and exchanges were shuffled with `Math.random`; now cryptographic.
- Tile ids used to follow the tile set's order (id 0 was always a `0` tile); now they are assigned after the shuffle.
- Any website could open a game connection; now only the game's own origins.
- No limit on requests, room creation, join attempts or message size; all now limited.
- A leading `+` was accepted (`+7 = 5 + 2`); it is now rejected, per the Junior rules.
- The chat sanitiser's regex was stored as raw control bytes, which made git treat `rooms.ts` as a binary file and hid its diffs. It now uses escape sequences.

## Known limits

- **No accounts.** Anyone can pick any nickname, so a name proves nothing about who is playing.
- **Outside help.** Nothing on a server can stop a player from using a calculator or a solver in another window.
- **Drafts are visible on purpose.** The opponent sees whatever tiles you put down before submitting, including ones you take back.
- **The origin check only stops browsers.** A script can send any Origin header it likes. That is fine because every game rule is enforced on the server regardless.
- **Without a database, rooms live in memory** and are lost whenever the free server sleeps or redeploys. With one, they survive (see the README), apart from what happened in the fraction of a second before a crash.
- **`/health` is public.** It shows whether games are saved and how many database commands this run has used: counts only, no game data, and never the reason for a failure.
- **The database holds full games,** including both racks and the bag. Anyone with access to it can see every hidden tile, so treat the Upstash token like a password. Seat tokens are hashed, so it cannot be used to take a seat.
- **A restart resets a turn's thinking time.** A turn resumes with the time it had used when it was last saved, so time the server was down is never charged, and someone who was thinking before a crash gets that back.

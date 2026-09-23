import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { allowedSyms, isRoomCode } from '@amath/shared';
import type { Ack, JoinAck, MoveBreakdown, Placement, RoomUpdate, Sticker, StickerEvent, Tile } from '@amath/shared';
import { Board, type PendingTile } from '../components/Board';
import { Chat } from '../components/Chat';
import { MatchClock, useServerNow } from '../components/Clock';
import { ComboScreen } from '../components/ComboScreen';
import { ChoiceDialog, ExchangeDialog, GameOverDialog } from '../components/Dialogs';
import { MySettings, usePrefs } from '../components/MySettings';
import { MoveLog, ScoreCard, TileTracker } from '../components/Panels';
import { StickerLayer, type Floater } from '../components/Stickers';
import { Toast, describeError, type ToastData } from '../components/Toast';
import { useFlip } from '../components/useFlip';
import { call, ensureConnected, getName, getToken, setName, setToken, socket } from '../net/socket';
import { recordFromState, saveMatch } from '../storage/history';
import { sfx } from '../sound/sfx';

interface Choice {
  tileId: number;
  row: number;
  col: number;
}

/** matches the server's sticker limit, so what you see is what they see */
const STICKER_BURST = 8;
const STICKER_WINDOW_MS = 2000;
const MAX_FLOATERS = 40;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Game() {
  const { code = '' } = useParams();
  const [token, setTok] = useState(() => getToken(code));
  if (!isRoomCode(code)) return <Notice title="Invalid room code" text="Room codes have 6 digits." />;
  if (!token) return <JoinPrompt code={code} onJoined={setTok} />;
  return <Room code={code} token={token} />;
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="page center">
      <div className="panel">
        <h2>{title}</h2>
        <p>{text}</p>
        <Link className="btn" to="/">Home</Link>
      </div>
    </div>
  );
}

function JoinPrompt({ code, onJoined }: { code: string; onJoined: (t: string) => void }) {
  const [name, setNameState] = useState(getName());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    setName(name.trim());
    const res = await call<JoinAck>('room:join', { code, name: name.trim() });
    setBusy(false);
    if (res.ok) {
      setToken(res.code, res.token);
      onJoined(res.token);
    } else setError(res.error);
  };
  return (
    <div className="page center">
      <div className="panel">
        <h2>Join room {code}</h2>
        <input value={name} maxLength={16} placeholder="Your nickname" onChange={(e) => setNameState(e.target.value)} />
        <button disabled={busy} onClick={join}>Join game</button>
        {error ? <p className="error">{error}</p> : null}
        <Link className="link" to="/">Back</Link>
      </div>
    </div>
  );
}

function Room({ code, token }: { code: string; token: string }) {
  const nav = useNavigate();
  const [update, setUpdate] = useState<RoomUpdate | null>(null);
  const [fatal, setFatal] = useState('');
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastId = useRef(0);
  const showError = useCallback((error: string) => setToast(describeError(error, ++toastId.current)), []);
  const closeToast = useCallback(() => setToast(null), []);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const floaterId = useRef(0);
  const stickerTimes = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingTile[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [overClosed, setOverClosed] = useState(false);
  const [order, setOrder] = useState<number[]>([]);
  const [copied, setCopied] = useState('');
  const [combo, setCombo] = useState<MoveBreakdown | null>(null);
  const prefs = usePrefs();
  const [skew, setSkew] = useState(0);
  // read inside the state effect, which does not re-run when the toggle flips
  const fxRef = useRef(prefs.fx);
  fxRef.current = prefs.fx;
  /** rack tiles we already know about, so only fresh draws make the draw sound */
  const knownRack = useRef<Set<number> | null>(null);
  const busy = useRef(false);
  /** log number of the last move we already animated */
  const seenMove = useRef<number | null>(null);
  /** true once we have taken a first state snapshot for this room */
  const primed = useRef(false);

  // connect + (re)claim the seat whenever the socket (re)connects
  useEffect(() => {
    const rejoin = () => {
      (socket as never as { emit: (...a: unknown[]) => void }).emit('room:rejoin', { code, token }, (r: Ack) => {
        if (!r.ok) setFatal(r.error);
      });
    };
    const onUpdate = (u: RoomUpdate) => u.code === code && setUpdate(u);
    socket.on('room:update', onUpdate);
    socket.on('connect', rejoin);
    ensureConnected();
    if (socket.connected) rejoin();
    return () => {
      socket.off('room:update', onUpdate);
      socket.off('connect', rejoin);
    };
  }, [code, token]);

  const state = update?.state ?? null;
  const rack = state?.myRack;
  // read by the sticker listener, which is set up once per room
  const youRef = useRef<0 | 1 | null>(null);
  youRef.current = state?.you ?? null;

  const spawn = useCallback((sticker: Sticker, x: number, y: number) => {
    const key = ++floaterId.current;
    sfx.sticker();
    setFloaters((f) => [...f.slice(-(MAX_FLOATERS - 1)), { key, sticker, x, y }]);
  }, []);
  // stable, so each sticker's removal timer is not reset by every clock tick
  const removeFloater = useCallback((key: number) => setFloaters((f) => f.filter((x) => x.key !== key)), []);

  // the opponent's stickers drift up from their score card
  useEffect(() => {
    const onSticker = (e: StickerEvent) => {
      if (e.player === youRef.current) return; // our own were already shown the moment we pressed
      const card = rootRef.current?.querySelector('.side .score-card')?.getBoundingClientRect();
      if (card) spawn(e.sticker, card.left + card.width / 2, card.top + card.height / 2);
      else spawn(e.sticker, window.innerWidth - 120, window.innerHeight - 160);
    };
    socket.on('room:sticker', onSticker);
    return () => {
      socket.off('room:sticker', onSticker);
    };
  }, [spawn]);

  const sendSticker = (sticker: Sticker, from: DOMRect) => {
    const now = Date.now();
    stickerTimes.current = stickerTimes.current.filter((t) => now - t < STICKER_WINDOW_MS);
    if (stickerTimes.current.length >= STICKER_BURST) return;
    stickerTimes.current.push(now);
    spawn(sticker, from.left + from.width / 2, from.top);
    socket.emit('chat:sticker', { sticker });
  };

  // keep the rack order stable across updates; drop pending tiles that no longer make sense
  useEffect(() => {
    if (!state) return;
    const ids = state.myRack.map((t) => t.id);
    if (knownRack.current) {
      const fresh = ids.filter((id) => !knownRack.current!.has(id)).length;
      if (fresh > 0) sfx.draw(fresh);
    }
    knownRack.current = new Set(ids);
    setOrder((o) => [...o.filter((id) => ids.includes(id)), ...ids.filter((id) => !o.includes(id))]);
    setPending((p) => p.filter((x) => ids.includes(x.tile.id) && !state.board[x.row][x.col]));
    setSelected((s) => (s !== null && ids.includes(s) ? s : null));
    if (!state.finished) setOverClosed(false);
  }, [state]);

  // save finished games to the local match history
  useEffect(() => {
    if (state?.finished) saveMatch(recordFromState(code, state));
  }, [state, code]);

  // keep the local clock honest, then play the combo for each new move
  useEffect(() => {
    if (!state) return;
    setSkew(state.serverNow - Date.now());
    const last = state.lastMove;
    if (!primed.current) {
      // first state after joining or a refresh: don't replay moves already made
      primed.current = true;
      seenMove.current = last?.n ?? 0;
      return;
    }
    if (last && last.n > (seenMove.current ?? 0)) {
      seenMove.current = last.n;
      if (fxRef.current) setCombo(last);
      else sfx.total(last.total);
    }
  }, [state]);

  const rackTiles = useMemo(() => {
    if (!rack) return [];
    const byId = new Map(rack.map((t) => [t.id, t]));
    return order.map((id) => byId.get(id)).filter((t): t is Tile => !!t);
  }, [rack, order]);
  const pendingIds = new Set(pending.map((p) => p.tile.id));
  const inRack = rackTiles.filter((t) => !pendingIds.has(t.id));

  const myTurn = !!state && !state.finished && state.turn === state.you;
  const now = useServerNow(skew, !!state && !state.finished);
  const matchMs = (p: 0 | 1) =>
    state && state.matchSeconds > 0
      ? state.bank[p] - (!state.finished && state.turn === p ? now - state.turnStartedAt : 0)
      : null;

  // switching the animation off mid-combo closes it straight away
  useEffect(() => {
    if (!prefs.fx) setCombo(null);
  }, [prefs.fx]);

  // let the opponent watch the equation take shape; a short debounce keeps drags from flooding
  const draftSent = useRef('');
  useEffect(() => {
    if (!myTurn) {
      draftSent.current = '';
      return;
    }
    const placements: Placement[] = pending.map((p) => ({ tileId: p.tile.id, row: p.row, col: p.col, sym: p.sym }));
    const sig = JSON.stringify(placements);
    if (sig === draftSent.current) return;
    const t = window.setTimeout(() => {
      draftSent.current = sig;
      socket.emit('game:draft', { placements });
    }, 120);
    return () => clearTimeout(t);
  }, [pending, myTurn]);

  // tiles fly between the rack and the board, and new ones arrive from the right
  useFlip(rootRef, !reducedMotion());

  const place = useCallback(
    (tileId: number, row: number, col: number, sym?: string) => {
      if (!rack || !state) return;
      const tile = rack.find((t) => t.id === tileId);
      if (!tile || state.board[row][col]) return;
      if (pending.some((p) => p.row === row && p.col === col && p.tile.id !== tileId)) return;
      const opts = allowedSyms(tile.face);
      if (opts.length > 1 && !sym) {
        setChoice({ tileId, row, col });
        return;
      }
      setPending((p) => [...p.filter((x) => x.tile.id !== tileId), { tile, row, col, sym: sym ?? opts[0] }]);
      setSelected(null);
      sfx.place();
    },
    [rack, state, pending],
  );

  const takeBack = (tileId: number) => {
    if (pending.some((x) => x.tile.id === tileId)) sfx.recall();
    setPending((p) => p.filter((x) => x.tile.id !== tileId));
  };
  const recallAll = () => {
    if (pending.length) sfx.recall();
    setPending([]);
  };

  const onCellClick = (row: number, col: number) => {
    if (selected !== null) place(selected, row, col);
  };
  const dragStart = (tileId: number, e: DragEvent) => {
    e.dataTransfer.setData('text/plain', String(tileId));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onCellDrop = (row: number, col: number, e: DragEvent) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isFinite(id)) return;
    const existing = pending.find((p) => p.tile.id === id);
    const tile = rack?.find((t) => t.id === id);
    // a dragged +/-, ×/÷ or blank keeps the symbol it already had
    place(id, row, col, existing && tile && allowedSyms(tile.face).length > 1 ? existing.sym : undefined);
  };
  const onRackDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isFinite(id)) takeBack(id);
  };

  const send = async <T extends Ack>(event: string, ...args: unknown[]) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await call<T>(event, ...args);
      if (!res.ok) {
        sfx.invalid();
        showError(res.error);
      }
      return res;
    } finally {
      busy.current = false;
    }
  };

  const submit = async () => {
    const placements: Placement[] = pending.map((p) => ({ tileId: p.tile.id, row: p.row, col: p.col, sym: p.sym }));
    const res = await send('game:move', { placements });
    if (res?.ok) {
      setPending([]);
      setToast(null);
    }
  };
  const doExchange = async (ids: number[]) => {
    setExchangeOpen(false);
    const res = await send('game:exchange', { tileIds: ids });
    if (res?.ok) setPending([]);
  };
  const shuffleRack = () => setOrder((o) => o.slice().sort(() => Math.random() - 0.5));
  const resign = () => {
    if (window.confirm('Resign this game?')) void send('game:resign');
  };
  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? code : `${location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      window.prompt('Copy this:', text);
    }
  };

  if (fatal) return <Notice title="Cannot open this room" text={`${fatal}. The room may have expired.`} />;

  // waiting for the second player
  if (!state) {
    return (
      <div className="page center">
        <div className="panel room-code-panel">
          <h2>Game room code</h2>
          <p className="muted">Send this 6-digit code to your friend. They can type it on the home page.</p>
          <div className="room-code" aria-label={`Room code ${code.split('').join(' ')}`}>{code}</div>
          <div className="modal-actions">
            <button onClick={() => copy('code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button>
            <button className="ghost" onClick={() => copy('link')}>{copied === 'link' ? 'Copied!' : 'Copy link'}</button>
          </div>
          <p className="muted pulse">{update ? 'Waiting for your friend to join…' : 'Connecting…'}</p>
          <Link className="link" to="/">Cancel</Link>
        </div>
      </div>
    );
  }

  const me = state.you;
  const opp = me === 0 ? 1 : 0;
  const oppGone = !state.connected[opp];
  const oppTurn = !state.finished && state.turn === opp;
  const bagEmpty = state.bagCount === 0;
  const canExchange = myTurn && state.bagCount >= 5;
  const turnText = state.finished ? 'Game over' : myTurn ? (state.firstMove ? 'Your turn — cover the ★ square' : 'Your turn') : `${state.names[opp]}’s turn`;
  const choiceTile = choice ? rack?.find((t) => t.id === choice.tileId) : undefined;

  return (
    <div className="game" ref={rootRef}>
      <TileTracker unseen={state.unseen} />

      <main className="play">
        <Board
          board={state.board}
          pending={pending}
          draft={oppTurn ? state.opponentDraft : []}
          lastMine={state.lastPlaced[me]}
          lastTheirs={state.lastPlaced[opp]}
          onCellClick={onCellClick}
          onCellDrop={onCellDrop}
          onPendingClick={takeBack}
          onPendingDragStart={dragStart}
        />
        <div className={`status${myTurn ? ' mine' : ''}`} role="status">
          {turnText}
          {oppTurn && state.opponentDraft.length ? <span className="building"> · building…</span> : null}
          {oppGone && !state.finished ? <span className="warn"> · {state.names[opp]} is disconnected</span> : null}
        </div>
        <div className="rack" onDragOver={(e) => e.preventDefault()} onDrop={onRackDrop} aria-label="Your tiles">
          {inRack.map((t) => (
            <div
              key={t.id}
              data-tid={t.id}
              data-zone="rack"
              className={`tile rack-tile${selected === t.id ? ' selected' : ''}`}
              draggable
              onDragStart={(e) => dragStart(t.id, e)}
              onClick={() => setSelected((s) => (s === t.id ? null : t.id))}
            >
              <span>{t.face}</span>
              <sub>{t.points}</sub>
            </div>
          ))}
        </div>
      </main>

      <aside className="side">
        <ScoreCard
          label={`${state.names[opp]}`}
          name={state.names[opp]}
          score={state.scores[opp]}
          active={oppTurn}
          sub={`${state.opponentRackCount} tiles`}
          clock={<MatchClock ms={matchMs(opp)} active={oppTurn} />}
        />
        <ScoreCard
          label={`${state.names[me]} (YOU)`}
          name={state.names[me]}
          score={state.scores[me]}
          active={myTurn}
          sub={`Bag: ${state.bagCount}`}
          clock={<MatchClock ms={matchMs(me)} active={myTurn} />}
        />
        <MySettings prefs={prefs} compact />
        <div className="buttons">
          <button className="ghost" disabled={!canExchange} onClick={() => setExchangeOpen(true)}>Exchange</button>
          <button className="submit" disabled={!myTurn || pending.length === 0} onClick={submit}>SUBMIT</button>
          <button className="ghost" disabled={pending.length === 0} onClick={recallAll}>Recall</button>
          <button className="ghost" onClick={shuffleRack}>Shuffle</button>
          {bagEmpty && myTurn ? <button className="ghost" onClick={() => send('game:pass')}>Pass</button> : null}
        </div>
        <MoveLog log={state.log} names={state.names} />
        <Chat
          messages={state.chat}
          you={me}
          names={state.names}
          onSend={(text) => void send('chat:send', { text })}
          onSticker={sendSticker}
        />
        <div className="side-links">
          {!state.finished ? <button className="link" onClick={resign}>Resign</button> : null}
          <Link className="link" to="/">Home</Link>
        </div>
      </aside>

      {choice && choiceTile ? (
        <ChoiceDialog
          tile={choiceTile}
          onCancel={() => setChoice(null)}
          onPick={(sym) => {
            const c = choice;
            setChoice(null);
            place(c.tileId, c.row, c.col, sym);
          }}
        />
      ) : null}
      {exchangeOpen ? <ExchangeDialog rack={rackTiles} onCancel={() => setExchangeOpen(false)} onConfirm={doExchange} /> : null}
      {combo ? (
        <ComboScreen
          move={combo}
          who={state.names[combo.player]}
          mine={combo.player === me}
          speed={prefs.speed}
          onDone={() => setCombo(null)}
        />
      ) : null}
      <StickerLayer floaters={floaters} onDone={removeFloater} />
      {toast ? <Toast toast={toast} onClose={closeToast} /> : null}
      {state.finished && !overClosed ? (
        <GameOverDialog
          state={state}
          onRematch={() => socket.emit('game:rematch')}
          onHome={() => nav('/')}
          onHistory={() => nav('/history')}
          onClose={() => setOverClosed(true)}
        />
      ) : null}
    </div>
  );
}

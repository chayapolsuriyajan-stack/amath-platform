import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEFAULT_TURN_SECONDS, TURN_SECONDS_CHOICES, isRoomCode } from '@amath/shared';
import type { JoinAck } from '@amath/shared';
import { call, getName, setName, setToken } from '../net/socket';

const timeLabel = (s: number) => (s === 0 ? 'No limit' : `${s / 60} min`);

export function Home() {
  const nav = useNavigate();
  const [name, setNameState] = useState(getName());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [turnSeconds, setTurnSeconds] = useState(DEFAULT_TURN_SECONDS);

  const enter = async (event: 'room:create' | 'room:join') => {
    setError('');
    if (event === 'room:join' && !isRoomCode(code)) return setError('Enter the 6-digit room code');
    setBusy(true);
    setName(name.trim());
    const res = await call<JoinAck>(event, { name: name.trim(), code, turnSeconds });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setToken(res.code, res.token);
    nav(`/room/${res.code}`);
  };

  return (
    <div className="page center">
      <div className="home">
        <h1>
          A-Math <small>v1.1</small>
        </h1>
        <p>A-Math is a simple math scrabble board game, like crossword but with numbers and operators. A valid equation is a valid sequence.</p>

        <label className="field">
          <span>Nickname</span>
          <input value={name} maxLength={16} placeholder="Player" onChange={(e) => setNameState(e.target.value)} />
        </label>

        <fieldset className="settings">
          <legend>Game settings</legend>
          <span className="settings-label">Time per turn</span>
          <div className="seg">
            {TURN_SECONDS_CHOICES.map((s) => (
              <button
                key={s}
                type="button"
                className={turnSeconds === s ? 'on' : ''}
                aria-pressed={turnSeconds === s}
                onClick={() => setTurnSeconds(s)}
              >
                {timeLabel(s)}
              </button>
            ))}
          </div>
          <p className="settings-note">
            {turnSeconds === 0
              ? 'Players can take as long as they like.'
              : 'The clock keeps running past zero. Go 5 minutes over and you lose the game.'}
          </p>
        </fieldset>

        <div className="home-actions">
          <button disabled={busy} onClick={() => enter('room:create')}>New Game</button>
        </div>

        <form
          className="join-form"
          onSubmit={(e) => {
            e.preventDefault();
            void enter('room:join');
          }}
        >
          <input
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6-digit room code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-label="Room code"
          />
          <button className="ghost" disabled={busy || code.length !== 6}>Join</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </div>

      <footer className="foot">
        <Link to="/history">Match history</Link>
        <Link className="btn ghost" to="/rules">Game rules</Link>
      </footer>
    </div>
  );
}

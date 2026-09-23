import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DEFAULT_MATCH_SECONDS, formatClockSeconds, isRoomCode, parseClock,
} from '@amath/shared';
import type { JoinAck } from '@amath/shared';
import { MySettings, usePrefs } from '../components/MySettings';
import { call, getName, setName, setToken } from '../net/socket';

export function Home() {
  const nav = useNavigate();
  const prefs = usePrefs();
  const [name, setNameState] = useState(getName());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [matchOn, setMatchOn] = useState(true);
  const [matchText, setMatchText] = useState(formatClockSeconds(DEFAULT_MATCH_SECONDS));
  const matchSecs = parseClock(matchText);
  const matchBad = matchOn && matchSecs === null;

  const enter = async (event: 'room:create' | 'room:join') => {
    setError('');
    if (event === 'room:join' && !isRoomCode(code)) return setError('Enter the 6-digit room code');
    if (event === 'room:create' && matchBad) return setError('Write the match clock as minutes:seconds, like 20:00');
    setBusy(true);
    setName(name.trim());
    const res = await call<JoinAck>(event, {
      name: name.trim(),
      code,
      matchSeconds: matchOn ? matchSecs ?? DEFAULT_MATCH_SECONDS : 0,
    });
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
          <legend>Game settings (for both players)</legend>

          <span className="settings-label">Match clock, per player</span>
          <div className="seg match-row">
            <button type="button" className={matchOn ? 'on' : ''} aria-pressed={matchOn} onClick={() => setMatchOn(true)}>On</button>
            <button type="button" className={!matchOn ? 'on' : ''} aria-pressed={!matchOn} onClick={() => setMatchOn(false)}>Off</button>
            {matchOn ? (
              <input
                className={`clock-input${matchBad ? ' bad' : ''}`}
                value={matchText}
                inputMode="numeric"
                maxLength={6}
                placeholder="20:00"
                aria-label="Match clock, minutes:seconds"
                aria-invalid={matchBad}
                onChange={(e) => setMatchText(e.target.value.replace(/[^\d:]/g, ''))}
                onBlur={() => matchSecs !== null && setMatchText(formatClockSeconds(matchSecs))}
              />
            ) : null}
          </div>
          <p className="settings-note">
            {!matchOn
              ? 'No clock at all: players can take as long as they like.'
              : matchBad
                ? 'Use minutes:seconds, from 0:01 up to 180:00.'
                : `Each player gets ${formatClockSeconds(matchSecs!)} for the whole game. It only runs on your own turns and keeps going past zero. Go 5 minutes over and you lose.`}
          </p>

        </fieldset>

        <fieldset className="settings">
          <legend>Your settings (only you)</legend>
          <MySettings prefs={prefs} />
        </fieldset>

        <div className="home-actions">
          <button disabled={busy || matchBad} onClick={() => enter('room:create')}>New Game</button>
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

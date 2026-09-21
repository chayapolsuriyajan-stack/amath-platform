import { useState } from 'react';
import {
  FX_SPEEDS, getFx, getFxSpeed, getSound, getVolume, setFx, setFxSpeed, setSound, setVolume, type FxSpeed,
} from '../storage/prefs';
import { sfx } from '../sound/sfx';

/** this player's own settings, saved in this browser only */
export function usePrefs() {
  const [fx, setFxState] = useState(getFx);
  const [speed, setSpeedState] = useState<FxSpeed>(getFxSpeed);
  const [sound, setSoundState] = useState(getSound);
  const [volume, setVolumeState] = useState(getVolume);
  return {
    fx,
    speed,
    sound,
    volume,
    setFx: (on: boolean) => { setFxState(on); setFx(on); },
    setSpeed: (s: FxSpeed) => { setSpeedState(s); setFxSpeed(s); },
    setSound: (on: boolean) => { setSoundState(on); setSound(on); if (on) sfx.place(); },
    setVolume: (v: number) => { setVolumeState(v); setVolume(v); },
  };
}

export type Prefs = ReturnType<typeof usePrefs>;

/** the controls; `compact` is the in-game version that folds away */
export function MySettings({ prefs, compact = false }: { prefs: Prefs; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const summary = `Animation ${prefs.fx ? `on ${prefs.speed}x` : 'off'} · Sound ${prefs.sound ? 'on' : 'off'}`;

  const body = (
    <div className="my-settings-body">
      <span className="settings-label">Score animation</span>
      <div className="seg">
        <button type="button" className={prefs.fx ? 'on' : ''} aria-pressed={prefs.fx} onClick={() => prefs.setFx(true)}>On</button>
        <button type="button" className={!prefs.fx ? 'on' : ''} aria-pressed={!prefs.fx} onClick={() => prefs.setFx(false)}>Off</button>
        {prefs.fx
          ? FX_SPEEDS.map((s) => (
              <button key={s} type="button" className={prefs.speed === s ? 'on' : ''} aria-pressed={prefs.speed === s} onClick={() => prefs.setSpeed(s)}>
                {s}x
              </button>
            ))
          : null}
      </div>

      <span className="settings-label">Sound effects</span>
      <div className="seg sound-row">
        <button type="button" className={prefs.sound ? 'on' : ''} aria-pressed={prefs.sound} onClick={() => prefs.setSound(true)}>On</button>
        <button type="button" className={!prefs.sound ? 'on' : ''} aria-pressed={!prefs.sound} onClick={() => prefs.setSound(false)}>Off</button>
        {prefs.sound ? (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            aria-label="Volume"
            onChange={(e) => prefs.setVolume(Number(e.target.value))}
            onPointerUp={() => sfx.place()}
          />
        ) : null}
      </div>
      <p className="settings-note">Only you see and hear these. Change them any time, even mid-match.</p>
    </div>
  );

  if (!compact) return body;
  return (
    <section className={`my-settings${open ? ' open' : ''}`}>
      <button type="button" className="my-settings-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>⚙</span> <b>Your settings</b>
        {!open ? <span className="my-settings-sum">{summary}</span> : null}
        <span className="chev" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open ? body : null}
    </section>
  );
}

/** Personal preferences, kept per browser. They never affect the other player. */
const FX_KEY = 'amath.fx';
const SPEED_KEY = 'amath.fxSpeed';
const SOUND_KEY = 'amath.sound';
const VOLUME_KEY = 'amath.volume';

/** Are sound effects on? Defaults to on. */
export function getSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* the preference just won't stick */
  }
}

/** 0 to 1, default 0.6 */
export function getVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return localStorage.getItem(VOLUME_KEY) !== null && v >= 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
}

export function setVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    /* the preference just won't stick */
  }
}

export const FX_SPEEDS = [1, 2, 4] as const;
export type FxSpeed = (typeof FX_SPEEDS)[number];

/** Is the scoring animation switched on? Defaults to on. */
export function getFx(): boolean {
  try {
    return localStorage.getItem(FX_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setFx(on: boolean) {
  try {
    localStorage.setItem(FX_KEY, on ? 'on' : 'off');
  } catch {
    /* the preference just won't stick */
  }
}

/** How fast the scoring animation plays: 1x, 2x or 4x. Defaults to 1x. */
export function getFxSpeed(): FxSpeed {
  try {
    const n = Number(localStorage.getItem(SPEED_KEY));
    return (FX_SPEEDS as readonly number[]).includes(n) ? (n as FxSpeed) : 1;
  } catch {
    return 1;
  }
}

export function setFxSpeed(speed: FxSpeed) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* the preference just won't stick */
  }
}

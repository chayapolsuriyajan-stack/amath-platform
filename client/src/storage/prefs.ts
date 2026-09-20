/** Personal display preferences, kept per browser. */
const FX_KEY = 'amath.fx';
const SPEED_KEY = 'amath.fxSpeed';

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

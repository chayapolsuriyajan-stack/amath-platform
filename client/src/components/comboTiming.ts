import type { MoveBreakdown } from '@amath/shared';

/** one beat of the scoring animation */
export type Step =
  | { kind: 'equation'; eq: number }
  | { kind: 'tile'; eq: number; tile: number }
  | { kind: 'mult'; eq: number }
  | { kind: 'subtotal'; eq: number }
  | { kind: 'bingo' }
  | { kind: 'total' }
  | { kind: 'done' };

/**
 * The speeds the player can pick. 1x is the slow, deliberate pace of a card game's scoring,
 * 4x is quick. 4x is what the animation always used to run at.
 */
export const BASE_SPEED = 4;

/** how much to stretch the pauses between beats: 1 is the original timing, 4 is four times slower */
export const paceFor = (speed: number) => BASE_SPEED / speed;

/**
 * How much to stretch the beats themselves (a slam, a count-up). Less than the pauses, so a
 * slow setting means a slower rhythm with hits that still land hard, rather than everything
 * turning to slow motion.
 */
export const punchFor = (speed: number) => Math.sqrt(paceFor(speed));

/**
 * When each beat happens, in ms from the start, at the given pace (1 = the original timing).
 * The order and content never change with pace, only the spacing.
 */
export function buildSteps(b: MoveBreakdown, pace = 1): { step: Step; at: number }[] {
  const out: { step: Step; at: number }[] = [];
  let t = 0;
  const tileCount = b.equations.reduce((n, e) => n + e.tiles.length, 0);
  // keep long equations from dragging
  const per = tileCount > 14 ? 70 : tileCount > 9 ? 95 : 130;
  b.equations.forEach((eq, i) => {
    out.push({ step: { kind: 'equation', eq: i }, at: t });
    t += 420;
    eq.tiles.forEach((_, j) => {
      out.push({ step: { kind: 'tile', eq: i, tile: j }, at: t });
      t += per;
    });
    t += 120;
    if (eq.eqMult > 1) {
      out.push({ step: { kind: 'mult', eq: i }, at: t });
      t += 620;
    }
    out.push({ step: { kind: 'subtotal', eq: i }, at: t });
    t += 520;
  });
  if (b.bingo) {
    out.push({ step: { kind: 'bingo' }, at: t });
    t += 780;
  }
  out.push({ step: { kind: 'total' }, at: t });
  t += 1500;
  out.push({ step: { kind: 'done' }, at: t });
  return pace === 1 ? out : out.map((s) => ({ ...s, at: Math.round(s.at * pace) }));
}

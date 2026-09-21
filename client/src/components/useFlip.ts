import { useLayoutEffect, useRef, type RefObject } from 'react';

const FLIP_ID = 'flip';

/**
 * Where the element sits in the layout, ignoring any transform an animation is
 * currently applying. Measuring the on-screen box instead would read a tile that
 * is mid-flight as "moved", start a second animation on top of the first, and
 * compound every render (the clock re-renders four times a second).
 */
function layoutCenter(node: HTMLElement) {
  const r = node.getBoundingClientRect();
  const t = getComputedStyle(node).transform;
  const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
  // centre, not corner, so a scale in the animation does not shift the reading
  return {
    x: r.left + r.width / 2 - (m?.m41 ?? 0) + window.scrollX,
    y: r.top + r.height / 2 - (m?.m42 ?? 0) + window.scrollY,
  };
}

function restart(node: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  for (const a of node.getAnimations()) if (a.id === FLIP_ID) a.cancel();
  const anim = node.animate(keyframes, options);
  anim.id = FLIP_ID;
  // A tab or view that stops producing frames never starts the animation, which
  // would leave a drawn tile parked off to the right. Make sure it always lands.
  const total = Number(options.duration ?? 0) + Number(options.delay ?? 0) + 200;
  window.setTimeout(() => {
    if (anim.playState !== 'finished' && anim.playState !== 'idle') anim.finish();
  }, total);
}

/**
 * Animates tiles between renders ("FLIP"): any element with a data-tid whose
 * layout position changed slides from where it was to where it is now, so a
 * recalled tile flies back into the rack and the rest of the rack slides over.
 * A rack tile that was not there before (freshly drawn) shoots in from the right.
 */
export function useFlip(root: RefObject<HTMLElement>, enabled = true) {
  const prev = useRef(new Map<string, { x: number; y: number }>());
  const viewport = useRef('');

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const size = `${window.innerWidth}x${window.innerHeight}`;
    // a resize moves everything; just take new positions without animating
    const resized = viewport.current !== '' && viewport.current !== size;
    viewport.current = size;
    const first = prev.current.size === 0;
    const next = new Map<string, { x: number; y: number }>();
    let arrivals = 0;

    el.querySelectorAll<HTMLElement>('[data-tid]').forEach((node) => {
      const id = node.dataset.tid!;
      const pos = layoutCenter(node);
      next.set(id, pos);
      if (!enabled || first || resized || typeof node.animate !== 'function') return;

      const old = prev.current.get(id);
      if (old) {
        const dx = old.x - pos.x;
        const dy = old.y - pos.y;
        // layout unchanged: leave any animation already running alone
        if (Math.abs(dx) + Math.abs(dy) < 1) return;
        const far = Math.hypot(dx, dy) > 120;
        restart(
          node,
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: far ? 340 : 220, easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)' },
        );
      } else if (node.dataset.zone === 'rack') {
        // drawn from the bag: come in fast from the right, one after another
        restart(
          node,
          [
            { transform: 'translateX(420px) scale(0.85)', opacity: 0 },
            { transform: 'translateX(-10px) scale(1.04)', opacity: 1, offset: 0.75 },
            { transform: 'translateX(0) scale(1)', opacity: 1 },
          ],
          { duration: 360, delay: arrivals++ * 70, easing: 'cubic-bezier(0.15, 0.9, 0.3, 1)', fill: 'backwards' },
        );
      }
    });
    prev.current = next;
  });
}

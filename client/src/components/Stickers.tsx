import { useEffect, useMemo } from 'react';
import { STICKERS, type Sticker } from '@amath/shared';

export const STICKER_ART: Record<Sticker, { label: string; emoji?: string }> = {
  happy: { label: 'Happy', emoji: '😄' },
  sad: { label: 'Sad', emoji: '😢' },
  worried: { label: 'Worried', emoji: '😟' },
  angry: { label: 'Angry', emoji: '😠' },
  thumbs: { label: 'Thumbs up', emoji: '👍' },
  gg: { label: 'Good game' },
};

export function StickerFace({ sticker }: { sticker: Sticker }) {
  const art = STICKER_ART[sticker];
  return art.emoji ? <span className="sticker-emoji">{art.emoji}</span> : <span className="sticker-gg">GG</span>;
}

export function StickerBar({ onPick }: { onPick: (s: Sticker, from: DOMRect) => void }) {
  return (
    <div className="sticker-bar" aria-label="Stickers">
      {STICKERS.map((s) => (
        <button
          key={s}
          type="button"
          title={STICKER_ART[s].label}
          aria-label={STICKER_ART[s].label}
          onClick={(e) => onPick(s, e.currentTarget.getBoundingClientRect())}
        >
          <StickerFace sticker={s} />
        </button>
      ))}
    </div>
  );
}

export interface Floater {
  key: number;
  sticker: Sticker;
  /** viewport position the sticker starts from */
  x: number;
  y: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** One sticker drifting up like a ghost: a wandering path, a flicker, then gone. */
function Float({ f, onDone }: { f: Floater; onDone: (key: number) => void }) {
  const seconds = useMemo(() => rand(3.1, 4.3), []);
  // each sticker gets its own wobble so a burst spreads out instead of stacking
  const path = useMemo(
    () => ({
      ['--x1' as string]: `${rand(-45, 45)}px`,
      ['--x2' as string]: `${rand(-70, 70)}px`,
      ['--x3' as string]: `${rand(-60, 60)}px`,
      ['--x4' as string]: `${rand(-90, 90)}px`,
      ['--r1' as string]: `${rand(-18, 18)}deg`,
      ['--r2' as string]: `${rand(-24, 24)}deg`,
      ['--rise' as string]: `${rand(46, 68)}vh`,
      animationDuration: `${seconds}s`,
      left: f.x + rand(-14, 14),
      top: f.y,
    }),
    [f.x, f.y, seconds],
  );
  // animationend never fires where frames are paused, so remove it on a timer too
  useEffect(() => {
    const t = window.setTimeout(() => onDone(f.key), seconds * 1000 + 300);
    return () => clearTimeout(t);
  }, [f.key, seconds, onDone]);
  return (
    <div className="floater" style={path} onAnimationEnd={() => onDone(f.key)}>
      <StickerFace sticker={f.sticker} />
    </div>
  );
}

export function StickerLayer({ floaters, onDone }: { floaters: Floater[]; onDone: (key: number) => void }) {
  return (
    <div className="sticker-layer" aria-hidden>
      {floaters.map((f) => (
        <Float key={f.key} f={f} onDone={onDone} />
      ))}
    </div>
  );
}

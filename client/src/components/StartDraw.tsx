import { useEffect, useState } from 'react';

interface Props {
  faces: [string, string];
  redraws: number;
  names: [string, string];
  you: 0 | 1;
  first: 0 | 1;
  onDone: () => void;
}

const label = (face: string) => (face === '?' ? 'Blank' : face);

/**
 * The opening draw from the Junior rules, played out: each player's tile turns
 * over, then whoever drew nearer to 20 is named as the first player.
 */
export function StartDraw({ faces, redraws, names, you, first, onDone }: Props) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = [
      window.setTimeout(() => setStage(1), 350),
      window.setTimeout(() => setStage(2), 1100),
      window.setTimeout(onDone, 3400),
    ];
    return () => t.forEach(clearTimeout);
  }, [onDone]);

  // show your own draw on the left
  const order: (0 | 1)[] = you === 0 ? [0, 1] : [1, 0];
  const firstName = first === you ? 'You go' : `${names[first]} goes`;

  return (
    <div className="start-draw" role="status" onClick={onDone}>
      <div className="start-draw-inner">
        <p className="start-draw-title">Drawing to see who starts</p>
        <p className="start-draw-sub">Nearest to 20 goes first · symbols lowest · blank highest</p>
        <div className="start-draw-tiles">
          {order.map((p, i) => (
            <div key={p} className={`draw-slot${stage >= 2 && p === first ? ' win' : ''}${stage >= 2 && p !== first ? ' lose' : ''}`}>
              <div className={`draw-tile${stage >= 1 ? ' flipped' : ''}`} style={{ transitionDelay: `${i * 180}ms` }}>
                <span className="back" aria-hidden>?</span>
                <span className="front">{label(faces[p])}</span>
              </div>
              <span className="draw-name">{p === you ? 'You' : names[p]}</span>
            </div>
          ))}
        </div>
        <p className={`start-draw-result${stage >= 2 ? ' show' : ''}`}>
          {firstName} first!
          {redraws > 0 ? <small> after {redraws} tied draw{redraws > 1 ? 's' : ''}</small> : null}
        </p>
      </div>
    </div>
  );
}

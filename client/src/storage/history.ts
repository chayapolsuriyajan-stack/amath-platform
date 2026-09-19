import type { EndReason, LogType, PublicState } from '@amath/shared';

const KEY = 'amath.history';
const MAX = 200;

export interface HistoryMove {
  n: number;
  who: string;
  mine: boolean;
  type: LogType;
  equations: string[];
  score: number;
  bingo?: boolean;
}

export interface MatchRecord {
  id: string;
  date: string;
  code: string;
  you: string;
  opponent: string;
  yourScore: number;
  opponentScore: number;
  result: 'win' | 'loss' | 'draw';
  endReason?: EndReason;
  moves: HistoryMove[];
}

export function loadHistory(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: MatchRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked: history is a convenience only */
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function recordFromState(code: string, s: PublicState): MatchRecord {
  const me = s.you;
  const opp = me === 0 ? 1 : 0;
  const moves = s.log.map((l) => ({
    n: l.n,
    who: s.names[l.player],
    mine: l.player === me,
    type: l.type,
    equations: l.equations,
    score: l.score,
    bingo: l.bingo,
  }));
  const fingerprint = `${code}|seat${me}|${s.names.join('/')}|${s.scores.join('-')}|` +
    s.log.map((l) => `${l.player}${l.type}${l.equations.join(',')}${l.score}`).join(';');
  return {
    id: `${code}-${hash(fingerprint)}`,
    date: new Date().toISOString(),
    code,
    you: s.names[me],
    opponent: s.names[opp],
    yourScore: s.scores[me],
    opponentScore: s.scores[opp],
    result: s.winner == null ? 'draw' : s.winner === me ? 'win' : 'loss',
    endReason: s.endReason,
    moves,
  };
}

/** adds the finished game once; a page refresh on the game-over screen will not duplicate it */
export function saveMatch(rec: MatchRecord) {
  const list = loadHistory();
  if (list.some((r) => r.id === rec.id)) return;
  save([rec, ...list]);
}

export function deleteMatch(id: string) {
  save(loadHistory().filter((r) => r.id !== id));
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

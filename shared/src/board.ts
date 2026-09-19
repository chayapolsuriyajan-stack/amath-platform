import type { Board } from './types';

export const SIZE = 15;
export const CENTER = 7;

export type Premium = '3E' | '2E' | '3P' | '2P' | '★' | '';

/** Right/bottom half is mirrored from the top-left quadrant layout read from a-math.com. */
const TOP_HALF = [
  '3E .. .. 2P .. .. .. 3E .. .. .. 2P .. .. 3E',
  '.. 2E .. .. .. 3P .. .. .. 3P .. .. .. 2E ..',
  '.. .. 2E .. .. .. 2P .. 2P .. .. .. 2E .. ..',
  '2P .. .. 2E .. .. .. 2P .. .. .. 2E .. .. 2P',
  '.. .. .. .. 3P .. .. .. .. .. 3P .. .. .. ..',
  '.. 3P .. .. .. 3P .. .. .. 3P .. .. .. 3P ..',
  '.. .. 2P .. .. .. 2P .. 2P .. .. .. 2P .. ..',
  '3E .. .. 2P .. .. .. ★. .. .. .. 2P .. .. 3E',
];

function parse(row: string): Premium[] {
  return row.split(' ').map((c) => (c === '..' ? '' : c === '★.' ? '★' : (c as Premium)));
}

export const PREMIUMS: Premium[][] = (() => {
  const rows = TOP_HALF.map(parse);
  const bottom = rows.slice(0, CENTER).reverse();
  return [...rows, ...bottom];
})();

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
}

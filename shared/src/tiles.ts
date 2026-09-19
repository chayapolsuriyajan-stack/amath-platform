import type { Tile } from './types';

/** face -> [count, points]. 2-digit tiles are limited to 10-16 plus a separate 20. */
export const TILE_SET: Record<string, [number, number]> = {
  '0': [5, 1], '1': [6, 1], '2': [6, 1], '3': [5, 1], '4': [5, 2],
  '5': [4, 2], '6': [4, 2], '7': [4, 2], '8': [4, 2], '9': [4, 2],
  '10': [2, 3], '11': [1, 4], '12': [2, 3], '13': [1, 6], '14': [1, 4],
  '15': [1, 4], '16': [1, 4], '20': [1, 5],
  '+': [4, 2], '-': [4, 2], '+/-': [5, 1], '×': [4, 2], '÷': [4, 2], '×/÷': [4, 1],
  '=': [11, 1], '?': [4, 0],
};

/** faces in the order the tile tracker shows them */
export const FACE_ORDER = Object.keys(TILE_SET);

export const TOTAL_TILES = Object.values(TILE_SET).reduce((n, [c]) => n + c, 0);
export const RACK_SIZE = 8;

export const SINGLE_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
export const MULTI_DIGITS = ['10', '11', '12', '13', '14', '15', '16', '20'];
export const OPERATORS = ['+', '-', '×', '÷'];

/** symbols a tile may stand for once placed */
export function allowedSyms(face: string): string[] {
  if (face === '+/-') return ['+', '-'];
  if (face === '×/÷') return ['×', '÷'];
  if (face === '?') return [...SINGLE_DIGITS, ...MULTI_DIGITS, ...OPERATORS, '='];
  return [face];
}

export function createBag(rand: () => number = Math.random): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (const [face, [count, points]] of Object.entries(TILE_SET)) {
    for (let i = 0; i < count; i++) tiles.push({ id: id++, face, points });
  }
  return shuffle(tiles, rand);
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function tileValue(tiles: Tile[]): number {
  return tiles.reduce((n, t) => n + t.points, 0);
}

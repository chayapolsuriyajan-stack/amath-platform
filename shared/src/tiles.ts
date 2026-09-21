import type { Tile } from './types';

/**
 * A-Math Junior Edition: 70 tiles. face -> [count, points].
 * Numbers run 0-16 plus a separate 20 (no 17, 18 or 19), and there are no
 * separate × and ÷ tiles — only the dual ×/÷ tile.
 */
export const TILE_SET: Record<string, [number, number]> = {
  '0': [4, 1], '1': [4, 1], '2': [4, 1], '3': [4, 1], '4': [4, 2],
  '5': [3, 2], '6': [3, 2], '7': [2, 2], '8': [3, 2], '9': [2, 2],
  '10': [1, 3], '11': [1, 4], '12': [1, 3], '13': [1, 6], '14': [1, 4],
  '15': [1, 4], '16': [1, 4], '20': [1, 5],
  '+': [4, 2], '-': [4, 2], '+/-': [5, 1], '×/÷': [4, 1],
  '=': [8, 1], '?': [4, 0],
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

/**
 * A random number in [0, 1) from the platform's cryptographic generator.
 * Math.random is fast but its state can be reconstructed from enough output,
 * which would let a player predict the bag.
 */
export function secureRandom(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] / 2 ** 32;
  }
  return Math.random();
}

export function createBag(rand: () => number = secureRandom): Tile[] {
  const faces: [string, number][] = [];
  for (const [face, [count, points]] of Object.entries(TILE_SET)) {
    for (let i = 0; i < count; i++) faces.push([face, points]);
  }
  // ids are handed out after shuffling, so an id says nothing about the face behind it
  return shuffle(faces, rand).map(([face, points], id) => ({ id, face, points }));
}

export function shuffle<T>(arr: T[], rand: () => number = secureRandom): T[] {
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

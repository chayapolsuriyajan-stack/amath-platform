import { describe, expect, it } from 'vitest';
import { emptyBoard } from '@amath/shared';
import type { Board, Tile } from '@amath/shared';
import { checkDraft, type DraftTile } from '../src/draft';

let id = 100;
const tile = (face: string): Tile => ({ id: id++, face, points: 1 });

/** put a row of symbols down starting at (row, col); returns the rack and the pending tiles */
function lay(faces: string[], row: number, col: number, dir: 'across' | 'down' = 'across') {
  const rack = faces.map(tile);
  const pending: DraftTile[] = rack.map((t, i) => ({
    tile: t,
    row: dir === 'across' ? row : row + i,
    col: dir === 'across' ? col + i : col,
    sym: t.face,
  }));
  return { rack, pending };
}

describe('checking the tiles on the board before submitting', () => {
  it('has nothing to judge until a tile is down', () => {
    expect(checkDraft(emptyBoard(), [tile('1')], [], true)).toBeNull();
  });

  it('accepts a correct opening across the star', () => {
    const { rack, pending } = lay(['1', '+', '2', '=', '3'], 7, 5);
    expect(checkDraft(emptyBoard(), rack, pending, true)).toEqual({ ok: true });
  });

  it('refuses a wrong answer and says the two sides differ', () => {
    const { rack, pending } = lay(['1', '+', '2', '=', '4'], 7, 5);
    const res = checkDraft(emptyBoard(), rack, pending, true);
    expect(res).toMatchObject({ ok: false });
    expect(res && !res.ok && res.reason).toContain('not equal');
  });

  it('refuses an equation that is still being built', () => {
    const { rack, pending } = lay(['1', '+', '2'], 7, 5);
    expect(checkDraft(emptyBoard(), rack, pending, true)).toMatchObject({ ok: false });
    const half = lay(['1', '+', '2', '='], 7, 5);
    expect(checkDraft(emptyBoard(), half.rack, half.pending, true)).toMatchObject({ ok: false });
  });

  it('refuses a first move that misses the star square', () => {
    const { rack, pending } = lay(['1', '+', '2', '=', '3'], 2, 2);
    const res = checkDraft(emptyBoard(), rack, pending, true);
    expect(res && !res.ok && res.reason).toContain('★');
  });

  it('refuses a plus sign in front of a number', () => {
    const { rack, pending } = lay(['+', '7', '=', '5', '+', '2'], 7, 4);
    const res = checkDraft(emptyBoard(), rack, pending, true);
    expect(res && !res.ok && res.reason).toContain('plus');
  });

  it('refuses tiles that are not in one line, or have a gap', () => {
    const rack = ['1', '+', '2', '=', '3'].map(tile);
    const bent: DraftTile[] = rack.map((t, i) => ({ tile: t, row: 7 + (i % 2), col: 5 + i, sym: t.face }));
    expect(checkDraft(emptyBoard(), rack, bent, true)).toMatchObject({ ok: false });
    const gap: DraftTile[] = rack.map((t, i) => ({ tile: t, row: 7, col: i === 4 ? 10 : 5 + i, sym: t.face }));
    expect(checkDraft(emptyBoard(), rack, gap, true)).toMatchObject({ ok: false });
  });

  it('accepts a move that builds on tiles already on the board, and refuses one that floats free', () => {
    const board: Board = emptyBoard();
    ['1', '+', '2', '=', '3'].forEach((s, i) => {
      board[7][5 + i] = { tile: tile(s), sym: s };
    });
    // 4+2=6 going down through the existing = at (7,8)
    const down = ['4', '+', '2', '6'].map(tile);
    const rows = [4, 5, 6, 8];
    const good: DraftTile[] = down.map((t, i) => ({ tile: t, row: rows[i], col: 8, sym: t.face }));
    expect(checkDraft(board, down, good, false)).toEqual({ ok: true });

    const far = lay(['4', '+', '2', '=', '6'], 1, 1);
    const res = checkDraft(board, far.rack, far.pending, false);
    expect(res && !res.ok && res.reason).toContain('connect');
  });

  it('uses the operator chosen for a +/- or ×/÷ tile', () => {
    const rack = ['6', '+/-', '1', '=', '5'].map(tile);
    const place = (op: string): DraftTile[] => rack.map((t, i) => ({ tile: t, row: 7, col: 5 + i, sym: i === 1 ? op : t.face }));
    expect(checkDraft(emptyBoard(), rack, place('-'), true)).toEqual({ ok: true }); // 6-1=5
    expect(checkDraft(emptyBoard(), rack, place('+'), true)).toMatchObject({ ok: false }); // 6+1=5
  });
});

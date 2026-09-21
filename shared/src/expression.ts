import { MULTI_DIGITS, OPERATORS, SINGLE_DIGITS } from './tiles';

/** Exact rational number so that division never suffers from float rounding. */
class Frac {
  n: bigint;
  d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = n / g;
    this.d = d / g;
  }
  add(o: Frac) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  mul(o: Frac) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o: Frac) { return new Frac(this.n * o.d, this.d * o.n); }
  isZero() { return this.n === 0n; }
  eq(o: Frac) { return this.n === o.n && this.d === o.d; }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

type Tok = { t: 'num'; v: bigint } | { t: 'op'; v: string } | { t: 'eq' };

const isSingle = (s: string) => SINGLE_DIGITS.includes(s);
const isMulti = (s: string) => MULTI_DIGITS.includes(s);

/**
 * Group symbols into numbers/operators. Consecutive single digits join into one number
 * (max 3 digits, no zero padding). 10-16 and 20 are whole numbers that never join.
 */
function tokenize(syms: string[]): Tok[] | string {
  const toks: Tok[] = [];
  let i = 0;
  while (i < syms.length) {
    const s = syms[i];
    if (isSingle(s)) {
      let j = i;
      while (j < syms.length && isSingle(syms[j])) j++;
      const run = syms.slice(i, j);
      if (run.length > 3) return 'Only 3 digits can be joined into one number';
      if (run.length > 1 && run[0] === '0') return 'A number cannot start with a zero';
      toks.push({ t: 'num', v: BigInt(run.join('')) });
      i = j;
    } else if (isMulti(s)) {
      toks.push({ t: 'num', v: BigInt(s) });
      i++;
    } else if (s === '=') {
      toks.push({ t: 'eq' });
      i++;
    } else if (OPERATORS.includes(s)) {
      toks.push({ t: 'op', v: s });
      i++;
    } else {
      return `Unknown symbol ${s}`;
    }
  }
  for (let k = 1; k < toks.length; k++) {
    if (toks[k].t === 'num' && toks[k - 1].t === 'num') {
      return '10-16 and 20 tiles cannot be joined to other numbers';
    }
  }
  return toks;
}

function evalSide(toks: Tok[]): Frac | string {
  if (toks.length === 0) return 'Both sides of = need a value';
  let i = 0;
  let negate = false;
  const first = toks[0];
  if (first.t === 'op') {
    // only a minus may lead a side: "-6 = 4 - 10" is fine, "+7 = 5 + 2" is not
    if (first.v === '+') return 'A plus sign cannot go in front of a number, only a minus can';
    if (first.v !== '-') return `An equation cannot start with ${first.v}`;
    negate = true;
    i = 1;
    const next = toks[1];
    if (!next || next.t !== 'num') return 'A minus sign must be followed by a number';
    if (next.v === 0n) return 'A minus sign cannot be put before zero';
  }
  const terms: { op: string; val: Frac }[] = [];
  let expectNum = true;
  let pendingOp = '+';
  for (; i < toks.length; i++) {
    const tk = toks[i];
    if (expectNum) {
      if (tk.t !== 'num') return 'Operators cannot be next to each other';
      terms.push({ op: pendingOp, val: new Frac(terms.length === 0 && negate ? -tk.v : tk.v) });
      expectNum = false;
    } else {
      if (tk.t !== 'op') return 'Numbers must be separated by an operator';
      pendingOp = tk.v;
      expectNum = true;
    }
  }
  if (expectNum) return 'An equation cannot end with an operator';

  // × and ÷ bind tighter than + and −
  const summands: { sign: bigint; val: Frac }[] = [];
  for (const term of terms) {
    if (term.op === '×' || term.op === '÷') {
      const last = summands[summands.length - 1];
      if (term.op === '×') last.val = last.val.mul(term.val);
      else {
        if (term.val.isZero()) return 'Cannot divide by zero';
        last.val = last.val.div(term.val);
      }
    } else {
      summands.push({ sign: term.op === '-' ? -1n : 1n, val: term.val });
    }
  }
  let total = new Frac(0n);
  for (const s of summands) total = total.add(s.val.mul(new Frac(s.sign)));
  return total;
}

export type EquationResult = { ok: true } | { ok: false; error: string };

/** Check one horizontal/vertical line of symbols (a contiguous run of tiles). */
export function checkEquation(syms: string[]): EquationResult {
  const toks = tokenize(syms);
  if (typeof toks === 'string') return { ok: false, error: toks };
  const sides: Tok[][] = [[]];
  for (const tk of toks) {
    if (tk.t === 'eq') sides.push([]);
    else sides[sides.length - 1].push(tk);
  }
  if (sides.length < 2) return { ok: false, error: 'An equation needs an = sign' };
  let ref: Frac | null = null;
  for (const side of sides) {
    const v = evalSide(side);
    if (typeof v === 'string') return { ok: false, error: v };
    if (ref && !ref.eq(v)) return { ok: false, error: `The two sides are not equal (${ref} ≠ ${v})` };
    ref = v;
  }
  return { ok: true };
}

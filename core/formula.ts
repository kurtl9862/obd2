/**
 * Evaluates the formulas carmaker-specific values are shared in, Torque-style:
 * A is the first data byte after the echo, B the second ... Z, then AA, AB ... ("A-40",
 * "(A*256+B)/10"). A small parser instead of eval, so a shared profile can't run code.
 */

type Token = { kind: 'num'; value: number } | { kind: 'var'; name: string } | { kind: 'op'; op: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        // allow exponents like 2.3e-9
        if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '-' || src[j + 1] === '+')) j++;
        j++;
      }
      tokens.push({ kind: 'num', value: Number(src.slice(i, j)) });
      i = j;
    } else if (/[A-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Z]/.test(src[j])) j++;
      tokens.push({ kind: 'var', name: src.slice(i, j) });
      i = j;
    } else if ('+-*/^()'.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i++;
    } else {
      throw new Error(`Unexpected "${c}" in formula`);
    }
  }
  return tokens;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26, "AD" -> 29. */
export function byteIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function evaluateFormula(formula: string, bytes: number[]): number {
  const tokens = tokenize(formula.toUpperCase());
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (op: string) => {
    const t = peek();
    return t?.kind === 'op' && t.op === op;
  };

  // expr := term (('+'|'-') term)* ; term := power (('*'|'/') power)* ; power := unary ('^' power)?
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { op: string }).op;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[pos++] as { op: string }).op;
      const r = power();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const power = (): number => {
    const base = unary();
    if (isOp('^')) {
      pos++;
      return base ** power();
    }
    return base;
  };
  const unary = (): number => {
    if (isOp('-')) {
      pos++;
      return -unary();
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return atom();
  };
  const atom = (): number => {
    const t = tokens[pos++];
    if (!t) throw new Error('Formula ended early');
    if (t.kind === 'num') return t.value;
    if (t.kind === 'var') {
      const i = byteIndex(t.name);
      if (i >= bytes.length) throw new Error(`Formula uses byte ${t.name}, but the reply has ${bytes.length} bytes`);
      return bytes[i];
    }
    if (t.op === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('Missing ")" in formula');
      pos++;
      return v;
    }
    throw new Error(`Unexpected "${t.op}" in formula`);
  };

  const value = expr();
  if (pos !== tokens.length) throw new Error('Extra text at the end of the formula');
  return value;
}

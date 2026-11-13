// Parser for the VNNLIB subset used by VNN-COMP.
//
// A VNNLIB file describes the UNSAFE condition: the instance is "sat" if some
// input in the box makes the output constraint true (that input is a
// counterexample), "unsat" if none does.
//
// The whole property is converted to disjunctive normal form and grouped by
// input box:
//   regions: [{ lo, hi, disjuncts: [{ atoms: [{ a, b, strict }] }] }]
// Each atom means  a·y - b <= 0  (or < 0 when strict). A disjunct (a
// conjunction of atoms) holds when every atom holds; the region is violated
// when any disjunct holds for some input in [lo, hi].

const MAX_CONJUNCTIONS = 100000;

function tokenize(text) {
  const tokens = [];
  const src = text.replace(/;[^\n]*/g, " ");
  const re = /\(|\)|[^\s()]+/g;
  let m;
  while ((m = re.exec(src))) tokens.push(m[0]);
  return tokens;
}

function parseSexprs(tokens) {
  let pos = 0;
  function parseOne() {
    const t = tokens[pos++];
    if (t === "(") {
      const list = [];
      while (tokens[pos] !== ")") {
        if (pos >= tokens.length) throw new Error("VNNLIB: unbalanced parentheses (missing ')').");
        list.push(parseOne());
      }
      pos++;
      return list;
    }
    if (t === ")") throw new Error("VNNLIB: unbalanced parentheses (unexpected ')').");
    return t;
  }
  const out = [];
  while (pos < tokens.length) out.push(parseOne());
  return out;
}

const show = (e) => (Array.isArray(e) ? `(${e.map(show).join(" ")})` : e);

function parseNumber(tok) {
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) return null;
  return Number(tok);
}

// Linear expression: { terms: Map(varName -> coeff), c: constant }
function linear(expr, vars) {
  if (!Array.isArray(expr)) {
    const n = parseNumber(expr);
    if (n !== null) return { terms: new Map(), c: n };
    if (!vars.has(expr)) throw new Error(`VNNLIB: unknown symbol "${expr}".`);
    return { terms: new Map([[expr, 1]]), c: 0 };
  }
  const [op, ...args] = expr;
  if (op === "+") return args.map((a) => linear(a, vars)).reduce(addLin, { terms: new Map(), c: 0 });
  if (op === "-") {
    const parts = args.map((a) => linear(a, vars));
    if (parts.length === 1) return scaleLin(parts[0], -1);
    return parts.slice(1).reduce((acc, p) => addLin(acc, scaleLin(p, -1)), parts[0]);
  }
  if (op === "*") {
    const parts = args.map((a) => linear(a, vars));
    const nonConst = parts.filter((p) => p.terms.size > 0);
    if (nonConst.length > 1) throw new Error(`VNNLIB: non-linear term ${show(expr)}.`);
    const k = parts.filter((p) => p.terms.size === 0).reduce((acc, p) => acc * p.c, 1);
    return nonConst.length ? scaleLin(nonConst[0], k) : { terms: new Map(), c: k };
  }
  throw new Error(`VNNLIB: unsupported expression ${show(expr)}.`);
}

function addLin(a, b) {
  const terms = new Map(a.terms);
  for (const [k, v] of b.terms) terms.set(k, (terms.get(k) ?? 0) + v);
  return { terms, c: a.c + b.c };
}

function scaleLin(a, k) {
  return { terms: new Map([...a.terms].map(([n, v]) => [n, v * k])), c: a.c * k };
}

// Comparison -> list of atoms { terms, c, strict } meaning terms + c <= 0 (< 0 if strict).
function comparisonAtoms(expr, vars) {
  const [op, ...args] = expr;
  if (args.length < 2) throw new Error(`VNNLIB: comparison needs two operands: ${show(expr)}.`);
  const atoms = [];
  for (let i = 0; i + 1 < args.length; i++) {
    const l = linear(args[i], vars);
    const r = linear(args[i + 1], vars);
    const lMinusR = addLin(l, scaleLin(r, -1));
    if (op === "<=" || op === "<") atoms.push({ ...lMinusR, strict: op === "<" });
    else if (op === ">=" || op === ">") atoms.push({ ...scaleLin(lMinusR, -1), strict: op === ">" });
    else if (op === "=") atoms.push({ ...lMinusR, strict: false }, { ...scaleLin(lMinusR, -1), strict: false });
  }
  return atoms;
}

// Expression -> DNF: array of conjunctions, each an array of atoms.
function toDnf(expr, vars) {
  if (!Array.isArray(expr)) {
    if (expr === "true") return [[]];
    if (expr === "false") return [];
    throw new Error(`VNNLIB: unsupported assertion "${expr}".`);
  }
  const [op, ...args] = expr;
  if (op === "and") return args.map((a) => toDnf(a, vars)).reduce(productDnf, [[]]);
  if (op === "or") return args.flatMap((a) => toDnf(a, vars));
  if (["<=", ">=", "<", ">", "="].includes(op)) return [comparisonAtoms(expr, vars)];
  throw new Error(`VNNLIB: unsupported operator "${op}" in ${show(expr)}.`);
}

function productDnf(a, b) {
  if (a.length * b.length > MAX_CONJUNCTIONS) {
    throw new Error(`VNNLIB: property expands to more than ${MAX_CONJUNCTIONS} cases.`);
  }
  const out = [];
  for (const x of a) for (const y of b) out.push([...x, ...y]);
  return out;
}

function varIndex(name, prefix) {
  const m = new RegExp(`^${prefix}_(\\d+)$`).exec(name);
  return m ? Number(m[1]) : null;
}

export function parseVnnlib(text) {
  const forms = parseSexprs(tokenize(text));
  const vars = new Set();
  let numInputs = 0;
  let numOutputs = 0;
  const asserts = [];

  for (const form of forms) {
    if (!Array.isArray(form) || form.length === 0) {
      throw new Error(`VNNLIB: unexpected top-level token ${show(form)}.`);
    }
    const head = form[0];
    if (head === "declare-const" || head === "declare-fun") {
      const name = form[1];
      const xi = varIndex(name, "X");
      const yi = varIndex(name, "Y");
      if (xi === null && yi === null) {
        throw new Error(`VNNLIB: variable "${name}" is not named X_i or Y_j.`);
      }
      vars.add(name);
      if (xi !== null) numInputs = Math.max(numInputs, xi + 1);
      if (yi !== null) numOutputs = Math.max(numOutputs, yi + 1);
    } else if (head === "assert") {
      asserts.push(form[1]);
    } else if (["set-logic", "check-sat", "get-model", "exit", "set-info", "set-option"].includes(head)) {
      // ignored
    } else {
      throw new Error(`VNNLIB: unsupported command "${head}".`);
    }
  }

  if (numInputs === 0) throw new Error("VNNLIB: no input variables (X_i) declared.");
  if (numOutputs === 0) throw new Error("VNNLIB: no output variables (Y_j) declared.");

  const dnf = asserts.map((a) => toDnf(a, vars)).reduce(productDnf, [[]]);

  const regionsByKey = new Map();
  for (const conj of dnf) {
    const lo = new Array(numInputs).fill(-Infinity);
    const hi = new Array(numInputs).fill(Infinity);
    const outAtoms = [];
    let infeasible = false;

    for (const atom of conj) {
      const names = [...atom.terms.keys()].filter((k) => atom.terms.get(k) !== 0);
      const xs = names.filter((n) => varIndex(n, "X") !== null);
      const ys = names.filter((n) => varIndex(n, "Y") !== null);

      if (xs.length && ys.length) {
        throw new Error("VNNLIB: constraints mixing inputs and outputs are not supported.");
      }
      if (!xs.length && !ys.length) {
        const holds = atom.strict ? atom.c < 0 : atom.c <= 0;
        if (!holds) infeasible = true;
        continue;
      }
      if (xs.length) {
        if (xs.length > 1) throw new Error("VNNLIB: input constraints must bound one variable at a time (boxes only).");
        if (atom.strict) throw new Error("VNNLIB: strict input bounds (< or >) are not supported.");
        const i = varIndex(xs[0], "X");
        const k = atom.terms.get(xs[0]);
        const bound = -atom.c / k + 0; // + 0 turns -0 into 0
        if (k > 0) hi[i] = Math.min(hi[i], bound);
        else lo[i] = Math.max(lo[i], bound);
        continue;
      }
      const a = new Float64Array(numOutputs);
      for (const n of ys) a[varIndex(n, "Y")] = atom.terms.get(n);
      outAtoms.push({ a, b: -atom.c, strict: atom.strict });
    }

    if (infeasible || lo.some((l, i) => l > hi[i])) continue;

    const key = `${lo.join(",")}|${hi.join(",")}`;
    if (!regionsByKey.has(key)) regionsByKey.set(key, { lo, hi, disjuncts: [] });
    regionsByKey.get(key).disjuncts.push({ atoms: outAtoms });
  }

  const regions = [...regionsByKey.values()];
  regions.forEach((r, idx) => {
    r.lo.forEach((l, i) => {
      if (!Number.isFinite(l) || !Number.isFinite(r.hi[i])) {
        throw new Error(`VNNLIB: X_${i} is not bounded on both sides${regions.length > 1 ? ` in input region ${idx + 1}` : ""}.`);
      }
    });
  });

  return { numInputs, numOutputs, regions };
}

/** Margin of one region at output y (doubles): min over disjuncts of max over atoms of a·y - b. */
export function regionMargin64(region, y) {
  let best = Infinity;
  for (const d of region.disjuncts) {
    let m = -Infinity;
    for (const atom of d.atoms) {
      let g = -atom.b;
      for (let j = 0; j < atom.a.length; j++) g += atom.a[j] * y[j];
      if (g > m) m = g;
    }
    if (m < best) best = m;
  }
  return best;
}

/** True if some disjunct holds exactly at y (doubles), respecting strictness. */
export function regionViolated64(region, y) {
  return region.disjuncts.some((d) =>
    d.atoms.every((atom) => {
      let g = -atom.b;
      for (let j = 0; j < atom.a.length; j++) g += atom.a[j] * y[j];
      return atom.strict ? g < 0 : g <= 0;
    }),
  );
}

/** Text of a counterexample in the VNN-COMP result format. */
export function formatCounterexample(x, y) {
  const lines = [];
  x.forEach((v, i) => lines.push(`(X_${i} ${formatReal(v)})`));
  y.forEach((v, j) => lines.push(`(Y_${j} ${formatReal(v)})`));
  return `sat\n(${lines.join("\n ")})\n`;
}

function formatReal(v) {
  // Shortest string that round-trips the double exactly.
  return String(Number(v));
}

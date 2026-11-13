// Mode B: robustness around user-supplied points.
//
// CSV format: one point per row, the model's input features first (flattened,
// in the model's own, possibly normalised, units). For classification the
// next column is the integer class label. A first row that is not numeric is
// treated as a header. Lines starting with # are ignored.

export const TASKS = {
  classification: "Classification",
  "regression-standard": "Regression: standard (δ)",
  "regression-lipschitz": "Regression: Lipschitz (L)",
};

export function parsePointsCsv(text, inputSize, task) {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[,;\t ]+/).filter(Boolean));

  if (rows.length && rows[0].some((c) => !Number.isFinite(Number(c)))) rows.shift();
  if (!rows.length) throw new Error("The CSV has no data rows.");

  const needLabel = task === "classification";
  const inputs = [];
  const labels = needLabel ? [] : null;

  rows.forEach((cells, r) => {
    const values = cells.map(Number);
    const bad = values.findIndex((v) => !Number.isFinite(v));
    if (bad >= 0) throw new Error(`CSV row ${r + 1}: "${cells[bad]}" is not a number.`);
    const want = inputSize + (needLabel ? 1 : 0);
    if (values.length < want) {
      throw new Error(
        `CSV row ${r + 1} has ${values.length} columns; the model has ${inputSize} inputs` +
          (needLabel ? " and classification needs a label column after them." : "."),
      );
    }
    inputs.push(values.slice(0, inputSize));
    if (needLabel) {
      const label = values[inputSize];
      if (!Number.isInteger(label) || label < 0) throw new Error(`CSV row ${r + 1}: label ${label} is not a class index.`);
      labels.push(label);
    }
  });

  return { inputs, labels, extraColumns: rows[0].length - inputSize - (needLabel ? 1 : 0) };
}

/** "" -> null, "0" -> [0,0,...], "0,1,2" -> [0,1,2]. */
export function parseBoundList(text, inputSize, what) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const values = t.split(/[,;\s]+/).filter(Boolean).map(Number);
  if (values.some((v) => Number.isNaN(v))) throw new Error(`${what}: not a list of numbers.`);
  if (values.length === 1) return new Array(inputSize).fill(values[0]);
  if (values.length !== inputSize) {
    throw new Error(`${what}: expected 1 or ${inputSize} values, got ${values.length}.`);
  }
  return values;
}

/** The L-infinity ball of radius eps around x, clipped to the domain. */
export function epsilonBox(x, eps, domainLo, domainHi) {
  const lo = x.map((v, i) => Math.max(v - eps, domainLo ? domainLo[i] : -Infinity));
  const hi = x.map((v, i) => Math.min(v + eps, domainHi ? domainHi[i] : Infinity));
  return { lo, hi };
}

export function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

// Mode B: robustness around user-supplied points.
//
// CSV format: one point per row, the model's input features first (flattened,
// in the model's own, possibly normalised, units). For classification the
// next column is the integer class label. A first row that is not numeric is
// treated as a header. Lines starting with # are ignored.

export const TASKS = {
  classification: "Classification robustness (ε-ball)",
  "regression-standard": "Regression: standard robustness (δ), attack only",
  "regression-lipschitz": "Regression: Lipschitz robustness (L), attack only",
  properties: "Output constraints (VNNLIB file)",
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

/**
 * Problems that make a classification check meaningless, before running:
 * fewer than two outputs (argmax is then always 0), or a CSV label that is
 * not an output index. Returns a list of { short, text } messages (empty when fine). CSV
 * errors other than labels are left to the run, which reports them.
 */
export function classificationSetupErrors(outputSize, csvText, inputSize) {
  if (outputSize < 2) {
    return [
      {
        short: `Can't run: the model has ${outputSize} output; classification needs one per class.`,
        text: `The model has ${outputSize} output, so every point is classified as class 0 and robustness is meaningless. Export one output (logit) per class, or use a regression property.`,
      },
    ];
  }
  if (!csvText) return [];
  let labels;
  try {
    ({ labels } = parsePointsCsv(csvText, inputSize, "classification"));
  } catch {
    return [];
  }
  const bad = labels.findIndex((l) => l >= outputSize);
  if (bad < 0) return [];
  const text = `CSV row ${bad + 1}: label ${labels[bad]}, but the model has only ${outputSize} outputs (labels 0–${outputSize - 1}).`;
  return [{ short: `Can't run: ${text}`, text }];
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

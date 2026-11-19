// Reads `vehicle verify` output (ANSI codes already stripped by the runner) into a verdict per
// property. Works on partial output too, so rows can fill in while the job streams.
//
// Shape of the output (Vehicle 0.x):
//   Warning: In property 'p', at least one of the generated queries ... strict inequality ...
//   Verifying properties:
//     p [=====] 1/1 queries
//       result: 🗸 - Marabou proved no counterexample exists
//     q [=====] 1/1 queries
//       result: ✗ - Marabou found a counterexample
//         x: const 0.75 [2]
//   Error: syntax error at line 9, column 26 before `.'

/**
 * Vehicle redraws progress bars with carriage returns; keep only what was drawn last (a line can
 * also end with one, when the result follows on the next line). Colour codes are removed.
 */
export function displayText(output) {
  return output
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .trimStart()
    .split("\n")
    .map((line) => line.split("\r").filter((part) => part.trim()).pop() ?? "")
    .join("\n");
}

const PROGRESS = /^\s+(\S+)\s+\[[^\]]*\]\s+(\d+)\/(\d+)\s+quer/;
const RESULT = /^\s*result:\s*(\S+)\s*-\s*(.*)$/;
const VALUE = /^\s+([A-Za-z_][\w'!.[\]]*)\s*:\s*(.+)$/;
const STRICT_WARNING = /^Warning: In property '([^']+)'.*strict inequalit/i;

function verdictOf(symbol, message) {
  if (/^[🗸✓✔]/u.test(symbol)) return "proved";
  if (/^[✗✘×]/u.test(symbol)) return "false";
  if (/timeout|time limit/i.test(message)) return "timeout";
  return "unknown";
}

/** "const 0.75 [2]" -> "[0.75, 0.75]"; other forms are returned as Vehicle printed them. */
export function formatValue(raw) {
  const text = raw.trim();
  const constant = /^const\s+(\S+)\s+\[([\d,\s]*)\]$/.exec(text);
  if (constant) {
    const [, value, shapeText] = constant;
    const shape = shapeText.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
    const size = shape.reduce((a, b) => a * b, 1);
    if (shape.length === 0) return value;
    if (shape.length === 1 && size <= 12) return `[${Array(size).fill(value).join(", ")}]`;
    return `every entry ${value} (shape [${shape.join(", ")}])`;
  }
  return text;
}

/**
 * Returns { properties: [{ name, verdict: running|proved|false|timeout|unknown, message,
 *   done, total, values: [{ name, raw, text }] }], strict: Set<name>, warnings: [string],
 *   error: string|null, verifying: boolean }.
 */
export function parseVehicleOutput(output) {
  const lines = displayText(output).split("\n");
  const result = { properties: [], strict: new Set(), warnings: [], error: null, verifying: false };
  let current = null;
  let skippingWarning = false; // inside a multi-paragraph warning block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Error:/.test(line)) {
      result.error = lines.slice(i).join("\n").trim();
      break;
    }
    if (/^Warning:/.test(line)) {
      skippingWarning = true;
      const strict = STRICT_WARNING.exec(line);
      if (strict) result.strict.add(strict[1]);
      else result.warnings.push(line.replace(/^Warning:\s*/, ""));
      continue;
    }
    if (/^Verifying properties:/.test(line)) {
      skippingWarning = false;
      result.verifying = true;
      continue;
    }
    if (skippingWarning || !result.verifying) continue;

    const progress = PROGRESS.exec(line);
    if (progress) {
      const [, name, done, total] = progress;
      current = result.properties.find((p) => p.name === name);
      if (!current) {
        current = { name, verdict: "running", message: "", done: 0, total: 0, values: [] };
        result.properties.push(current);
      }
      current.done = Number(done);
      current.total = Number(total);
      continue;
    }
    const verdict = RESULT.exec(line);
    if (verdict && current) {
      current.verdict = verdictOf(verdict[1], verdict[2]);
      current.message = verdict[2].trim();
      continue;
    }
    if (current && current.verdict !== "running" && line.trim()) {
      const value = VALUE.exec(line);
      if (value) current.values.push({ name: value[1], raw: value[2].trim(), text: formatValue(value[2]) });
      else current.values.push({ name: null, raw: line.trim(), text: line.trim() });
    }
  }
  return result;
}

/** A short label for a verdict, from Vehicle's own message. */
export function verdictLabel(property) {
  const { verdict, message } = property;
  if (verdict === "proved") return /witness/i.test(message) ? "witness found" : "proved";
  if (verdict === "false") {
    if (/counterexample/i.test(message)) return "counterexample";
    if (/witness/i.test(message)) return "no witness";
    return "false";
  }
  if (verdict === "timeout") return "timeout";
  if (verdict === "running") return property.total ? `checking ${property.done}/${property.total} queries` : "checking";
  return message || "unknown";
}

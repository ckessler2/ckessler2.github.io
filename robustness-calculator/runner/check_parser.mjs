// The page's parser (src/vehicle/output.js) on the smoke test's real Vehicle output, so a change in
// Vehicle's output format fails the image build instead of quietly breaking the results table.
// node runner/check_parser.mjs OUTPUT_FILE
import { readFileSync } from "node:fs";
import { parseVehicleOutput } from "../src/vehicle/output.js";

const { properties, error } = parseVehicleOutput(readFileSync(process.argv[2], "utf8"));
const verdicts = Object.fromEntries(properties.map((p) => [p.name, p.verdict]));
const expected = { belowTwoAndAHalf: "proved", belowOneAndAHalf: "false" };
const ok = !error && Object.entries(expected).every(([name, verdict]) => verdicts[name] === verdict)
  && properties.find((p) => p.name === "belowOneAndAHalf")?.values.length > 0;
console.log(ok ? "parser ok:" : "parser FAILED:", JSON.stringify({ verdicts, error }));
process.exit(ok ? 0 : 1);

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVehicleOutput } from "../src/vehicle/output.js";

const red = (s) => `\x1b[91m${s}\x1b[m`;
const green = (s) => `\x1b[92m${s}\x1b[m`;

test("reads results after progress lines that end with a carriage return, with colour codes", () => {
  // As Vehicle 0.29 prints it when stdout is not a terminal (Iris example, two properties).
  const output = [
    "Verifying properties:",
    "  property1 [......] 0/2 queries\r",
    `    result: ${red("✗")} - Marabou found a counterexample`,
    "      x: [ 4.3, 3.0, 3.85896, 0.1 ]",
    "  property5 [......] 0/2 queries\r  property5 [======] 2/2 queries",
    `    result: ${green("🗸")} - Marabou proved no counterexample exists`,
    "",
  ].join("\n");
  const { properties } = parseVehicleOutput(output);
  assert.deepEqual(
    properties.map((p) => [p.name, p.verdict, p.done, p.total]),
    [
      ["property1", "false", 0, 2],
      ["property5", "proved", 2, 2],
    ],
  );
  assert.equal(properties[0].values[0].text, "[ 4.3, 3.0, 3.85896, 0.1 ]");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { classificationSetupErrors } from "../src/spec/points.js";
import { friendlyError } from "../src/lib/errors.js";
import { BENCHMARKS } from "../src/spec/benchmark.js";

test("classification setup: a single-output model is refused", () => {
  const errors = classificationSetupErrors(1, "0.5,0.5,0\n0.1,0.2,0\n", 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0].text, /1 output/);
  assert.match(errors[0].text, /one output \(logit\) per class/);
  assert.match(errors[0].short, /^Can't run/);
});

test("classification setup: a label beyond the outputs names its row", () => {
  const csv = "x1,x2,label\n0.5,0.5,0\n# comment\n0.1,0.2,3\n";
  const errors = classificationSetupErrors(3, csv, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0].text, /^CSV row 2: label 3/);
  assert.match(errors[0].text, /only 3 outputs/);
});

test("classification setup: valid labels and unparsable CSVs pass (the run reports CSV errors)", () => {
  assert.deepEqual(classificationSetupErrors(3, "0.5,0.5,2\n", 2), []);
  assert.deepEqual(classificationSetupErrors(3, "", 2), []);
  assert.deepEqual(classificationSetupErrors(3, "0.5\n", 2), []);
});

test("friendly errors: non-ONNX file and blocked CDN", () => {
  const bad = friendlyError("Unsupported protobuf wire type 7.");
  assert.equal(bad.text, "This doesn't look like an ONNX model file.");
  assert.equal(bad.raw, "Unsupported protobuf wire type 7.");

  const cdn = friendlyError("Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.fesm.min.js");
  assert.equal(cdn.text, "Couldn't load TensorFlow.js from cdn.jsdelivr.net — check your network or ad-blocker.");
  assert.match(cdn.raw, /^Failed to fetch/);

  const ort = friendlyError("error loading dynamically imported module: https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs");
  assert.match(ort.text, /^Couldn't load onnxruntime from cdn\.jsdelivr\.net/);

  const other = friendlyError("ε must be a positive number.");
  assert.deepEqual(other, { text: "ε must be a positive number.", raw: null });
});

test("benchmark labels all name the VNN-COMP year and benchmark", () => {
  for (const b of BENCHMARKS) assert.match(b.label, /^VNN-COMP 20\d\d [\w]+: \S/, b.id);
});

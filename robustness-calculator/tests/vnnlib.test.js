import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVnnlib, regionMargin64, regionViolated64, formatCounterexample } from "../src/spec/vnnlib.js";
import { float32AtLeast, float32AtMost, makeBox, nextFloat32Up } from "../src/attack/box.js";

const header = `
(declare-const X_0 Real)
(declare-const X_1 Real)
(declare-const Y_0 Real)
(declare-const Y_1 Real)
(declare-const Y_2 Real)
`;

test("simple box and conjunction of output constraints (ACAS Xu property 2 style)", () => {
  const spec = parseVnnlib(`${header}
    ; comment
    (assert (<= X_0 0.5)) (assert (>= X_0 -0.5))
    (assert (<= X_1 1))   (assert (>= X_1 0))
    (assert (<= Y_1 Y_0))
    (assert (<= Y_2 Y_0))`);
  assert.equal(spec.numInputs, 2);
  assert.equal(spec.numOutputs, 3);
  assert.equal(spec.regions.length, 1);
  const [r] = spec.regions;
  assert.deepEqual(r.lo, [-0.5, 0]);
  assert.deepEqual(r.hi, [0.5, 1]);
  assert.equal(r.disjuncts.length, 1);
  assert.equal(r.disjuncts[0].atoms.length, 2);
  // Unsafe when Y_0 is the maximum.
  assert.equal(regionViolated64(r, [3, 1, 2]), true);
  assert.equal(regionViolated64(r, [1, 3, 2]), false);
  assert.equal(regionMargin64(r, [3, 1, 2]), -1); // max(1-3, 2-3)
  assert.equal(regionMargin64(r, [1, 3, 2]), 2);
});

test("disjunctions on the input side become separate regions (ACAS Xu property 6 style)", () => {
  const spec = parseVnnlib(`${header}
    (assert (or
      (and (<= X_0 1) (>= X_0 0.5) (<= X_1 1) (>= X_1 0))
      (and (<= X_0 -0.5) (>= X_0 -1) (<= X_1 1) (>= X_1 0))))
    (assert (or (and (<= Y_1 Y_0)) (and (<= Y_2 Y_0))))`);
  assert.equal(spec.regions.length, 2);
  assert.deepEqual(spec.regions[0].lo, [0.5, 0]);
  assert.deepEqual(spec.regions[1].hi, [-0.5, 1]);
  spec.regions.forEach((r) => assert.equal(r.disjuncts.length, 2));
  // margin = min over disjuncts: min(Y1-Y0, Y2-Y0)
  assert.equal(regionMargin64(spec.regions[0], [0, 5, -1]), -1);
});

test("linear expressions, constants on either side, strict and chained comparisons", () => {
  const spec = parseVnnlib(`${header}
    (assert (<= 0 X_0)) (assert (<= X_0 1)) (assert (<= -1 X_1 1))
    (assert (> (+ Y_0 (* 2 Y_1) (- Y_2)) 3.5))`);
  const [r] = spec.regions;
  assert.deepEqual(r.lo, [0, -1]);
  assert.deepEqual(r.hi, [1, 1]);
  const [atom] = r.disjuncts[0].atoms;
  // Y_0 + 2 Y_1 - Y_2 > 3.5   <=>   -(Y_0 + 2Y_1 - Y_2) + 3.5 < 0
  assert.deepEqual(Array.from(atom.a), [-1, -2, 1]);
  assert.equal(atom.b, -3.5);
  assert.equal(atom.strict, true);
  assert.equal(regionViolated64(r, [3.5, 0, 0]), false); // equality is not enough for >
  assert.equal(regionViolated64(r, [3.5000001, 0, 0]), true);
});

test("unsupported or ill-formed properties are refused clearly", () => {
  assert.throws(() => parseVnnlib(`${header} (assert (<= X_0 1))`), /X_0 is not bounded on both sides/);
  assert.throws(() => parseVnnlib(`${header} (assert (<= (+ X_0 X_1) 1))`), /one variable at a time/);
  assert.throws(() => parseVnnlib(`${header} (assert (<= X_0 Y_0))`), /mixing inputs and outputs/);
  assert.throws(() => parseVnnlib(`${header} (assert (not (<= Y_0 1)))`), /unsupported operator "not"/);
  assert.throws(() => parseVnnlib(`${header} (assert (<= (* Y_0 Y_1) 1))`), /non-linear/);
  assert.throws(() => parseVnnlib(`${header} (assert (<= X_0 1)`), /unbalanced/);
});

test("contradictory input bounds give no regions", () => {
  const spec = parseVnnlib(`${header} (assert (<= X_0 0)) (assert (>= X_0 1)) (assert (<= -1 X_1 1)) (assert (<= Y_0 0))`);
  assert.equal(spec.regions.length, 0);
});

test("counterexample text is in VNN-COMP format", () => {
  assert.equal(formatCounterexample([0.5, -1], [2, 3.25]), "sat\n((X_0 0.5)\n (X_1 -1)\n (Y_0 2)\n (Y_1 3.25))\n");
});

test("float32 bounds are rounded inwards", () => {
  for (const v of [0.6, -0.6, 0.1, 0.679857769, -0.129289109, 1e-30, 0, 3]) {
    const up = float32AtMost(v);
    const lo = float32AtLeast(v);
    assert.ok(up <= v && Math.fround(up) === up);
    assert.ok(lo >= v && Math.fround(lo) === lo);
    assert.ok(nextFloat32Up(up) > v || up === v);
  }
  const box = makeBox([0.1], [0.6]);
  assert.ok(box.lo32[0] >= 0.1 && box.hi32[0] <= 0.6);
  assert.throws(() => makeBox([0.1], [0.1]), /contains no float32 value/);
});

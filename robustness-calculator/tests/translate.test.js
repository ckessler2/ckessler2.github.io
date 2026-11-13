import { test } from "node:test";
import assert from "node:assert/strict";
import { tf, load } from "./helpers/setup.js";
import { model, node, tensor } from "./helpers/onnx-writer.js";
import { parseOnnxModel } from "../src/onnx/onnx-model.js";
import { translateModel } from "../src/onnx/translate.js";

function tfForward(m, rows) {
  return tf.tidy(() => m.forward(tf.tensor2d(rows.flat(), [rows.length, m.inputSize])).arraySync());
}

// y = relu(W1·x + b1)·W2 + b2, with weights small enough to check by hand.
const handNet = model({
  nodes: [
    node("Gemm", ["x", "W1", "b1"], ["h"], { transB: 1 }),
    node("Relu", ["h"], ["r"]),
    node("MatMul", ["r", "W2"], ["m"]),
    node("Add", ["m", "b2"], ["y"]),
  ],
  initializers: [
    tensor("W1", [2, 2], [1, -1, 0.5, 2]), // rows = output units (transB)
    tensor("b1", [2], [0, -1]),
    tensor("W2", [2, 1], [2, 1]),
    tensor("b2", [1], [0.25]),
  ],
  input: ["x", [1, 2]],
  output: ["y", [1, 1]],
});

function handNetExact([x0, x1]) {
  const h0 = Math.max(0, x0 - x1);
  const h1 = Math.max(0, 0.5 * x0 + 2 * x1 - 1);
  return 2 * h0 + h1 + 0.25;
}

test("hand-made Gemm/ReLU/MatMul network matches the exact answer and onnxruntime", async () => {
  const { model: m, checker } = await load(handNet);
  assert.equal(m.inputSize, 2);
  assert.equal(m.outputSize, 1);
  assert.equal(m.paramCount, 4 + 2 + 2 + 1);
  const xs = [
    [0, 0],
    [1, 0],
    [0.25, 0.75],
    [-1, 2],
    [3, -0.5],
  ];
  const yTf = tfForward(m, xs);
  for (let i = 0; i < xs.length; i++) {
    const exact = handNetExact(xs[i]);
    const ort = (await checker.evaluate(Float32Array.from(xs[i])))[0];
    assert.ok(Math.abs(yTf[i][0] - exact) < 1e-6, `tf ${yTf[i][0]} vs exact ${exact}`);
    assert.ok(Math.abs(ort - exact) < 1e-6, `ort ${ort} vs exact ${exact}`);
  }
});

test("Gemm honours transA/transB/alpha/beta", async () => {
  // Y = 2 · x · Wᵀ + 0.5 · C, x: [1,3], W: [2,3]
  const bytes = model({
    nodes: [node("Gemm", ["x", "W", "C"], ["y"], { transB: 1, alpha: { float: 2 }, beta: 0.5 })],
    initializers: [tensor("W", [2, 3], [1, 2, 3, -1, 0, 1]), tensor("C", [2], [4, -4])],
    input: ["x", [1, 3]],
    output: ["y", [1, 2]],
  });
  const { model: m, checker } = await load(bytes);
  const x = [0.5, -1, 2];
  const expected = [2 * (0.5 - 2 + 6) + 2, 2 * (-0.5 + 0 + 2) - 2];
  const [yTf] = tfForward(m, [x]);
  const yOrt = await checker.evaluate(Float32Array.from(x));
  expected.forEach((e, j) => {
    assert.ok(Math.abs(yTf[j] - e) < 1e-6);
    assert.ok(Math.abs(yOrt[j] - e) < 1e-6);
  });
});

test("Flatten, Reshape, elementwise ops, Constant and Identity agree with onnxruntime on a batch", async () => {
  // x [1,1,2,3] -> (x - mean) / std -> Flatten -> MatMul -> Tanh -> Reshape [1,2,2] -> Reshape [1,4]
  //            -> Mul(const) -> Sigmoid -> Identity
  const bytes = model({
    nodes: [
      node("Sub", ["x", "mean"], ["a"]),
      node("Div", ["a", "std"], ["b"]),
      node("Flatten", ["b"], ["c"], { axis: 1 }),
      node("MatMul", ["c", "W"], ["d"]),
      node("Tanh", ["d"], ["e"]),
      node("Constant", [], ["shape1"], { value: { tensor: tensor("s1", [3], [1, 2, 2], "int64") } }),
      node("Reshape", ["e", "shape1"], ["f"]),
      node("Reshape", ["f", "shape2"], ["g"]),
      node("Constant", [], ["k"], { value: { tensor: tensor("k", [4], [1, -2, 0.5, 3]) } }),
      node("Mul", ["g", "k"], ["h"]),
      node("Sigmoid", ["h"], ["i"]),
      node("Identity", ["i"], ["y"]),
    ],
    initializers: [
      tensor("mean", [1, 1, 1, 3], [0.1, -0.2, 0.3]),
      tensor("std", [3], [2, 0.5, 1]),
      tensor("W", [6, 4], Array.from({ length: 24 }, (_, i) => Math.sin(i + 1))),
      tensor("shape2", [2], [-1, 4], "int64"),
    ],
    input: ["x", ["batch", 1, 2, 3]],
    output: ["y", ["batch", 4]],
  });
  const { model: m, checker } = await load(bytes);
  assert.deepEqual(m.featureShape, [1, 2, 3]);
  assert.equal(m.outputSize, 4);
  const xs = Array.from({ length: 7 }, (_, i) => Array.from({ length: 6 }, (_, j) => Math.cos(3 * i + j)));
  const yTf = tfForward(m, xs);
  for (let i = 0; i < xs.length; i++) {
    const yOrt = await checker.evaluate(Float32Array.from(xs[i]));
    yOrt.forEach((v, j) => assert.ok(Math.abs(v - yTf[i][j]) < 1e-6, `row ${i} col ${j}: ${v} vs ${yTf[i][j]}`));
  }
});

test("unsupported operators are refused by name", () => {
  const bytes = model({
    nodes: [node("Softmax", ["x"], ["s"]), node("Elu", ["s"], ["y"])],
    input: ["x", [1, 3]],
    output: ["y", [1, 3]],
  });
  assert.throws(() => translateModel(tf, parseOnnxModel(bytes)), /Unsupported operators: Softmax, Elu/);
});

test("a fixed batch size above 1 is refused", () => {
  const bytes = model({ nodes: [node("Relu", ["x"], ["y"])], input: ["x", [4, 3]], output: ["y", [4, 3]] });
  assert.throws(() => translateModel(tf, parseOnnxModel(bytes)), /fixed batch size of 4/);
});

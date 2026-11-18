// Writes model.onnx, the example network used by spec.vcl and the image's smoke test.
// 2 inputs -> 2 ReLU units -> 1 output: y = relu(x0 + x1) + relu(x0 - x1).
// On [0, 1]^2 the largest output is 2 (at x0 = 1).
// Run from this folder: node make-model.js
import { writeFileSync } from "node:fs";
import { model, node, tensor } from "../../tests/helpers/onnx-writer.js";

const bytes = model({
  nodes: [
    node("MatMul", ["x", "W1"], ["a"]),
    node("Relu", ["a"], ["h"]),
    node("MatMul", ["h", "W2"], ["y"]),
  ],
  initializers: [tensor("W1", [2, 2], [1, 1, 1, -1]), tensor("W2", [2, 1], [1, 1])],
  input: ["x", [2]],
  output: ["y", [1]],
});
writeFileSync(new URL("./model.onnx", import.meta.url), bytes);

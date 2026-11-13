// Tiny ONNX encoder for tests: builds hand-made networks with known answers.

function varint(v) {
  let x = BigInt.asUintN(64, BigInt(v));
  const out = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    out.push(b);
  } while (x);
  return out;
}

const key = (field, wire) => varint((field << 3) | wire);
const bytesOf = (s) => Array.from(new TextEncoder().encode(s));

function len(field, payload) {
  return [...key(field, 2), ...varint(payload.length), ...payload];
}
const str = (field, s) => len(field, bytesOf(s));
const int = (field, v) => [...key(field, 0), ...varint(v)];
function f32(field, v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...key(field, 5), ...b];
}

const TYPE_CODES = { float32: 1, int64: 7 };

export function tensor(name, dims, data, dataType = "float32") {
  const raw =
    dataType === "float32"
      ? new Uint8Array(Float32Array.from(data).buffer)
      : new Uint8Array(BigInt64Array.from(data.map(BigInt)).buffer);
  return [
    ...len(1, dims.flatMap((d) => varint(d))),
    ...int(2, TYPE_CODES[dataType]),
    ...str(8, name),
    ...len(9, Array.from(raw)),
  ];
}

function attribute(name, value) {
  if (value && value.float !== undefined) return [...str(1, name), ...f32(2, value.float), ...int(20, 1)];
  if (typeof value === "number" && Number.isInteger(value)) return [...str(1, name), ...int(3, value), ...int(20, 2)];
  if (typeof value === "number") return [...str(1, name), ...f32(2, value), ...int(20, 1)];
  if (Array.isArray(value)) return [...str(1, name), ...len(8, value.flatMap((v) => varint(v))), ...int(20, 7)];
  if (value && value.tensor) return [...str(1, name), ...len(5, value.tensor), ...int(20, 4)];
  throw new Error(`Unsupported test attribute ${name}`);
}

export function node(opType, inputs, outputs, attrs = {}) {
  return [
    ...inputs.flatMap((i) => str(1, i)),
    ...outputs.flatMap((o) => str(2, o)),
    ...str(3, `${opType}_${outputs[0]}`),
    ...str(4, opType),
    ...Object.entries(attrs).flatMap(([k, v]) => len(5, attribute(k, v))),
  ];
}

function valueInfo(name, shape) {
  const dims = shape.flatMap((d) => len(1, typeof d === "string" ? str(2, d) : int(1, d)));
  const tensorType = [...int(1, 1), ...len(2, dims)];
  return [...str(1, name), ...len(2, len(1, tensorType))];
}

/**
 * model({ nodes: [node(...)], initializers: [tensor(...)], input: ["x", [1, 2]], output: ["y", [1, 1]] })
 */
export function model({ nodes, initializers = [], input, output, opset = 13 }) {
  const graph = [
    ...nodes.flatMap((n) => len(1, n)),
    ...str(2, "test"),
    ...initializers.flatMap((t) => len(5, t)),
    ...len(11, valueInfo(...input)),
    ...len(12, valueInfo(...output)),
  ];
  return Uint8Array.from([
    ...int(1, 8),
    ...str(2, "test-writer"),
    ...len(7, graph),
    ...len(8, [...str(1, ""), ...int(2, opset)]),
  ]);
}

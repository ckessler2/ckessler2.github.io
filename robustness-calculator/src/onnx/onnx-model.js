// Decode an ONNX ModelProto into plain JS objects.
// Field numbers follow onnx/onnx.proto (IR version 3+).

import {
  readFields,
  asString,
  asInt64,
  asFloat32,
  collectInt64s,
  collectFloat32s,
  collectFloat64s,
} from "./protobuf.js";

export const DATA_TYPES = {
  1: "float32",
  2: "uint8",
  3: "int8",
  6: "int32",
  7: "int64",
  9: "bool",
  10: "float16",
  11: "float64",
};

const ATTR_TYPES = {
  1: "float",
  2: "int",
  3: "string",
  4: "tensor",
  5: "graph",
  6: "floats",
  7: "ints",
  8: "strings",
  9: "tensors",
};

function strings(fields, n) {
  return fields.filter((f) => f.field === n).map((f) => asString(f.value));
}

function first(fields, n) {
  return fields.find((f) => f.field === n)?.value;
}

/** TensorProto -> { name, dims, dataType, data } (data: Float32Array or number[]). */
export function parseTensor(bytes) {
  const fields = readFields(bytes);
  const name = asString(first(fields, 8) ?? new Uint8Array());
  const dims = collectInt64s(fields, 1);
  const typeCode = Number(first(fields, 2) ?? 0n);
  const dataType = DATA_TYPES[typeCode];
  const size = dims.reduce((a, b) => a * b, 1);

  if (first(fields, 13) !== undefined || Number(first(fields, 14) ?? 0n) === 1) {
    throw new Error(
      `Tensor "${name}" uses external data files, which are not supported. ` +
        "Re-export the model with all weights embedded in the .onnx file.",
    );
  }
  if (first(fields, 3) !== undefined) {
    throw new Error(`Tensor "${name}" is segmented, which is not supported.`);
  }

  const raw = first(fields, 9);
  let data;
  if (dataType === "float32") {
    if (raw) {
      data = new Float32Array(raw.slice().buffer);
    } else {
      data = Float32Array.from(collectFloat32s(fields, 4));
    }
  } else if (dataType === "float64") {
    data = raw ? Float32Array.from(new Float64Array(raw.slice().buffer)) : Float32Array.from(collectFloat64s(fields, 10));
  } else if (dataType === "int64") {
    data = raw ? Array.from(new BigInt64Array(raw.slice().buffer), Number) : collectInt64s(fields, 7);
  } else if (dataType === "int32") {
    data = raw ? Array.from(new Int32Array(raw.slice().buffer)) : collectInt64s(fields, 5);
  } else {
    throw new Error(`Tensor "${name}" has unsupported data type ${dataType ?? typeCode}.`);
  }

  if (data.length !== size) {
    throw new Error(`Tensor "${name}" has ${data.length} values but its shape [${dims}] needs ${size}.`);
  }
  return { name, dims, dataType, data };
}

function parseAttribute(bytes) {
  const fields = readFields(bytes);
  const name = asString(first(fields, 1));
  let type = ATTR_TYPES[Number(first(fields, 20) ?? 0n)];

  // Very old exporters omit the type field; infer it from what is present.
  if (!type) {
    if (first(fields, 2) !== undefined) type = "float";
    else if (first(fields, 3) !== undefined) type = "int";
    else if (first(fields, 4) !== undefined) type = "string";
    else if (first(fields, 5) !== undefined) type = "tensor";
    else if (first(fields, 8) !== undefined) type = "ints";
    else if (first(fields, 7) !== undefined) type = "floats";
  }

  switch (type) {
    case "float":
      return [name, asFloat32(first(fields, 2))];
    case "int":
      return [name, asInt64(first(fields, 3) ?? 0n)];
    case "string":
      return [name, asString(first(fields, 4))];
    case "tensor":
      return [name, parseTensor(first(fields, 5))];
    case "floats":
      return [name, collectFloat32s(fields, 7)];
    case "ints":
      return [name, collectInt64s(fields, 8)];
    case "strings":
      return [name, strings(fields, 9)];
    default:
      // Graph-valued attributes (If/Loop bodies) are not supported; keep a
      // marker so the translator can name the problem.
      return [name, { unsupportedAttributeType: type ?? "unknown" }];
  }
}

function parseNode(bytes) {
  const fields = readFields(bytes);
  return {
    inputs: strings(fields, 1),
    outputs: strings(fields, 2),
    name: asString(first(fields, 3) ?? new Uint8Array()),
    opType: asString(first(fields, 4)),
    domain: asString(first(fields, 7) ?? new Uint8Array()),
    attrs: Object.fromEntries(fields.filter((f) => f.field === 5).map((f) => parseAttribute(f.value))),
  };
}

function parseValueInfo(bytes) {
  const fields = readFields(bytes);
  const name = asString(first(fields, 1));
  let elemType = null;
  let shape = null;

  const typeBytes = first(fields, 2);
  if (typeBytes) {
    const tensorType = first(readFields(typeBytes), 1);
    if (tensorType) {
      const tt = readFields(tensorType);
      elemType = DATA_TYPES[Number(first(tt, 1) ?? 0n)] ?? null;
      const shapeBytes = first(tt, 2);
      if (shapeBytes) {
        shape = readFields(shapeBytes)
          .filter((f) => f.field === 1)
          .map((f) => {
            const dim = readFields(f.value);
            const v = first(dim, 1);
            if (v !== undefined) return asInt64(v);
            const p = first(dim, 2);
            return p !== undefined ? asString(p) : null;
          });
      }
    }
  }
  return { name, elemType, shape };
}

/**
 * Parse an .onnx file.
 * @param {Uint8Array} bytes
 */
export function parseOnnxModel(bytes) {
  const model = readFields(bytes);
  const graphBytes = first(model, 7);
  if (!graphBytes) {
    throw new Error("Not an ONNX model: no graph found.");
  }

  const opsets = model
    .filter((f) => f.field === 8)
    .map((f) => {
      const o = readFields(f.value);
      return {
        domain: asString(first(o, 1) ?? new Uint8Array()),
        version: asInt64(first(o, 2) ?? 0n),
      };
    });

  const g = readFields(graphBytes);
  if (g.some((f) => f.field === 15)) {
    throw new Error("Sparse initialisers are not supported.");
  }

  const initializers = new Map();
  for (const f of g.filter((f) => f.field === 5)) {
    const t = parseTensor(f.value);
    initializers.set(t.name, t);
  }

  // Older exporters list initialisers among the graph inputs; the real
  // inputs are the ones that are not initialisers.
  const inputs = g
    .filter((f) => f.field === 11)
    .map((f) => parseValueInfo(f.value))
    .filter((v) => !initializers.has(v.name));
  const outputs = g.filter((f) => f.field === 12).map((f) => parseValueInfo(f.value));

  return {
    irVersion: asInt64(first(model, 1) ?? 0n),
    producer: asString(first(model, 2) ?? new Uint8Array()),
    opsets,
    graph: {
      name: asString(first(g, 2) ?? new Uint8Array()),
      nodes: g.filter((f) => f.field === 1).map((f) => parseNode(f.value)),
      initializers,
      inputs,
      outputs,
    },
  };
}

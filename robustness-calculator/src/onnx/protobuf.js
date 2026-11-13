// Minimal protobuf wire-format reader: just enough to decode ONNX models
// without pulling in protobufjs and onnx.proto.
//
// readFields(bytes) returns every field of one message as
//   { field, wire, value }
// where value is a BigInt (varint), a Uint8Array view (length-delimited),
// or a number (fixed32 / fixed64 read as raw bits; see the helpers below).

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

function readVarint(bytes, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= bytes.length) {
      throw new Error("Truncated protobuf varint.");
    }
    const b = bytes[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return [result, pos];
    }
    shift += 7n;
    if (shift > 70n) {
      throw new Error("Malformed protobuf varint.");
    }
  }
}

export function readFields(bytes) {
  const fields = [];
  let pos = 0;
  while (pos < bytes.length) {
    let key;
    [key, pos] = readVarint(bytes, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let value;
    if (wire === WIRE_VARINT) {
      [value, pos] = readVarint(bytes, pos);
    } else if (wire === WIRE_LEN) {
      let len;
      [len, pos] = readVarint(bytes, pos);
      const end = pos + Number(len);
      if (end > bytes.length) {
        throw new Error("Truncated protobuf field.");
      }
      value = bytes.subarray(pos, end);
      pos = end;
    } else if (wire === WIRE_FIXED32) {
      value = bytes.subarray(pos, pos + 4);
      pos += 4;
    } else if (wire === WIRE_FIXED64) {
      value = bytes.subarray(pos, pos + 8);
      pos += 8;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}.`);
    }
    fields.push({ field, wire, value });
  }
  return fields;
}

const textDecoder = new TextDecoder();

export function asString(value) {
  return textDecoder.decode(value);
}

/** int64 varint -> JS number (two's complement, so -1 round-trips). */
export function asInt64(value) {
  return Number(BigInt.asIntN(64, value));
}

export function asFloat32(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
}

export function asFloat64(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
}

/** Repeated int64 field: may arrive packed (one LEN field) or one varint per entry. */
export function collectInt64s(fields, fieldNumber) {
  const out = [];
  for (const f of fields) {
    if (f.field !== fieldNumber) continue;
    if (f.wire === WIRE_VARINT) {
      out.push(asInt64(f.value));
    } else if (f.wire === WIRE_LEN) {
      let pos = 0;
      while (pos < f.value.length) {
        let v;
        [v, pos] = readVarint(f.value, pos);
        out.push(asInt64(v));
      }
    }
  }
  return out;
}

/** Repeated float field (fixed32), packed or not. */
export function collectFloat32s(fields, fieldNumber) {
  const out = [];
  for (const f of fields) {
    if (f.field !== fieldNumber) continue;
    if (f.wire === WIRE_FIXED32) {
      out.push(asFloat32(f.value));
    } else if (f.wire === WIRE_LEN) {
      const view = new DataView(f.value.buffer, f.value.byteOffset, f.value.byteLength);
      for (let i = 0; i + 4 <= f.value.length; i += 4) {
        out.push(view.getFloat32(i, true));
      }
    }
  }
  return out;
}

/** Repeated double field (fixed64), packed or not. */
export function collectFloat64s(fields, fieldNumber) {
  const out = [];
  for (const f of fields) {
    if (f.field !== fieldNumber) continue;
    if (f.wire === WIRE_FIXED64) {
      out.push(asFloat64(f.value));
    } else if (f.wire === WIRE_LEN) {
      const view = new DataView(f.value.buffer, f.value.byteOffset, f.value.byteLength);
      for (let i = 0; i + 8 <= f.value.length; i += 8) {
        out.push(view.getFloat64(i, true));
      }
    }
  }
  return out;
}

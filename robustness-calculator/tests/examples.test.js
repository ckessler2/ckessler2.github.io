import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, firstEntries } from "../src/vehicle/examples.js";

test("firstEntries keeps the header and the first n entries of an IDX file", () => {
  // 3 images of 2x2 uint8: magic 0 0 0x08 3, sizes 3 2 2, then 12 bytes.
  const idx = new Uint8Array([0, 0, 0x08, 3, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 2, ...Array.from({ length: 12 }, (_, i) => i)]);
  const two = firstEntries(idx, 2);
  assert.deepEqual([...two.slice(0, 8)], [0, 0, 0x08, 3, 0, 0, 0, 2]);
  assert.deepEqual([...two.slice(16)], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(firstEntries(idx, 9).length, idx.length); // more than there are: all of them
  assert.equal(idx[7], 3); // the input is not changed
  assert.throws(() => firstEntries(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]), 1));
});

test("examples have unique ids and tutorial paths without symbolic links", () => {
  const ids = EXAMPLES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of EXAMPLES.filter((e) => !e.local)) {
    // chapter-*/chapter-code folders of chapters 2 and 3 hold links to resources-by-dataset.
    for (const path of [e.spec, ...Object.values(e.networks ?? {})]) {
      assert.ok(!/chapter-[23]\/chapter-code\/.*\.(onnx|idx)$/.test(path), path);
    }
  }
});

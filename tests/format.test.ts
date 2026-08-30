import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes, formatIndexRanges } from "../shared/format.ts";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "../shared/protocol.ts";

test("byte counts read the way a person would say them", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024 - 1), "1024.0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatBytes(150_323_855), "143.4 MB");
});

test("the file size limit and its label agree", () => {
  // The label goes on the picker and into the rejection message; the constant
  // is what actually rejects. They are one number in two places.
  assert.equal(MAX_FILE_LABEL, "64 MB");
  assert.equal(formatBytes(MAX_FILE_BYTES), "64.0 MB");
});

test("index ranges collapse consecutive holes and cap how many spans they paint", () => {
  assert.equal(formatIndexRanges([]), "");
  assert.equal(formatIndexRanges([0]), "0");
  assert.equal(formatIndexRanges([0, 1, 2]), "0–2");
  assert.equal(formatIndexRanges([0, 2, 4]), "0, 2, 4");
  assert.equal(formatIndexRanges([0, 1, 3, 4, 5, 8]), "0–1, 3–5, 8");
  const many = Array.from({ length: 30 }, (_, i) => i * 2);
  const compact = formatIndexRanges(many, 4);
  assert.equal(compact, "0, 2, 4, 6 … +26");
});

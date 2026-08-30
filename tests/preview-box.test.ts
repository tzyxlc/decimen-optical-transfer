import assert from "node:assert/strict";
import test from "node:test";
import { previewBoxSize } from "../shared/preview-box.ts";

test("a 4:3 stream fits the box width when the viewport is tall enough", () => {
  assert.deepEqual(previewBoxSize(1280, 960, 640, 800, 156), { width: 640, height: 480 });
});

test("a tall viewport chrome clamp shrinks width to keep the ratio", () => {
  const { width, height } = previewBoxSize(1280, 960, 640, 400, 156);
  assert.equal(height, 244);
  assert.ok(Math.abs(width / height - 1280 / 960) < 1e-6);
  assert.ok(width < 640);
});

test("chrome that would go negative still yields a 120px floor", () => {
  const { height } = previewBoxSize(1920, 1080, 400, 100, 200);
  assert.equal(height, 120);
});

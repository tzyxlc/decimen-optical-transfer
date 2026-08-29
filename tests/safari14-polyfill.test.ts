import assert from "node:assert/strict";
import test from "node:test";
import { installSafari14Polyfills } from "../receive/safari14-polyfill.ts";

test("the BigInt64Array stand-in reads and writes WASM memory", () => {
  const isolated = { BigInt64Array: undefined, BigUint64Array: undefined } as unknown as typeof globalThis;
  installSafari14Polyfills(isolated);
  const Ctor = isolated.BigInt64Array as unknown as {
    new (buffer: ArrayBuffer, byteOffset?: number, length?: number): {
      [i: number]: bigint;
      length: number;
      subarray: (begin?: number, end?: number) => { [i: number]: bigint; length: number };
      set: (array: ArrayLike<bigint>, offset?: number) => void;
    };
  };
  const buf = new ArrayBuffer(24);
  const view = new Ctor(buf);
  view[0] = 1n;
  view[1] = -1n;
  assert.equal(view[0], 1n);
  assert.equal(view[1], -1n);
  const slice = view.subarray(1, 2);
  assert.equal(slice.length, 1);
  assert.equal(slice[0], -1n);
  view.set([2n], 2);
  assert.equal(view[2], 2n);
});

test("BigInt.asUintN / asIntN exist after the polyfill", () => {
  installSafari14Polyfills();
  assert.equal(typeof BigInt.asUintN, "function");
  assert.equal(typeof BigInt.asIntN, "function");
  assert.equal(BigInt.asUintN(8, 256n), 0n);
  assert.equal(BigInt.asIntN(8, 255n), -1n);
});

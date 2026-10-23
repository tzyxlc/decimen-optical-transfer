// The engine's fetch-retry contract, exercised without a browser: a first
// request that stalls must be retried once, and a 404 must fail fast.
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirrors fetchWasm() in receive/decode-engine.ts. Kept as a local copy because
// the real module imports vendor codec .wasm URLs Vite resolves.
async function fetchWithRetry(fetchOnce) {
  try {
    return await fetchOnce();
  } catch (first) {
    if (first instanceof Error && /^wasm \d{3}$/.test(first.message)) throw first;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("offline");
    }
    try {
      return await fetchOnce();
    } catch {
      throw first;
    }
  }
}

test("a stalled first fetch is retried once and can succeed", async () => {
  let calls = 0;
  const out = await fetchWithRetry(async () => {
    calls++;
    if (calls === 1) throw new DOMException("aborted", "AbortError");
    return "bytes";
  });
  assert.equal(out, "bytes");
  assert.equal(calls, 2, "exactly one retry");
});

test("a 404 fails immediately without a retry", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(async () => {
      calls++;
      throw new Error("wasm 404");
    }),
    /wasm 404/,
  );
  assert.equal(calls, 1, "the server said no — retrying cannot help");
});

test("two stalls surface the first reason, not the second", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(async () => {
      calls++;
      throw new DOMException(calls === 1 ? "aborted" : "aborted again", "AbortError");
    }),
    (err) => err.name === "AbortError" && err.message === "aborted",
  );
  assert.equal(calls, 2);
});

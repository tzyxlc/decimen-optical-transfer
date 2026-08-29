// Shared zxing-wasm decode path: used by the Worker and by the iOS 14
// main-thread fallback (Safari 14 often fails to run WASM inside workers).

import "./safari14-polyfill";
import wasmUrl from "./wasm-url";
import DecimenCodec, { type DecimenModule, type DecimenQuad } from "../vendor/decimen-codec/decimen_codec.js";

// Safari 14's instantiateStreaming often never settles (wrong WASM MIME, or
// the streaming compile path hanging). Prefetch the bytes and instantiate
// from an ArrayBuffer so init either finishes or times out.
const INIT_MS =
  typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent) ? 20_000 : 12_000;

function explainWasmError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err);
  if (/opcode 253|opcode 0xfd|simd/i.test(text)) {
    return new Error("decoder WASM uses SIMD (needs Safari 16.4+); this build should be scalar — hard-refresh");
  }
  return err instanceof Error ? err : new Error(text);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function fetchWasm(): Promise<ArrayBuffer> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), INIT_MS) : undefined;
  try {
    const response = await fetch(wasmUrl, { credentials: "same-origin", signal: ctrl?.signal });
    if (!response.ok) throw new Error(`wasm ${response.status}`);
    return await response.arrayBuffer();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function loadCodec(): Promise<DecimenModule> {
  const wasmBinary = await fetchWasm();
  const bytes = new Uint8Array(wasmBinary);
  return new Promise((resolve, reject) => {
    void DecimenCodec({
      locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
      wasmBinary,
      instantiateWasm(imports, done) {
        // Safari 14 is happier with a Uint8Array than a raw ArrayBuffer.
        void WebAssembly.instantiate(bytes, imports).then(
          (out) => {
            try {
              done(out.instance, out.module);
            } catch (err) {
              reject(explainWasmError(err));
            }
          },
          (err) => reject(explainWasmError(err)),
        );
        return {};
      },
    }).then(resolve, reject);
  });
}

let ready: Promise<DecimenModule> | null = null;

function codecReady(): Promise<DecimenModule> {
  if (!ready) {
    ready = withTimeout(loadCodec(), INIT_MS, "decoder init").catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export interface DecodeJob {
  id: number;
  buf?: ArrayBuffer;
  bitmap?: ImageBitmap;
  w?: number;
  h?: number;
  ox?: number;
  oy?: number;
  full?: boolean;
  quad?: DecimenQuad;
  dim?: number;
}

export interface DecodeResult {
  id: number;
  symbols: { bytes: Uint8Array; box: object; quad: DecimenQuad; modules: number; tracked: boolean }[];
  sightings: object[];
  trackedAttempted: boolean;
}

function boundsOf(p: DecimenQuad, ox: number, oy: number) {
  const xs = [p.topLeft.x, p.topRight.x, p.bottomRight.x, p.bottomLeft.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomRight.y, p.bottomLeft.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: ox + x, y: oy + y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function shifted(p: DecimenQuad, ox: number, oy: number): DecimenQuad {
  const s = (pt: { x: number; y: number }) => ({ x: pt.x + ox, y: pt.y + oy });
  return {
    topLeft: s(p.topLeft),
    topRight: s(p.topRight),
    bottomRight: s(p.bottomRight),
    bottomLeft: s(p.bottomLeft),
  };
}

let offscreen: OffscreenCanvas | undefined;

function pixelsOf(buf: ArrayBuffer | undefined, bitmap: ImageBitmap | undefined, w: number, h: number) {
  if (bitmap) {
    const bw = bitmap.width;
    const bh = bitmap.height;
    if (typeof OffscreenCanvas !== "undefined") {
      if (!offscreen || offscreen.width !== bw || offscreen.height !== bh) {
        offscreen = new OffscreenCanvas(bw, bh);
      }
      const octx = offscreen.getContext("2d", { willReadFrequently: true })!;
      octx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = octx.getImageData(0, 0, bw, bh);
      return { data: img.data, w: bw, h: bh };
    }
    bitmap.close();
  }
  return { data: new Uint8Array(buf!), w, h };
}

export async function warmUp(): Promise<void> {
  const zx = await codecReady();
  const ptr = zx._malloc(8 * 8 * 4);
  zx.HEAPU8.set(new Uint8Array(8 * 8 * 4).fill(255), ptr);
  zx.readFull(ptr, 8, 8, false, 1, false).delete();
  zx._free(ptr);
}

export async function decodePayload(job: DecodeJob): Promise<DecodeResult> {
  const { id, buf, bitmap, w = 0, h = 0, ox = 0, oy = 0, full = true, quad, dim } = job;
  const zx = await codecReady();
  const pixels = pixelsOf(buf, bitmap, w, h);
  const { w: pw, h: ph } = pixels;
  const ptr = zx._malloc(pw * ph * 4);
  try {
    zx.HEAPU8.set(
      pixels.data instanceof Uint8Array ? pixels.data : new Uint8Array(pixels.data.buffer),
      ptr,
    );
    const symbols: DecodeResult["symbols"] = [];
    const sightings: object[] = [];

    let trackedHit = false;
    let trackedAttempted = false;
    if (!full && quad && dim) {
      trackedAttempted = true;
      const r = zx.readTracked(
        ptr, pw, ph, dim,
        quad.topLeft.x - ox, quad.topLeft.y - oy,
        quad.topRight.x - ox, quad.topRight.y - oy,
        quad.bottomRight.x - ox, quad.bottomRight.y - oy,
        quad.bottomLeft.x - ox, quad.bottomLeft.y - oy,
      );
      if (r.valid && r.bytes.length > 0) {
        symbols.push({
          bytes: r.bytes,
          box: boundsOf(r.position, ox, oy),
          quad: shifted(r.position, ox, oy),
          modules: r.modules,
          tracked: true,
        });
        trackedHit = true;
      }
    }

    if (!trackedHit) {
      const vec = zx.readFull(ptr, pw, ph, true, full ? 12 : 2, full);
      for (let i = 0; i < vec.size(); i++) {
        const r = vec.get(i);
        if (r.valid && r.bytes.length > 0) {
          symbols.push({
            bytes: r.bytes,
            box: boundsOf(r.position, ox, oy),
            quad: shifted(r.position, ox, oy),
            modules: r.modules,
            tracked: false,
          });
        } else if (full) {
          const box = boundsOf(r.position, ox, oy);
          if (box.w > 0 && box.h > 0) sightings.push(box);
        }
      }
      vec.delete();
    }
    return { id, symbols, sightings, trackedAttempted };
  } finally {
    zx._free(ptr);
  }
}

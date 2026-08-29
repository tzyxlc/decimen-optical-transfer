// gzip / zlib via Compression Streams when the engine has them (Safari 16.4+),
// and via fflate on older iOS. The fflate import is dynamic so the served
// receive chunk does not grow by the fallback.

import { OpticalError } from "./optical-error";

function hasCompressionStream(): boolean {
  return typeof globalThis.CompressionStream === "function";
}

function hasDecompressionStream(): boolean {
  return typeof globalThis.DecompressionStream === "function";
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasCompressionStream()) {
    return readStream(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip")),
    );
  }
  const { gzipSync } = await import("fflate");
  return gzipSync(bytes);
}

/**
 * Inflate with a hard output ceiling. The gzip trailer size is a hint, never a
 * bound — count output bytes and abort the moment they exceed `maxBytes`.
 */
export async function gunzipBytes(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (hasDecompressionStream()) {
    const inflated = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const reader = inflated.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new OpticalError("inflateOverflow");
      }
      chunks.push(value);
    }
    return concat(chunks, total);
  }

  const { Gunzip } = await import("fflate");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gz = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new OpticalError("inflateOverflow");
    chunks.push(chunk);
  });
  gz.push(bytes, true);
  return concat(chunks, total);
}

/** zlib (RFC 1950) — what PNG IDAT / fdAT carry. */
export async function deflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasCompressionStream()) {
    return readStream(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    );
  }
  const { zlibSync } = await import("fflate");
  return zlibSync(bytes);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

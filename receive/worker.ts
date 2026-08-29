// QR decode worker: thin wrapper around decode-engine. Safari 14 cannot run
// this path reliably — iOS 14 uses receive/main-decode.ts instead.

import { decodePayload, warmUp } from "./decode-engine";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e: MessageEvent) => {
  const job = e.data as { id: number };
  try {
    ctx.postMessage(await decodePayload(job));
  } catch {
    ctx.postMessage({ id: job.id, symbols: [], sightings: [] });
  }
};

void warmUp().then(
  () => ctx.postMessage({ id: -1, ready: true }),
  (err) =>
    ctx.postMessage({
      id: -1,
      ready: false,
      error: err instanceof Error ? err.message : String(err),
    }),
);

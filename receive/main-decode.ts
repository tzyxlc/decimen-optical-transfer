// Main-thread decoder that speaks the same protocol as the Worker.
// iOS 14 / Safari 14 frequently fails to instantiate WASM inside a Worker;
// running here is the reliable path on those phones.

import type { PoolWorker } from "../shared/worker-pool";
import { decodePayload, warmUp, type DecodeJob } from "./decode-engine";

export function createMainDecodeWorker(): PoolWorker {
  let handler: ((event: MessageEvent) => void) | null = null;
  let dead = false;

  const deliver = (data: unknown) => {
    if (dead || !handler) return;
    handler({ data } as MessageEvent);
  };

  void warmUp().then(
    () => deliver({ id: -1, ready: true }),
    (err) =>
      deliver({
        id: -1,
        ready: false,
        error: err instanceof Error ? err.message : String(err),
      }),
  );

  return {
    get onmessage() {
      return handler;
    },
    set onmessage(fn) {
      handler = fn;
    },
    postMessage(message: unknown, _transfer: Transferable[] = []) {
      if (dead) return;
      const job = message as DecodeJob;
      void decodePayload(job).then(
        (result) => deliver(result),
        () => deliver({ id: job.id, symbols: [], sightings: [] }),
      );
    },
    terminate() {
      dead = true;
      handler = null;
    },
  };
}

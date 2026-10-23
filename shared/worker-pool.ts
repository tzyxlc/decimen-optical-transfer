// Fixed-slot pool of decode workers.
//
// The subtle part is slot identity: every worker's message handler closes over
// its own index, so growing and shrinking the pool has to leave the surviving
// workers' indices alone. Shrinking from the end is what makes that true, and
// it is why this is worth having on its own rather than inline in the receiver.
//
// Each worker holds its own ~272 KB zxing WASM instance (plus its compiled
// heap), so the pool is also how the receiver reclaims that memory the moment
// the last frame is in.

export interface PoolWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

/** Where a symbol sat in the capture, in capture coordinates. */
export interface SymbolBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A symbol's corner quad in capture coordinates — the tracked decode path
 *  rebuilds its sampling transform from this, so unlike the axis-aligned box
 *  it must survive the round trip un-flattened. */
export interface SymbolQuad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** Decode metadata that rides along with the bytes. */
export interface SymbolInfo {
  quad?: SymbolQuad;
  /** QR dimension in modules; feeds the next tracked decode. */
  modules?: number;
  /** True when the tracked fast path produced this decode. */
  tracked?: boolean;
}

interface DecodeMessage {
  id: number;
  /** Warm-up ping: false means WASM/init failed and this worker will never decode. */
  ready?: boolean;
  /** Failure detail from WASM init, when `ready` is false. */
  error?: string;
  /** Every QR found in the frame. The grid sender shows several codes at
   *  once; each one is an independent fountain frame. Empty means a miss. */
  symbols: { bytes: Uint8Array; box?: SymbolBox; quad?: SymbolQuad; modules?: number; tracked?: boolean }[];
  /** Codes DETECTED but not decoded — no bytes, but the position is real.
   *  The receiver uses these to aim crops at codes the full frame lost. */
  sightings?: SymbolBox[];
  /** True when this reply's crop went through the tracked fast path first —
   *  paired with per-symbol `tracked`, the receiver derives the hit rate. */
  trackedAttempted?: boolean;
}

export class DecodeWorkerPool {
  private readonly workers: PoolWorker[] = [];
  private readonly busy: boolean[] = [];
  /** Warm-up state, and deliberately not a boolean.
   *
   *  "warming" outlives a `whenReady` timeout. A cold 278 KB WASM fetch plus
   *  its compile and instantiate is the receiver's slowest startup step, and on
   *  a phone link it routinely needs longer than any wait worth blocking the
   *  camera start for. Latching "dead" on that timeout is what put a live
   *  camera with 0 dec/s in front of iPhone users on IOS 27: the WASM arrived a
   *  second too late, the pool had already written off the whole session, and
   *  the only recovery on offer was a page reload. A late success now promotes
   *  the pool, and a late failure still reports its reason. */
  private warm: "idle" | "warming" | "ready" | "failed" = "idle";
  /** Why the last warm-up failed, when it did. Empty means "no answer yet". */
  private failure = "";
  private readonly readyWaiters = new Set<(ok: boolean) => void>();

  constructor(
    private readonly create: () => PoolWorker,
    private readonly onDecoded: (bytes: Uint8Array, box?: SymbolBox, info?: SymbolInfo) => void,
    private readonly onSighted?: (box: SymbolBox) => void,
    private readonly onTrackedAttempt?: () => void,
    private readonly onWorkerError?: (message: string) => void,
    private readonly onReply?: () => void,
  ) {}

  get size(): number {
    return this.workers.length;
  }

  get busyCount(): number {
    return this.busy.filter(Boolean).length;
  }

  /** True after the first successful warm-up ping. Capture must not submit
   *  before this — a hung WASM init would occupy the only slot forever. */
  get isReady(): boolean {
    return this.warm === "ready";
  }

  /** Still initializing, with no verdict yet. The receiver keeps the camera up
   *  and waits rather than tearing the session down: this is the state a slow
   *  first WASM load sits in. */
  get isStarting(): boolean {
    return this.warm === "warming";
  }

  /** The warm-up's own verdict, once it has one. "idle" and "warming" both mean
   *  no answer yet — never a failure. */
  get warmState(): "idle" | "warming" | "ready" | "failed" {
    return this.warm;
  }

  /**
   * Wait until a worker reports on the WASM, or `timeoutMs` elapses.
   *
   * A timeout resolves false WITHOUT cancelling the warm-up — it is "not ready
   * yet", not "dead". Callers that keep the camera running on a false answer
   * get promoted for free when the WASM finally lands (see `watchReady`). Only a
   * worker explicitly reporting `ready: false` marks the pool failed.
   */
  whenReady(timeoutMs = 15_000): Promise<boolean> {
    if (this.warm === "ready") return Promise.resolve(true);
    if (this.warm === "failed") return Promise.resolve(false);
    if (this.workers.length === 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = (ok: boolean) => {
        clearTimeout(timer);
        this.readyWaiters.delete(waiter);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        // Still warming: report "not yet" and leave the waiter registry alone,
        // so the pool's eventual verdict is not swallowed by this dead
        // callback. The caller decides whether lateness is fatal.
        const settled = this.warm === "ready" || this.warm === "failed";
        waiter(settled ? this.warm === "ready" : false);
      }, timeoutMs);
      this.readyWaiters.add(waiter);
    });
  }

  /** Notified the moment the pool becomes ready, however late that is. Lets a
   *  receiver that already stopped blocking on `whenReady` start decoding
   *  without making the user reload the page. */
  private onBecameReady?: () => void;

  /** Called by the receiver to learn when a slow warm-up comes good. */
  watchReady(handler: () => void): void {
    this.onBecameReady = handler;
    if (this.warm === "ready") handler();
  }

  private finishWarm(ok: boolean): void {
    if (this.warm === "ready" || this.warm === "failed") return;
    this.warm = ok ? "ready" : "failed";
    const waiters = [...this.readyWaiters];
    this.readyWaiters.clear();
    for (const waiter of waiters) waiter(ok);
    if (ok) this.onBecameReady?.();
  }

  /** Grow or shrink in place. Terminating a busy worker just drops the frame it
   *  held, which the fountain absorbs like any other miss.
   *
   *  Warm-up state is only ever reset by draining to zero, which retires the
   *  workers whose WASM instance it described. Growing a warm pool (1 → 2 for a
   *  mid-session worker change) leaves it warm: a new slot starts its own init
   *  and `finishWarm` ignores the duplicate ping. */
  resize(count: number): void {
    while (this.workers.length > Math.max(0, count)) {
      this.workers.pop()!.terminate();
      this.busy.pop();
    }
    if (this.workers.length === 0) {
      this.warm = "idle";
      this.failure = "";
      const waiters = [...this.readyWaiters];
      this.readyWaiters.clear();
      for (const waiter of waiters) waiter(false);
    }
    if (count > 0 && this.warm === "idle") this.warm = "warming";
    while (this.workers.length < count) {
      const slot = this.workers.length;
      const worker = this.create();
      this.busy.push(false);
      worker.onmessage = (event: MessageEvent) => {
        const { id, symbols, sightings, trackedAttempted, ready, error } = event.data as DecodeMessage;
        if (id === -1) {
          if (ready === false) {
            this.failure = error || "decoder init failed";
            // Once ANY worker is warm the pool can decode, and one slot whose
            // second copy of the WASM failed is a capacity loss, not a broken
            // session — reporting it would paint an error over a working
            // receiver. Nor is a repeat from the next straggler news: the
            // first real failure is the one worth showing.
            if (this.warm !== "ready" && this.warm !== "failed") this.onWorkerError?.(this.failure);
            this.finishWarm(false);
          } else {
            this.finishWarm(true);
          }
          return;
        }
        this.busy[slot] = false;
        this.onReply?.();
        if (trackedAttempted) this.onTrackedAttempt?.();
        for (const s of symbols)
          this.onDecoded(s.bytes, s.box, { quad: s.quad, modules: s.modules, tracked: s.tracked });
        if (this.onSighted) for (const box of sightings ?? []) this.onSighted(box);
      };
      worker.onerror = (event) => {
        this.busy[slot] = false;
        this.failure = event.message || "decode worker crashed";
        // Same rule as a failed ping: a crashed slot alongside a warm one is a
        // lost capacity unit, not a dead decoder.
        if (this.warm !== "ready" && this.warm !== "failed") this.onWorkerError?.(this.failure);
        // A worker that never pinged at all and then crashed cannot warm this
        // pool — that IS a real failure, not lateness.
        this.finishWarm(false);
      };
      this.workers.push(worker);
    }
  }

  /** Why the warm-up failed, when it did. Empty while warming. */
  get failureReason(): string {
    return this.failure;
  }

  /** Hand a frame to a free worker. False when every worker is busy — the
   *  caller drops the frame rather than queueing it, because a stale frame is
   *  worth less than the next one. */
  submit(message: unknown, transfer: Transferable[]): boolean {
    const slot = this.busy.indexOf(false);
    if (slot === -1) return false;
    this.busy[slot] = true;
    this.workers[slot]!.postMessage(message, transfer);
    return true;
  }
}

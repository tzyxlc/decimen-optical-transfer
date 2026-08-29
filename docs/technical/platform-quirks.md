# Platform quirks

The hard-won details baked into the code, so nobody has to rediscover them.

## Camera

- **iOS lies about frame rate.** `frameRate: {ideal: 60}` silently delivers 30; demand `{exact: 60}` (works at 1280-wide) and fall back to `ideal`. Always read back `getSettings()`.
- **iOS may refuse a live `applyConstraints`.** The receiver keeps the running stream and says so rather than tearing down a transfer.
- **Capabilities are probed, not UA-sniffed** (`shared/platform.ts`). Android Chrome exposes `torch`, `focusMode`, `frameRate.max` via `getCapabilities()`; iOS exposes none of them. Continuous autofocus is applied when available; unreachable fps options are disabled. `torch` is reported but deliberately unused — the sender is an emissive screen, a flashlight only adds glare.
- **`requestVideoFrameCallback` chains outlive their stream** and resume on the next one; a generation counter prevents zombie capture loops.
- **One camera at a time.** Phones will not open a second camera while one is live, so switching devices stops the current track *before* the new `getUserMedia` — which is why a refused switch needs an explicit reacquire fallback rather than keeping the stream it no longer has (`switchCamera` in `receive/main.ts`). And `enumerateDevices` labels are blank until permission is granted, which is why the camera picker fills in only after the first start.
- **Auto camera selection picks the wrong lens on some phones.** `facingMode: environment` hands over the telephoto on a Huawei P30 Pro (blurry until the user backs across the room) and the front camera on others. Field reports, not speculation — the camera picker exists because auto cannot be trusted on every device.
- **Safari 14 / iOS 14 (iPhone 11) cannot parse top-level `await` or construct `{ type: "module" }` workers.** Entries boot via `initI18n().then(…)` / an async `main()`, the site build targets `es2020`, and decode workers are IIFE. Combined `width`+`height`+`frameRate` constraints often throw `OverconstrainedError`; `acquireCamera` peels those off until a stream starts. The preview `<video>` needs `playsinline` (and `webkit-playsinline`) before `play()`, or iOS paints a black box.
- **Safari 14 has no `BigInt64Array`.** The emscripten glue creates those views of WASM memory on startup; without a polyfill (`receive/safari14-polyfill.ts`) every decode worker dies and the camera “sees” codes but never reacts. iOS 14 also defaults to **1** decode worker (six 940 KB WASM instances OOM the tab). A detached `drawImage(video)` canvas is often all-black on iOS 14 — the grab canvas stays in the document.
- **WASM-in-Worker is unreliable on iOS 14.** The receiver dynamically imports `main-decode.ts` and runs the same WASM codec on the page thread. The service worker is unregistered on iOS 14 so a stale precache cannot hide a new build. Safari 14 is also missing `BigInt.asUintN` / `BigInt64Array` (Safari 15); the polyfill in `safari14-polyfill.ts` covers those so `DecimenCodec()` can finish. WASM is prefetched as bytes and instantiated with `WebAssembly.instantiate` — `instantiateStreaming` can hang. Capture waits for the warm-up ping; a timeout or init throw surfaces `errDecoder` plus the underlying reason.
- **WASM SIMD is Safari 16.4+.** Opcode 253 (`0xFD`) is the SIMD prefix; iOS 14/15 reject the module at parse time (`WebAssembly.Module doesn't parse at byte 8: invalid opcode 253`). The vendored `decimen-codec` is a scalar build (`-msimd128` off, `MIN_SAFARI_VERSION=140100`).
- **`DecompressionStream` is Safari 16.4+.** A finished gzip transfer threw `Can't find variable: DecompressionStream` on iOS 15. `shared/compression.ts` uses the native streams when they exist and dynamically imports `fflate` otherwise, so the receive chunk stays small.
- **PWA NavigationRoute must not fall back to `index.html`.** This site is three HTML pages. Workbox's default SPA fallback made `/receive/?v=…` and `/__cert.pem` look like the home page on iOS 15 (the SW is registered there). `navigateFallback` is disabled; cache-bust `v=` is ignored when matching the precache.

## QR decoding

Safari has never shipped `BarcodeDetector` (WebKit bug 281848), so decoding is [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) compiled to WASM in workers — the one portable path.

## Media playback

**iOS Safari will not reliably play `blob:` URLs in `<video>`/`<audio>`** — AVFoundation wants real HTTP semantics, Range requests included. Received media goes into the Cache API and is served through a workbox `rangeRequests` route at a real URL (`received-media`); the blob URL is the fallback when no service worker controls the page, plus an `error`-event fallback in case AVFoundation bypasses the SW entirely.

## Safari 26 "Liquid Glass" chrome tinting

Safari 26 ignores `theme-color` and tints its chrome / safe-area bands by **sampling page CSS — fixed-position layers especially — and latches the sample**. Two consequences baked in:

- `html` carries an explicit `background-color` (a transparent root samples as *white*).
- The sender's tap-to-fullscreen QR is **not a fixed overlay** — it's a page state (`body.qr-full`) that hides everything else and lets the stage fill the viewport in normal flow. Flow content repaints on reflow; there is no fixed layer for the tint to latch onto. (Every overlay variant — fixed white, fixed transparent with absolute white child, safe-area-inset overlay — left white bands latched after close on a real device.)

## Assorted UI

- **16px input floor**: mobile Safari zooms the page when a smaller control takes focus; every settings control pays the 16px instead of locking viewport scale.
- **Sticky `:hover`**: iOS latches `:hover` on the last tap target — any state meant to be *seen* on touch must be the resting style, not a hover style.
- **`<dialog>` focus**: `showModal()` focuses the first button and iOS paints it pre-highlighted; focus is sent to the title (`tabindex="-1" autofocus`) instead.
- **Backdrop-click close must be geometric** (`shared/dialog.ts`): the gaps between a dialog's children are also `event.target === dialog`, so the target check alone closes on ordinary taps.
- **`hidden` vs display**: any rule setting `display` on an element that also uses the `hidden` attribute needs an explicit `[hidden] { display: none }` companion.

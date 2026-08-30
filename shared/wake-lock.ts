import { isIOS } from "./platform";

/** Keep the screen awake for the duration of a transfer, best effort.
 *
 *  Safari 16.4+ has the Screen Wake Lock API. iOS 14 does not: a live
 *  camera stream does not hold the idle timer, so a long receive dies when
 *  the phone locks. The fallback is a near-silent oscillator started from
 *  the same tap that opened the camera (iOS will not start audio later).
 *  Call this *before* any `await` in that tap handler. */

let audioKeepalive: { ctx: AudioContext; stop: () => void } | null = null;

export function requestScreenWakeLock(): void {
  const nav = navigator as Navigator & {
    wakeLock?: { request(t: "screen"): Promise<unknown> };
  };
  if (nav.wakeLock) {
    void nav.wakeLock.request("screen").catch(() => startLegacyKeepalive());
    return;
  }
  startLegacyKeepalive();
}

function startLegacyKeepalive(): void {
  if (!isIOS || audioKeepalive) return;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Below hearing, above "silence" — a true zero-gain buffer does not
    // keep iOS 14's idle timer from firing.
    osc.frequency.value = 20;
    gain.gain.value = 0.001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    void ctx.resume();
    audioKeepalive = {
      ctx,
      stop() {
        osc.stop();
        void ctx.close();
      },
    };
  } catch {
    /* fine without it */
  }
}

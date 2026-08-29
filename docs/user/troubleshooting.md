# Troubleshooting

## "Nothing happening?"

If the camera runs for a while without decoding a single frame, a small toast appears above the preview asking exactly that. **Help** opens the tips; **Dismiss** snoozes it (it returns later if things are still dead — tapping a button doesn't make frames arrive).

The fixes are on the **sender**, which is the non-obvious part. In order:

1. On the sender, open Transfer settings and drop **bytes / frame to 1465**. The 2953-byte default is tuned for close-range phone-to-phone and is exactly what fails on an ordinary monitor at arm's length.
2. Still nothing? Drop the sender's **tx fps to 24**.
3. Fill this camera's view with the code, and prop the phone against something — autofocus hunting from hand tremor is the usual culprit.
4. Turn the sending screen's brightness all the way up.

## "Update the sending device" / "Update this app"

The receiver found a Decimen stream it recognises but cannot read, and the two
devices are on different wire formats. **Decimen 0.5.0 changed the frame format
and is not compatible with 0.4.x** — both ends have to be on 0.5.0 or later.

- On [decimen.app](https://decimen.app/), reload both devices. If one was
  installed to the home screen and still complains, close it fully and reopen.
- Using **standalone files**? A `decimen-sender.html` and `decimen-receiver.html`
  saved from an earlier release work with each other forever, but not with a
  newer peer. Download both again from the same release. See
  [Install & offline](install-and-offline.md).

The message names which side is behind, so follow whichever one you got:
"Update the sending device" means the screen; "Update this app" means the phone
you are holding.

One direction cannot speak: these messages are new in 0.5.0, so a receiver
still on **0.4.x or earlier** pointed at a 0.5.0 sender shows nothing at all —
just the "Nothing happening?" toast. If the sender is up to date and the
receiving phone seems blind, update the receiver first. From 0.5.0 on, both
ends can name a mismatch, so a future format change will say so on the
receiving screen whichever side is older.

A receiver that shows *nothing* may also simply be looking at codes that are
not Decimen's — that case stays quiet on purpose, because the camera decodes
every QR code in view. See "Nothing happening?" above.

## Camera problems

- **Wrong camera** — the front camera instead of the rear one, or a telephoto that stays blurry unless you stand across the room. Some phones hand the browser the wrong lens as "the" rear camera; pick the right one under **Receive settings → camera**. The list shows real camera names once the camera has started, and switching applies immediately, mid-transfer included.
- **Permission denied** — tap the browser's permission prompt carefully; if you hit Block by accident, allow camera for the site and tap **Start camera** again (no reload needed).
- **"camera needs https"** — the page is being served over plain http. Browsers remove the camera API on insecure origins. On a phone open the **https://** address (the Go server's `:8443` URL), not `http://`. Accept the self-signed warning once. On **iOS 14**, also download `/__cert.pem` from that server and enable the profile under **Settings → General → About → Certificate Trust Settings**.
- **iPhone 11 / iOS 14, Start camera does nothing or stays black** — older Safari cannot run the previous ES2022/module-worker build. Rebuild (`npm run build` then `go build`) so the phone gets the Safari 14-compatible bundle, then use HTTPS as above.
- **Home opens but /receive/ or /__cert.pem looks like the home page (iOS 15)** — an old service worker was rewriting those URLs to `index.html`. Rebuild, then on the phone: Settings → Safari → Clear History and Website Data (or remove the site under Advanced → Website Data), then open `https://…/receive/` with no query string. `/__cert.pem` should download a certificate file, not show the site.
- **Camera works but codes do nothing (iOS 14)** — rebuild and reload (clear Safari site data). Changing workers to 1 does not start WASM; iOS 14 already decodes on the page thread. If the line turns red, the text in parentheses is the WASM error — send that. If `try/s` > 0 but `dec/s` is 0, fill the viewfinder and drop the sender to 1465 bytes/frame. Progress only appears after the first valid Decimen frame.
- **Standalone receiver file** — opening `decimen-receiver.html` from `file://` will not get a camera on iOS or Android. See [Install & offline](install-and-offline.md).

## Slow transfers

See the tuning table in [Sending](sending.md) — bytes/frame and tx fps are the two levers that matter.

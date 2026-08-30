/** Open a modal. iOS 15.0–15.3 has no `showModal`; iOS 14 has no
 *  HTMLDialogElement behaviour at all. The `open` attribute still reveals
 *  the box, and `.dialog-fallback` + a sibling backdrop make it a modal. */
const FALLBACK_CLASS = "dialog-fallback";
const BACKDROP_CLASS = "dialog-fallback-backdrop";

export function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch {
      // Already open, or the engine rejected the modal — fall through.
    }
  }
  if (!dialog.classList.contains(FALLBACK_CLASS)) {
    const back = document.createElement("div");
    back.className = BACKDROP_CLASS;
    back.addEventListener("click", () => closeDialog(dialog));
    dialog.before(back);
    dialog.classList.add(FALLBACK_CLASS);
  }
  dialog.setAttribute("open", "");
}

/** Close even when `dialog.close()` is missing or a no-op (iOS 14 / 15). */
export function closeDialog(dialog: HTMLDialogElement): void {
  const wasFallback = dialog.classList.contains(FALLBACK_CLASS);
  if (!wasFallback && typeof dialog.close === "function") {
    try {
      dialog.close();
    } catch {
      // ignore
    }
  }
  dialog.removeAttribute("open");
  if (wasFallback) {
    dialog.classList.remove(FALLBACK_CLASS);
    const prev = dialog.previousElementSibling;
    if (prev?.classList.contains(BACKDROP_CLASS)) prev.remove();
    // Native `close()` is missing or a no-op on the fallback path, and the
    // receiver listens for `close` to dismiss the no-signal toast.
    dialog.dispatchEvent(new Event("close"));
  }
}

/** Close a modal <dialog> when a click lands on its ::backdrop.
 *
 *  Comparing event.target to the dialog — the common recipe — is wrong: the
 *  gaps between a dialog's children (its padding, their margins) are also the
 *  dialog, so taps well inside the box kept closing it. A real backdrop click
 *  still targets the dialog, but its coordinates fall outside the dialog's
 *  border box; geometry is the only honest test.
 *
 *  The fallback path (no `showModal`) uses a sibling backdrop instead; this
 *  listener is a no-op there because the click target is never the dialog. */
export function closeOnBackdropClick(dialog: HTMLDialogElement): void {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) closeDialog(dialog);
  });
}

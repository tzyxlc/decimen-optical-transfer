/** Open a modal. iOS 15.0–15.3 has no `showModal`; the `open` attribute
 *  still reveals the box. */
export function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch {
      // Already open, or the engine rejected the modal — fall through.
    }
  }
  dialog.setAttribute("open", "");
}

/** Close even when `dialog.close()` is missing or a no-op (iOS 15). */
export function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") {
    try {
      dialog.close();
    } catch {
      // ignore
    }
  }
  dialog.removeAttribute("open");
}

/** Close a modal <dialog> when a click lands on its ::backdrop.
 *
 *  Comparing event.target to the dialog — the common recipe — is wrong: the
 *  gaps between a dialog's children (its padding, their margins) are also the
 *  dialog, so taps well inside the box kept closing it. A real backdrop click
 *  still targets the dialog, but its coordinates fall outside the dialog's
 *  border box; geometry is the only honest test. */
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

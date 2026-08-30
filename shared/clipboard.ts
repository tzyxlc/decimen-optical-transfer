/** Copy text to the clipboard. `navigator.clipboard` is Safari 13.1+ but
 *  still throws under some iOS permission states; `execCommand("copy")` is
 *  the user-gesture fallback those phones still honour. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the execCommand path
  }
  execCommandCopy(text);
}

export function execCommandCopy(text: string): void {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  field.style.top = "0";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  field.remove();
  if (!ok) throw new Error("copy failed");
}

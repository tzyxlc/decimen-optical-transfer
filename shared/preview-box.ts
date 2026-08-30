/** Size the camera box when `aspect-ratio` is missing (Safari 15).
 *  Fits `boxW` × (`viewportH` − `chrome`) while keeping the stream's ratio. */
export function previewBoxSize(
  videoW: number,
  videoH: number,
  boxW: number,
  viewportH: number,
  chrome: number,
): { width: number; height: number } {
  const maxH = Math.max(120, viewportH - chrome);
  let width = boxW;
  let height = (width * videoH) / videoW;
  if (height > maxH) {
    height = maxH;
    width = (height * videoW) / videoH;
  }
  return { width, height };
}

export function supportsAspectRatio(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("aspect-ratio", "4 / 3");
}

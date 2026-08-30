/** Byte counts for humans. Deliberately coarse — these land in a status line
 *  next to a filename, not in a report. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Compact sorted integer runs for diagnostics: `0, 2–5, 9`.
 *
 * Fountain gaps are source-block indices, often long consecutive holes once
 * a few blocks have solved. A hard cap on how many spans we spell out keeps
 * a 500-block file from painting a novel under Live diagnostics.
 */
export function formatIndexRanges(ids: readonly number[], maxSpans = 20): string {
  if (ids.length === 0) return "";
  const spans: [number, number][] = [];
  let start = ids[0]!;
  let end = start;
  for (let i = 1; i < ids.length; i++) {
    const n = ids[i]!;
    if (n === end + 1) {
      end = n;
    } else {
      spans.push([start, end]);
      start = end = n;
    }
  }
  spans.push([start, end]);
  const label = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}–${b}`);
  if (spans.length <= maxSpans) return spans.map(label).join(", ");
  const shown = spans.slice(0, maxSpans);
  const covered = shown.reduce((n, [a, b]) => n + (b - a + 1), 0);
  return `${shown.map(label).join(", ")} … +${ids.length - covered}`;
}

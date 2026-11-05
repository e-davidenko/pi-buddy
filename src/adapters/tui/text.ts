/** Plain text measurement and grapheme-safe wrapping. Pi's terminal width is injected when available. */
export const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\/g;
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (text: string) => Array.from(segments.segment(text), (s) => s.segment);
/** Fallback for top mode when the optional TUI package is unavailable. */
export function textWidth(text: string): number {
  return graphemes(text.replace(ANSI, "")).reduce((width, g) => {
    const cp = g.codePointAt(0)!;
    if (/^[\p{Mark}\p{Control}\p{Format}]+$/u.test(g)) return width;
    const wide = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g) || g.includes("\u20e3")
      || (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a
        || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
        || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe6f)
        || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || cp >= 0x20000));
    return width + (wide ? 2 : 1);
  }, 0);
}
export function truncateText(text: string, width: number, measure = textWidth, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (measure(text) <= width) return text;
  // Truncated fallback text may lose color, but never emits a partial control sequence.
  text = text.replace(ANSI, "");
  const room = width - measure(ellipsis);
  if (room < 0) return "";
  let result = "";
  for (const g of graphemes(text)) {
    if (measure(result + g) > room) break;
    result += g;
  }
  return result + ellipsis;
}
export function wrapWords(text: string, width: number, maxLines: number, measure = textWidth): string[] {
  if (width <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const candidate = current ? current + " " + word : word;
    if (measure(candidate) <= width) { current = candidate; continue; }
    if (current) { lines.push(current); current = ""; }
    // Split long words at grapheme boundaries rather than losing their suffix.
    for (const g of graphemes(word)) {
      if (current && measure(current + g) > width) { lines.push(current); current = ""; }
      current += g;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  const out = lines.slice(0, maxLines).map((l) => truncateText(l.trimEnd(), width, measure));
  if (lines.length > maxLines && out.length) out[out.length - 1] = truncateText(out[out.length - 1] + "…", width, measure);
  return out;
}

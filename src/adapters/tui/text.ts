/** Текст в терминале: escape-последовательности, перенос по словам */
export const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\/g;

export function wrapWords(text: string, w: number, maxLines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += " " + word;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, maxLines).map((l) => (l.length > w ? l.slice(0, w - 1) + "…" : l));
}

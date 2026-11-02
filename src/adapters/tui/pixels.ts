/** Пиксели → строки терминала полублоками ▀▄ (truecolor или палитра 256) */
import { PX_W } from "../../app/layout.ts";
import { PX_256, PX_PAL, PX_PRIO } from "../../content/palette.ts";
import type { PxMode } from "../../domain/types.ts";

/** Мини-копия спрайта для щенков стаи: 24×16 → 8×6, детали (глаза, нос) не теряются */
export const MINI_ROWS: [number, number][] = [[0, 3], [3, 6], [6, 8], [8, 11], [11, 13], [13, 16]];
export const MINI_PRIO: Record<string, number> = { E: 9, A: 9, N: 8 };
export const miniCache = new Map<string[], string[]>();
export function miniSprite(spr: string[]): string[] {
  const hit = miniCache.get(spr);
  if (hit) return hit;
  const out = MINI_ROWS.map(([y0, y1]) => {
    let line = "";
    for (let cx = 0; cx < 8; cx++) {
      const cells: string[] = [];
      for (let y = y0; y < y1; y++) for (let x = cx * 3; x < cx * 3 + 3; x++) cells.push(spr[y]?.[x] ?? ".");
      const solid = cells.filter((c) => c !== ".");
      if (solid.length * 2 < cells.length) {
        line += ".";
        continue;
      }
      const cnt = (c: string) => solid.filter((x) => x === c).length;
      line += solid.reduce((a, b) => {
        const pa = (MINI_PRIO[a] ?? 0) * 100 + cnt(a);
        const pb = (MINI_PRIO[b] ?? 0) * 100 + cnt(b);
        return pb > pa ? b : a;
      });
    }
    return line;
  });
  miniCache.set(spr, out);
  return out;
}

/** Пиксели → строки полублоков: верхний пиксель — цвет символа ▀, нижний — фон */
export const pxCache = new Map<string, string[]>();
export function pxRender(grid: string[], blink: boolean, mode: PxMode = "bg"): string[] {
  const key = grid.join("|") + (blink ? "~" : "") + mode;
  const hit = pxCache.get(key);
  if (hit) return hit;
  const rows = blink ? grid.map((r) => r.replace(/A/g, "D")) : grid;
  const fg = (c: [number, number, number]) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
  const bg = (c: [number, number, number]) => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
  const out: string[] = [];
  for (let y = 0; y < rows.length; y += 2) {
    let line = "";
    for (let x = 0; x < PX_W; x++) {
      const tc = rows[y][x];
      const bc = rows[y + 1]?.[x] ?? ".";
      const t = PX_PAL[tc];
      const b = PX_PAL[bc];
      if (mode === "fg") {
        // только цвет символа, палитра 256
        const c = (k: string) => `\x1b[38;5;${PX_256[k]}m`;
        if (t && b) line += `${c((PX_PRIO[bc] ?? 0) > (PX_PRIO[tc] ?? 0) ? bc : tc)}█\x1b[0m`; // цвет поважнее
        else if (t) line += `${c(tc)}▀\x1b[0m`;
        else if (b) line += `${c(bc)}▄\x1b[0m`;
        else line += " ";
        continue;
      }
      if (t && b && t === b) line += `${bg(b)} \x1b[0m`;
      else if (t && b) line += `${fg(t)}${bg(b)}▀\x1b[0m`;
      else if (t) line += `${fg(t)}▀\x1b[0m`;
      else if (b) line += `${fg(b)}▄\x1b[0m`;
      else line += " ";
    }
    out.push(line);
  }
  pxCache.set(key, out);
  return out;
}

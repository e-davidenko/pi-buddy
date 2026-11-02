/** Мелочи отображения, которые зависят только от состояния: глаза, декор у имени, кадр ASCII */
import { ANIM, EYES } from "../domain/animation.ts";
import type { Mood } from "../domain/types.ts";

/** Глаза ASCII-питомца: моргание в простое и в работе */
export const eyeFor = (m: Mood, blink: boolean) => (blink && (m === "idle" || m === "work") ? "-" : EYES[m]);

/** Номер ASCII-кадра по настроению и тику */
export function frameIndex(m: Mood, count: number, animN: number): number {
  const a = ANIM[m];
  return a.seq[Math.floor(animN / a.every) % a.seq.length] % count;
}

/** Декор после имени: во сне «z» дышит, в работе бегут точки */
export const decoFor = (m: Mood, quiet: boolean, animN: number) =>
  quiet
    ? m === "sleep" ? " z" : m === "love" ? " <3" : ""
    : m === "sleep"
    ? [" z", " zZ", " zZz"][Math.floor(animN / 4) % 3]
    : m === "love"
      ? " <3"
      : m === "work"
        ? [" .", " ..", " ..."][animN % 3]
        : "";

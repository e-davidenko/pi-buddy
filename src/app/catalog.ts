/** Облик питомца по его состоянию: вид, взрослый ли, ASCII-кадры, подписи */
import { SPECIES } from "../content/species.ts";
import { message, plural, speciesFor } from "./localization.ts";
import { isGrown } from "../domain/rules.ts";
import type { BuddyState, Species, Locale } from "../domain/types.ts";

export const spec = (st: BuddyState): Species => SPECIES[st.species] ?? SPECIES.blob;
export const grown = (st: BuddyState) => isGrown(spec(st), st.xp);
export const miniFor = (st: BuddyState) => (grown(st) ? spec(st).miniGrown ?? spec(st).mini : spec(st).mini);
export const artFor = (st: BuddyState) => (grown(st) ? spec(st).grown! : spec(st).art);
export const labelFor = (st: BuddyState, locale: Locale = "ru") => {
  const words = speciesFor(st.species, locale);
  return grown(st) ? words.grownLabel ?? words.label : words.label;
};
/** Кадры анимации: [основной, ...доп]. Без своих кадров — лёгкое покачивание */
export const framesFor = (st: BuddyState): string[][] => {
  const base = artFor(st);
  const extra = grown(st) ? spec(st).framesGrown : spec(st).frames;
  return [base, ...(extra ?? [base.map((l) => " " + l)])];
};

export function age(born: number, now: number, locale: Locale = "ru") {
  const d = Math.floor((now - born) / 86_400_000);
  return d === 0 ? message(locale, "today") : message(locale, "days", { count: new Intl.NumberFormat(locale).format(d), unit: plural(locale, d, locale === "ru" ? { one: "день", few: "дня", many: "дней", other: "дня" } : { one: "day", other: "days" }) });
}

export function bar(v: number, w = 10) {
  const n = Math.round((v / 100) * w);
  return "[" + "=".repeat(n) + "-".repeat(w - n) + "]";
}

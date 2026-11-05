import type { Language, Locale, Pose, Species, Topic } from "../domain/types.ts";
import { SPECIES, NAMES } from "../content/species.ts";
import { OWN_ONLY } from "../domain/topics.ts";
import { IT } from "../content/items.ts";
import { SAY } from "../content/phrases.ts";
import { TOPIC_HINT } from "../content/topicHints.ts";
import * as en from "../content/locales/en.ts";
export { message } from "../content/locales/ui.ts";

export function resolveLocale(setting: Language | undefined, environment = ""): Locale {
  if (setting === "ru" || setting === "en") return setting;
  // Missing setting belongs to an existing installation.
  if (setting === undefined) return "ru";
  return /^ru(?:[-_.@]|$)/i.test(environment) ? "ru" : "en";
}
export const namesFor = (locale: Locale) => locale === "ru" ? NAMES : en.names;
export const commonFor = (locale: Locale) => locale === "ru" ? SAY : en.speech;
export const topicsFor = (locale: Locale) => locale === "ru" ? TOPIC_HINT : en.topics;
export const dogSpecies = (key: string) => ["veo", "veo_px", "gsd"].includes(key);

const englishSpecies: Record<string, Species> = Object.fromEntries(Object.entries(SPECIES).map(([key, base]) => {
  const words = en.species[key];
  return [key, {
    ...base, ...words,
    // Resolve an entire topic pool; never mix a Russian phrase into English speech.
    say: { ...Object.fromEntries([...OWN_ONLY].map((t) => [t, en.speech[t]])), ...words?.say },
    items: base.items?.map((it) => {
      const id = Object.keys(IT).find((k) => IT[k] === it)!;
      return { ...it, id, aliases: [it.name], ...en.items[id] };
    }),
  }];
}));
export function speciesFor(key: string, locale: Locale): Species {
  const catalog = locale === "ru" ? SPECIES : englishSpecies;
  return Object.hasOwn(catalog, key) ? catalog[key] : catalog.blob;
}
export function plural(locale: Locale, n: number, forms: { one: string; few?: string; many?: string; other: string }) {
  return forms[new Intl.PluralRules(locale).select(n) as keyof typeof forms] ?? forms.other;
}
export const topicUnit = (locale: Locale, n: number) => plural(locale, n, locale === "ru"
  ? { one: "тема", few: "темы", many: "тем", other: "темы" } : { one: "topic", other: "topics" });
export const phraseUnit = (locale: Locale, n: number) => plural(locale, n, locale === "ru"
  ? { one: "фразу", few: "фразы", many: "фраз", other: "фразы" } : { one: "phrase", other: "phrases" });
export const rarityFor = (rarity: string, locale: Locale) => locale === "en" ? rarity :
  ({ common: "обычный", uncommon: "необычный", rare: "редкий", epic: "эпический", legendary: "легендарный" } as Record<string, string>)[rarity] ?? rarity;
export const posesFor = (locale: Locale): Record<Pose, string> => locale === "ru"
  ? { stand: "стоит", walk: "идёт", lie: "лежит", sit: "сидит" }
  : { stand: "standing", walk: "walking", lie: "lying down", sit: "sitting" };

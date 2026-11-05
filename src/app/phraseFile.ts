import { BuddyError } from "./errors.ts";
import type { Locale, Topic } from "../domain/types.ts";
import { SPECIES_KEYS } from "../content/species.ts";
import { TOPICS } from "../content/topicHints.ts";

type Phrases = Partial<Record<Topic, string[]>>;
export interface PhraseFile {
  version: 2;
  locales: Partial<Record<Locale, { common: Phrases; species: Record<string, Phrases> }>>;
  _help?: string;
}
function object(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function validateTopics(v: unknown) {
  if (!object(v)) throw new BuddyError("phraseTopics");
  for (const [key, list] of Object.entries(v)) {
    if (key.startsWith("_")) continue;
    if (!TOPICS.includes(key as Topic) || !Array.isArray(list) || list.some((x) => typeof x !== "string"))
      throw new BuddyError("phraseTopic", key);
  }
}
/** Normalize without mutating the source. Legacy phrases always belong to Russian. */
export function phraseFile(raw: unknown): PhraseFile {
  if (!object(raw)) throw new BuddyError("phraseFile");
  if (raw.version !== undefined) {
    if (raw.version !== 2 || !object(raw.locales)) throw new BuddyError("phraseVersion");
    for (const [locale, set] of Object.entries(raw.locales)) {
      if (!["ru", "en"].includes(locale) || !object(set) || !object(set.species)) throw new BuddyError("phraseLocale");
      validateTopics(set.common);
      for (const phrases of Object.values(set.species)) validateTopics(phrases);
    }
    return structuredClone(raw) as PhraseFile;
  }
  const common: Phrases = {};
  const species: Record<string, Phrases> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    if (TOPICS.includes(key as Topic)) {
      validateTopics({ [key]: value });
      common[key as Topic] = [...value];
    } else if (SPECIES_KEYS.includes(key)) {
      validateTopics(value);
      species[key] = structuredClone(value);
    } else throw new BuddyError("phraseKey", key);
  }
  return { version: 2, locales: { ru: { common, species } } };
}
export function phraseSet(raw: unknown, locale: Locale): Record<string, any> {
  const set = phraseFile(raw).locales[locale];
  return set ? { ...set.common, ...set.species } : {};
}

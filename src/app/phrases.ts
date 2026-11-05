/** Localized custom phrase sets. Never overwrite malformed or unknown-version files. */
import { TOPICS } from "../content/topicHints.ts";
import { cleanPhrases, phraseProblem, type PhraseProblem } from "../domain/topics.ts";
import type { Locale, Topic } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";
import { phraseFile, phraseSet, type PhraseFile } from "./phraseFile.ts";
import { message, posesFor } from "./localization.ts";

function updateFile(app: BuddyApp, change: (file: PhraseFile) => void): PhraseFile {
  const store = app.ports.phrases;
  const update = (raw: unknown) => {
    const file = phraseFile(raw);
    change(file);
    return file;
  };
  const next = store.update
    ? store.update(update) as PhraseFile
    : update(store.exists() ? store.read() : {});
  if (!store.update) store.write(next);
  app.speech.setCustom(next);
  return next;
}
export function savePhrases(app: BuddyApp, add: Partial<Record<Topic, string[]>>, locale: Locale = app.locale(), species = app.s.species): number {
  let n = 0;
  if (!Object.values(add).some((x) => x?.length)) return 0;
  updateFile(app, (file) => {
    const set = (file.locales[locale] ??= { common: {}, species: {} });
    const target = (set.species[species] ??= {});
    for (const [topic, list] of Object.entries(add)) {
      const t = topic as Topic;
      const custom = phraseSet(file, locale);
      const existing = [...(custom[t] ?? []), ...(custom[species]?.[t] ?? [])];
      const clean = cleanPhrases(t, list, existing);
      if (!clean.length) continue;
      target[t] = [...(target[t] ?? []), ...clean];
      n += clean.length;
    }
  });
  return n;
}
export function learnPhrases(app: BuddyApp, t: Topic, list: unknown, locale: Locale = app.locale()): { list: string[]; n: number } {
  // Other-language tool requests use that language's built-ins too.
  const existing = app.phrasePool(t, locale, app.s.species);
  const clean = cleanPhrases(t, list, existing);
  return { list: clean, n: savePhrases(app, { [t]: clean }, locale) };
}
export function problemText(problem: PhraseProblem, locale: Locale): string {
  if (problem.code === "empty") return message(locale, "emptyPhrase");
  if (problem.code === "long") return message(locale, "longPhrase");
  const names = posesFor(locale);
  return message(locale, "invalidPose", { allowed: problem.allowed.map((p) => names[p]).join("/"), pose: names[problem.pose as keyof typeof names] ?? problem.pose });
}
export function cleanPhraseFile(app: BuddyApp): string[] | null {
  if (!app.ports.phrases.exists()) return null;
  const removed: string[] = [];
  updateFile(app, (file) => {
    for (const [locale, set] of Object.entries(file.locales)) {
      for (const [species, topics] of [["common", set.common], ...Object.entries(set.species)] as const) {
        for (const [topic, list] of Object.entries(topics)) {
          if (!TOPICS.includes(topic as Topic)) continue;
          topics[topic as Topic] = list!.filter((text) => {
            const problem = phraseProblem(topic as Topic, text);
            if (problem) removed.push(`${locale}/${species}/${topic}: «${text}» — ${problemText(problem, app.locale())}`);
            return !problem;
          });
        }
      }
    }
  });
  return removed;
}
export function ensurePhraseTemplate(app: BuddyApp) {
  const locale = app.locale();
  updateFile(app, (file) => {
    file._help = app.t("phraseHelp", { topics: TOPICS.join(", ") });
    file.locales[locale] ??= {
      common: { done: [app.t("phraseExample")] },
      species: { veo: { hello: [app.t("phraseSpeciesExample")] } },
    };
  });
}

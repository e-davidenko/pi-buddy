/** Свои фразы пользователя: дописать выученные, почистить невалидные, создать шаблон */
import { SAY } from "../content/phrases.ts";
import { SPECIES } from "../content/species.ts";
import { TOPICS } from "../content/topicHints.ts";
import { cleanPhrases, phraseProblem } from "../domain/topics.ts";
import type { Topic } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";

/** Дописать фразы в buddy-phrases.json (для текущего вида) и сразу начать их использовать */
export function savePhrases(app: BuddyApp, add: Partial<Record<Topic, string[]>>): number {
  const store = app.ports.phrases;
  let file: any = {};
  try {
    file = store.read() ?? {};
  } catch {
    /* файла ещё нет */
  }
  const sp = (file[app.s.species] ??= {});
  let n = 0;
  for (const [t, list] of Object.entries(add)) {
    if (!list?.length) continue;
    sp[t] = [...(Array.isArray(sp[t]) ? sp[t] : []), ...list];
    n += list.length;
  }
  if (!n) return 0;
  store.write(file);
  app.speech.setCustom(file);
  return n;
}

/** Фразы, предложенные моделью или агентом: проверить (длина, поза, повторы) и сохранить */
export function learnPhrases(app: BuddyApp, t: Topic, list: unknown): { list: string[]; n: number } {
  const clean = cleanPhrases(t, list, app.speech.pool(t));
  return { list: clean, n: savePhrases(app, { [t]: clean }) };
}

/** Убрать из своих фраз то, что никогда не прозвучит: длинное или с невозможной позой. null — файла нет */
export function cleanPhraseFile(app: BuddyApp): string[] | null {
  const store = app.ports.phrases;
  let file: any = {};
  try {
    file = store.read() ?? {};
  } catch {
    return null;
  }
  const removed: string[] = [];
  const fix = (obj: any) => {
    for (const [t, list] of Object.entries(obj ?? {})) {
      if (!TOPICS.includes(t as Topic) || !Array.isArray(list)) continue;
      obj[t] = list.filter((x: unknown) => {
        const why = typeof x === "string" ? phraseProblem(t as Topic, x) : "не строка";
        if (why) removed.push(`${t}: «${String(x)}» — ${why}`);
        return !why;
      });
    }
  };
  fix(file);
  for (const k of Object.keys(SPECIES)) if (file[k] && typeof file[k] === "object") fix(file[k]);
  if (removed.length) {
    store.write(file);
    app.speech.setCustom(file);
  }
  return removed;
}

/** Создать файл своих фраз с подсказкой, если его ещё нет */
export function ensurePhraseTemplate(app: BuddyApp) {
  const store = app.ports.phrases;
  if (store.exists()) return;
  store.write({
    _help: "Свои фразы дополняют встроенные. Темы: " + Object.keys(SAY).join(", ") +
      ". Для конкретного вида: ключ вида (veo, gsd, cat...) с темами внутри. После правки — /reload.",
    done: ["моя фраза после хода"],
    veo: { hello: ["гав! моя фраза для ВЕО"] },
  });
}

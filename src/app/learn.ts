/**
 * /buddy learn [тема | пожелание] — текущая модель pi придумывает новые фразы в характере
 * питомца. Отдельный вызов модели: в историю сессии ничего не попадает.
 */
import { TOPICS, TOPIC_HINT } from "../content/topicHints.ts";
import { MAX_LEN, cleanPhrases, poseNote } from "../domain/topics.ts";
import type { Topic } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";
import { labelFor, spec } from "./catalog.ts";
import { savePhrases } from "./phrases.ts";

/** Модель pi, как её видит расширение */
export interface ModelPort {
  model: { id: string } | undefined;
  complete(prompt: string): Promise<string>;
}

/** Ответ модели → объект {тема: [фразы]} (модели любят оборачивать JSON в ```) */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

export function learnPrompt(app: BuddyApp, arg: string): { prompt: string; one: Topic | undefined } {
  const s = app.s;
  const one = TOPICS.find((t) => t.toLowerCase() === arg.toLowerCase());
  const topics = one ? [one] : TOPICS;
  const perTopic = one ? 10 : 2;
  const wish = one ? "" : arg.trim();
  const dog = !!spec(s).say?.done?.some((x) => /гав/i.test(x));
  const rng = () => app.ports.clock.rng();
  const examples = topics
    .map((t) => {
      const ex = app.speech.pool(t).sort(() => rng() - 0.5).slice(0, 3).map((x) => JSON.stringify(x)).join(", ");
      return `- ${t}: ${TOPIC_HINT[t]}; пёс в этот момент ${poseNote(t)}. Уже есть: ${ex}`;
    })
    .join("\n");
  const prompt = [
    `Придумай новые короткие реплики для питомца в терминале программиста.`,
    `Питомец: ${labelFor(s)} по кличке ${s.name}.` +
      (dog
        ? ` Это собака: часть реплик — короткая речь («гав!», «апорт!»), часть — ремарки в 3-м лице («виляет хвостом»).`
        : ""),
    `Хозяин — Java/Spring-разработчик, работает с AI-агентом pi в терминале.`,
    wish ? `Пожелание хозяина: ${wish}. Подбери подходящие темы сам, всего до 15 реплик.` : `По ${perTopic} новых реплики на тему.`,
    ``,
    `Правила: по-русски; не длиннее ${MAX_LEN} символов; без эмодзи и без кавычек вокруг; не повторяй примеры;`,
    `добрый юмор, без грубости. Ремарку про позу тела помечай префиксом позы, и только той позы,`,
    `что указана у темы (@stand: стоит, @walk: идёт, @lie: лежит, @sit: сидит).`,
    ``,
    `Темы:`,
    examples,
    ``,
    `Ответь ТОЛЬКО JSON-объектом {"тема": ["реплика", ...]} с темами из списка.`,
  ].join("\n");
  return { prompt, one };
}

export async function learn(app: BuddyApp, model: ModelPort, notify: (m: string, l: "info" | "warning" | "error") => void, arg: string) {
  if (!model.model) {
    notify("Нет активной модели pi — выбери её через /model", "warning");
    return;
  }
  const s = app.s;
  const { prompt, one } = learnPrompt(app, arg);
  app.say("думаю над новыми фразами...", 120_000);
  app.render();
  try {
    const text = await model.complete(prompt);
    const obj = parseJsonObject(text);
    if (!obj) throw new Error("модель ответила не JSON");
    const add: Partial<Record<Topic, string[]>> = {};
    for (const [t, list] of Object.entries(obj)) {
      if (!TOPICS.includes(t as Topic)) continue;
      if (one && t !== one) continue;
      add[t as Topic] = cleanPhrases(t as Topic, list, app.speech.pool(t as Topic));
    }
    const n = savePhrases(app, add);
    const sample = Object.values(add).flat().slice(0, 6).map((x) => x!.replace(/^@\w+:/, ""));
    app.say(n ? `выучил ${n} новых фраз!` : "ничего нового не придумал", 6000);
    app.react(n ? "happy" : "sad", 4000);
    notify(
      n
        ? `${s.name} выучил ${n} фраз (${Object.values(add).filter((v) => v?.length).length} тем) — ${model.model.id}.\n` +
            `Например: ${sample.join(" · ")}\nВсе свои фразы: ${app.ports.phrases.path}`
        : "Модель не предложила ничего нового (или всё отсеялось как повторы/длинное).",
      n ? "info" : "warning",
    );
  } catch (e: any) {
    app.say("не вышло выучить :(", 5000);
    notify(`Не получилось: ${e?.message ?? e}`, "error");
  }
  app.render();
}

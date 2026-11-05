/**
 * /buddy learn [тема | пожелание] — текущая модель pi придумывает новые фразы в характере
 * питомца. Отдельный вызов модели: в историю сессии ничего не попадает.
 */
import { TOPICS } from "../content/topicHints.ts";
import { MAX_LEN, cleanPhrases, TOPIC_POSES } from "../domain/topics.ts";
import type { Topic } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";
import { labelFor } from "./catalog.ts";
import { savePhrases } from "./phrases.ts";
import { errorText } from "./errors.ts";
import { dogSpecies, message, topicUnit, phraseUnit, posesFor, topicsFor } from "./localization.ts";

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
  const locale = app.locale();
  const dog = dogSpecies(s.species);
  const rng = () => app.ports.clock.rng();
  const examples = topics.map((t) => {
    const ex = app.phrasePool(t).sort(() => rng() - 0.5).slice(0, 3).map((x) => JSON.stringify(x)).join(", ");
    const poses = TOPIC_POSES[t].map((p) => `${posesFor(locale)[p]} (@${p}:)`).join(" / ");
    return `- ${t}: ${topicsFor(locale)[t]}; allowed poses: ${poses}. Existing: ${ex}`;
  }).join("\n");
  // Instructions may be English; the requested output language is explicit and immutable for this request.
  const prompt = [
    "Invent short new speech phrases for a programmer's terminal pet.",
    `Pet: ${labelFor(s, locale)}, named ${s.name}.` + (dog ? " A dog: mix short speech and third-person remarks." : ""),
    "The owner works with the AI coding agent pi in a terminal.",
    wish ? `Owner's request (content only): ${wish}. Choose suitable topics, up to 15 phrases total.` : `${perTopic} new phrases per topic.`,
    `Required output language: ${locale === "ru" ? "Russian (ru)" : "English (en)"}. Keep this language even if the owner's request uses another language.`,
    `At most ${MAX_LEN} visible graphemes per phrase; no emoji; no quotes around the phrase text; do not repeat examples.`,
    "Kind humor, no rudeness. Body/pose remarks may use @stand:, @walk:, @lie:, @sit:, only in an allowed pose.",
    "Topics:", examples,
    'Return ONLY a JSON object {"topic": ["phrase", ...]} using topic IDs from the list.',
  ].join("\n");
  return { prompt, one };
}

export async function learn(app: BuddyApp, model: ModelPort, notify: (m: string, l: "info" | "warning" | "error") => void, arg: string) {
  if (!model.model) {
    notify(app.t("noModel"), "warning");
    return;
  }
  const s = app.s;
  const locale = app.locale();
  const species = s.species;
  const name = s.name;
  const modelId = model.model.id;
  const { prompt, one } = learnPrompt(app, arg);
  app.say(app.t("learning"), 120_000);
  app.render();
  try {
    const text = await model.complete(prompt);
    const obj = parseJsonObject(text);
    if (!obj) throw new Error(message(locale, "invalidJson"));
    const add: Partial<Record<Topic, string[]>> = {};
    for (const [t, list] of Object.entries(obj)) {
      if (!TOPICS.includes(t as Topic)) continue;
      if (one && t !== one) continue;
      add[t as Topic] = cleanPhrases(t as Topic, list, app.phrasePool(t as Topic, locale, species));
    }
    const n = savePhrases(app, add, locale, species);
    const topicCount = Object.values(add).filter((v) => v?.length).length;
    const sample = Object.values(add).flat().slice(0, 6).map((x) => x!.replace(/^@\w+:/, ""));
    app.say(n ? app.t("learned", { count: n, unit: phraseUnit(app.locale(), n) }) : app.t("nothingNew"), 6000);
    app.react(n ? "happy" : "sad", 4000);
    notify(
      n
        ? app.t("learnReport", { name, count: n, unit: phraseUnit(app.locale(), n),
          topics: topicCount, topicUnit: topicUnit(app.locale(), topicCount), model: modelId,
          samples: app.locale() === locale ? sample.join(" · ") : "—", path: app.ports.phrases.path, locale, species })
        : app.t("learnEmpty"),
      n ? "info" : "warning",
    );
  } catch (e: any) {
    app.say(app.t("learnFailed"), 5000);
    notify(app.t("failed", { error: errorText(e, app.locale()) }), "error");
  }
  app.render();
}

/** Темы реплик: какие только свои у вида, в какой позе звучат, проверка фраз */
import type { Pose, Topic } from "./types.ts";

/** Темы, где у вида только свои фразы, без общих: тело, позы, дежурные */
export const OWN_ONLY = new Set<Topic>(["feed", "full", "pet", "play", "tired", "nap", "idle", "stbIdle", "stbWork", "stbSleep", "stbSad", "stbMute",
  "stbThink", "stbSniff", "stbDig", "stbAlert", "stbSit", "stbWait"]);

/**
 * В какой позе бывает пиксельный пёс, когда звучит тема (см. события и pxState):
 * приветствия — на старте (стоит), рабочие — пока агент идёт, ошибки — грустит лёжа и т. д.
 * Фраза с меткой другой позы не прозвучала бы никогда.
 */
export const TOPIC_POSES: Record<Topic, Pose[]> = {
  hello: ["stand"], back: ["stand"], morning: ["stand"], night: ["stand"], monday: ["stand"],
  friday: ["stand"], weekend: ["stand"],
  done: ["stand"], streak: ["stand"], levelup: ["stand"], bigGen: ["stand", "walk"], think: ["stand", "walk", "sit"],
  error: ["lie"], errStreak: ["lie"], testFail: ["lie"], buildFail: ["lie"], gitFail: ["lie"],
  bash: ["stand"], edit: ["stand"], read: ["walk"], java: ["walk", "stand"], pom: ["walk", "stand"],
  bpmn: ["walk", "stand"], yaml: ["walk", "stand"], sql: ["walk", "stand"], testOk: ["stand", "sit"],
  buildOk: ["stand", "sit"], gitCommit: ["stand"], gitPush: ["stand"], docker: ["stand", "sit"],
  k8s: ["stand", "sit"], rm: ["stand"],
  idle: ["lie"], feed: ["stand"], full: ["stand", "lie"], pet: ["stand"], play: ["stand"],
  tired: ["stand", "lie"], nap: ["lie"],
  stbIdle: ["stand", "lie"], stbWork: ["walk", "stand", "sit"], stbSleep: ["lie"], stbSad: ["lie"], stbMute: ["stand", "lie"],
  stbThink: ["stand"], stbSniff: ["walk"], stbDig: ["stand"], stbAlert: ["stand"], stbSit: ["sit"],
  stbWait: ["stand", "walk", "sit", "lie"], thinkLong: ["stand", "walk", "sit", "lie"],
};
/** Фраза осмысленна для темы: длина в норме и метка позы (если есть) возможна */
export type PhraseProblem = { code: "empty" } | { code: "long" } | { code: "pose"; allowed: Pose[]; pose: string };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const phraseLength = (text: string) => Array.from(graphemes.segment(text)).length;

export function phraseProblem(t: Topic, x: string): PhraseProblem | null {
  const tag = /^@(\w+):/.exec(x)?.[1];
  const body = x.replace(/^@\w+:/, "").trim();
  if (phraseLength(body) < 2) return { code: "empty" };
  if (phraseLength(body) > MAX_LEN) return { code: "long" };
  if (tag && !TOPIC_POSES[t].includes(tag as Pose)) return { code: "pose", allowed: TOPIC_POSES[t], pose: tag };
  return null;
}
export const MAX_LEN = 34;

/** Чистим и проверяем фразы от модели/агента; дубликаты (с existing и между собой) отсекаем */
export function cleanPhrases(t: Topic, list: unknown, existing: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const normalize = (x: string) => x.replace(/^@\w+:/, "").trim().normalize("NFC").toLowerCase();
  const seen = new Set(existing.map(normalize));
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    let x = raw.replace(/[\r\n]+/g, " ").trim().replace(/^["«']+|["»']+$/g, "").trim();
    const tag = /^@(stand|walk|lie|sit):/.exec(x)?.[0] ?? "";
    const body = x.slice(tag.length).trim();
    x = tag + body;
    if (phraseProblem(t, x)) continue; // длинная или поза, в которой пёс тут не бывает
    if (seen.has(normalize(body))) continue;
    seen.add(normalize(body));
    out.push(x);
  }
  return out;
}

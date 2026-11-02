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
export const POSE_RU: Record<Pose, string> = { stand: "стоит", walk: "идёт", lie: "лежит", sit: "сидит" };
export const poseNote = (t: Topic) => TOPIC_POSES[t].map((p) => `${POSE_RU[p]} (@${p}:)`).join(" или ");

/** Фраза осмысленна для темы: длина в норме и метка позы (если есть) возможна */
export function phraseProblem(t: Topic, x: string): string | null {
  const tag = /^@(\w+):/.exec(x)?.[1];
  const body = x.replace(/^@\w+:/, "").trim();
  if (body.length < 2) return "пустая";
  if (body.length > MAX_LEN) return "длинная";
  if (tag && !TOPIC_POSES[t].includes(tag as Pose)) return `пёс тут ${TOPIC_POSES[t].map((p) => POSE_RU[p]).join("/")}, а не ${POSE_RU[tag as Pose] ?? tag}`;
  return null;
}
export const MAX_LEN = 34;

/** Чистим и проверяем фразы от модели/агента; дубликаты (с existing и между собой) отсекаем */
export function cleanPhrases(t: Topic, list: unknown, existing: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set(existing.map((x) => x.toLowerCase()));
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    let x = raw.replace(/[\r\n]+/g, " ").trim().replace(/^["«']+|["»']+$/g, "").trim();
    const tag = /^@(stand|walk|lie|sit):/.exec(x)?.[0] ?? "";
    const body = x.slice(tag.length).trim();
    x = tag + body;
    if (phraseProblem(t, x)) continue; // длинная или поза, в которой пёс тут не бывает
    if (seen.has(body.toLowerCase())) continue;
    seen.add(body.toLowerCase());
    out.push(x);
  }
  return out;
}

/** Таблицы анимации: какие кадры играть в каждом состоянии и как переходить между позами */
import type { Mood, Pose, PxFrame, PxState } from "./types.ts";

/**
 * Анимация по состоянию: every — каждые N тиков по 500 мс, seq — кадры по кругу.
 * В простое редко и в основном «стоит», чтобы не отвлекать; в работе — шаг.
 */
export const PX_ANIM: Record<PxState, { every: number; seq: PxFrame[] }> = {
  work: { every: 1, seq: ["S", "WA", "S", "WB"] }, // идёт
  happy: { every: 1, seq: ["S", "WM", "WU", "WM"] }, // виляет хвостом
  love: { every: 1, seq: ["WM", "WU"] }, // виляет вовсю
  eat: { every: 2, seq: ["S", "SP"] },
  idle: { every: 2, seq: ["S", "S", "S", "SB", "S", "SP", "S", "SP", "S", "S", "SE", "S", "WM", "S", "S", "SP"] },
  rest: { every: 2, seq: ["L", "L", "L", "LB", "L", "LP", "L", "LP", "L", "L", "LT", "L"] }, // прилёг
  sad: { every: 2, seq: ["SAD", "SAD", "SAD", "SADB", "SAD", "SAD"] },
  sleep: { every: 3, seq: ["Z", "ZB"] }, // дышит во сне
  toss: { every: 1, seq: ["S", "WM", "WU", "WM"] }, // играет: подпрыгивает за предметом
  chew: { every: 2, seq: ["L", "LP", "L", "LP", "L", "LB"] }, // лёжа возится с предметом
  // во время работы агента: чем он занят (кадры есть у всех пиксельных питомцев)
  think: { every: 2, seq: ["TH", "TH", "TH2", "TH", "THB", "TH"] }, // модель думает — голова набок
  sniff: { every: 1, seq: ["SN1", "SN2"] }, // читает/ищет код — нюхает след
  dig: { every: 1, seq: ["DG1", "DG2"] }, // правит файлы — копает
  alert: { every: 2, seq: ["AL", "AL", "AL", "ALB"] }, // запустил команду — настороже
  sit: { every: 2, seq: ["SIT", "SIT", "SITP", "SIT", "SITB", "SIT", "SITP", "SIT"] }, // тесты/сборка — сидит, ждёт
  bark: { every: 1, seq: ["BK1", "BK2", "BK1", "BK2", "BK2", "BK2"] }, // гав-гав!
};
/** Состояния «лёжа»: переход между ними идёт через L, а не через стойку */
export const PX_LYING = new Set<PxState>(["rest", "sad", "sleep", "chew"]);
export const PX_SITTING = new Set<PxState>(["sit"]);

/** Базовая поза состояния: переходы идут через неё (стоит / лежит / сидит) */
export const baseOf = (st: PxState): PxFrame => (PX_LYING.has(st) ? "L" : PX_SITTING.has(st) ? "SIT" : "S");

/** Поза тела для реплик с меткой @поза: */
export const poseOf = (st: PxState): Pose => (st === "work" || st === "sniff" ? "walk" : PX_LYING.has(st) ? "lie" : PX_SITTING.has(st) ? "sit" : "stand");

// ---------- ASCII-питомцы ----------

/**
 * Темп анимации по настроению: every — каждые N тиков по 500 мс, seq — номера кадров.
 * В простое редко и в основном кадр 0, чтобы не отвлекать; в работе живее.
 */
export const ANIM: Record<Mood, { every: number; seq: number[] }> = {
  idle: { every: 2, seq: [0, 0, 0, 1, 0, 0, 0, 2] },
  work: { every: 1, seq: [0, 1, 0, 2] },
  happy: { every: 1, seq: [0, 1, 0, 2] },
  love: { every: 1, seq: [0, 1] },
  eat: { every: 1, seq: [0, 1] },
  sad: { every: 4, seq: [0] },
  sleep: { every: 4, seq: [0] },
};

export const EYES: Record<Mood, string> = {
  idle: "•",
  happy: "^",
  sad: ";",
  sleep: "-",
  work: "•",
  eat: "•",
  love: "*",
};

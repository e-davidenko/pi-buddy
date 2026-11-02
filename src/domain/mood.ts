/** Настроение питомца и что он делает, когда агент не работает */
import type { Mood, PxState } from "./types.ts";

export interface MoodInput {
  now: number;
  tempMood: Mood | null; // короткая реакция (поели, погладили, ошибка)
  tempUntil: number;
  working: boolean; // агент сейчас работает
  herding: () => boolean; // стая субагентов ещё в деле
  energy: number;
  joy: number;
  food: number;
  lastActivity: number;
  idleSleepMs: number; // через сколько простоя засыпает
}

export function moodOf(i: MoodInput): Mood {
  if (i.tempMood && i.now < i.tempUntil) return i.tempMood;
  if (i.working) return "work";
  // пока стая в деле — на посту, от скуки не засыпает (только если совсем без сил)
  if (i.energy < 10 || (!i.herding() && i.now - i.lastActivity > i.idleSleepMs)) return "sleep";
  if (i.joy < 30) return "sad";
  if (i.joy > 80 && i.food > 60) return "happy";
  return "idle";
}

/** Простой без дела дольше этого — прилёг */
export const REST_AFTER_MS = 3 * 60_000;

/** Состояние пиксельного питомца по настроению (без учёта работы агента и игр) */
export function restingState(m: Mood, lastActivity: number, now: number): PxState {
  if (m === "sleep") return "sleep";
  if (m === "sad") return "sad";
  if (m === "work" || m === "happy" || m === "love" || m === "eat") return m;
  return now - lastActivity > REST_AFTER_MS ? "rest" : "idle"; // заскучал — прилёг
}

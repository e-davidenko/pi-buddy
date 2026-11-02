/**
 * Речь питомца: из какого набора берётся реплика (свои фразы вида, общие, пользовательские),
 * без повторов подряд, с учётом позы; болтовня с кулдауном; дежурная подпись с ротацией.
 */
import { OWN_ONLY } from "./topics.ts";
import type { Pose, Topic } from "./types.ts";

export interface SpeechEnv {
  now(): number;
  rng(): number;
  species(): string;
  speciesSay(): Partial<Record<Topic, string[]>> | undefined;
  common(): Record<Topic, string[]>; // общие встроенные реплики
  pose(): Pose | null; // поза пиксельного питомца; у ASCII позы нет
  muted(): boolean;
  say(text: string, ms: number): void;
}

export const CHAT_COOLDOWN = 25_000; // болтовня не чаще раза в 25 с
export const ERR_COOLDOWN = 6_000;
export const STANDBY_ROTATE = 3 * 60_000;
/** Пока модель думает, дежурная подпись меняется чаще */
export const STANDBY_ROTATE_THINK = 20_000;

export class Speech {
  /** свои фразы пользователя: { тема: [...], вид: { тема: [...] } } */
  custom: any = {};
  private bags = new Map<string, number[]>();
  lastChat = 0;
  lastErrSay = 0;
  private stbTopic = ""; // вид:тема:поза — при смене питомца или позы фраза сразу меняется
  private stbText = "";
  private stbSince = 0;
  /** какой вариант подписи стаи показывать */
  stbPick: number;

  constructor(private env: SpeechEnv) {
    this.stbPick = Math.floor(env.rng() * 1000);
  }

  setCustom(file: any) {
    this.custom = file;
    this.bags.clear();
  }

  /** Все реплики темы, подходящие к текущей позе */
  pool(t: Topic): string[] {
    const e = this.env;
    const own = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    const mine = e.speciesSay()?.[t];
    const common = e.common()[t];
    // технические темы смешиваем (собака тоже радуется зелёным тестам по-человечески),
    // а реплики про тело и дежурные — только свои
    const base = !mine ? common : OWN_ONLY.has(t) ? mine : [...mine, ...common];
    const all = [...base, ...own(this.custom[t]), ...own(this.custom[e.species()]?.[t])];
    const ps = e.pose();
    // фраза с меткой позы — только в своей позе; без позы (ASCII) метка просто снимается
    const fit = all.flatMap((x) => {
      const m = /^@(\w+):(.*)$/.exec(x);
      if (!m) return [x];
      return !ps || m[1] === ps ? [m[2]] : [];
    });
    return fit.length ? fit : all.map((x) => x.replace(/^@\w+:/, ""));
  }

  /** Фраза темы без повторов подряд: перемешанный «мешок», пока не кончится */
  line(t: Topic): string {
    const e = this.env;
    const p = this.pool(t);
    const key = `${e.species()}:${t}:${e.pose() ?? ""}`;
    let bag = this.bags.get(key);
    if (!bag?.length || bag.some((i) => i >= p.length)) {
      bag = [...p.keys()].sort(() => e.rng() - 0.5);
      this.bags.set(key, bag);
    }
    return p[bag.pop()!];
  }

  /** Необязательная болтовня: с вероятностью, кулдауном и молчит в mute */
  chat(t: Topic, prob = 1, ms = 5000) {
    const e = this.env;
    if (e.muted()) return;
    const now = e.now();
    if (now - this.lastChat < CHAT_COOLDOWN || e.rng() > prob) return;
    this.lastChat = now;
    e.say(this.line(t), ms);
  }

  /** Важное (ответ на команду, уровень): без кулдауна; force — даже в mute */
  shout(t: Topic, ms = 5000, force = false) {
    const e = this.env;
    if (e.muted() && !force) return;
    this.lastChat = e.now();
    e.say(this.line(t), ms);
  }

  /** Ошибки озвучиваем не чаще ERR_COOLDOWN */
  errorSay(t: Topic) {
    const now = this.env.now();
    if (now - this.lastErrSay > ERR_COOLDOWN) {
      this.lastErrSay = now;
      this.shout(t);
    }
  }

  /** Дежурная подпись темы: держится, пока не сменятся вид/тема/поза или не выйдет время */
  standby(t: Topic, rotateMs: number): string {
    const e = this.env;
    const now = e.now();
    const key = `${e.species()}:${t}:${e.pose() ?? ""}`; // сменилась поза — сменилась и фраза
    if (key !== this.stbTopic || now - this.stbSince > rotateMs) {
      this.stbTopic = key;
      this.stbText = this.line(t);
      this.stbSince = now;
    }
    return this.stbText;
  }
}

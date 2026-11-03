/**
 * Приложение: питомец текущего терминала. Держит состояние, синхронизирует его с общим файлом
 * и реагирует на события агента (сценарии). Экран, файлы, часы — через порты.
 */
import { DEFAULT_BARK, SAY } from "../content/phrases.ts";
import { NAMES, RARITY_WEIGHTS, SPECIES } from "../content/species.ts";
import { PX_ANIM } from "../domain/animation.ts";
import { moodOf, restingState } from "../domain/mood.ts";
import { PackTracker } from "../domain/pack.ts";
import { PoseMachine } from "../domain/poses.ts";
import {
  GROW_LEVEL, STREAKS, hatch, level, mergeWithDisk, onGeneration, onPackReturn, onRunEnd, onToolCall, onToolError, onToolOk, relax,
} from "../domain/rules.ts";
import { STANDBY_ROTATE, STANDBY_ROTATE_THINK, Speech } from "../domain/speech.ts";
import { activityOf, classify } from "../domain/tools.ts";
import type { BuddyState, Mood, Placement, Pose, PxItem, PxMode, PxState, Topic } from "../domain/types.ts";
import { poseOf } from "../domain/animation.ts";
import { framesFor, labelFor, spec } from "./catalog.ts";
import type { Clock, Env, PetStore, PhraseStore, RunStatusReader, Scheduler, Ui, View } from "./ports.ts";
import { DOCK_W, PX_MIN_TERM, PX_W } from "./layout.ts";
import { decoFor, frameIndex } from "./viewModel.ts";

/** Через сколько тиков (по 500 мс) что делать в фоне */
const TICK_MS = 500;

export interface AppPorts {
  store: PetStore;
  phrases: PhraseStore;
  runs: RunStatusReader;
  clock: Clock;
  env: Env;
  scheduler: Scheduler;
}

/** Что известно об экране: встроились ли в редактор, ширина терминала, режим pi */
export interface Display {
  sideReady: boolean; // удалось ли встроиться в редактор
  dockReady: boolean; // поставлена ли полоса справа
  termW: number; // последняя известная ширина терминала
  mode: () => string | undefined; // режим TUI pi: fullscreen или обычный
}

export class BuddyApp {
  s: BuddyState;
  private base: BuddyState; // каким файл был при последней синхронизации
  readonly dirty = new Set<string>(); // настройки, изменённые в этом терминале
  replaced = false; // /buddy hatch: питомец заменён целиком
  /** Фоновый pi без экрана (субагент, `pi -p`, `--mode json/rpc`): ничего не сохраняет */
  headless: boolean;

  ui: Ui | null = null;
  view: View = { render() {} };
  readonly display: Display = { sideReady: false, dockReady: false, termW: 0, mode: () => undefined };

  tempMood: Mood | null = null;
  tempUntil = 0;
  bubble = "";
  bubbleUntil = 0;
  blink = false;
  working = false;
  animN = 0; // тики таймера (500 мс)
  scene: { item: PxItem; until: number; text: string } | null = null;

  private levelAtStart = 1;
  workStart = 0;
  private runErrors = 0;
  // Исходы запросов ждут успешной записи; polling их не подтверждает.
  private runEnds: boolean[] = [];
  private packErrors = new Set<string>();
  private errRow = 0;
  private lastPackSig = "";
  private syncError = "";

  readonly speech: Speech;
  readonly poses: PoseMachine;
  readonly pack: PackTracker;

  constructor(readonly ports: AppPorts) {
    const { env } = ports;
    const argv = env.argv;
    this.headless = argv.includes("-p") || argv.includes("--print") || /^(json|rpc)$/.test(argv[argv.indexOf("--mode") + 1] ?? "");
    // первый запуск: питомец детерминирован по пользователю, как в Claude Code
    this.s = ports.store.read() ?? hatch(env.user() + "@" + env.host(), this.now(), SPECIES, RARITY_WEIGHTS, NAMES);
    this.base = { ...this.s };

    const speechCustom = (() => {
      try {
        return ports.phrases.read() ?? {};
      } catch {
        return {}; // своих фраз нет — ок
      }
    })();
    this.speech = new Speech({
      now: () => this.now(),
      rng: () => ports.clock.rng(),
      species: () => this.s.species,
      speciesSay: () => spec(this.s).say,
      common: () => SAY,
      pose: () => this.pose(),
      muted: () => !!this.s.muted,
      say: (t, ms) => this.say(t, ms),
    });
    this.speech.custom = speechCustom;

    this.poses = new PoseMachine({
      now: () => this.now(),
      rng: () => ports.clock.rng(),
      hasAnim: (st) => this.hasAnim(st),
      quiet: () => this.quiet(),
      working: () => this.working,
      scene: (m) => (this.sceneOn() && m !== "sleep" && m !== "sad" ? this.scene!.item.mode : null),
      resting: (m) => restingState(m, this.s.lastActivity, this.now()),
      herding: () => this.pack.herding(),
      animN: () => this.animN,
    });

    this.pack = new PackTracker(
      { now: () => this.now(), readStatus: (dir) => ports.runs.read(dir) },
      {
        sit: () => this.poses.setAct("sit"),
        announce: (n) => {
          if (!this.s.muted) this.say(this.packGo(n), 3500);
        },
        home: (ok, gens, tools) => {
          onPackReturn(this.s, gens, tools, ok);
          if (!ok) {
            this.runErrors++;
            this.react("sad");
            if (this.pack.pack?.id) this.packErrors.add(this.pack.pack.id);
          }
          this.activity(); // стая вернулась — проснулся встречать
          if (ok && this.bark(2500, false)) this.say(this.packBack(), 3500);
          this.speech.stbPick++;
          this.sync();
        },
      },
    );
  }

  now() {
    return this.ports.clock.now();
  }
  private pick<T>(a: T[]): T {
    return a[Math.floor(this.ports.clock.rng() * a.length)];
  }

  // ---------- состояние и синхронизация ----------

  /** Пассивное изменение статов со временем */
  tick() {
    relax(this.s, this.now());
  }

  /**
   * Слить своё состояние с файлом. write=false — только подтянуть прогресс других терминалов
   * (своё несохранённое при этом не теряется).
   */
  sync(write = true) {
    if (this.headless) return;
    const now = this.now();
    this.tick();
    try {
      if (write) {
        // Не меняем baseline до подтверждённой записи: иначе повторная попытка теряет XP.
        const saved = this.ports.store.update((disk) =>
          disk && !this.replaced ? mergeWithDisk(this.s, this.base, disk, this.dirty, now, this.runEnds) : { ...this.s },
        );
        if (saved.born !== this.base.born) this.resetRunHistory();
        this.s = saved;
        this.base = { ...saved };
        this.dirty.clear();
        this.runEnds = [];
        this.replaced = false;
      } else if (!this.replaced) {
        const disk = this.ports.store.read();
        if (disk) {
          if (disk.born !== this.base.born) {
            this.dirty.clear();
            this.resetRunHistory();
          }
          this.s = mergeWithDisk(this.s, this.base, disk, this.dirty, now, this.runEnds);
          this.base = { ...disk };
        }
      }
      this.syncError = "";
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== this.syncError) {
        this.ui?.notify(`Не удалось сохранить/прочитать прогресс питомца: ${message}. Повторю сохранение автоматически.`, "warning");
      }
      this.syncError = message;
    }
  }

  activity() {
    this.s.lastActivity = this.now();
  }

  // ---------- вид и экран ----------

  placement(): Placement {
    return this.display.sideReady ? this.s.placement ?? "side" : "top";
  }
  /** Пиксельный вид активен: у питомца есть px, режим dock и терминал достаточно широкий */
  pxOn() {
    return !!spec(this.s).px && (this.s.size ?? "dock") === "dock" && this.placement() === "side" && this.display.termW >= PX_MIN_TERM;
  }
  dockW() {
    return this.pxOn() ? PX_W + 1 : DOCK_W;
  }
  pxMode(): PxMode {
    return !this.s.pxColor || this.s.pxColor === "auto" ? this.ports.env.autoPxMode() : this.s.pxColor;
  }
  /**
   * «Тихий» режим: в простое ничего не пишем в терминал.
   * В обычном (не полноэкранном) режиме pi история — это прокрутка самого терминала,
   * а консоль Windows при любом выводе прыгает вниз к курсору: анимация раз в 0,5 с
   * не давала бы листать длинные ответы. Пока агент работает, вывод идёт и так.
   */
  quiet(): boolean {
    const a = this.s.anim ?? "auto";
    if (a === "on") return false;
    if (a === "off") return !this.working;
    return !this.working && this.display.mode() !== "fullscreen";
  }
  render() {
    this.view.render();
  }

  // ---------- настроение, позы, речь ----------

  mood(): Mood {
    return moodOf({
      now: this.now(),
      tempMood: this.tempMood,
      tempUntil: this.tempUntil,
      working: this.working,
      herding: () => this.pack.herding(),
      energy: this.s.energy,
      joy: this.s.joy,
      food: this.s.food,
      lastActivity: this.s.lastActivity,
      idleSleepMs: this.ports.env.idleSleepMs,
    });
  }

  /** Есть ли у питомца кадры для анимации состояния */
  hasAnim(st: PxState) {
    return PX_ANIM[st].seq.every((k) => !!spec(this.s).px?.[k]);
  }

  /** Поза пиксельного питомца прямо сейчас; у ASCII-питомцев позы нет */
  pose(): Pose | null {
    if (!this.pxOn()) return null;
    return poseOf(this.poses.state(this.mood()));
  }

  say(text: string, ms = 5000) {
    this.bubble = text;
    this.bubbleUntil = this.now() + ms;
  }
  bubbleOn() {
    return !!this.bubble && this.now() < this.bubbleUntil;
  }
  react(m: Mood, ms = 4000) {
    this.tempMood = m;
    this.tempUntil = this.now() + ms;
  }

  isDog() {
    return !!spec(this.s).say?.done?.some((x) => /гав/i.test(x)) || this.s.species === "gsd";
  }
  barkSay(): string[] {
    const sp = spec(this.s);
    return sp.voice?.length ? sp.voice : this.s.species === "gsd" ? ["wuff!", "wuff-wuff!", "WUFF!"] : DEFAULT_BARK;
  }
  /** Подписи стаи: у собак — «стая», у остальных — свои помощники */
  packGo(n: number) {
    return this.isDog() ? (n > 1 ? `стая, вперёд! (${n})` : "апорт, помощник!") : n > 1 ? `помощники, вперёд! (${n})` : "помощник, вперёд!";
  }
  packBack() {
    return this.isDog() ? "гав! стая вернулась" : `${this.pick(this.barkSay())} ${this.pick(spec(this.s).packSay?.home ?? ["все вернулись"])}`;
  }
  /** Голос (гав/мяу/кря…): поза BK на ms; talk — ещё и реплика */
  bark(ms = 3000, talk = true) {
    if (!this.hasAnim("bark") || !this.pxOn()) return false;
    this.poses.barkUntil = this.now() + ms;
    if (talk && !this.s.muted) this.say(this.pick(this.barkSay()), ms);
    return true;
  }

  // ---- игра с любимым предметом ----
  sceneOn() {
    return !!this.scene && this.now() < this.scene.until && this.pxOn() && !this.working;
  }
  startScene(item?: PxItem, ms = 12_000) {
    const items = spec(this.s).items;
    const it = item ?? (items?.length ? items[Math.floor(this.ports.clock.rng() * items.length)] : undefined);
    if (!it) return false;
    this.scene = { item: it, until: this.now() + ms, text: this.pick(it.say) };
    return true;
  }

  /** Дежурная подпись под питомцем: что он делает (серым), пока нет живой реплики */
  standby(): string {
    if (this.sceneOn()) return this.scene!.text; // играет — и подпись про игру
    const pk = this.pack.pack;
    const sp = this.speech;
    if (this.pack.visible()) {
      const run = pk!.pups.filter((p) => p.status === "run" || p.status === "wait").length;
      if (!pk!.pups.length) return "стая собирается…";
      if (!run) return spec(this.s).packSay?.home?.[sp.stbPick % spec(this.s).packSay!.home.length] ?? "стая вернулась!";
      const ps = spec(this.s).packSay;
      if (ps?.run?.length) return ps.run[sp.stbPick % ps.run.length].replace("{n}", String(run));
      return this.isDog() ? `пасёт стаю: ${run} в деле` : `субагентов в работе: ${run}`;
    }
    const m = this.mood();
    const ACT_TOPIC: Partial<Record<PxState, Topic>> = { think: "stbThink", sniff: "stbSniff", dig: "stbDig", alert: "stbAlert", sit: "stbSit" };
    const cs = this.pxOn() ? this.poses.state(m) : null;
    const t: Topic =
      cs && this.poses.thinkingLong() && cs !== "think" ? "stbWait"
      : cs && ACT_TOPIC[cs] ? ACT_TOPIC[cs]!
      : m === "work" ? "stbWork" : m === "sleep" ? "stbSleep" : m === "sad" ? "stbSad" : this.s.muted ? "stbMute" : "stbIdle";
    return sp.standby(t, t === "stbWait" || t === "stbThink" ? STANDBY_ROTATE_THINK : STANDBY_ROTATE);
  }

  greetingTopic(): Topic {
    const d = new Date(this.now());
    const h = d.getHours();
    const wd = d.getDay();
    if (this.now() - this.s.lastActivity > 2 * 3_600_000) return "back";
    if (h >= 23 || h < 5) return "night";
    if (wd === 0 || wd === 6) return "weekend";
    if (wd === 5 && h >= 15) return "friday";
    if (wd === 1 && h < 12) return "monday";
    if (h < 11) return "morning";
    return "hello";
  }

  // ---------- сценарии: события агента ----------

  /** Экран готов: поздороваться и запустить анимацию */
  greet() {
    const greet = this.greetingTopic(); // до activity(): нужно знать, сколько тебя не было
    this.tick();
    this.activity();
    this.speech.shout(greet, 4000);
    if (greet === "back") this.ports.scheduler.later(() => this.bark(2500, false), 1500); // вернулся — встречает лаем
    this.render();
    this.ports.scheduler.startTimer();
  }

  agentStart() {
    this.sync(false); // уровень мог вырасти в другом терминале
    this.poses.setAct("think", true);
    this.levelAtStart = level(this.s.xp);
    this.workStart = this.now();
    this.runErrors = 0;
    this.working = true;
    if (this.tempMood === "sleep") {
      this.tempMood = null;
      this.tempUntil = 0;
    }
    this.activity();
    this.render();
  }

  turnStart() {
    this.poses.setAct("think"); // модель снова думает
  }

  /** Инструмент стартовал: поза по делу; субагенты — стая */
  toolStart(name: string, args: any, toolCallId: unknown, isSubagent: boolean) {
    if (isSubagent) {
      if (args?.action && args.action !== "resume") return; // status/list/stop… — не запуск
      this.pack.toolStart(toolCallId, args);
      return;
    }
    this.poses.setAct(activityOf(name, args));
  }

  /** Каждая генерация модели: кормит, утомляет, даёт XP пропорционально объёму */
  turnEnd(out: number) {
    this.tick();
    onGeneration(this.s, out);
    if (out > 3000) this.speech.chat("bigGen", 0.6);
    this.sync();
    this.render();
  }

  toolResult(name: string, input: any, ok: boolean, toolCallId?: string) {
    const packAlreadyPenalized = toolCallId !== undefined && this.packErrors.delete(toolCallId);
    onToolCall(this.s);
    const c = classify(name, input, ok);
    if (ok) {
      this.errRow = 0;
      onToolOk(this.s);
      // радостный голос: тесты зелёные, сборка прошла, запушили; тревожный — на удаление файлов
      if (c && ["testOk", "buildOk", "gitPush", "rm"].includes(c.t) && this.bark(2500, false)) {
        this.speech.lastChat = this.now();
        this.say(c.t === "rm" && this.isDog() ? "ГАВ! (не трогай файлы)" : `${this.pick(this.barkSay())} ${this.speech.line(c.t)}`, 4000);
      } else if (c) this.speech.chat(c.t, c.p);
    } else {
      if (packAlreadyPenalized) this.s.errors++;
      else onToolError(this.s);
      this.runErrors++;
      this.errRow++;
      this.react("sad", 4000);
      this.speech.errorSay(c?.t ?? (this.errRow >= 3 ? "errStreak" : "error"));
    }
    this.render();
  }

  agentEnd() {
    this.working = false;
    this.poses.setAct(null, true);
    this.activity();
    this.tick();
    const hadErrors = this.runErrors > 0;
    onRunEnd(this.s, hadErrors);
    this.runEnds.push(hadErrors);
    const s = this.s;
    if (level(s.xp) > this.levelAtStart) {
      const grewUp = spec(s).grown && level(s.xp) >= GROW_LEVEL && this.levelAtStart < GROW_LEVEL;
      this.say(grewUp ? `${s.name} вырос! теперь это ${labelFor(s)}` : `${this.speech.line("levelup")} lv.${level(s.xp)}`, 8000);
      this.react("love", 6000);
    } else if (!hadErrors) {
      if (STREAKS.includes(s.cleanRuns!)) this.speech.shout("streak", 6000);
      else this.speech.chat("done", 0.6);
      this.react("happy", 4000);
    }
    this.sync();
    this.render();
  }

  resetRunHistory() {
    this.runEnds = [];
    this.runErrors = 0;
  }

  shutdown() {
    this.sync();
  }

  // ---------- таймер: анимация и фоновые дела ----------

  /** Тик таймера (раз в 500 мс): кадр, моргание, реплики, игра, синхронизация */
  onTimer(n: number) {
    this.pack.poll(); // фоновая стая: живой статус из status.json
    const pk = this.pack.signature();
    const packChanged = pk !== this.lastPackSig;
    this.lastPackSig = pk;
    // кадр анимации/декор сменился — перерисовываем (только тогда, чтобы не дёргать TUI зря)
    const m0 = this.mood();
    const fc = framesFor(this.s).length;
    const sig = () =>
      `${this.pxOn() ? this.poses.frame(m0) + (this.sceneOn() ? this.animN - this.poses.mStart : "") : frameIndex(m0, fc, this.animN)}${decoFor(m0, this.quiet(), this.animN)}${this.pack.visible() ? "p" + this.animN : this.pack.pack ? "x" : ""}`;
    const before = sig();
    this.animN = n;
    if (this.pxOn()) this.poses.tick(this.mood());
    const animChanged = sig() !== before;
    // моргаем ~раз в 4 секунды
    const nextBlink = n % 8 === 0;
    const now0 = this.now();
    const bubbleExpired = this.bubble && now0 >= this.bubbleUntil;
    const tempExpired = this.tempMood && now0 >= this.tempUntil;
    if (bubbleExpired) this.bubble = "";
    if (tempExpired) this.tempMood = null;
    if (this.quiet()) {
      // только разовые перерисовки по событиям (реплика ушла), без анимации
      this.blink = false;
      if (bubbleExpired || tempExpired || packChanged) this.render();
    } else if (nextBlink !== this.blink || bubbleExpired || tempExpired || animChanged || packChanged) {
      this.blink = nextBlink;
      this.render();
    }
    const now = this.now();
    const sp = this.speech;
    const ticks = (ms: number) => ms / TICK_MS;
    if (this.working && n % ticks(30_000) === 0 && now - this.workStart > 20_000)
      sp.chat(this.poses.thinkingLong() && now - this.poses.thinkFrom > 60_000 ? "thinkLong" : "think", this.poses.thinkingLong() ? 0.5 : 0.3, 4000);
    // в простое иногда сам берёт любимую игрушку (не во сне и не в грусти)
    if (!this.working && !this.quiet() && this.pxOn() && n % ticks(60_000) === ticks(30_000) && !this.sceneOn()) {
      const md = this.mood();
      if ((md === "idle" || md === "happy") && this.ports.clock.rng() < 0.35) this.startScene();
    }
    if (!this.working && !this.quiet() && n % ticks(180_000) === 0) {
      const idleMs = now - this.s.lastActivity;
      if (idleMs > 3 * 60_000 && idleMs < 30 * 60_000) sp.chat("idle", 0.35, 6000);
    }
    if (n % ticks(30_000) === 0) this.sync(); // контрольная точка, включая длинные/прерванные запросы
    if (n % ticks(60_000) === 0) {
      this.tick();
      if (!this.quiet()) this.render();
    }
  }
}

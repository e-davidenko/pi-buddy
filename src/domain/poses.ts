/**
 * Автомат поз пиксельного питомца:
 *  - чем занят агент (думает, ищет, правит, ждёт тесты…) с очередью: каждая поза видна ≥ 3 с;
 *  - долгое «думает»: питомец сам себя занимает, не повторяя занятие дважды подряд;
 *  - переходы между состояниями через базовые позы (стоит / лежит / сидит);
 *  - выбор кадра анимации на текущий тик.
 */
import { PX_ANIM, baseOf } from "./animation.ts";
import type { Mood, PxFrame, PxState } from "./types.ts";

/** Что автомату нужно знать о мире */
export interface PoseEnv {
  now(): number;
  rng(): number;
  hasAnim(st: PxState): boolean; // есть ли у питомца кадры для состояния
  quiet(): boolean; // тихий режим: без анимации и смены занятий
  working(): boolean;
  scene(m: Mood): PxState | null; // игра с предметом (toss/chew), если идёт
  resting(m: Mood): PxState; // что делает без работы агента
  herding(): boolean; // стая субагентов в деле
  animN(): number; // номер тика (500 мс)
}

export const ACT_MIN_MS = 3000;
export const THINK_FIRST = 10_000;
export const THINK_STEP = 9_000;

export class PoseMachine {
  act: PxState | null = null;
  private actHold = 0; // до этого момента текущую позу не сменяем (быстрые read/edit иначе не видны)
  private actQueue: PxState[] = []; // позы, ждущие своей очереди
  barkUntil = 0;
  thinkFrom = 0;
  private thinkSeed = 0;
  private thinkSeq: PxState[] = [];
  /** Переходы: текущее состояние анимации, с какого тика оно играется, кадры перехода */
  mState: PxState | "" = "";
  mStart = 0;
  private mQueue: PxFrame[] = [];

  constructor(private env: PoseEnv) {}

  /**
   * Сменить позу активности. Если текущая показана меньше ACT_MIN_MS — встать в очередь:
   * так быстрые read/edit всё равно видны по 3 с. «Думает» между ними в очереди не копится.
   */
  setAct(a: PxState | null, force = false) {
    const now = this.env.now();
    if (force || a === null) {
      if (a !== "think" || this.act !== "think") this.thinkFrom = 0;
      this.act = a;
      this.actQueue = [];
      this.actHold = now + ACT_MIN_MS;
      return;
    }
    if (this.act && this.act !== a && now < this.actHold) {
      const last = this.actQueue[this.actQueue.length - 1] ?? this.act;
      if (last === a) return;
      if (last === "think") this.actQueue.pop(); // «думает» вытесняется следующим делом
      this.actQueue.push(a);
      if (this.actQueue.length > 3) this.actQueue.splice(0, this.actQueue.length - 3);
      return;
    }
    if (a !== this.act) this.actHold = now + ACT_MIN_MS;
    if (a !== "think") this.thinkFrom = 0;
    this.act = a;
  }

  private actStep() {
    if (this.actQueue.length && this.env.now() >= this.actHold) {
      this.act = this.actQueue.shift()!;
      if (this.act !== "think") this.thinkFrom = 0;
      this.actHold = this.env.now() + ACT_MIN_MS;
    }
  }

  barking(): boolean {
    return this.env.now() < this.barkUntil && this.env.hasAnim("bark");
  }

  /** Что питомец делает прямо сейчас */
  state(m: Mood): PxState {
    const e = this.env;
    if (this.barking()) return "bark";
    const sc = e.scene(m);
    if (sc) return sc;
    const st = e.resting(m);
    this.actStep(); // очередь поз
    if (st === "work" && this.act === "think") return this.thinkPose(); // долгое «думает» — разные занятия
    if (st === "work" && this.act && e.hasAnim(this.act)) return this.act; // чем именно занят агент
    // агент свободен, а стая ещё бегает в фоне — сидит и ждёт
    if (st !== "work" && m !== "sleep" && e.herding() && e.hasAnim("sit")) return "sit";
    return st;
  }

  /**
   * Модель думает: первые секунды — голова набок, дальше питомец сам себя занимает —
   * прислушивается, присаживается, бродит, потягивается; если думает долго — прилёг подождать.
   * Каждое занятие ~9 с, порядок свой на каждый ход и без повторов подряд.
   */
  private thinkPose(): PxState {
    const e = this.env;
    const now = e.now();
    if (!this.thinkFrom) {
      this.thinkFrom = now;
      this.thinkSeed = Math.floor(e.rng() * 1000);
      this.thinkSeq = [];
    }
    const el = now - this.thinkFrom;
    if (el < THINK_FIRST || e.quiet()) return e.hasAnim("think") ? "think" : "work";
    // занятия по отрезкам: строим цепочку шаг за шагом, соседние никогда не совпадают
    const k = Math.floor((el - THINK_FIRST) / THINK_STEP);
    while (this.thinkSeq.length <= k) {
      const j = this.thinkSeq.length;
      const t = THINK_FIRST + j * THINK_STEP;
      const prev = this.thinkSeq[j - 1] ?? "think";
      const pool = ((t < 45_000 ? ["alert", "think", "sit", "idle", "sniff"] : ["sit", "rest", "think", "idle", "rest", "alert"]) as PxState[])
        .filter((x) => x !== prev && (x === "idle" || x === "rest" || e.hasAnim(x)));
      this.thinkSeq.push(pool.length ? pool[(j * 7 + this.thinkSeed) % pool.length] : "idle");
    }
    return this.thinkSeq[k];
  }

  /** Модель думает дольше первых секунд — питомец занят ожиданием */
  thinkingLong(): boolean {
    return this.env.working() && this.act === "think" && this.thinkFrom > 0 && this.env.now() - this.thinkFrom >= THINK_FIRST;
  }

  /** Сдвиг автомата переходов раз в тик */
  tick(m: Mood) {
    const st = this.state(m);
    if (st !== this.mState) {
      this.mQueue = this.mState && baseOf(this.mState) !== baseOf(st) ? [baseOf(this.mState), baseOf(st)] : [baseOf(st)];
      this.mState = st;
      this.mStart = this.env.animN() + this.mQueue.length;
    } else if (this.mQueue.length) this.mQueue.shift();
  }

  /** Текущий кадр: в тихом режиме — первый кадр состояния, без анимации и переходов */
  frame(m: Mood): PxFrame {
    const st = this.state(m);
    const a = PX_ANIM[st];
    if (this.env.quiet()) return a.seq[0];
    if (st === this.mState && this.mQueue.length) return this.mQueue[0];
    return a.seq[Math.floor(Math.max(0, this.env.animN() - this.mStart) / a.every) % a.seq.length];
  }
}

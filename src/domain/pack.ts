/**
 * Стая: субагенты как мини-копии питомца. Отслеживает, кто из них что делает,
 * синхронные запуски (прогресс в details инструмента) и фоновые (pi-subagents async:
 * события запуска/завершения и живой status.json). Побочные эффекты — через PackListener.
 */
import { activityOf } from "./tools.ts";
import type { PxState } from "./types.ts";

export type PupStatus = "wait" | "run" | "done" | "err";
export interface Pup {
  name: string;
  act: PxState; // чем занят субагент сейчас
  status: PupStatus;
}
/** Фоновый запуск: инструмент вернулся сразу, а щенки ещё бегают */
export interface BgRun {
  dir: string;
  idx: number[];
  turns: number;
  tools: number;
  ok: boolean | null;
}

export const PUP_ERR = /^(failed|partial|stopped|rejected|error|aborted|timeout|timed_?out)$/i;
export const PUP_DONE = /^(complete|completed|done|success|succeeded|ok)$/i;
const FOREVER = Number.MAX_SAFE_INTEGER;
/** Сколько щенки ещё виляют после возвращения */
export const PACK_LINGER_MS = 5000;

export interface PackListener {
  /** питомец садится присматривать за стаей */
  sit(): void;
  /** стая отправилась: n помощников */
  announce(n: number): void;
  /** все вернулись: ok — без ошибок; gens/tools — ходы и вызовы субагентов */
  home(ok: boolean, gens: number, tools: number): void;
}

export interface PackPorts {
  now(): number;
  /** status.json фонового запуска или null */
  readStatus(dir: string): any | null;
}

export class Pack {
  id = "";
  pups: Pup[] = [];
  until = FOREVER;
  runs = new Map<string, BgRun>();
  constructor(id = "", pups: Pup[] = []) {
    this.id = id;
    this.pups = pups;
  }
  get running() {
    return this.until === FOREVER;
  }
}

export function pupsFromArgs(args: any): Pup[] {
  const list = (x: any) => (Array.isArray(x) ? x : []);
  const name = (t: any, i: number) => String(t?.agent ?? t?.name ?? t?.subagent_type ?? `агент ${i + 1}`);
  if (list(args?.tasks).length) return list(args.tasks).map((t: any, i: number) => ({ name: name(t, i), act: "think", status: "run" }));
  if (list(args?.chain).length)
    return list(args.chain).map((t: any, i: number) => ({ name: name(t, i), act: "think", status: i === 0 ? "run" : "wait" }));
  return [{ name: name(args, 0), act: "think", status: "run" }];
}

/** Трекер стаи текущего терминала */
export class PackTracker {
  pack: Pack | null = null;
  private bgPolled = 0;

  constructor(
    private ports: PackPorts,
    private on: PackListener,
  ) {}

  /** Стая на экране (бегает или ещё виляет после возвращения) */
  visible(): boolean {
    return !!this.pack && this.ports.now() < this.pack.until;
  }
  /** Кто-то из стаи ещё в деле */
  herding(): boolean {
    return this.visible() && this.pack!.pups.some((p) => p.status === "run" || p.status === "wait");
  }

  // ---- синхронный запуск (инструмент держит ход, пока субагенты работают) ----

  /** Инструмент субагентов стартовал. false — это не запуск (status/list/stop…) */
  toolStart(toolCallId: unknown, args: any): void {
    const id = String(toolCallId ?? "");
    if (args?.workflow || args?.action === "resume") {
      // щенков узнаем из события запуска (subagent:async-started) и status.json
      if (!this.pack || !this.pack.running) this.pack = new Pack(id);
      else this.pack.id = id;
      this.on.sit();
      return;
    }
    if (this.pack && this.pack.running && this.pack.runs.size) {
      // стая уже бегает в фоне — новых щенков допишем, когда запуск подтвердится
      this.pack.id = id;
      return;
    }
    this.pack = new Pack(id, pupsFromArgs(args));
    this.on.sit(); // сидит и присматривает за стаей
    this.on.announce(this.pack.pups.length);
  }

  /**
   * Обновление прогресса из details инструмента. Готов — когда субагент дал финальный ответ
   * (последнее сообщение без вызова инструмента); ошибка — код выхода > 0 или stopReason error/aborted.
   * exitCode -1 в параллельном режиме значит «ещё работает».
   */
  update(toolCallId: unknown, details: any) {
    if (this.pack && toolCallId === this.pack.id) this.applyDetails(details);
  }

  private applyDetails(details: any) {
    const pack = this.pack;
    const results: any[] = Array.isArray(details?.results) ? details.results : [];
    if (!pack || !results.length) return;
    results.forEach((r: any, i: number) => {
      if (!r) return;
      const pup = pack.pups[i] ?? (pack.pups[i] = { name: String(r.agent ?? `агент ${i + 1}`), act: "think", status: "run" });
      if ((typeof r.exitCode === "number" && r.exitCode > 0) || r.stopReason === "error" || r.stopReason === "aborted" || r.errorMessage) {
        pup.status = "err";
        return;
      }
      const msgs: any[] = Array.isArray(r.messages) ? r.messages : [];
      const last = [...msgs].reverse().find((m) => m?.role === "assistant");
      const call = Array.isArray(last?.content) ? [...last.content].reverse().find((c: any) => c?.type === "toolCall") : null;
      const finished = !!last && !call && !!last.stopReason && last.stopReason !== "toolUse";
      pup.status = finished ? "done" : "run";
      pup.act = call ? activityOf(String(call.name ?? ""), call.arguments) : "think";
    });
    // цепочка: следующие шаги ждут, пока до них не дойдёт очередь
    if (details?.mode === "chain") for (let i = results.length; i < pack.pups.length; i++) pack.pups[i].status = "wait";
  }

  /** Инструмент субагентов завершился */
  toolEnd(toolCallId: unknown, details: any, isError: boolean) {
    const pack = this.pack;
    if (!pack || toolCallId !== pack.id) return;
    // фоновый запуск (pi-subagents async): инструмент вернул только id, сами субагенты ещё работают
    const asyncId = String(details?.asyncId ?? "");
    if (asyncId && !isError) {
      const agents = pack.pups.map((p) => p.name);
      this.attach(asyncId, String(details?.asyncDir ?? ""), agents, details?.mode);
      return;
    }
    if (pack.runs.size) return; // это был вызов status/stop по фоновой стае — она ещё бегает
    this.applyDetails(details);
    // опыт за работу стаи начисляет основной терминал: ходы и вызовы инструментов субагентов
    const res: any[] = Array.isArray(details?.results) ? details.results : [];
    let gens = 0;
    let tools = 0;
    for (const r of res) {
      gens += Number(r?.usage?.turns) || 0;
      for (const m of Array.isArray(r?.messages) ? r.messages : [])
        if (m?.role === "assistant" && Array.isArray(m.content)) tools += m.content.filter((c: any) => c?.type === "toolCall").length;
    }
    this.home(!isError && !pack.pups.some((p) => p.status === "err"), gens, tools);
  }

  // ---- фоновые запуски ----

  /** Событие subagent:async-started */
  asyncStarted(d: any) {
    if (!d?.id) return;
    const agents: string[] =
      d.mode === "workflow" ? [] : Array.isArray(d.agents) && d.agents.length ? d.agents.map(String) : d.agent ? [String(d.agent)] : [];
    // workflow: заранее не знаем щенков — заведём по шагам из status.json
    this.attach(String(d.id), String(d.asyncDir ?? ""), agents, d.mode);
  }

  /** Событие subagent:async-complete */
  asyncComplete(d: any) {
    const pack = this.pack;
    if (!pack) return;
    const id = String(d?.runId ?? d?.id ?? "");
    const run = pack.runs.get(id);
    if (!run) return;
    this.bgPolled = 0;
    this.poll(); // последние счётчики ходов/инструментов
    const st = String(d?.state ?? d?.status ?? "");
    const ok = d?.success === false || PUP_ERR.test(st) ? false : true;
    this.done(id, ok, Array.isArray(d?.results) ? d.results : undefined);
  }

  /** Фоновый запуск: щенки этого run'а (новые — дописываются в стаю) */
  private attach(id: string, dir: string, agents: string[], mode?: string) {
    if (!id) return;
    if (!this.pack || !this.pack.running) {
      this.pack = new Pack();
      this.on.sit();
      if (agents.length) this.on.announce(agents.length);
    }
    const pack = this.pack;
    const old = pack.runs.get(id);
    if (old) {
      if (dir && !old.dir) old.dir = dir;
      return;
    }
    // щенки, заведённые по аргументам инструмента, ещё не привязаны ни к одному run'у — берём их
    const taken = new Set([...pack.runs.values()].flatMap((r) => r.idx));
    let idx = pack.pups.map((_, i) => i).filter((i) => !taken.has(i));
    if (!idx.length) {
      const start = pack.pups.length;
      const names = agents.length ? agents : ["помощник"];
      names.forEach((n, i) => pack.pups.push({ name: n, act: "think", status: mode === "chain" && i > 0 ? "wait" : "run" }));
      idx = names.map((_, i) => start + i);
    } else if (agents.length === idx.length) idx.forEach((p, i) => (pack.pups[p].name = agents[i]));
    pack.runs.set(id, { dir, idx, turns: 0, tools: 0, ok: null });
  }

  /** Живой прогресс фоновых запусков из их status.json (не чаще раза в секунду) */
  poll() {
    const pack = this.pack;
    const now = this.ports.now();
    if (!pack || !pack.runs.size || now - this.bgPolled < 1000) return;
    this.bgPolled = now;
    for (const [id, run] of pack.runs) {
      if (run.ok !== null || !run.dir) continue;
      const st = this.ports.readStatus(run.dir);
      if (st === null) continue;
      const steps: any[] = Array.isArray(st?.steps) && st.steps.length ? st.steps : [st];
      // в workflow шаги появляются по ходу — дописываем щенков
      while (run.idx.length < steps.length && pack.pups.length < 12) {
        pack.pups.push({ name: String(steps[run.idx.length]?.agent ?? "помощник"), act: "think", status: "wait" });
        run.idx.push(pack.pups.length - 1);
      }
      steps.forEach((step: any, i: number) => {
        const pup = pack.pups[run.idx[i] ?? -1];
        if (!pup) return;
        const status = String(step?.status ?? step?.state ?? "");
        if (typeof step?.agent === "string" && step.agent) pup.name = step.agent;
        if (PUP_ERR.test(status)) pup.status = "err";
        else if (PUP_DONE.test(status)) pup.status = "done";
        else if (status === "pending" || status === "queued") pup.status = "wait";
        else {
          pup.status = "run";
          const tool = String(step?.currentTool ?? "");
          pup.act = tool ? activityOf(tool.toLowerCase(), { command: String(step?.currentToolArgs ?? "") }) : "think";
        }
      });
      run.turns = Number(st?.turnCount) || steps.reduce((a, x) => a + (Number(x?.turnCount) || 0), 0) || run.turns;
      run.tools = Number(st?.toolCount) || steps.reduce((a, x) => a + (Number(x?.toolCount) || 0), 0) || run.tools;
      const state = String(st?.state ?? "");
      if (PUP_DONE.test(state)) this.done(id, true);
      else if (PUP_ERR.test(state)) this.done(id, false);
    }
  }

  /** Фоновый запуск закончился (событие или status.json) */
  private done(id: string, ok: boolean, results?: any[]) {
    const pack = this.pack;
    const run = pack?.runs.get(id);
    if (!pack || !run || run.ok !== null) return;
    run.ok = ok;
    run.idx.forEach((p, i) => {
      const pup = pack.pups[p];
      if (!pup) return;
      const r = results?.[i];
      const st = String(r?.status ?? "");
      pup.status = PUP_ERR.test(st) ? "err" : PUP_DONE.test(st) ? "done" : pup.status === "err" ? "err" : ok ? "done" : "err";
    });
    if ([...pack.runs.values()].every((r) => r.ok !== null)) this.home(ok);
  }

  /** Все вернулись: щенки виляют PACK_LINGER_MS и разбегаются */
  private home(ok: boolean, gens = 0, tools = 0) {
    const pack = this.pack;
    if (!pack || !pack.running) return;
    ok = ok && [...pack.runs.values()].every((r) => r.ok !== false) && !pack.pups.some((p) => p.status === "err");
    for (const r of pack.runs.values()) {
      gens += r.turns;
      tools += r.tools;
    }
    for (const p of pack.pups) if (p.status === "run" || p.status === "wait") p.status = ok ? "done" : "err";
    pack.until = this.ports.now() + PACK_LINGER_MS;
    this.on.home(ok, gens, tools);
  }

  /** Подпись состояния для перерисовки: меняется — экран обновляется */
  signature(): string {
    return this.pack ? `${this.visible()}${this.pack.pups.map((p) => p.status + p.act).join()}` : "";
  }
}

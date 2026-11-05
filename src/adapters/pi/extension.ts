/**
 * Подключение к pi: события агента → сценарии приложения, команда /buddy, инструмент для фраз,
 * таймер анимации. Здесь же собираются порты (файлы, часы, окружение) и экран.
 */
import * as os from "node:os";
import { readFileSync } from "node:fs";
import { BuddyApp } from "../../app/buddy.ts";
import { completions, runCommand } from "../../app/commands.ts";
import type { ModelPort } from "../../app/learn.ts";
import type { Env } from "../../app/ports.ts";
import { SPECIES } from "../../content/species.ts";
import { SUBAGENT_TOOL } from "../../domain/tools.ts";
import type { PxMode } from "../../domain/types.ts";
import { FilePetStore, FilePhraseStore, FileRunStatus } from "../storage/files.ts";
import { TuiView } from "../tui/view.ts";
import { registerPhraseTool } from "./phraseTool.ts";

/** IntelliJ (JediTerm) не рисует 24-битный фон — там красим только символы */
function autoPxMode(): PxMode {
  const te = `${process.env.TERMINAL_EMULATOR ?? ""} ${process.env.TERM_PROGRAM ?? ""}`;
  return /jetbrains|jediterm/i.test(te) ? "fg" : "bg";
}

const processEnv = (): Env => ({
  version: JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version,
  user: () => os.userInfo().username,
  host: () => os.hostname(),
  argv: process.argv.slice(2),
  idleSleepMs: Number(process.env.PI_BUDDY_IDLE_SLEEP_MS) || 10 * 60_000,
  autoPxMode,
  locale: process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "",
});

/** Модель pi для /buddy learn: отдельный вызов, в историю сессии ничего не попадает */
function modelPort(ctx: any): ModelPort {
  return {
    model: ctx.model && ctx.modelRegistry?.complete ? ctx.model : undefined,
    async complete(prompt: string) {
      const res = await ctx.modelRegistry.complete(
        ctx.model,
        { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
        { cacheRetention: "none" },
      );
      return (res?.content ?? [])
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("\n");
    },
  };
}

export function createBuddy(pi: any) {
  // Один живой экземпляр на процесс: при /new и /reload pi создаёт новый, а старый
  // по этому токену понимает, что его сменили, и перестаёт рисовать (иначе дубли полосы)
  const G = globalThis as any;
  // /reload может случиться посреди запроса, до agent_end/session_shutdown.
  G.__piBuddyFlush?.();
  const me = Symbol("buddy");
  G.__piBuddyLive = me;
  const alive = () => G.__piBuddyLive === me;

  let timer: ReturnType<typeof setInterval> | null = null;
  const app = new BuddyApp({
    store: new FilePetStore(undefined, (k) => !!SPECIES[k]),
    phrases: new FilePhraseStore(),
    runs: new FileRunStatus(),
    clock: { now: () => Date.now(), rng: () => Math.random() },
    env: processEnv(),
    scheduler: { startTimer: () => startTimer(), later: (fn, ms) => setTimeout(fn, ms) },
  });
  const view = new TuiView(app, alive);
  app.view = view;
  G.__piBuddyFlush = () => app.shutdown();

  function startTimer() {
    if (timer) return;
    let n = 0;
    timer = setInterval(() => {
      if (!alive()) {
        // нас сменил новый экземпляр — тихо уходим
        if (timer) clearInterval(timer);
        timer = null;
        view.hide();
        return;
      }
      n++;
      app.onTimer(n);
    }, 500);
    (timer as any).unref?.();
  }

  const tool = { ready: false };
  pi.on("session_start", async (_e: any, ctx: any) => {
    if (ctx.hasUI === false) app.headless = true;
    registerPhraseTool(pi, app, tool).catch(() => {});
    if (ctx.hasUI === false) return;
    app.ui = ctx.ui;
    try {
      await view.installSide(ctx);
    } catch {
      app.display.sideReady = false;
    }
    app.greet();
  });

  // Tool definitions stay stable; refresh language context for each agent request.
  pi.on("before_agent_start", async (event: any) => {
    if (!tool.ready || typeof event?.systemPrompt !== "string") return;
    app.sync(false);
    return { systemPrompt: event.systemPrompt + `\nThe buddy terminal pet currently uses ${app.locale()}. When the user asks to teach it phrases, generate them in this language unless the user explicitly requests another supported locale (ru/en). Pass the chosen locale to buddy_phrases. Do not call this tool without a user request.` };
  });

  pi.on("agent_start", async () => app.agentStart());
  pi.on("turn_start", async () => app.turnStart());
  pi.on("tool_execution_start", async (e: any) => {
    const name = String(e?.toolName ?? "");
    app.toolStart(name, e?.args, e?.toolCallId, SUBAGENT_TOOL.test(name) && !e?.parentToolCallId);
  });
  pi.on("tool_execution_update", async (e: any) => app.pack.update(e?.toolCallId, e?.partialResult?.details));
  pi.on("tool_execution_end", async (e: any) => app.pack.toolEnd(e?.toolCallId, e?.result?.details, !!e?.isError));
  pi.on("tool_result", async (e: any) => app.toolResult(String(e?.toolName ?? ""), e?.input, !e?.isError, e?.toolCallId));
  pi.on("turn_end", async (e: any) => app.turnEnd(Number(e?.message?.usage?.output) || 0));
  pi.on("agent_end", async () => app.agentEnd());
  pi.on("session_shutdown", async () => {
    view.hide();
    app.shutdown();
    if (timer) clearInterval(timer);
    timer = null;
  });

  // pi-subagents: события фоновых запусков
  const bus: any = pi.events;
  if (bus?.on) {
    bus.on("subagent:async-started", (d: any) => {
      if (!alive() || app.headless) return;
      app.pack.asyncStarted(d);
    });
    bus.on("subagent:async-complete", (d: any) => {
      if (!alive()) return;
      app.pack.asyncComplete(d);
    });
  }

  pi.registerCommand("buddy", {
    description: "Terminal pet / Тамагочи: /buddy … | lang ru/en/auto",
    getArgumentCompletions: (prefix: string) => completions(prefix, app.locale()),
    handler: async (args: string, ctx: any) => {
      app.ui = ctx.ui ?? app.ui;
      await runCommand(app, args, ctx.ui, modelPort(ctx));
    },
  });

  return app;
}

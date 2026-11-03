import assert from "node:assert/strict";
import { test } from "node:test";
import { PACK_LINGER_MS, PackTracker } from "../src/domain/pack.ts";
import { fakeClock } from "./helpers.ts";

function tracker() {
  const c = fakeClock();
  const status = new Map<string, any>();
  const calls: string[] = [];
  const homes: [boolean, number, number][] = [];
  const t = new PackTracker(
    { now: c.now, readStatus: (dir) => status.get(dir) ?? null },
    {
      sit: () => calls.push("sit"),
      announce: (n) => calls.push(`go ${n}`),
      home: (ok, g, tools) => {
        calls.push("home");
        homes.push([ok, g, tools]);
      },
    },
  );
  return { t, c, status, calls, homes };
}
const pupState = (t: PackTracker) => t.pack!.pups.map((p) => `${p.name}:${p.status}:${p.act}`).join(" ");
const call = (name: string) => ({ role: "assistant", content: [{ type: "toolCall", name, arguments: {} }], stopReason: "toolUse" });
const answer = { role: "assistant", content: [{ type: "text", text: "готово" }], stopReason: "stop" };

test("параллельные субагенты: прогресс из details, exitCode -1 — ещё работает", () => {
  const { t, calls, homes, c } = tracker();
  t.toolStart("x", { tasks: [{ agent: "scout" }, { agent: "worker" }] });
  assert.deepEqual(calls, ["sit", "go 2"]);
  assert.ok(t.herding());
  t.update("x", { results: [{ exitCode: -1, messages: [call("read")] }, { exitCode: -1, messages: [call("edit")] }] });
  assert.equal(pupState(t), "scout:run:sniff worker:run:dig");
  t.update("x", { results: [{ exitCode: 0, messages: [answer] }, { exitCode: -1, messages: [call("bash")] }] });
  assert.equal(pupState(t), "scout:done:think worker:run:alert");
  t.toolEnd("x", { results: [{ messages: [answer], usage: { turns: 3 } }, { messages: [call("read"), answer], usage: { turns: 2 } }] }, false);
  assert.deepEqual(homes, [[true, 5, 1]]);
  assert.ok(!t.herding());
  assert.ok(t.visible()); // ещё виляют
  c.advance(PACK_LINGER_MS);
  assert.ok(!t.visible());
});

test("цепочка: следующие ждут своей очереди; ошибка — крестик", () => {
  const { t } = tracker();
  t.toolStart("c", { chain: [{ agent: "a" }, { agent: "b" }, { agent: "c" }] });
  assert.equal(pupState(t), "a:run:think b:wait:think c:wait:think");
  t.update("c", { mode: "chain", results: [{ messages: [answer] }, { exitCode: 2 }] });
  assert.equal(pupState(t), "a:done:think b:err:think c:wait:think");
});

test("служебные вызовы и чужие toolCallId стаю не трогают", () => {
  const { t, homes } = tracker();
  t.toolStart("x", { agent: "scout" });
  t.update("other", { results: [{ exitCode: 1 }] });
  t.toolEnd("other", {}, false);
  assert.equal(pupState(t), "scout:run:think");
  assert.equal(homes.length, 0);
});

test("фоновый запуск: инструмент вернулся сразу, стая бегает до события завершения", () => {
  const { t, c, status, homes } = tracker();
  t.toolStart("x", { agent: "analyzer" });
  t.asyncStarted({ id: "run1", mode: "single", agent: "analyzer", asyncDir: "/runs/1" });
  t.toolEnd("x", { asyncId: "run1", asyncDir: "/runs/1" }, false);
  assert.equal(homes.length, 0, "мгновенный ответ инструмента — ещё не возвращение");
  assert.ok(t.herding());
  status.set("/runs/1", { state: "running", steps: [{ agent: "analyzer", status: "running", currentTool: "Bash", currentToolArgs: "mvn test" }] });
  c.advance(1000);
  t.poll();
  assert.equal(pupState(t), "analyzer:run:sit");
  status.set("/runs/1", { state: "running", turnCount: 7, toolCount: 5, steps: [{ agent: "analyzer", status: "running" }] });
  t.asyncComplete({ runId: "run1", state: "complete", results: [{ status: "completed" }] });
  assert.deepEqual(homes, [[true, 7, 5]]);
  assert.equal(pupState(t), "analyzer:done:think");
});

test("фоновый запуск: завершение по status.json и ошибка", () => {
  const { t, c, status, homes } = tracker();
  t.asyncStarted({ id: "r", mode: "single", agent: "w", asyncDir: "/r" });
  status.set("/r", { state: "failed", steps: [{ agent: "w", status: "failed" }] });
  c.advance(1000);
  t.poll();
  assert.deepEqual(homes, [[false, 0, 0]]);
  assert.equal(pupState(t), "w:err:think");
});

test("workflow: щенки появляются по шагам из status.json", () => {
  const { t, c, status } = tracker();
  t.toolStart("w", { workflow: true });
  t.asyncStarted({ id: "wf", mode: "workflow", agent: "workflow", asyncDir: "/wf" });
  status.set("/wf", { state: "running", steps: [{ agent: "plan", status: "complete" }, { agent: "code", status: "running", currentTool: "write" }, { agent: "review", status: "pending" }] });
  c.advance(1000);
  t.poll();
  assert.equal(pupState(t), "plan:done:think code:run:dig review:wait:think");
});

test("опрос status.json не чаще раза в секунду", () => {
  const c = fakeClock();
  let reads = 0;
  const t = new PackTracker(
    { now: c.now, readStatus: () => (reads++, { state: "running" }) },
    { sit() {}, announce() {}, home() {} },
  );
  t.asyncStarted({ id: "r", agent: "w", asyncDir: "/r" });
  c.advance(1000);
  t.poll();
  t.poll();
  c.advance(999);
  t.poll();
  assert.equal(reads, 1);
  c.advance(1);
  t.poll();
  assert.equal(reads, 2);
});

test("общий исход стаи остаётся неудачным, когда последний фоновый запуск успешен", () => {
  const { t, homes } = tracker();
  t.asyncStarted({ id: "a", agent: "first" });
  t.asyncStarted({ id: "b", agent: "last" });
  t.asyncComplete({ runId: "a", success: false });
  assert.equal(homes.length, 0);
  t.asyncComplete({ runId: "b", success: true });
  assert.deepEqual(homes, [[false, 0, 0]]);
  t.asyncComplete({ runId: "b", success: true });
  assert.equal(homes.length, 1);
});

test("ошибка внутри details делает возвращение неуспешным даже без isError оболочки", () => {
  const { t, homes } = tracker();
  t.toolStart("x", { agent: "worker" });
  t.toolEnd("x", { results: [{ exitCode: 1, usage: { turns: 2 } }] }, false);
  assert.deepEqual(homes, [[false, 2, 0]]);
});

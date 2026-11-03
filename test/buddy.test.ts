import assert from "node:assert/strict";
import { test } from "node:test";
import { BuddyApp } from "../src/app/buddy.ts";
import type { AppPorts } from "../src/app/buddy.ts";
import type { BuddyState } from "../src/domain/types.ts";
import { fakeClock } from "./helpers.ts";

function setup() {
  const clock = fakeClock();
  let disk: BuddyState | null = null;
  let failRead = false;
  let failWrite = false;
  const ports: AppPorts = {
    clock,
    env: { user: () => "test", host: () => "host", argv: [], idleSleepMs: 600_000, autoPxMode: () => "bg" },
    phrases: { path: "phrases.json", read: () => ({}), write() {}, exists: () => true },
    runs: { read: () => null },
    scheduler: { startTimer() {}, later() {} },
    store: {
      read() {
        if (failRead) throw new Error("read failed");
        return disk && { ...disk };
      },
      write(s) {
        if (failWrite) throw new Error("write failed");
        disk = { ...s };
      },
      update(change) {
        const next = change(this.read());
        this.write(next);
        return next;
      },
    },
  };
  const app = new BuddyApp(ports);
  app.sync();
  return { app, ports, clock, disk: () => disk!, failRead: (v: boolean) => { failRead = v; }, failWrite: (v: boolean) => { failWrite = v; } };
}

test("ошибка записи не теряет локальный XP и настройки при повторной синхронизации", () => {
  const f = setup();
  const other = new BuddyApp(f.ports);
  f.app.s.xp += 10;
  f.app.s.name = "Тапок";
  f.app.dirty.add("name");
  f.failWrite(true);
  f.app.sync();
  assert.equal(f.disk().xp, 0);
  assert.equal(f.app.s.xp, 10);
  assert.ok(f.app.dirty.has("name"));
  f.failWrite(false);
  other.s.xp += 20;
  other.sync();
  f.app.sync();
  assert.equal(f.disk().xp, 30);
  assert.equal(f.disk().name, "Тапок");
  f.app.sync();
  assert.equal(f.disk().xp, 30, "повторное сохранение не начисляет XP дважды");
});

test("ошибка чтения не перезаписывает файл и не сбрасывает локальный прогресс", () => {
  const f = setup();
  f.app.s.xp = 100;
  f.app.sync();
  f.app.s.xp += 5;
  f.failRead(true);
  f.app.sync();
  assert.equal(f.disk().xp, 100);
  assert.equal(f.app.s.xp, 105);
  f.failRead(false);
  f.app.sync();
  assert.equal(f.disk().xp, 105);
});

test("каждый turn сохраняется до завершения всего запроса", () => {
  const f = setup();
  f.app.agentStart();
  f.app.turnEnd(4000);
  assert.equal(f.disk().xp, 6);
  assert.equal(new BuddyApp(f.ports).s.xp, 6);
});

test("checkpoint сохраняет инструменты посреди длинного запроса", () => {
  const f = setup();
  f.app.agentStart();
  f.app.toolResult("read", {}, true);
  f.clock.advance(30_000);
  f.app.onTimer(60);
  assert.equal(f.disk().xp, 1);
  assert.equal(f.disk().toolCalls, 1);
});

test("опрос состояния другого терминала не удваивает локальные приращения", () => {
  const f = setup();
  const other = new BuddyApp(f.ports);
  f.app.s.xp += 10;
  other.s.xp += 20;
  other.sync();
  f.app.sync(false);
  f.app.sync(false);
  f.app.sync();
  assert.equal(f.disk().xp, 30);
});

test("headless-процесс не сохраняет опыт родительского питомца", () => {
  const f = setup();
  const child = new BuddyApp({ ...f.ports, env: { ...f.ports.env, argv: ["-p"] } });
  child.turnEnd(4000);
  child.shutdown();
  assert.equal(f.disk().xp, 0);
});

test("начало работы прерывает только сон, сохраняет силы и другие реакции", () => {
  for (const mood of ["sleep", "love", "sad", "eat"] as const) {
    const f = setup();
    f.app.s.energy = 70;
    f.app.sync();
    f.app.react(mood, 8000);
    f.app.agentStart();
    assert.equal(f.app.mood(), mood === "sleep" ? "work" : mood);
    assert.equal(f.app.s.energy, 70);
  }
});

test("ошибка сохраняет XP, штрафует на 10, завершение сбрасывает общую серию без бонуса", () => {
  const f = setup();
  Object.assign(f.app.s, { joy: 60, cleanRuns: 3 });
  f.ports.store.write({ ...f.disk(), cleanRuns: 3 });
  f.app.sync();
  f.app.agentStart();
  f.app.toolResult("read", {}, false);
  assert.equal(f.app.s.xp, 1);
  assert.equal(f.app.s.errors, 1);
  assert.equal(f.app.s.toolCalls, 1);
  assert.equal(f.app.s.joy, 50);
  f.app.agentEnd();
  assert.equal(f.disk().joy, 50);
  assert.equal(f.disk().cleanRuns, 0);
});

test("успешное завершение даёт радость и увеличивает серию", () => {
  const f = setup();
  Object.assign(f.app.s, { joy: 60, cleanRuns: 3 });
  f.ports.store.write({ ...f.disk(), cleanRuns: 3 });
  f.app.sync();
  f.app.agentStart();
  f.app.toolResult("read", {}, true);
  f.app.agentEnd();
  assert.equal(f.disk().joy, 65.5);
  assert.equal(f.disk().cleanRuns, 4);
});

test("серия нескольких терминалов учитывает успехи и сбросы в порядке сохранения", () => {
  const f = setup();
  const other = new BuddyApp(f.ports);
  f.app.agentStart();
  other.agentStart();
  f.app.agentEnd();
  other.agentEnd();
  assert.equal(f.disk().cleanRuns, 2);
  f.app.agentStart();
  other.agentStart();
  f.app.toolResult("read", {}, false);
  other.agentEnd();
  assert.equal(f.disk().cleanRuns, 3);
  f.app.agentEnd();
  assert.equal(f.disk().cleanRuns, 0);
});

test("ошибка сохранения и повторный polling не теряют и не дублируют завершения", () => {
  const f = setup();
  const other = new BuddyApp(f.ports);
  f.failWrite(true);
  f.app.agentStart();
  f.app.agentEnd();
  f.failWrite(false);
  other.agentStart();
  other.agentEnd();
  for (let i = 0; i < 3; i++) f.app.sync(false);
  assert.equal(f.app.s.cleanRuns, 2);
  f.app.sync();
  f.app.sync();
  assert.equal(f.disk().cleanRuns, 2);
});

test("после сохранения настройки другой терминал может поменять её без обратного перетирания", () => {
  const f = setup();
  f.app.s.name = "Первый";
  f.app.dirty.add("name");
  f.app.sync();
  const other = new BuddyApp(f.ports);
  other.s.name = "Второй";
  other.dirty.add("name");
  other.sync();
  f.app.sync();
  assert.equal(f.disk().name, "Второй");
});

test("polling сохраняет локальный несохранённый XP при следующей записи", () => {
  const f = setup();
  const other = new BuddyApp(f.ports);
  f.app.s.xp += 10;
  other.s.xp += 20;
  other.sync();
  f.app.sync(false);
  other.s.xp += 5;
  other.sync();
  f.app.sync();
  assert.equal(f.disk().xp, 35);
});

test("чужое яйцо отбрасывает локальные шкалы, настройки, XP и несохранённые завершения", () => {
  const f = setup();
  f.failWrite(true);
  f.app.agentStart();
  f.app.agentEnd();
  f.app.s.xp += 100;
  f.app.s.name = "Старый";
  f.app.dirty.add("name");
  f.failWrite(false);
  const other = new BuddyApp(f.ports);
  other.s = { ...other.s, born: other.s.born + 1, name: "Новый", xp: 0, cleanRuns: 0 };
  other.replaced = true;
  other.sync();
  f.app.sync(false);
  f.app.sync();
  assert.equal(f.disk().name, "Новый");
  assert.equal(f.disk().xp, 0);
  assert.equal(f.disk().cleanRuns, 0);
  assert.equal(f.app.dirty.size, 0);
});

test("неудача стаи штрафуется один раз, XP сохраняется, повторный toolEnd не начисляет снова", () => {
  const f = setup();
  f.app.s.joy = 60;
  f.app.sync();
  f.app.agentStart();
  f.app.pack.toolStart("pack-1", { agent: "worker" });
  const details = { results: [{ exitCode: 1, usage: { turns: 3 }, messages: [
    { role: "assistant", content: [{ type: "toolCall", name: "read" }, { type: "toolCall", name: "edit" }] },
  ] }] };
  f.app.pack.toolEnd("pack-1", details, true);
  assert.equal(f.app.s.joy, 50);
  assert.equal(f.app.s.xp, 8);
  assert.equal(f.app.s.toolCalls, 2);
  f.app.pack.toolEnd("pack-1", details, true);
  assert.equal(f.app.s.xp, 8);
  f.app.toolResult("subagent", {}, false, "pack-1");
  assert.equal(f.app.s.joy, 50);
  assert.equal(f.app.s.xp, 9);
  f.app.agentEnd();
  assert.equal(f.disk().joy, 50);
  assert.equal(f.disk().cleanRuns, 0);
});

test("новое яйцо без опциональных счётчиков не наследует их из памяти старого питомца", () => {
  for (const write of [true, false]) {
    const f = setup();
    f.app.turnEnd(4000);
    const other = new BuddyApp(f.ports);
    const newborn = { ...f.disk(), born: f.disk().born + 1, xp: 0, toolCalls: 0, errors: 0 };
    delete newborn.generations;
    delete newborn.tokensOut;
    delete newborn.cleanRuns;
    other.s = newborn;
    other.replaced = true;
    other.sync();
    f.app.sync(write);
    f.app.sync();
    assert.equal(f.disk().generations ?? 0, 0);
    assert.equal(f.disk().tokensOut ?? 0, 0);
    assert.equal(f.disk().xp, 0);
  }
});

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

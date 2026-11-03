import assert from "node:assert/strict";
import { test } from "node:test";
import { BuddyApp } from "../src/app/buddy.ts";
import { completions, runCommand } from "../src/app/commands.ts";
import type { Ui } from "../src/app/ports.ts";
import type { BuddyState } from "../src/domain/types.ts";
import { fakeClock } from "./helpers.ts";

function setup(select?: Ui["select"], confirm?: Ui["confirm"]) {
  let disk: BuddyState | null = null;
  const notices: string[] = [];
  const ui: Ui = { notify: (text) => { notices.push(text); }, select, confirm };
  const app = new BuddyApp({
    clock: fakeClock(),
    env: { version: "9.8.7", user: () => "test", host: () => "host", argv: [], idleSleepMs: 600_000, autoPxMode: () => "bg" },
    scheduler: { startTimer() {}, later() {} },
    phrases: { path: "phrases.json", read: () => ({}), write() {}, exists: () => true },
    runs: { read: () => null },
    store: {
      read: () => disk && { ...disk },
      write: (state) => { disk = { ...state }; },
      update(change) {
        const next = change(this.read());
        this.write(next);
        return next;
      },
    },
  });
  app.s.species = "blob";
  app.s.xp = 1000;
  app.s.name = "Бульк";
  app.sync();
  return { app, notices, ui, disk: () => disk!, command: (args: string) => runCommand(app, args, ui, { model: undefined, complete: async () => "" }) };
}

test("прямая команда выбирает ВЕО без меню и сохраняет имя и опыт", async () => {
  const f = setup();
  await f.command("choose veo_px");
  assert.equal(f.app.s.species, "veo_px");
  assert.equal(f.disk().species, "veo_px");
  assert.equal(f.disk().xp, 1000);
  assert.equal(f.disk().name, "Бульк");
  await f.command("choose gsd");
  assert.equal(f.disk().species, "gsd");
});

test("выбор из меню использует ключ вида и сохраняет выбранного пса", async () => {
  const f = setup(async (_title, options) => options.find((x) => x.startsWith("veo_px —")));
  await f.command("choose");
  assert.equal(f.disk().species, "veo_px");
  assert.equal(f.disk().xp, 1000);
});

test("отсутствующее или закрытое меню оставляет видимую инструкцию", async () => {
  for (const select of [undefined, async () => undefined]) {
    const f = setup(select);
    await f.command("choose");
    assert.equal(f.disk().species, "blob");
    assert.ok(f.notices.some((x) => x.includes("/buddy choose veo_px") && x.includes("/buddy choose duck")));
  }
});

test("исключение при открытии меню даёт рабочую альтернативу", async () => {
  const f = setup(async () => { throw new Error("UI unavailable"); });
  await f.command("choose");
  assert.ok(f.notices.some((x) => x.includes("UI unavailable") && x.includes("/buddy choose veo_px")));
  assert.equal(f.disk().species, "blob");
});

test("неизвестный вид не выбирается и показывает полную команду", async () => {
  const f = setup();
  for (const key of ["random-pet", "constructor", "__proto__"]) {
    await f.command(`choose ${key}`);
    assert.equal(f.disk().species, "blob");
    assert.ok(f.notices.at(-1)?.includes("/buddy choose veo_px"));
  }
});

test("подсказки и прямая команда не зависят от регистра", async () => {
  assert.ok(completions("CHOOSE VEO_").some((x) => x.value === "choose veo_px"));
  const f = setup();
  await f.command("CHOOSE VEO_PX");
  assert.equal(f.disk().species, "veo_px");
});

test("version показывает версию расширения из окружения", async () => {
  const f = setup();
  await f.command("version");
  assert.ok(f.notices.includes("pi-buddy 9.8.7"));
  assert.equal(f.disk().xp, 1000);
});


test("уход меняет шкалы точно, насыщает до 100 и не приносит XP", async () => {
  const f = setup();
  Object.assign(f.app.s, { food: 60, joy: 60, energy: 50 });
  f.app.sync();
  await f.command("feed");
  assert.equal(f.disk().food, 90);
  assert.equal(f.disk().energy, 55);
  await f.command("pet");
  assert.equal(f.disk().joy, 75);
  await f.command("play");
  assert.equal(f.disk().joy, 100);
  assert.equal(f.disk().energy, 40);
  assert.equal(f.disk().food, 85);
  assert.equal(f.disk().xp, 1000);
  await f.command("nap");
  assert.equal(f.disk().energy, 80);
  assert.equal(f.app.tempMood, "sleep");
  assert.equal(f.app.tempUntil - f.app.now(), 8000);
  for (let i = 0; i < 5; i++) await f.command("nap");
  assert.equal(f.disk().energy, 100);
});

test("кормление разрешено при 95, а игра при 15 энергии; ниже сил не хватает", async () => {
  for (const food of [94, 95, 96, 100]) {
    const f = setup();
    Object.assign(f.app.s, { food, energy: 50 });
    f.app.sync();
    await f.command("feed");
    assert.equal(f.disk().food, food <= 95 ? 100 : food);
    assert.equal(f.disk().energy, food <= 95 ? 55 : 50);
  }
  for (const energy of [14, 15, 16]) {
    const f = setup();
    Object.assign(f.app.s, { food: 60, joy: 60, energy });
    f.app.sync();
    await f.command("play");
    assert.equal(f.disk().energy, energy < 15 ? energy : energy - 15);
    assert.equal(f.disk().food, energy < 15 ? 60 : 55);
    assert.equal(f.disk().joy, energy < 15 ? 60 : 85);
    assert.equal(f.disk().xp, 1000);
  }
});

test("mute и unmute сохраняют настройку", async () => {
  const f = setup();
  await f.command("mute");
  assert.equal(f.disk().muted, true);
  await f.command("unmute");
  assert.equal(f.disk().muted, false);
});

test("choose сохраняет жизнь и shiny, меняет только вид и его редкость", async () => {
  const f = setup();
  Object.assign(f.app.s, { shiny: true, rarity: "common", food: 30, joy: 45, energy: 70, errors: 3, cleanRuns: 7 });
  f.app.sync();
  const before = { ...f.disk() };
  await f.command("choose veo_px");
  const { SPECIES } = await import("../src/content/species.ts");
  assert.deepEqual(f.disk(), { ...before, species: "veo_px", rarity: SPECIES.veo_px.rarity });
});

test("hatch без подтверждения и отмена ничего не меняют", async () => {
  for (const confirm of [undefined, async () => false]) {
    const f = setup(undefined, confirm);
    f.app.s.visible = false;
    f.app.sync();
    const before = { ...f.disk() };
    await f.command("hatch");
    assert.deepEqual(f.disk(), before);
    assert.deepEqual(f.app.s, before);
    if (!confirm) assert.ok(f.notices.at(-1)?.includes("/buddy hatch confirm"));
  }
});

test("hatch сбрасывает жизнь, сохраняет настройки и заменяет питомца даже в ту же миллисекунду", async () => {
  for (const explicit of [false, true]) {
    const f = setup(undefined, explicit ? undefined : async () => true);
    Object.assign(f.app.s, { toolCalls: 20, errors: 3, generations: 8, tokensOut: 9000, cleanRuns: 5,
      food: 20, joy: 30, energy: 40, placement: "top", size: "compact", muted: true, anim: "off", pxColor: "fg", visible: false });
    f.app.sync();
    for (const key of ["placement", "size", "muted", "anim", "pxColor", "visible"]) f.app.dirty.add(key);
    f.app.sync();
    const before = { ...f.disk() };
    await f.command(explicit ? "hatch confirm" : "hatch");
    const after = f.disk();
    assert.notEqual(after.born, before.born);
    assert.equal(after.xp, 0);
    for (const key of ["toolCalls", "errors", "generations", "tokensOut", "cleanRuns"] as const) assert.equal(after[key] ?? 0, 0);
    assert.deepEqual([after.food, after.joy, after.energy], [80, 80, 100]);
    for (const key of ["placement", "size", "muted", "anim", "pxColor", "visible"] as const) assert.equal(after[key], before[key]);
  }
});

test("имя ограничено 20 символами", async () => {
  const f = setup();
  await f.command("name abcdefghijklmnopqrstuvwxyz");
  assert.equal(f.disk().name, "abcdefghijklmnopqrst");
});

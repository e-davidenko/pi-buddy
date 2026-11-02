import assert from "node:assert/strict";
import { test } from "node:test";
import { NAMES, RARITY_WEIGHTS, SPECIES } from "../src/content/species.ts";
import { BASE, clamp, hatch, level, mergeWithDisk, onGeneration, onRunEnd, relax } from "../src/domain/rules.ts";
import type { BuddyState } from "../src/domain/types.ts";

const T0 = Date.UTC(2026, 9, 27, 12);
const pet = (o: Partial<BuddyState> = {}): BuddyState => ({
  name: "Сальса", species: "veo_px", rarity: "legendary", shiny: false, born: T0, food: 70, joy: 60, energy: 90,
  xp: 100, lastTick: T0, lastActivity: T0, visible: true, toolCalls: 0, errors: 0, ...o,
});

test("уровень: ⌊√(xp/10)⌋ + 1, без потолка", () => {
  assert.equal(level(0), 1);
  assert.equal(level(10), 2);
  assert.equal(level(90), 4);
  assert.equal(level(1_000_000), 317);
});

test("шкалы сами возвращаются к базе и не выходят за 0..100", () => {
  const s = pet({ food: 0, joy: 100, energy: 0 });
  relax(s, T0 + 48 * 3_600_000);
  assert.ok(Math.abs(s.food - BASE.food) < 0.1);
  assert.ok(Math.abs(s.joy - BASE.joy) < 0.1);
  assert.ok(Math.abs(s.energy - BASE.energy) < 0.1);
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-5), 0);
});

test("генерация кормит, утомляет и даёт опыт", () => {
  const s = pet();
  onGeneration(s, 4000);
  assert.equal(s.generations, 1);
  assert.equal(s.tokensOut, 4000);
  assert.equal(s.xp, 100 + 2 + 4);
  assert.ok(s.food > 70 && s.energy < 90);
});

test("серия без ошибок обнуляется ошибкой", () => {
  const s = pet({ cleanRuns: 4 });
  onRunEnd(s, false);
  assert.equal(s.cleanRuns, 5);
  onRunEnd(s, true);
  assert.equal(s.cleanRuns, 0);
});

test("несколько терминалов: счётчики складываются, уровень не откатывается", () => {
  // оба терминала стартовали с одного файла
  const base = pet({ xp: 100, toolCalls: 0 });
  const disk = pet({ xp: 130, toolCalls: 30 }); // терминал A уже сохранил +30
  const mine = pet({ xp: 110, toolCalls: 10 }); // терминал B набрал +10
  const m = mergeWithDisk(mine, base, disk, new Set(), T0);
  assert.equal(m.xp, 140);
  assert.equal(m.toolCalls, 40);
});

test("несколько терминалов: настройки — только изменённые здесь", () => {
  const base = pet();
  const disk = pet({ name: "Другая", species: "cat" });
  const mine = pet({ name: "Сальса", muted: true });
  const m = mergeWithDisk(mine, base, disk, new Set(["muted"]), T0);
  assert.equal(m.name, "Другая"); // имя меняли в другом терминале
  assert.equal(m.species, "cat");
  assert.equal(m.muted, true); // а звук выключили здесь
});

test("устаревший файл не откатывает уже известный опыт и счётчики", () => {
  const base = pet({ xp: 100, toolCalls: 20 });
  const mine = pet({ xp: 105, toolCalls: 21 });
  const disk = pet({ xp: 10, toolCalls: 0 });
  const merged = mergeWithDisk(mine, base, disk, new Set(), T0);
  assert.equal(merged.xp, 105);
  assert.equal(merged.toolCalls, 21);
});

test("новое яйцо в другом терминале не наследует опыт прежнего питомца", () => {
  const base = pet({ xp: 1000 });
  const mine = pet({ xp: 1010 });
  const disk = pet({ born: T0 + 1, xp: 0 });
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0 + 1).xp, 0);
});

test("несколько терминалов: шкалы — приращениями", () => {
  const base = pet({ joy: 60 });
  const disk = pet({ joy: 40 }); // там огорчились на -20
  const mine = pet({ joy: 70 }); // тут обрадовались на +10
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0).joy, 50);
});

test("вылупление детерминировано по seed", () => {
  const a = hatch("user@host", T0, SPECIES, RARITY_WEIGHTS, NAMES);
  const b = hatch("user@host", T0, SPECIES, RARITY_WEIGHTS, NAMES);
  assert.deepEqual(a, b);
  assert.ok(SPECIES[a.species]);
  assert.equal(SPECIES[a.species].rarity, a.rarity);
});

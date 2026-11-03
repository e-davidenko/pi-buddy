import assert from "node:assert/strict";
import { test } from "node:test";
import { NAMES, RARITY_WEIGHTS, SPECIES } from "../src/content/species.ts";
import { BASE, clamp, hatch, hash, isGrown, level, mergeWithDisk, onGeneration, onRunEnd, onToolCall, onToolOk, onToolError, onPackReturn, relax, rollRarity } from "../src/domain/rules.ts";
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


test("успех и ошибка инструментов дают опыт, но по-разному меняют радость", () => {
  const s = pet();
  onToolCall(s);
  onToolOk(s);
  assert.deepEqual([s.xp, s.toolCalls, s.errors, s.joy, s.energy], [101, 1, 0, 61.5, 89.6]);
  onToolCall(s);
  onToolError(s);
  assert.equal(s.xp, 102);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.errors, 1);
  assert.equal(s.joy, 51.5);
  assert.ok(Math.abs(s.energy - 89.2) < 1e-10);
  s.joy = 5;
  onToolError(s);
  assert.equal(s.joy, 0);
  s.joy = 99;
  onToolOk(s);
  assert.equal(s.joy, 100);
});

test("завершение радует только без ошибок; ошибка сбрасывает серию без нового штрафа", () => {
  const s = pet({ cleanRuns: 3 });
  onRunEnd(s, false);
  assert.equal(s.joy, 64);
  assert.equal(s.cleanRuns, 4);
  onRunEnd(s, true);
  assert.equal(s.joy, 64);
  assert.equal(s.cleanRuns, 0);
});

test("стая приносит весь опыт при любом исходе и меняет радость один раз", () => {
  for (const ok of [true, false]) {
    const s = pet();
    onPackReturn(s, 3, 7, ok);
    assert.equal(s.xp, 113);
    assert.equal(s.generations, 3);
    assert.equal(s.toolCalls, 7);
    assert.equal(s.joy, ok ? 64 : 50);
  }
});

test("токены дают XP за полные тысячи, бонус еды ограничен восемью", () => {
  for (const out of [0, 999, 1000, 1001, 4000, 10000]) {
    const s = pet({ food: 20 });
    onGeneration(s, out);
    assert.equal(s.xp, 102 + Math.floor(out / 1000));
    assert.equal(s.food, 25 + Math.min(8, out / 400));
    assert.equal(s.energy, 88.5);
  }
});

test("восстановление экспоненциальное и не зависит от частоты тиков", () => {
  const s = pet({ food: 0, joy: 100, energy: 0 });
  const once = { ...s };
  relax(s, T0 + 3_600_000);
  assert.ok(Math.abs(s.food - (60 - 60 * Math.exp(-1 / 3))) < 1e-10);
  assert.ok(Math.abs(s.joy - (60 + 40 * Math.exp(-1 / 2))) < 1e-10);
  assert.ok(Math.abs(s.energy - (100 - 100 * Math.exp(-1))) < 1e-10);
  assert.equal(s.lastTick, T0 + 3_600_000);
  const before = { ...s };
  relax(s, T0);
  assert.deepEqual(s, before);
  relax(s, s.lastTick);
  assert.deepEqual(s, before);
  relax(s, T0 + 2 * 3_600_000);
  relax(once, T0 + 2 * 3_600_000);
  for (const key of ["food", "joy", "energy"] as const) assert.ok(Math.abs(s[key] - once[key]) < 1e-10);
});

test("взрослый облик доступен с пятого уровня включительно", () => {
  const sp = SPECIES.gsd;
  assert.ok(sp.grown);
  assert.equal(isGrown(sp, 159), false);
  assert.equal(isGrown(sp, 160), true);
  assert.equal(isGrown({ ...sp, grown: undefined }, 10000), false);
});

test("границы весов редкости не перекрываются", () => {
  const weights: Parameters<typeof rollRarity>[1] = [["common", 50], ["rare", 30], ["legendary", 20]];
  for (const [r, expected] of [[0,"common"], [49,"common"], [50,"rare"], [79,"rare"], [80,"legendary"], [99,"legendary"], [100,"common"]] as const)
    assert.equal(rollRarity(r, weights), expected);
});

test("shiny существует и детерминирован seed", () => {
  const seed = Array.from({ length: 10000 }, (_, i) => `shiny-${i}`).find(x => (hash(x) >>> 24) % 100 === 0)!;
  assert.ok(seed);
  assert.equal(hatch(seed, T0, SPECIES, RARITY_WEIGHTS, NAMES).shiny, true);
});

test("слияние берёт свежую активность и применяет завершения к общей серии по порядку", () => {
  const base = pet({ cleanRuns: 5 });
  const disk = pet({ cleanRuns: 8, lastActivity: T0 + 100 });
  const mine = pet({ cleanRuns: 6, lastActivity: T0 + 50 });
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0, [false, false]).cleanRuns, 10);
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0, [false, true, false]).cleanRuns, 1);
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0, []).cleanRuns, 8);
  assert.equal(mergeWithDisk(mine, base, disk, new Set(), T0, []).lastActivity, T0 + 100);
});

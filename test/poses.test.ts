import assert from "node:assert/strict";
import { test } from "node:test";
import { moodOf, restingState } from "../src/domain/mood.ts";
import { ACT_MIN_MS, PoseMachine, THINK_FIRST, THINK_STEP } from "../src/domain/poses.ts";
import type { Mood, PxState } from "../src/domain/types.ts";
import { fakeClock } from "./helpers.ts";

function machine(o: { working?: boolean; quiet?: boolean; herding?: boolean; noAnim?: PxState[] } = {}) {
  const c = fakeClock();
  const env = {
    working: o.working ?? true,
    quiet: o.quiet ?? false,
    herding: o.herding ?? false,
    animN: 0,
  };
  const pm = new PoseMachine({
    now: c.now,
    rng: c.rng,
    hasAnim: (st) => !(o.noAnim ?? []).includes(st),
    quiet: () => env.quiet,
    working: () => env.working,
    scene: () => null,
    resting: (m) => restingState(m, c.now(), c.now()),
    herding: () => env.herding,
    animN: () => env.animN,
  });
  return { pm, c, env };
}
const W: Mood = "work";

test("быстрые инструменты видны по очереди, каждый не меньше 5 с", () => {
  const { pm, c } = machine();
  pm.setAct("sniff");
  pm.setAct("dig");
  pm.setAct("alert");
  assert.equal(pm.state(W), "sniff");
  c.advance(4999);
  assert.equal(pm.state(W), "sniff");
  c.advance(1);
  assert.equal(pm.state(W), "dig");
  c.advance(ACT_MIN_MS - 1);
  assert.equal(pm.state(W), "dig");
  c.advance(1);
  assert.equal(pm.state(W), "alert");
});

test("«думает» в очереди не копится — его вытесняет следующее дело", () => {
  const { pm, c } = machine();
  pm.setAct("sniff");
  pm.setAct("think");
  pm.setAct("dig");
  c.advance(ACT_MIN_MS);
  assert.equal(pm.state(W), "dig");
});

test("долгое «думает»: сначала голова набок, потом разные занятия без повторов подряд", () => {
  for (let run = 0; run < 50; run++) {
    const { pm, c } = machine();
    pm.setAct("think", true);
    for (let i = 0; i < run; i++) c.rng();
    assert.equal(pm.state(W), "think");
    c.advance(THINK_FIRST - 1);
    assert.equal(pm.state(W), "think");
    let prev = "think";
    for (let k = 0; k < 40; k++) {
      c.advance(k === 0 ? 1 : THINK_STEP);
      const st = pm.state(W);
      assert.notEqual(st, prev, `повтор на шаге ${k}`);
      prev = st;
    }
    assert.ok(pm.thinkingLong());
  }
});

test("долгое «думает»: после 45 с питомец чаще ложится подождать", () => {
  const seen = new Set<string>();
  for (let run = 0; run < 20; run++) {
    const { pm, c } = machine();
    for (let i = 0; i < run; i++) c.rng();
    pm.setAct("think", true);
    pm.state(W);
    c.advance(60_000);
    for (let k = 0; k < 10; k++, c.advance(THINK_STEP)) seen.add(pm.state(W));
  }
  assert.ok(seen.has("rest"));
  assert.ok(!seen.has("sniff")); // бродит только поначалу
});

test("в тихом режиме занятия не меняются", () => {
  const { pm, c } = machine({ quiet: true });
  pm.setAct("think", true);
  pm.state(W);
  c.advance(120_000);
  assert.equal(pm.state(W), "think");
});

test("без кадров позы — обычная ходьба", () => {
  const { pm } = machine({ noAnim: ["think", "dig"] });
  pm.setAct("dig", true);
  assert.equal(pm.state(W), "work");
});

test("голос важнее всего, пока не истёк", () => {
  const { pm, c } = machine();
  pm.setAct("dig", true);
  pm.barkUntil = c.now() + 1000;
  assert.equal(pm.state(W), "bark");
  c.advance(1000);
  assert.equal(pm.state(W), "dig");
});

test("стая в деле, агент свободен — сидит и ждёт, но не во сне", () => {
  const { pm } = machine({ working: false, herding: true });
  assert.equal(pm.state("idle"), "sit");
  assert.equal(pm.state("sleep"), "sleep");
});

test("переход стоя → лёжа идёт через обе базовые позы", () => {
  const { pm, env } = machine({ working: false });
  pm.tick("idle");
  env.animN = 1;
  pm.tick("sad"); // грустит лёжа
  assert.equal(pm.frame("sad"), "S");
  env.animN = 2;
  pm.tick("sad");
  assert.equal(pm.frame("sad"), "L");
  env.animN = 3;
  pm.tick("sad");
  assert.equal(pm.frame("sad"), "SAD");
});

test("настроение: засыпает от простоя, но не пока стая в деле; без сил — всегда", () => {
  const base = { now: 11 * 60_000, tempMood: null, tempUntil: 0, working: false, energy: 80, joy: 60, food: 60, lastActivity: 0, idleSleepMs: 10 * 60_000 };
  assert.equal(moodOf({ ...base, herding: () => false }), "sleep");
  assert.equal(moodOf({ ...base, herding: () => true }), "idle");
  assert.equal(moodOf({ ...base, energy: 5, herding: () => true }), "sleep");
  assert.equal(moodOf({ ...base, lastActivity: base.now, joy: 20, herding: () => false }), "sad");
  assert.equal(moodOf({ ...base, lastActivity: base.now, joy: 90, food: 90, herding: () => false }), "happy");
  assert.equal(moodOf({ ...base, working: true, herding: () => false }), "work");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { SAY } from "../src/content/phrases.ts";
import { CHAT_COOLDOWN, Speech } from "../src/domain/speech.ts";
import { activityOf, classify } from "../src/domain/tools.ts";
import { cleanPhrases, phraseProblem } from "../src/domain/topics.ts";
import type { Pose, Topic } from "../src/domain/types.ts";
import { fakeClock } from "./helpers.ts";

function speech(o: { say?: Partial<Record<Topic, string[]>>; pose?: Pose | null; muted?: boolean } = {}) {
  const c = fakeClock();
  const said: string[] = [];
  const env = { pose: o.pose ?? null, muted: o.muted ?? false };
  const sp = new Speech({
    now: c.now,
    rng: c.rng,
    species: () => "veo_px",
    speciesSay: () => o.say,
    common: () => SAY,
    pose: () => env.pose,
    muted: () => env.muted,
    say: (t) => said.push(t),
  });
  return { sp, c, said, env };
}

test("реплики темы идут без повторов, пока не переберутся все", () => {
  const { sp } = speech();
  const n = sp.pool("done").length;
  const got = new Set(Array.from({ length: n }, () => sp.line("done")));
  assert.equal(got.size, n);
});

test("метка позы: фраза звучит только в своей позе; у ASCII метка снимается", () => {
  const say = { stbIdle: ["@lie:дремлет", "@stand:стоит", "просто"] };
  assert.deepEqual(speech({ say, pose: "lie" }).sp.pool("stbIdle"), ["дремлет", "просто"]);
  assert.deepEqual(speech({ say, pose: null }).sp.pool("stbIdle"), ["дремлет", "стоит", "просто"]);
});

test("дежурные и телесные темы — только свои фразы вида, технические — вместе с общими", () => {
  const say = { stbIdle: ["моя"], testOk: ["гав!"] };
  const { sp } = speech({ say });
  assert.deepEqual(sp.pool("stbIdle"), ["моя"]);
  assert.equal(sp.pool("testOk").length, 1 + SAY.testOk.length);
});

test("болтовня: кулдаун и mute", () => {
  const { sp, c, said, env } = speech();
  sp.chat("done");
  sp.chat("done");
  assert.equal(said.length, 1);
  c.advance(CHAT_COOLDOWN);
  sp.chat("done");
  assert.equal(said.length, 2);
  env.muted = true;
  c.advance(CHAT_COOLDOWN);
  sp.chat("done");
  sp.shout("pet");
  assert.equal(said.length, 2);
  sp.shout("pet", 4000, true); // ответ на команду — даже в mute
  assert.equal(said.length, 3);
});

test("дежурная подпись держится, пока не сменится поза или время", () => {
  const { sp, c, env } = speech({ say: { stbIdle: ["a", "b", "c", "d"] }, pose: "stand" });
  const first = sp.standby("stbIdle", 60_000);
  c.advance(59_000);
  assert.equal(sp.standby("stbIdle", 60_000), first);
  env.pose = "lie";
  sp.standby("stbIdle", 60_000); // новая поза — новая подпись (ключ сменился)
  env.pose = "stand";
  c.advance(61_000);
  assert.ok(["a", "b", "c", "d"].includes(sp.standby("stbIdle", 60_000)));
});

test("инструменты → поза и тема", () => {
  assert.equal(activityOf("read", {}), "sniff");
  assert.equal(activityOf("edit", {}), "dig");
  assert.equal(activityOf("bash", { command: "./mvnw -q test" }), "sit");
  assert.equal(activityOf("bash", { command: "ls" }), "alert");
  assert.deepEqual(classify("bash", { command: "npm test" }, true), { t: "testOk", p: 0.8 });
  assert.deepEqual(classify("bash", { command: "git push" }, true), { t: "gitPush", p: 0.8 });
  assert.deepEqual(classify("bash", { command: "rm -rf build" }, true), { t: "rm", p: 1 });
  assert.equal(classify("bash", { command: "rm -rf build" }, false), null);
  assert.deepEqual(classify("edit", { path: "flow.bpmn" }, true), { t: "bpmn", p: 0.6 });
});

test("фразы от модели: длина, поза, повторы", () => {
  assert.deepEqual(phraseProblem("error", "@stand:стоит"), { code: "pose", allowed: ["lie"], pose: "stand" });
  assert.deepEqual(phraseProblem("done", "x"), { code: "empty" });
  const out = cleanPhrases("done", ["«ура!»", "ура!", "готово", "@lie:лёг", "очень-очень-очень длинная фраза без конца"], ["готово"]);
  assert.deepEqual(out, ["ура!"]);
});

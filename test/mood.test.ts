import assert from "node:assert/strict";
import { test } from "node:test";
import { moodOf, restingState, REST_AFTER_MS } from "../src/domain/mood.ts";
import type { MoodInput } from "../src/domain/mood.ts";

const input = (overrides: Partial<MoodInput> = {}): MoodInput => ({
  now: 1000000, tempMood: null, tempUntil: 0, working: false, herding: () => false,
  energy: 50, joy: 60, food: 60, lastActivity: 1000000, idleSleepMs: 600000, ...overrides,
});

test("пороги настроения: ниже, ровно и выше", () => {
  for (const [energy, expected] of [[9, "sleep"], [10, "idle"], [11, "idle"]] as const)
    assert.equal(moodOf(input({ energy })), expected);
  for (const [joy, expected] of [[29, "sad"], [30, "idle"], [31, "idle"]] as const)
    assert.equal(moodOf(input({ joy })), expected);
  for (const [joy, food, expected] of [[80, 61, "idle"], [81, 60, "idle"], [81, 61, "happy"], [79, 61, "idle"], [81, 59, "idle"]] as const)
    assert.equal(moodOf(input({ joy, food })), expected);
});

test("приоритет: временная реакция, работа, сон, грусть, радость", () => {
  assert.equal(moodOf(input({ tempMood: "love", tempUntil: 1000001, working: true, energy: 0 })), "love");
  assert.equal(moodOf(input({ tempMood: "love", tempUntil: 1000000, working: true, energy: 0 })), "work");
  assert.equal(moodOf(input({ working: true, energy: 0, joy: 0 })), "work");
  assert.equal(moodOf(input({ energy: 0, joy: 0 })), "sleep");
});

test("ложится и засыпает ровно в срок, стая удерживает от сна кроме истощения", () => {
  for (const elapsed of [599999, 600000, 600001]) {
    assert.equal(moodOf(input({ lastActivity: 1000000 - elapsed })), elapsed < 600000 ? "idle" : "sleep");
    assert.equal(moodOf(input({ lastActivity: 1000000 - elapsed, herding: () => true })), "idle");
  }
  assert.equal(moodOf(input({ herding: () => true, energy: 9 })), "sleep");
  for (const elapsed of [REST_AFTER_MS - 1, REST_AFTER_MS, REST_AFTER_MS + 1])
    assert.equal(restingState("idle", 0, elapsed), elapsed < REST_AFTER_MS ? "idle" : "rest");
});

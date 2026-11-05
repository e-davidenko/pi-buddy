import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BuddyApp, type AppPorts } from "../src/app/buddy.ts";
import { completions, runCommand } from "../src/app/commands.ts";
import { resolveLocale, speciesFor, commonFor, phraseUnit } from "../src/app/localization.ts";
import { phraseFile, phraseSet } from "../src/app/phraseFile.ts";
import { savePhrases, ensurePhraseTemplate, cleanPhraseFile } from "../src/app/phrases.ts";
import { learn, learnPrompt } from "../src/app/learn.ts";
import { age } from "../src/app/catalog.ts";
import { FilePetStore, FilePhraseStore } from "../src/adapters/storage/files.ts";
import { TuiView } from "../src/adapters/tui/view.ts";
import { wrapWords, textWidth, truncateText } from "../src/adapters/tui/text.ts";
import { ru, en } from "../src/content/locales/ui.ts";
import * as english from "../src/content/locales/en.ts";
import { SPECIES, SPECIES_KEYS } from "../src/content/species.ts";
import { IT } from "../src/content/items.ts";
import { TOPICS } from "../src/content/topicHints.ts";
import { TOPIC_POSES, phraseProblem } from "../src/domain/topics.ts";
import type { BuddyState, Locale } from "../src/domain/types.ts";
import { registerPhraseTool } from "../src/adapters/pi/phraseTool.ts";
import { fakeClock } from "./helpers.ts";

function fixture(environment = "en_US.UTF-8", initial: BuddyState | null = null) {
  let disk = initial && { ...initial };
  let phrases: unknown = {};
  const ports: AppPorts = {
    clock: fakeClock(),
    env: { locale: environment, user: () => "test", host: () => "host", argv: [], idleSleepMs: 600_000, autoPxMode: () => "bg" },
    scheduler: { startTimer() {}, later() {} }, runs: { read: () => null },
    phrases: { path: "phrases.json", read: () => structuredClone(phrases), exists: () => true,
      write: (file) => { phrases = structuredClone(file); } },
    store: { read: () => disk && { ...disk }, write: (state) => { disk = { ...state }; },
      update(change) { const next = change(this.read()); this.write(next); return next; } },
  };
  const app = new BuddyApp(ports);
  const notices: string[] = [];
  const ui = { notify: (s: string) => notices.push(s) };
  return { app, ports, notices, disk: () => disk!, phrases: () => phrases,
    setPhrases: (raw: unknown) => { phrases = raw; app.speech.setCustom(raw); },
    command: (args: string) => runCommand(app, args, ui, { model: undefined, complete: async () => "" }) };
}

test("locale resolution and old/new installs preserve their intended language", async () => {
  for (const environment of ["ru_RU.UTF-8", "ru-RU", "RU", "ru_RU@variant"]) assert.equal(resolveLocale("auto", environment), "ru");
  for (const environment of ["en-US", "de_DE", "C", "POSIX", "", "russian"]) assert.equal(resolveLocale("auto", environment), "en");
  assert.equal(resolveLocale(undefined, "en_US"), "ru");
  assert.equal(resolveLocale("ru", "en_US"), "ru");
  assert.equal(resolveLocale("en", "ru_RU"), "en");
  const f = fixture();
  assert.equal(f.app.s.language, "auto");
  assert.equal(f.app.locale(), "en");
  const legacy = { ...f.app.s };
  delete legacy.language;
  const old = fixture("en_US", legacy);
  assert.equal(old.app.s.language, "ru");
  assert.equal(old.app.locale(), "ru");
  await f.command("lang");
  assert.match(f.notices.at(-1)!, /Language: auto/);
  await f.command("lang unsupported");
  assert.equal(f.disk().language, "auto");
  assert.match(f.notices.at(-1)!, /Unknown language/);
});

test("language persists, synchronizes across sessions and survives hatch without resetting progress", async () => {
  const f = fixture();
  f.app.s.name = "Кэш";
  f.app.s.xp = 1234;
  f.app.sync();
  const before = { ...f.disk() };
  const other = new BuddyApp({ ...f.ports, env: { ...f.ports.env, locale: "ru_RU" } });
  other.say("old text");
  other.standby();
  await f.command("lang en");
  other.sync(false);
  assert.equal(other.locale(), "en");
  await f.command("lang ru");
  other.sync(false);
  assert.equal(other.locale(), "ru");
  assert.equal(other.bubble, "");
  assert.equal(f.disk().name, before.name);
  assert.equal(f.disk().xp, before.xp);
  assert.equal(f.disk().species, before.species);
  assert.equal(f.disk().born, before.born);
  const restarted = new BuddyApp(f.ports);
  assert.equal(restarted.locale(), "ru");
  await f.command("hatch confirm");
  assert.equal(f.disk().language, "ru");
  assert.equal(f.disk().xp, 0);
  assert.ok(f.disk().born > before.born);
});

test("both catalogs have matching UI parameters, complete topics, species and items", () => {
  const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const key of Object.keys(ru) as (keyof typeof ru)[]) assert.deepEqual(params(ru[key]), params(en[key]), key);
  assert.deepEqual(Object.keys(english.species).sort(), [...SPECIES_KEYS].sort());
  assert.deepEqual(Object.keys(english.items).sort(), Object.keys(IT).sort());
  assert.deepEqual(Object.keys(english.topics).sort(), [...TOPICS].sort());
  for (const locale of ["ru", "en"] as const) {
    assert.deepEqual(Object.keys(commonFor(locale)).sort(), [...TOPICS].sort());
    for (const key of SPECIES_KEYS) {
      const sp = speciesFor(key, locale);
      assert.ok(sp.label);
      if (SPECIES[key].grown) assert.ok(sp.grownLabel);
      for (const [topic, pool] of Object.entries({ ...commonFor(locale), ...sp.say })) {
        assert.ok(pool.length, `${locale}/${key}/${topic}`);
        for (const text of pool) {
          assert.equal(phraseProblem(topic as keyof typeof TOPIC_POSES, text), null, `${locale}/${key}/${topic}: ${text}`);
          if (locale === "en") assert.doesNotMatch(text, /[а-яё]/i);
        }
      }
      for (const item of sp.items ?? []) {
        assert.ok(item.id);
        assert.ok(item.say.length);
        if (locale === "en") assert.doesNotMatch([item.name, ...item.say].join(" "), /[а-яё]/i);
      }
    }
  }
  assert.equal(phraseUnit("ru", 1), "фразу");
  assert.equal(phraseUnit("ru", 2), "фразы");
  assert.equal(phraseUnit("ru", 5), "фраз");
  assert.equal(phraseUnit("en", 1), "phrase");
  assert.equal(phraseUnit("en", 2), "phrases");
  assert.equal(age(0, 2 * 86_400_000, "ru"), "2 дня");
  assert.equal(age(0, 21 * 86_400_000, "ru"), "21 день");
});

test("custom sets isolate languages, preserve legacy data and clean all locales", async () => {
  const f = fixture();
  f.setPhrases({ done: ["свой русский текст"], cat: { hello: ["привет кот"] } });
  assert.ok(!f.app.speech.pool("done").includes("свой русский текст"));
  assert.equal(savePhrases(f.app, { done: ["my own phrase"] }, "en", "cat"), 1);
  const file = phraseFile(f.phrases());
  assert.deepEqual(file.locales.ru?.common.done, ["свой русский текст"]);
  assert.deepEqual(file.locales.ru?.species.cat.hello, ["привет кот"]);
  assert.deepEqual(file.locales.en?.species.cat.done, ["my own phrase"]);
  f.app.s.species = "cat";
  assert.ok(f.app.speech.pool("done").includes("my own phrase"));
  await f.command("lang ru");
  assert.ok(f.app.speech.pool("done").includes("свой русский текст"));
  assert.ok(!f.app.speech.pool("done").includes("my own phrase"));
  savePhrases(f.app, { done: ["ещё своя фраза"] }, "ru", "cat");
  const invalid = phraseFile(f.phrases());
  invalid.locales.en!.common.error = ["@stand:wrong pose"];
  f.setPhrases(invalid);
  const removed = cleanPhraseFile(f.app)!;
  assert.match(removed[0], /en\/common\/error/);
  assert.deepEqual(phraseFile(f.phrases()).locales.en!.common.error, []);
  assert.equal(savePhrases(f.app, { done: ["@stand:ещё своя фраза"] }, "ru", "cat"), 0);
});

test("unknown versions and malformed files are never replaced by templates or learned phrases", () => {
  for (const raw of [{ version: 9, locales: {} }, [], { done: "bad" }, { version: 2, locales: { en: { common: null, species: {} } } }]) {
    const f = fixture();
    f.setPhrases(raw);
    assert.throws(() => ensurePhraseTemplate(f.app));
    assert.throws(() => savePhrases(f.app, { done: ["a new phrase"] }));
    assert.deepEqual(f.phrases(), raw);
  }
  assert.throws(() => phraseFile({ version: 2, locales: { en: { common: { done: [1] }, species: {} } } }));
});

test("learning pins original locale and species while requests are in flight", async () => {
  const f = fixture();
  f.app.s.species = "cat";
  assert.match(learnPrompt(f.app, "done").prompt, /English \(en\)/);
  const promise = learn(f.app, {
    model: { id: "fake" }, complete: async (prompt) => {
      assert.match(prompt, /English \(en\)/);
      assert.doesNotMatch(prompt, /[а-яё]/i);
      await f.command("lang ru");
      await f.command("choose duck");
      return JSON.stringify({ done: ["a purrfect little patch"], error: ["not requested"] });
    },
  }, (text) => f.notices.push(text), "done");
  await promise;
  const file = phraseFile(f.phrases());
  assert.deepEqual(file.locales.en!.species.cat.done, ["a purrfect little patch"]);
  assert.equal(file.locales.en!.species.cat.error, undefined);
  assert.deepEqual(file.locales.ru, { common: {}, species: {} });
  assert.equal(f.app.s.species, "duck");
  assert.equal(f.app.locale(), "ru");
  assert.match(f.notices.at(-1)!, /en; вид: cat/);
  assert.ok(!f.app.speech.pool("done").includes("a purrfect little patch"));
});

test("file migration backs up legacy JSON; locks and failed edits preserve every locale", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-locale-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "phrases.json");
  const store = new FilePhraseStore(file);
  const legacy = '{"done":["старый текст"]}';
  fs.writeFileSync(file, legacy);
  assert.deepEqual(phraseSet(store.read(), "ru").done, ["старый текст"]);
  assert.equal(fs.existsSync(`${file}.bak`), false);
  store.update((raw) => {
    const next = phraseFile(raw);
    next.locales.en = { common: { done: ["new phrase"] }, species: {} };
    return next;
  });
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), legacy);
  store.update((raw) => {
    assert.throws(() => store.update(() => ({})));
    return phraseFile(raw);
  });
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => store.update(() => { throw new Error("failed edit"); }));
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(`${file}.lock`), false);
  const pet = new FilePetStore(path.join(dir, "buddy.json"));
  const f = fixture();
  const saved = { ...f.app.s };
  delete saved.language;
  fs.writeFileSync(pet.file, JSON.stringify(saved));
  assert.equal(pet.read()!.language, "ru");
  fs.writeFileSync(pet.file, JSON.stringify({ ...saved, language: "unsupported" }));
  assert.equal(pet.read()!.language, "auto");
  assert.equal(pet.read()!.name, saved.name);
});

test("Unicode wraps by terminal cells without splitting graphemes or dropping long-word suffixes", () => {
  assert.deepEqual(wrapWords("hello world again", 11, 3), ["hello world", "again"]);
  assert.deepEqual(wrapWords("abcdefghijkl", 4, 3), ["abcd", "efgh", "ijkl"]);
  assert.deepEqual(wrapWords("привет мир", 6, 2), ["привет", "мир"]);
  assert.equal(textWidth("e\u0301"), 1);
  assert.equal(textWidth("🐕"), 2);
  assert.equal(textWidth("中文"), 4);
  assert.equal(truncateText("e\u0301e\u0301e\u0301", 2), "e\u0301…");
  assert.equal(truncateText("🐕🐕🐕", 4), "🐕…");
  for (const line of wrapWords("中文中文 e\u0301e\u0301e\u0301 🐕🐕", 4, 10)) assert.ok(textWidth(line) <= 4, line);
  assert.deepEqual(wrapWords("a b", 0, 2), []);
  assert.equal(phraseProblem("done", "e\u0301".repeat(34)), null);
  assert.deepEqual(phraseProblem("done", "e\u0301".repeat(35)), { code: "long" });
});

test("English UI, toys, tool execution and every TUI mode use the active locale", async () => {
  const f = fixture();
  f.app.s.species = "veo_px";
  Object.assign(f.app.display, { sideReady: true, dockReady: true, termW: 120 });
  f.app.s.name = "Pixel";
  await f.command("stats");
  assert.match(f.notices.at(-1)!, /food/);
  assert.doesNotMatch(f.notices.at(-1)!, /[а-яё]/i);
  for (const arg of ["bone", "косточка"]) {
    f.app.s.energy = 100;
    await f.command(`play ${arg}`);
    assert.equal(f.app.scene!.item.id, "bone");
    assert.doesNotMatch(f.app.scene!.text, /[а-яё]/i);
  }
  assert.match(completions("choose cat", "en")[0].description!, /Cat/);
  assert.deepEqual(completions("lang e").map((x) => x.value), ["lang en"]);
  let definition: any;
  await registerPhraseTool({ registerTool: (tool: any) => { definition = tool; } }, f.app, { ready: false });
  assert.ok(definition);
  assert.doesNotMatch(definition.description, /must be Russian/);
  const result = await definition.execute("id", { topic: "done", phrases: ["a wonderful new patch"] });
  assert.equal(result.details.locale, "en");
  await f.command("lang ru");
  const explicit = await definition.execute("id", { topic: "done", phrases: ["a lovely new patch"], locale: "en" });
  assert.equal(explicit.details.locale, "en");
  assert.ok(!f.app.speech.pool("done").includes("a lovely new patch"));
  const view = new TuiView(f.app, () => true);
  // Exercise actual rendering branches without requiring a live pi terminal.
  for (const locale of ["ru", "en"] as Locale[]) {
    await f.command(`lang ${locale}`);
    const internal = view as any;
    for (const size of ["dock", "big", "compact"] as const) {
      f.app.s.size = size;
      const rendered: string[] = size === "dock" ? internal.sideColumn() : internal.sideRender((w: number) => ["-".repeat(w), "input"], 120);
      assert.ok(rendered.length);
      for (const line of rendered) assert.ok(textWidth(line) <= (size === "dock" ? 31 : 120), `${size}: ${line}`);
      if (locale === "en") assert.doesNotMatch(rendered.join(" "), /[а-яё]/i);
    }
    let widget: string[] = [];
    f.app.ui = { notify() {}, setWidget: (_id: string, lines: string[]) => { widget = lines; } } as any;
    f.app.s.placement = "top";
    f.app.display.termW = 45;
    view.render();
    assert.ok(widget.length);
    for (const line of widget) assert.ok(textWidth(line) <= 45);
    if (locale === "en") assert.doesNotMatch(widget.join(" "), /[а-яё]/i);
    f.app.s.placement = "side";
    f.app.display.termW = 120;
  }
});

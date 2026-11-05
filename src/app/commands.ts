/** /buddy [команда] — уход за питомцем, выбор вида, режимы показа, фразы, статистика */
import { errorText } from "./errors.ts";
import { commonFor, namesFor, rarityFor, speciesFor } from "./localization.ts";
import type { Locale } from "../domain/types.ts";
import { RARITY_WEIGHTS, SPECIES, SPECIES_KEYS } from "../content/species.ts";
import { CONFIG, clamp, hatch, level } from "../domain/rules.ts";
import type { Placement, Size } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";
import { age, labelFor } from "./catalog.ts";
import { type ModelPort, learn } from "./learn.ts";
import { cleanPhraseFile, ensurePhraseTemplate } from "./phrases.ts";
import type { Ui } from "./ports.ts";

export const COMMANDS = ["feed", "pet", "play", "nap", "choose", "side", "top", "mute", "unmute", "anim", "pxcolor", "bark", "learn", "phrases", "dock", "compact", "big", "name", "stats", "version", "hatch", "lang"];

/** Подсказки при наборе /buddy … */
export function completions(prefix: string, locale: Locale = "ru"): { value: string; label: string; description?: string }[] {
  const parts = prefix.trimStart().toLowerCase().split(/\s+/);
  if (parts[0] === "lang" && parts.length > 1)
    return ["ru", "en", "auto"].filter((v) => v.startsWith(parts[1])).map((v) => ({ value: `lang ${v}`, label: v }));
  if (parts[0] === "choose" && parts.length > 1)
    return SPECIES_KEYS.filter((k) => k.startsWith(parts[1])).map((k) => ({
      value: `choose ${k}`,
      label: k,
      description: `${speciesFor(k, locale).label} (${rarityFor(SPECIES[k].rarity, locale)})`,
    }));
  return COMMANDS.filter((c) => c.startsWith(parts[0] ?? "")).map((c) => ({ value: c, label: c }));
}

export async function runCommand(app: BuddyApp, args: string, ui: Ui, model: ModelPort) {
  const commandParts = (args ?? "").trim().split(/\s+/);
  if (commandParts[0].toLowerCase() === "hatch") {
    const explicit = commandParts.length === 2 && commandParts[1].toLowerCase() === "confirm";
    const ok = explicit || (ui.confirm ? await ui.confirm(app.t("hatchTitle"), app.t("hatchConfirm", { name: app.s.name })) : false);
    if (!ok) {
      if (!ui.confirm) ui.notify(app.t("hatchFallback"), "warning");
      return;
    }
  }
  app.ports.scheduler.startTimer();
  app.sync(false); // сначала подтянуть прогресс из других терминалов
  app.activity();
  const cfgBefore = Object.fromEntries(CONFIG.map((k) => [k, (app.s as any)[k]]));
  const [rawCmd, ...rest] = (args ?? "").trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const sp = app.speech;
  const s = () => app.s; // hatch заменяет объект состояния

  switch ((cmd ?? "").toLowerCase()) {
    case "":
      s().visible = !s().visible;
      break;
    case "feed":
      if (s().food > 95) sp.shout("full", 4000, true);
      else {
        s().food = clamp(s().food + 30);
        s().energy = clamp(s().energy + 5);
        app.react("eat");
        sp.shout("feed", 4000, true);
      }
      break;
    case "pet":
      s().joy = clamp(s().joy + 15);
      app.react("love");
      sp.shout("pet", 4000, true);
      break;
    case "play":
      if (s().energy < 15) sp.shout("tired", 4000, true);
      else {
        const want = rest.join(" ").toLowerCase();
        const its = app.spec().items ?? [];
        const it = its.find((x) => want && [x.id, x.name, ...(x.aliases ?? [])].some((v) => v?.toLowerCase().startsWith(want))) ?? its.find((x) => x.mode === "toss");
        if (it && app.startScene(it, 10_000)) app.say(app.scene!.text, 4000);
        s().joy = clamp(s().joy + 25);
        s().energy = clamp(s().energy - 15);
        s().food = clamp(s().food - 5);
        app.react("happy");
        sp.shout("play", 4000, true);
      }
      break;
    case "nap":
      s().energy = clamp(s().energy + 40);
      app.react("sleep", 8000);
      sp.shout("nap", 4000, true);
      break;
    case "choose": {
      let key = rest[0]?.toLowerCase();
      if (!key) {
        // Список виден даже в клиентах, где select отсутствует, не рисуется или возвращает undefined.
        ui.notify(
          app.t("chooseIntro") + "\n" +
          SPECIES_KEYS.map((k) => `/buddy choose ${k} — ${speciesFor(k, app.locale()).label}`).join("\n") +
          "\n" + app.t("chooseOutro"),
          "info",
        );
        if (!ui.select) break;
        const opts = SPECIES_KEYS.map((k) => `${k} — ${speciesFor(k, app.locale()).label} (${rarityFor(SPECIES[k].rarity, app.locale())})${k === s().species ? `  <- ${app.t("current")}` : ""}`);
        let picked: string | undefined;
        try {
          picked = await ui.select(app.t("chooseTitle"), opts);
        } catch (e) {
          ui.notify(app.t("chooseError", { error: errorText(e, app.locale()) }), "warning");
          break;
        }
        if (picked === undefined) break;
        key = SPECIES_KEYS[opts.indexOf(picked)];
      }
      if (!SPECIES_KEYS.includes(key)) {
        ui.notify(app.t("unknownSpecies", { keys: SPECIES_KEYS.join(", ") }), "warning");
        break;
      }
      // меняем облик, прогресс (имя, xp, статы) сохраняется
      s().species = key;
      s().rarity = SPECIES[key].rarity;
      app.react("happy", 5000);
      sp.shout("hello", 5000, true);
      break;
    }
    case "version":
      ui.notify(`pi-buddy ${app.ports.env.version ?? app.t("unknownVersion")}`, "info");
      break;
    case "mute":
      s().muted = true;
      app.say(app.t("muted"), 3000);
      break;
    case "unmute":
      s().muted = false;
      sp.shout("hello", 4000, true);
      break;
    case "bark":
    case "гав":
    case "голос":
      if (!app.bark(3000)) app.say(commonFor(app.locale()).hello[Math.floor(app.ports.clock.rng() * commonFor(app.locale()).hello.length)], 3000);
      app.react("happy", 3000);
      break;
    case "learn":
      await learn(app, model, (m, l) => ui.notify(m, l), rest.join(" "));
      break;
    case "phrases": {
      try {
        if ((rest[0] ?? "").toLowerCase() === "clean") {
          const removed = cleanPhraseFile(app);
          if (removed === null) {
            ui.notify(app.t("noPhrases"), "info");
            break;
          }
          ui.notify(removed.length ? app.t("cleaned", { count: removed.length, list: removed.join("\n") }) : app.t("cleanOk"), "info");
          break;
        }
        ensurePhraseTemplate(app);
        ui.notify(app.t("phrasesPath", { path: app.ports.phrases.path }), "info");
      } catch (e) {
        ui.notify(app.t("failed", { error: errorText(e, app.locale()) }), "error");
      }
      break;
    }
    case "pxcolor": {
      const v = (rest[0] ?? "").toLowerCase();
      if (v === "fg" || v === "bg" || v === "auto") s().pxColor = v;
      ui.notify(
        app.t("pxColor", { value: s().pxColor ?? "auto", mode: app.pxMode() }),
        "info",
      );
      break;
    }
    case "anim": {
      const v = (rest[0] ?? "").toLowerCase();
      if (v === "on" || v === "off" || v === "auto") s().anim = v;
      ui.notify(
        app.t("anim", { value: s().anim ?? "auto" }),
        "info",
      );
      break;
    }
    case "dock":
    case "big":
    case "compact":
      s().size = cmd as Size;
      if (app.display.sideReady) s().placement = "side";
      break;
    case "side":
    case "top":
      if (cmd === "side" && !app.display.sideReady) {
        ui.notify(app.t("sideError"), "warning");
        break;
      }
      s().placement = cmd as Placement;
      break;
    case "name":
      if (rest.length) {
        s().name = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rest.join(" ")), (x) => x.segment).slice(0, 20).join("");
        app.say(app.t("renamed", { name: s().name }));
      }
      break;
    case "stats": {
      const st = s();
      ui.notify(
        app.t("stats", {
          name: st.name, species: labelFor(st, app.locale()), rarity: rarityFor(st.rarity, app.locale()),
          shiny: st.shiny ? app.t("shiny") : "", level: level(st.xp),
          xp: new Intl.NumberFormat(app.locale()).format(st.xp), age: age(st.born, app.now(), app.locale()),
          generations: st.generations ?? 0, tokens: st.tokensOut ?? 0, tools: st.toolCalls, errors: st.errors,
          food: Math.round(st.food), joy: Math.round(st.joy), energy: Math.round(st.energy),
        }),
        "info",
      );
      break;
    }
    case "hatch": {
      const previous = s();
      app.s = hatch(`${app.ports.env.user()}-${app.now()}-${app.ports.clock.rng()}`, app.now(), SPECIES, RARITY_WEIGHTS, namesFor(app.locale()));
      for (const key of ["language", "placement", "size", "muted", "anim", "pxColor", "visible"] as const) {
        (app.s as any)[key] = previous[key];
      }
      app.s.born = Math.max(app.now(), previous.born + 1);
      app.resetRunHistory();
      app.replaced = true; // новый питомец заменяет общий целиком
      app.say(app.t("hatched", { species: labelFor(app.s, app.locale()) }), 6000);
      app.react("happy");
      break;
    }
    case "lang": {
      const value = rest[0]?.toLowerCase();
      if (value && !["ru", "en", "auto"].includes(value)) {
        ui.notify(app.t("unknownLanguage"), "warning");
        break;
      }
      if (value) {
        s().language = value as "ru" | "en" | "auto";
        app.refreshLanguage();
      }
      ui.notify(app.t("language", { setting: s().language ?? "ru", locale: app.locale() }), "info");
      break;
    }
    default:
      ui.notify(app.t("unknownCommand"), "warning");
  }
  s().visible = cmd === "" || cmd?.toLowerCase() === "hatch" ? s().visible : true;
  for (const k of CONFIG) if ((s() as any)[k] !== (cfgBefore as any)[k]) app.dirty.add(k);
  app.sync();
  app.render();
}

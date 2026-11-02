/** /buddy [команда] — уход за питомцем, выбор вида, режимы показа, фразы, статистика */
import { SAY } from "../content/phrases.ts";
import { NAMES, RARITY_WEIGHTS, SPECIES, SPECIES_KEYS } from "../content/species.ts";
import { CONFIG, clamp, hatch, level } from "../domain/rules.ts";
import type { Placement, Size } from "../domain/types.ts";
import type { BuddyApp } from "./buddy.ts";
import { age, labelFor, spec } from "./catalog.ts";
import { type ModelPort, learn } from "./learn.ts";
import { cleanPhraseFile, ensurePhraseTemplate } from "./phrases.ts";
import type { Ui } from "./ports.ts";

export const COMMANDS = ["feed", "pet", "play", "nap", "choose", "side", "top", "mute", "unmute", "anim", "pxcolor", "bark", "learn", "phrases", "dock", "compact", "big", "name", "stats", "hatch"];
export const COMMAND_HELP = "Тамагочи: /buddy [feed|pet|play|nap|choose|side|top|dock|compact|big|mute|unmute|anim|phrases|name <имя>|stats|hatch]";

/** Подсказки при наборе /buddy … */
export function completions(prefix: string) {
  const parts = prefix.split(/\s+/);
  if (parts[0] === "choose" && parts.length > 1)
    return SPECIES_KEYS.filter((k) => k.startsWith(parts[1])).map((k) => ({
      value: `choose ${k}`,
      label: k,
      description: `${SPECIES[k].label} (${SPECIES[k].rarity})`,
    }));
  return COMMANDS.filter((c) => c.startsWith(parts[0] ?? "")).map((c) => ({ value: c, label: c }));
}

export async function runCommand(app: BuddyApp, args: string, ui: Ui, model: ModelPort) {
  app.ports.scheduler.startTimer();
  app.sync(false); // сначала подтянуть прогресс из других терминалов
  app.activity();
  const cfgBefore = Object.fromEntries(CONFIG.map((k) => [k, (app.s as any)[k]]));
  const [cmd, ...rest] = (args ?? "").trim().split(/\s+/);
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
        const its = spec(s()).items ?? [];
        const it = its.find((x) => want && x.name.startsWith(want)) ?? its.find((x) => x.mode === "toss");
        if (it && app.startScene(it, 10_000)) app.say(app.scene!.text, 4000);
        s().joy = clamp(s().joy + 25);
        s().energy = clamp(s().energy - 15);
        s().food = clamp(s().food - 5);
        s().xp += 2;
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
        const opts = SPECIES_KEYS.map((k) => `${SPECIES[k].label} (${SPECIES[k].rarity})${k === s().species ? "  <- сейчас" : ""}`);
        const picked = await ui.select?.("Выбери питомца", opts);
        if (picked === undefined) break;
        key = SPECIES_KEYS[opts.indexOf(picked)];
      }
      if (!SPECIES[key]) {
        ui.notify(`Нет такого вида. Есть: ${SPECIES_KEYS.join(", ")}`, "warning");
        break;
      }
      // меняем облик, прогресс (имя, xp, статы) сохраняется
      s().species = key;
      s().rarity = SPECIES[key].rarity;
      app.react("happy", 5000);
      sp.shout("hello", 5000, true);
      break;
    }
    case "mute":
      s().muted = true;
      app.say("молчу, но всё вижу", 3000);
      break;
    case "unmute":
      s().muted = false;
      sp.shout("hello", 4000, true);
      break;
    case "bark":
    case "гав":
    case "голос":
      if (!app.bark(3000)) app.say(SAY.hello[Math.floor(app.ports.clock.rng() * SAY.hello.length)], 3000);
      app.react("happy", 3000);
      break;
    case "learn":
      await learn(app, model, (m, l) => ui.notify(m, l), rest.join(" "));
      break;
    case "phrases": {
      if ((rest[0] ?? "").toLowerCase() === "clean") {
        const removed = cleanPhraseFile(app);
        if (removed === null) {
          ui.notify("Своих фраз пока нет", "info");
          break;
        }
        ui.notify(removed.length ? `Убрал ${removed.length}:\n${removed.join("\n")}` : "Все свои фразы в порядке", "info");
        break;
      }
      ensurePhraseTemplate(app);
      ui.notify(`Свои фразы: ${app.ports.phrases.path}\nПосле правки — /reload`, "info");
      break;
    }
    case "pxcolor": {
      const v = (rest[0] ?? "").toLowerCase();
      if (v === "fg" || v === "bg" || v === "auto") s().pxColor = v;
      ui.notify(
        `Пиксельный пёс: ${s().pxColor ?? "auto"} (сейчас ${app.pxMode()}). bg — чётче, нужен 24-битный фон; ` +
          "fg — только цвет символов, для терминала IntelliJ. auto выбирает fg в IntelliJ.",
        "info",
      );
      break;
    }
    case "anim": {
      const v = (rest[0] ?? "").toLowerCase();
      if (v === "on" || v === "off" || v === "auto") s().anim = v;
      ui.notify(
        `Анимация: ${s().anim ?? "auto"}. auto — анимируется в полноэкранном режиме pi, ` +
          "а в обычном только пока агент работает (чтобы не мешать прокрутке терминала).",
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
        ui.notify("Сбоку не получилось: редактор pi недоступен для встраивания. Остаюсь сверху.", "warning");
        break;
      }
      s().placement = cmd as Placement;
      break;
    case "name":
      if (rest.length) {
        s().name = rest.join(" ").slice(0, 20);
        app.say(`теперь я ${s().name}!`);
      }
      break;
    case "stats": {
      const st = s();
      ui.notify(
        `${st.name} — ${labelFor(st)} (${st.rarity}${st.shiny ? ", shiny!" : ""}), lv.${level(st.xp)}, xp ${st.xp}\n` +
          `возраст: ${age(st.born, app.now())}, генераций: ${st.generations ?? 0}, токенов: ${st.tokensOut ?? 0}, ` +
          `tool calls: ${st.toolCalls}, ошибок пережито: ${st.errors}\n` +
          `еда ${Math.round(st.food)} · радость ${Math.round(st.joy)} · силы ${Math.round(st.energy)}`,
        "info",
      );
      break;
    }
    case "hatch": {
      const ok = ui.confirm ? await ui.confirm("Новое яйцо", `${s().name} уйдёт навсегда. Точно?`) : true;
      if (ok) {
        app.s = hatch(`${app.ports.env.user()}-${app.now()}-${app.ports.clock.rng()}`, app.now(), SPECIES, RARITY_WEIGHTS, NAMES);
        app.replaced = true; // новый питомец заменяет общий целиком
        app.say(`вылупился! я ${labelFor(app.s)}`, 6000);
        app.react("happy");
      }
      break;
    }
    default:
      ui.notify("Не понял. /buddy feed | pet | play | nap | choose [вид] | side | top | dock | compact | big | mute | unmute | anim on/off/auto | phrases | name <имя> | stats | hatch", "warning");
  }
  s().visible = cmd === "" ? s().visible : true;
  for (const k of CONFIG) if ((s() as any)[k] !== (cfgBefore as any)[k]) app.dirty.add(k);
  app.sync();
  app.render();
}

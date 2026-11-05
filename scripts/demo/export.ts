/** Export the real sprites and animation tables for the README demo. No pi session or pet state is touched. */
import { writeFileSync } from "node:fs";
import { speciesFor } from "../../src/app/localization.ts";
import { SPECIES } from "../../src/content/species.ts";
import { PX_PAL } from "../../src/content/palette.ts";
import { PX_ANIM } from "../../src/domain/animation.ts";
import type { PxState } from "../../src/domain/types.ts";
import { miniSprite } from "../../src/adapters/tui/pixels.ts";
import { withItem } from "../../src/adapters/tui/view.ts";

const locale = process.argv[3] ?? "ru";
if (locale !== "ru" && locale !== "en") throw new Error("Expected locale ru or en");

const scenes = [
  { title: "Рядом, пока ты кодишь", subtitle: "Читает код, ищет след и помогает копать баги", tab: 0, ticks: 8, pet: "veo_px" },
  { title: "Субагенты собираются в стаю", subtitle: "У каждого помощника — своё занятие и результат", tab: 1, ticks: 10, pet: "veo_px" },
  { title: "Переживает ошибки. Радуется победам.", subtitle: "Ждёт тесты, грустит на красных и подаёт голос на зелёных", tab: 2, ticks: 10, pet: "duck" },
  { title: "У питомца есть свой голос", subtitle: "Реплики зависят от вида питомца и того, чем занят агент", tab: 3, ticks: 8, pet: "duck" },
  { title: "Пора сделать маленькую паузу", subtitle: "У ВЕО — мячик и косточка", tab: 4, ticks: 8, pet: "veo_px" },
  { title: "У каждого — любимые игрушки", subtitle: "У уточки — пищалка и хлебушек", tab: 4, ticks: 8, pet: "duck" },
  { title: "Выбери своего напарника", subtitle: "ВЕО, уточка, кот, сова, дракон и другие", tab: 5, ticks: 8, pet: "duck" },
];

function sprite(pet: string, state: PxState, tick: number) {
  const a = PX_ANIM[state];
  const px = SPECIES[pet].px!;
  return px[a.seq[Math.floor(tick / a.every) % a.seq.length]] ?? px.S;
}

const frames = scenes.flatMap((scene, sceneIndex) => Array.from({ length: scene.ticks }, (_, tick) => {
  let state: PxState = "idle";
  let bubble = "";
  let caption = "";
  let command = "";
  let lines: [string, string][] = [];
  let pups: { name: string; grid: string[]; status: string }[] = [];
  let item: number | undefined;
  if (sceneIndex === 0) {
    const read = tick < 4;
    state = read ? "sniff" : "dig";
    bubble = read ? "нюхает код" : "следит за правками";
    caption = read ? "ИЩЕТ СЛЕД" : "ПРАВИТ КОД";
    command = "Найди баг и поправь обработку ошибок";
    lines = [["muted", "pi  Разбираюсь, где теряется прогресс."], ["cyan", "read  src/app/buddy.ts"], ["muted", "      Проверяю чтение и сохранение состояния."]];
    if (!read) lines.push(["green", "edit  src/app/buddy.ts"], ["white", "      Сохраняю опыт после каждого хода."]);
  } else if (sceneIndex === 1) {
    state = tick >= 8 ? "bark" : "sit";
    bubble = tick >= 8 ? "гав! стая вернулась" : "стая, вперёд! (3)";
    caption = tick >= 8 ? "ВСЕ ВЕРНУЛИСЬ" : "ПАСЁТ СТАЮ";
    command = "Проверь проект тремя субагентами";
    lines = [["cyan", "subagent  parallel · 3 tasks"], ["white", "scout     изучает архитектуру"], [tick >= 4 ? "green" : "white", "worker    исправляет сохранение"], [tick >= 8 ? "green" : "white", "tester    проверяет результат"]];
    if (tick >= 8) lines.push(["green", "          Все задачи завершены."]);
    pups = ["scout", "worker", "tester"].map((name, i) => {
      const done = tick >= [4, 6, 8][i];
      return { name, status: done ? "done" : "run", grid: miniSprite(sprite(scene.pet, done ? "happy" : (["sniff", "dig", "sit"] as PxState[])[i], tick)) };
    });
  } else if (sceneIndex === 2) {
    state = tick < 2 ? "sit" : tick < 6 ? "sad" : "bark";
    bubble = tick < 2 ? "высиживает билд" : tick < 6 ? "красный тест :(" : "кря! тесты зелёные!";
    caption = tick < 2 ? "ЖДЁТ ТЕСТЫ" : tick < 6 ? "ГРУСТИТ" : "ПРАЗДНУЕТ";
    command = "/buddy choose duck";
    lines = [["cyan", "bash  npm test"], [tick < 2 ? "muted" : "red", tick < 2 ? "      Running tests..." : "FAIL  сохраняет опыт после ошибки"]];
    if (tick >= 6) lines.push(["cyan", "edit  исправление · повторный запуск"], ["green", "PASS  все проверки пройдены"]);
  } else if (sceneIndex === 3) {
    state = tick < 4 ? "think" : "dig";
    bubble = tick < 4 ? "кря... дайте подумать" : "достаёт баг со дна";
    caption = tick < 4 ? "ДУМАЕТ ВМЕСТЕ С ТОБОЙ" : "ГОВОРИТ ПО ДЕЛУ";
    command = "Разберись, почему тест падает";
    lines = [["muted", "pi  Сравниваю сценарии сохранения."], ["cyan", "read  test/storage.test.ts"], ["white", "      Кажется, нашёл причину."]];
    if (tick >= 4) lines.push(["cyan", "edit  src/adapters/storage/files.ts"]);
  } else if (sceneIndex === 4 || sceneIndex === 5) {
    item = tick < 4 ? 0 : 1;
    const toy = SPECIES[scene.pet].items![item];
    state = toy.mode;
    bubble = toy.say[0];
    caption = tick < 4 ? "ИГРАЕТ" : "ОТДЫХАЕТ";
    command = `/buddy play ${toy.name}`;
    lines = [["green", "Работа сделана. Можно немного поиграть."], ["muted", "У каждого питомца — две любимые игрушки."], ["white", sceneIndex === 4 ? "ВЕО ловит мячик и грызёт косточку." : "Уточка играет с пищалкой и клюёт хлебушек."]];
  }
  let grid = sprite(scene.pet, state, tick);
  if (item !== undefined) grid = withItem(grid, SPECIES[scene.pet].items![item], tick);
  return { sceneIndex, tick, ...scene, state, bubble, caption, command, lines, pups, grid, item,
    gallery: ["veo_px", "duck", "cat", "owl", "dragon", "ghost", "axolotl", "blob", "gsd"].map((key) => ({ key, label: SPECIES[key].label, grid: sprite(key, "idle", tick) })) };
}));

// Demo copy is separate from runtime messages, but sprites, toys and species use real content.
const english: Record<string, string> = {
  "Рядом, пока ты кодишь": "By your side while you code",
  "Читает код, ищет след и помогает копать баги": "Reads code, follows clues and helps dig out bugs",
  "Субагенты собираются в стаю": "Subagents become a little pack",
  "У каждого помощника — своё занятие и результат": "Each helper has its own activity and result",
  "Переживает ошибки. Радуется победам.": "Feels the failures. Celebrates the wins.",
  "Ждёт тесты, грустит на красных и подаёт голос на зелёных": "Waits for tests, feels the red, cheers for the green",
  "У питомца есть свой голос": "A little companion with a voice",
  "Реплики зависят от вида питомца и того, чем занят агент": "Speech follows the pet's character and the agent's work",
  "Пора сделать маленькую паузу": "Time for a little break",
  "У ВЕО — мячик и косточка": "A ball and a bone for the shepherd",
  "У каждого — любимые игрушки": "Every pet has favorite toys",
  "У уточки — пищалка и хлебушек": "A squeaky duck and some bread for the duckling",
  "Выбери своего напарника": "Choose your coding companion",
  "ВЕО, уточка, кот, сова, дракон и другие": "Shepherds, ducks, cats, owls, dragons and more",
  "нюхает код": "sniffs out the bug", "следит за правками": "watches the changes",
  "ИЩЕТ СЛЕД": "FOLLOWS THE CLUES", "ПРАВИТ КОД": "WORKS ON THE CODE",
  "Найди баг и поправь обработку ошибок": "Find the bug and fix error handling",
  "pi  Разбираюсь, где теряется прогресс.": "pi  Finding where progress gets lost.",
  "      Проверяю чтение и сохранение состояния.": "      Checking state reads and saves.",
  "      Сохраняю опыт после каждого хода.": "      Saving XP after every turn.",
  "гав! стая вернулась": "woof! the pack is back", "стая, вперёд! (3)": "pack, go! (3)",
  "ВСЕ ВЕРНУЛИСЬ": "EVERYONE IS BACK", "ПАСЁТ СТАЮ": "WATCHES THE PACK",
  "Проверь проект тремя субагентами": "Review the project with three subagents",
  "scout     изучает архитектуру": "scout     explores the architecture",
  "worker    исправляет сохранение": "worker    fixes persistence",
  "tester    проверяет результат": "tester    checks the result",
  "          Все задачи завершены.": "          All tasks completed.",
  "высиживает билд": "sits on the build nest", "красный тест :(": "a red test :(",
  "кря! тесты зелёные!": "quack! tests are green!",
  "ЖДЁТ ТЕСТЫ": "WAITS FOR TESTS", "ГРУСТИТ": "FEELS THE FAILURE", "ПРАЗДНУЕТ": "CELEBRATES",
  "FAIL  сохраняет опыт после ошибки": "FAIL  saves XP after an error",
  "edit  исправление · повторный запуск": "edit  fix applied · running again",
  "PASS  все проверки пройдены": "PASS  all checks passed",
  "кря... дайте подумать": "quack... let me think", "достаёт баг со дна": "fishes out a little bug",
  "ДУМАЕТ ВМЕСТЕ С ТОБОЙ": "THINKS ALONG WITH YOU", "ГОВОРИТ ПО ДЕЛУ": "SPEAKS ABOUT THE WORK",
  "Разберись, почему тест падает": "Find out why the test fails",
  "pi  Сравниваю сценарии сохранения.": "pi  Comparing save scenarios.",
  "      Кажется, нашёл причину.": "      Looks like I found the cause.",
  "ИГРАЕТ": "PLAYS", "ОТДЫХАЕТ": "TAKES A BREAK",
  "Работа сделана. Можно немного поиграть.": "Work is done. Time to play a little.",
  "У каждого питомца — две любимые игрушки.": "Every pet has two favorite toys.",
  "ВЕО ловит мячик и грызёт косточку.": "The shepherd fetches and chews a bone.",
  "Уточка играет с пищалкой и клюёт хлебушек.": "The duck plays, then pecks at some bread.",
};
function translate(text: string): string {
  if (!/[а-яё]/i.test(text)) return text;
  if (!english[text]) throw new Error(`Missing demo translation: ${text}`);
  return english[text];
}
const localized = locale === "ru" ? frames : frames.map((frame) => {
  const toy = frame.item === undefined ? undefined : speciesFor(frame.pet, "en").items![frame.item];
  return {
    ...frame,
    title: translate(frame.title), subtitle: translate(frame.subtitle),
    bubble: toy ? toy.say[0] : translate(frame.bubble), caption: translate(frame.caption),
    command: toy ? `/buddy play ${toy.id}` : translate(frame.command),
    lines: frame.lines.map(([color, text]) => [color, translate(text)]),
    gallery: frame.gallery.map((pet) => ({ ...pet, label: pet.key === "veo_px" ? "VEO Shepherd" : pet.key === "gsd" ? "German Shepherd" : speciesFor(pet.key, "en").label })),
  };
});
writeFileSync(process.argv[2] ?? "/private/tmp/pi-buddy-demo.json", JSON.stringify({ locale, palette: PX_PAL, frames: localized }));

import type { Rarity, Species } from "../domain/types.ts";
import { GSD_SAY, VEO_SAY } from "./phrases.ts";
import { IT } from "./items.ts";
import { VEO_PX } from "./sprites/veo.ts";
import { ZOO_PX } from "./sprites/zoo.ts";
import { ZOO_SAY, ZOO_WORK } from "./zooWork.ts";

export const SPECIES: Record<string, Species> = {
  blob: { px: { ...ZOO_PX.blob, ...ZOO_WORK.blob }, ...ZOO_SAY.blob, items: [IT.cherry, IT.sugar], mini: "(E_E)", label: "Блоб", rarity: "common", art: ["  .---.  ", " ( E E ) ", "  `---'  "] },
  cat: { px: { ...ZOO_PX.cat, ...ZOO_WORK.cat }, ...ZOO_SAY.cat, items: [IT.yarn, IT.mouse], mini: "(=E.E=)", label: "Кот", rarity: "common", art: [" /\\_/\\  ", "( E.E ) ", " > ^ <  "] },
  duck: { px: { ...ZOO_PX.duck, ...ZOO_WORK.duck }, ...ZOO_SAY.duck, items: [IT.rubber, IT.bread], mini: "<(E )", label: "Утка", rarity: "uncommon", art: ["   __    ", " <(E )___", "  ( ._> /", "   `---' "] },
  ghost: { px: { ...ZOO_PX.ghost, ...ZOO_WORK.ghost }, ...ZOO_SAY.ghost, items: [IT.lantern, IT.cookie], mini: "(EoE)", label: "Призрак", rarity: "uncommon", art: ["  .-.  ", " (E E) ", " | O | ", " '~~~' "] },
  owl: { px: { ...ZOO_PX.owl, ...ZOO_WORK.owl }, ...ZOO_SAY.owl, items: [IT.feather, IT.book], mini: "{E,E}", label: "Сова", rarity: "rare", art: [" ,___,  ", " [E,E]  ", " /)__)  ", " -\"--\"- "] },
  axolotl: { px: { ...ZOO_PX.axolotl, ...ZOO_WORK.axolotl }, ...ZOO_SAY.axolotl, items: [IT.bubbles, IT.shell], mini: "}(EvE){", label: "Аксолотль", rarity: "epic", art: ["}~(___)~{", "}~(E E)~{", "  ( v )  ", "  ^^ ^^  "] },
  dragon: { px: { ...ZOO_PX.dragon, ...ZOO_WORK.dragon }, ...ZOO_SAY.dragon, items: [IT.coin, IT.gold], mini: "<(EwE)>~", label: "Дракон", rarity: "legendary", art: ["  /\\   /\\ ", " ( E   E )~", "  \\  ww /  ", "   `--'    "] },
  veo: {
    mini: "U(E.E)U", // щенок: уши висят
    frames: [["  _/\\      /\\_ ", " /  /______\\  \\", " \\_|  E  E  |_/", "   |  ,--,  |  ", "    \\ (__) /   ", "     \\_\\U/_/   "], ["   /\\      /\\_ ", " /  /______\\  \\", " \\_|  E  E  |_/", "   |  ,--,  |  ", "    \\ (__) /   ", "     \\_\\/_/    "]], // язык, дёрнул ухом
    framesGrown: [["   /\\      /\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "        U     "], ["   /\\      |\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "       \\U/    "]], // язык качается, дёрнул ухом
    miniGrown: "V(E.E)V", // взрослый: торчком
    label: "Овчарёнок ВЕО",
    grownLabel: "ВЕО",
    rarity: "legendary",
    // щенок: уши ещё полустоячие, морда короткая
    art: ["  _/\\      /\\_ ", " /  /______\\  \\", " \\_|  E  E  |_/", "   |  ,--,  |  ", "    \\ (__) /   ", "     \\_\\/_/    "],
    // взрослый: по фото — высокие стоячие уши, длинная морда, язык наружу
    grown: ["   /\\      /\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "       \\U/    "],
    say: VEO_SAY,
  },
  gsd: {
    px: ZOO_PX.gsd, // спрайт Сальсы в чепрачном окрасе
    items: [IT.frisbee, IT.rope],
    mini: "V(E.E)U", // одно ухо стоит, второе висит
    frames: [["   /\\        __   ", "  /  \\______/  \\_ ", "  |  E    E  |\\__/", "   \\   ##   /     ", "    \\#(__)#/      ", "     \\_\\U/_/      "], ["   /\\        /\\ ", "  /  \\______/  \\", "  |  E    E  |  ", "   \\   ##   /   ", "    \\#(__)#/    ", "     \\_\\/_/     "]], // язык; висячее ухо на миг встало
    framesGrown: [["   /\\        /\\ ", "  /  \\      /  \\", "  |   \\____/   |", "   \\  E ## E  / ", "    \\ ##||## /  ", "     \\#(__)#/   ", "      \\_\\U/_/   "], ["   /\\        |\\ ", "  /  \\      /  \\", "  |   \\____/   |", "   \\  E ## E  / ", "    \\ ##||## /  ", "     \\#(__)#/   ", "      \\_\\/_/    "]],
    miniGrown: "V(E.E)V",
    label: "Щенок немецкой овчарки",
    grownLabel: "Немецкая овчарка",
    rarity: "epic",
    // щенок: одно ухо уже стоит, второе ещё висит; # — тёмная маска на морде
    art: ["   /\\        __   ", "  /  \\______/  \\_ ", "  |  E    E  |\\__/", "   \\   ##   /     ", "    \\#(__)#/      ", "     \\_\\/_/       "],
    // взрослая: огромные стоячие уши, чёрная маска вокруг носа
    grown: ["   /\\        /\\ ", "  /  \\      /  \\", "  |   \\____/   |", "   \\  E ## E  / ", "    \\ ##||## /  ", "     \\#(__)#/   ", "      \\_\\/_/    "],
    say: GSD_SAY,
  },
  veo_px: {
    label: "ВЕО (пиксели)",
    rarity: "legendary",
    mini: "V(E.E)V",
    // в узком терминале или в режимах compact/top — ASCII взрослого ВЕО
    art: ["   /\\      /\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "       \\U/    "],
    frames: [["   /\\      /\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "        U     "], ["   /\\      |\\ ", "  /  \\____/  \\", "  \\  E    E  /", "   \\   ..   / ", "    \\ (__) /  ", "     \\_\\/_/   ", "       \\U/    "]],
    px: VEO_PX,
    items: [IT.ball, IT.bone],
    say: VEO_SAY,
  },
};

export const RARITY_WEIGHTS: [Rarity, number][] = [
  ["common", 60],
  ["uncommon", 25],
  ["rare", 10],
  ["epic", 4],
  ["legendary", 1],
];

export const RARITY_STARS: Record<Rarity, string> = {
  common: "*",
  uncommon: "**",
  rare: "***",
  epic: "****",
  legendary: "*****",
};

export const NAMES = ["Байт", "Кеш", "Бином", "Гоша", "Пиксель", "Тапок", "Монада", "Лямбда", "Бобик", "Спринг"];

export const SPECIES_KEYS = Object.keys(SPECIES);

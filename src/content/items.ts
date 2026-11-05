import type { PxItem } from "../domain/types.ts";

/**
 * Любимые предметы. toss — прыгает в руки (мячик скачет), chew — лежит у лап.
 * Рисуются поверх кадра у земли рядом с питомцем; say — дежурные фразы, пока идёт игра.
 */
export const IT: Record<string, PxItem> = {
  ball: { name: "мячик", mode: "toss", art: [".RR.", "RwRR", "RRRR", ".RR."], say: ["гоняет мячик", "ловит мячик", "апорт!", "мячик! мячик!"] },
  bone: { name: "косточка", mode: "chew", art: ["g...g", "wwwww", "g...g"], say: ["грызёт косточку", "охраняет косточку", "хрум-хрум"] },
  frisbee: { name: "фрисби", mode: "toss", art: [".RRR.", "ROOOR", ".RRR."], say: ["ловит фрисби", "фрисби! ещё!", "прыжок за тарелкой"] },
  rope: { name: "канат", mode: "chew", art: ["T.T.T.", "wTwTwT", ".T.T.T"], say: ["треплет канат", "тянет канат", "рррр, канат!"] },
  cherry: { name: "вишенка", mode: "toss", art: ["..v", ".v.", "RvR", "RR."], say: ["подбрасывает вишенку", "ням, вишенка"] },
  sugar: { name: "сахарок", mode: "chew", art: ["ww", "wg"], say: ["тает от сахарка", "облизывает сахарок"] },
  yarn: { name: "клубок", mode: "toss", art: [".mm.", "mkmm", "mmkm", ".mm."], say: ["гоняет клубок", "запутался в нитках", "катает клубок"] },
  mouse: { name: "мышка", mode: "chew", art: ["..gg", "gEgg", "sggg"], say: ["охотится на мышку", "мышка моя!", "трогает мышку лапкой"] },
  rubber: { name: "уточка-пищалка", mode: "toss", art: [".YO", "YYY", "YY."], say: ["пищит уточкой", "играет с пищалкой"] },
  bread: { name: "хлебушек", mode: "chew", art: [".TT.", "TTTT", "tTTt"], say: ["клюёт хлебушек", "крошки!", "ням-ням хлеб"] },
  lantern: { name: "фонарик", mode: "toss", art: [".b.", "YYY", "YOY", "bbb"], say: ["светит фонариком", "парит с фонариком"] },
  cookie: { name: "печенька", mode: "chew", art: [".TT.", "TtTT", "TTtT", ".TT."], say: ["хрустит печенькой", "призрачная печенька"] },
  feather: { name: "пёрышко", mode: "toss", art: ["..w", ".w.", ".w.", "w.."], say: ["ловит пёрышко", "чистит пёрышко"] },
  book: { name: "книжка", mode: "chew", art: ["RRRR", "Rwww", "RRRR"], say: ["читает книжку", "изучает документацию", "листает страницы"] },
  bubbles: { name: "пузырьки", mode: "toss", art: ["L..", "..L", ".L."], say: ["пускает пузырьки", "буль-буль"] },
  shell: { name: "ракушка", mode: "chew", art: [".k.", "kwk", "kkk"], say: ["любуется ракушкой", "слушает ракушку"] },
  coin: { name: "монетка", mode: "toss", art: [".Y.", "YyY", ".Y."], say: ["подкидывает монетку", "орёл или решка?"] },
  gold: { name: "сокровище", mode: "chew", art: ["..Y...", ".YyY..", "YyYyYy"], say: ["лежит на сокровищах", "пересчитывает золото", "моё золото!"] },
};

for (const [id, item] of Object.entries(IT)) {
  item.id = id;
  item.aliases = [id];
}

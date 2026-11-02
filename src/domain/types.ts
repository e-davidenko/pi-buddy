/** Типы предметной области: питомец, настроение, позы, реплики */

export type Mood = "idle" | "happy" | "sad" | "sleep" | "work" | "eat" | "love";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface BuddyState {
  name: string;
  species: string;
  rarity: Rarity;
  shiny: boolean;
  born: number;
  food: number; // 0..100, 100 = сыт
  joy: number; // 0..100
  energy: number; // 0..100
  xp: number;
  lastTick: number;
  lastActivity: number;
  visible: boolean;
  toolCalls: number;
  errors: number;
  generations?: number; // ответов модели (turn_end)
  tokensOut?: number; // сгенерировано токенов
  placement?: Placement;
  size?: Size;
  muted?: boolean;
  anim?: "auto" | "on" | "off";
  pxColor?: "auto" | PxMode; // как красить пиксельного пса
  cleanRuns?: number; // запросов подряд без ошибок
}

export type Placement = "side" | "top";
/**
 * dock    — полноразмерный питомец в полосе справа; чат и ввод сужаются по ширине,
 *           по высоте ничего не сдвигается (по умолчанию)
 * compact — мини-мордочка, ширина чата не трогается, строк не добавляет
 * big     — полный арт рядом с полем ввода, поле растёт по высоте
 */
export type Size = "dock" | "compact" | "big";

/**
 * Как красить пиксели:
 *  bg — полублок ▀: верх цветом символа, низ цветом фона. Чётко, но нужен 24-битный ФОН.
 *  fg — только цвет символа (█ ▀ ▄), без фона, палитра 256 (терминал IntelliJ/JediTerm).
 */
export type PxMode = "bg" | "fg";

// ---------- реплики ----------
// Держим фразы короткими (до ~34 символов): облачко — две строки по 18.

export type Topic =
  | "hello" | "back" | "morning" | "night" | "monday" | "friday" | "weekend"
  | "done" | "streak" | "bigGen" | "think" | "levelup"
  | "error" | "errStreak"
  | "bash" | "edit" | "read" | "java" | "pom" | "bpmn" | "yaml" | "sql"
  | "testOk" | "testFail" | "buildOk" | "buildFail" | "gitCommit" | "gitPush" | "gitFail"
  | "docker" | "k8s" | "rm"
  | "idle" | "feed" | "full" | "pet" | "play" | "tired" | "nap"
  // дежурные (тихие, серым, вместо пустоты): меняются раз в несколько минут
  | "stbIdle" | "stbWork" | "stbSleep" | "stbSad" | "stbMute"
  // дежурные во время работы — по тому, чем занят агент
  | "stbThink" | "stbSniff" | "stbDig" | "stbAlert" | "stbSit"
  // модель думает долго: чем занят питомец в ожидании, и реплики «ну долго ещё?»
  | "stbWait" | "thinkLong";

/** Поза пиксельного питомца, в которой звучит реплика (метка @поза: в фразе) */
export type Pose = "stand" | "walk" | "lie" | "sit";

export type PxBase = "S" | "SB" | "SP" | "SE" | "WM" | "WU" | "WA" | "WB" | "L" | "LB" | "LP" | "LT" | "SAD" | "SADB" | "Z" | "ZB";
/** Доп. позы (рабочие): думает, нюхает, копает, настороже, сидит, голос — у каждого питомца свои */
export type PxExtra = "TH" | "TH2" | "THB" | "SN1" | "SN2" | "DG1" | "DG2" | "AL" | "ALB" | "SIT" | "SITB" | "SITP" | "BK1" | "BK2";
export type PxFrame = PxBase | PxExtra;
export type PxSet = Record<PxBase, string[]> & Partial<Record<PxExtra, string[]>>;

export type PxState = "work" | "happy" | "love" | "eat" | "idle" | "rest" | "sad" | "sleep" | "toss" | "chew"
  | "think" | "sniff" | "dig" | "alert" | "sit" | "bark";

/**
 * Любимые предметы. toss — прыгает в руки (мячик скачет), chew — лежит у лап.
 * Рисуются поверх кадра у земли рядом с питомцем; say — дежурные фразы, пока идёт игра.
 */
export interface PxItem {
  name: string;
  mode: "toss" | "chew";
  art: string[];
  say: string[];
}

// E — место для глаз, подставляется в зависимости от настроения.
// grown — арт после взросления (с уровня GROW_LEVEL), если есть.
export interface Species {
  label: string;
  rarity: Rarity;
  art: string[];
  grown?: string[];
  grownLabel?: string;
  mini: string; // однострочная мордочка для компактного режима, E — глаз
  // доп. кадры анимации (кадр 0 — сам art/grown). Нет — покачивание на 1 символ
  frames?: string[][];
  framesGrown?: string[][];
  miniGrown?: string;
  say?: Partial<Record<Topic, string[]>>;
  px?: PxSet; // пиксельные кадры (полублоки, truecolor); art — ASCII-запаска
  items?: PxItem[]; // два любимых предмета
  voice?: string[]; // «голос» для поз BK (у собак — гав)
  packSay?: { run: string[]; home: string[] }; // подписи стаи помощников; run — с {n}
}

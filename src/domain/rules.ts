/**
 * Правила жизни питомца: шкалы (сытость, радость, силы), опыт и уровни,
 * пассивное восстановление со временем, слияние состояния между терминалами.
 * Чистые функции — без файлов, часов и экрана.
 */
import type {BuddyState, Rarity, Species} from "./types.ts";

/**
 * Статы самовосполняемые: в простое плавно тянутся к базовому уровню,
 * а работа агента их двигает. Кормить и развлекать вручную не нужно.
 */
export const BASE = {food: 60, joy: 60, energy: 100};
export const RELAX_H = {food: 3, joy: 2, energy: 1}; // постоянная времени возврата к базе, часов
export const GAIN = {
    genFood: 5, // каждая генерация кормит
    tokFood: 1 / 400, // и немного за объём ответа (токены)
    tokFoodMax: 8,
    toolJoy: 1.5, // успешный tool call радует
    runJoy: 4, // завершённый запрос — ещё больше
    errJoy: -10, // ошибка огорчает, но база вернёт
    genEnergy: -1.5, // генерации утомляют
    toolEnergy: -0.4,
    genXp: 2,
    toolXp: 1,
    tokXp: 1 / 1000,
};

/** С этого уровня питомец «взрослеет» (свой арт, если есть) */
export const GROW_LEVEL = 5;

export const clamp = (v: number) => Math.max(0, Math.min(100, v));
export const level = (xp: number) => Math.floor(Math.sqrt(xp / 10)) + 1;
export const isGrown = (sp: Species, xp: number) => !!sp.grown && level(xp) >= GROW_LEVEL;

// ---------- рождение ----------

export function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

export function rollRarity(r: number, weights: [Rarity, number][]): Rarity {
    let acc = 0;
    const x = r % 100;
    for (const [rar, w] of weights) {
        acc += w;
        if (x < acc) return rar;
    }
    return "common";
}

/** Новый питомец, детерминированный по seed: редкость, вид, кличка, shiny */
export function hatch(
    seed: string,
    now: number,
    catalog: Record<string, { rarity: Rarity }>,
    weights: [Rarity, number][],
    names: string[],
): BuddyState {
    const h = hash(seed);
    const rarity = rollRarity(h, weights);
    const pool = Object.entries(catalog).filter(([, s]) => s.rarity === rarity);
    const species = pool[(h >>> 8) % pool.length][0];
    return {
        name: names[(h >>> 16) % names.length],
        species,
        rarity,
        shiny: (h >>> 24) % 100 === 0,
        born: now,
        food: 80,
        joy: 80,
        energy: 100,
        xp: 0,
        lastTick: now,
        lastActivity: now,
        visible: true,
        toolCalls: 0,
        errors: 0,
    };
}

// ---------- время ----------

/** Пассивное изменение статов со временем: экспоненциальный возврат к базе */
export function relax(s: BuddyState, now: number): void {
    const hours = (now - s.lastTick) / 3_600_000;
    if (hours <= 0) return;
    // голод и скука не накапливаются
    const r = (v: number, base: number, tau: number) => clamp(base + (v - base) * Math.exp(-hours / tau));
    s.food = r(s.food, BASE.food, RELAX_H.food);
    s.joy = r(s.joy, BASE.joy, RELAX_H.joy);
    s.energy = r(s.energy, BASE.energy, RELAX_H.energy);
    s.lastTick = now;
}

/**
 * Питомец общий для всех терминалов. Каждый pi держит копию в памяти, поэтому при сохранении
 * не перезаписываем файл своей копией, а сливаем: счётчики (xp, вызовы…) — складываем то,
 * что набрал этот терминал с прошлой синхронизации; шкалы (еда, радость, силы) — так же
 * приращениями; настройки (имя, вид, режимы) — только те, что поменяли здесь.
 */
export const COUNTERS = ["xp", "toolCalls", "errors", "generations", "tokensOut"] as const;
export const GAUGES = ["food", "joy", "energy"] as const;
export const CONFIG = ["name", "species", "rarity", "shiny", "born", "visible", "placement", "size", "muted", "anim", "pxColor"] as const;

/** Шкалы, «доведённые» до момента now (как relax): чтобы спад за одно время не учитывать дважды */
export function relaxedGauges(st: BuddyState, now: number): Record<(typeof GAUGES)[number], number> {
    const hours = Math.max(0, (now - (st.lastTick ?? now)) / 3_600_000);
    const r = (v: number, base: number, tau: number) => clamp(base + ((v ?? base) - base) * Math.exp(-hours / tau));
    return {
        food: r(st.food, BASE.food, RELAX_H.food),
        joy: r(st.joy, BASE.joy, RELAX_H.joy),
        energy: r(st.energy, BASE.energy, RELAX_H.energy),
    };
}

/**
 * Слияние: disk — что сейчас в файле, base — каким файл был при нашей прошлой синхронизации,
 * mine — наше состояние в памяти, dirty — настройки, изменённые у нас.
 */
export function mergeWithDisk(mine: BuddyState, base: BuddyState, disk: BuddyState, dirty: ReadonlySet<string>, now: number, runEnds: readonly boolean[] = []): BuddyState {
    // /buddy hatch в другом терминале — явная замена питомца, старый опыт ему не переносим.
    if (disk.born !== base.born) return {...disk};
    const m: any = {...disk};
    for (const k of COUNTERS) {
        const local = mine[k] ?? 0;
        m[k] = Math.max(local, (disk[k] ?? 0) + Math.max(0, local - (base[k] ?? 0)));
    }
    const dg = relaxedGauges(disk, now);
    const bg = relaxedGauges(base, now);
    for (const k of GAUGES) m[k] = clamp(dg[k] + (mine[k] - bg[k]));
    for (const k of CONFIG) if (dirty.has(k)) m[k] = (mine as any)[k];
    m.cleanRuns = runEnds.reduce((streak, hadErrors) => hadErrors ? 0 : streak + 1, disk.cleanRuns ?? 0);
    m.lastTick = now;
    m.lastActivity = Math.max(disk.lastActivity ?? 0, mine.lastActivity ?? 0);
    return m;
}

// ---------- реакции на работу агента ----------

/** Каждая генерация модели: кормит, утомляет, даёт XP пропорционально объёму */
export function onGeneration(s: BuddyState, out: number): void {
    s.generations = (s.generations ?? 0) + 1;
    s.tokensOut = (s.tokensOut ?? 0) + out;
    s.food = clamp(s.food + GAIN.genFood + Math.min(GAIN.tokFoodMax, out * GAIN.tokFood));
    s.energy = clamp(s.energy + GAIN.genEnergy);
    s.xp += GAIN.genXp + Math.floor(out * GAIN.tokXp);
}

/** Вызов инструмента: опыт и усталость всегда, радость — по исходу */
export function onToolCall(s: BuddyState): void {
    s.toolCalls++;
    s.xp += GAIN.toolXp;
    s.energy = clamp(s.energy + GAIN.toolEnergy);
}

export function onToolOk(s: BuddyState): void {
    s.joy = clamp(s.joy + GAIN.toolJoy);
}

export function onToolError(s: BuddyState): void {
    s.errors++;
    s.joy = clamp(s.joy + GAIN.errJoy);
}

/** Стая субагентов вернулась: их ходы и вызовы идут в опыт питомца */
export function onPackReturn(s: BuddyState, gens: number, tools: number, ok = true): void {
    s.generations = (s.generations ?? 0) + gens;
    s.toolCalls += tools;
    s.xp += gens * GAIN.genXp + tools * GAIN.toolXp;
    s.joy = clamp(s.joy + (ok ? GAIN.runJoy : GAIN.errJoy));
}

/** Запрос завершён: радость и серия запросов без ошибок */
export function onRunEnd(s: BuddyState, hadErrors: boolean): void {
    if (!hadErrors) s.joy = clamp(s.joy + GAIN.runJoy);
    s.cleanRuns = hadErrors ? 0 : (s.cleanRuns ?? 0) + 1;
}

/** Серии без ошибок, которые питомец отмечает отдельно */
export const STREAKS = [5, 10, 25, 50, 100];

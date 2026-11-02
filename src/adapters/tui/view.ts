/**
 * Экран pi: питомец рядом с полем ввода. Режимы:
 *  dock    — полоса справа (оверлей), чат и ввод сужаются по ширине;
 *  compact — мини-мордочка в рамке поля ввода, ни одной строки сверху;
 *  big     — полный арт справа от поля ввода, поле растёт;
 *  top     — виджет над полем ввода (если встроиться в редактор не вышло).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BuddyApp } from "../../app/buddy.ts";
import { bar, framesFor, labelFor, miniFor, spec } from "../../app/catalog.ts";
import { MINI_W, MIN_TERM_W, PX_W, SIDE_W } from "../../app/layout.ts";
import type { View } from "../../app/ports.ts";
import { decoFor, eyeFor, frameIndex } from "../../app/viewModel.ts";
import { RARITY_STARS } from "../../content/species.ts";
import type { Pup } from "../../domain/pack.ts";
import { level } from "../../domain/rules.ts";
import type { Mood, PxFrame, PxItem } from "../../domain/types.ts";
import { importPi } from "../pi/importPi.ts";
import { miniSprite, pxRender } from "./pixels.ts";
import { ANSI, wrapWords } from "./text.ts";

const WIDGET_ID = "buddy";

export class TuiView implements View {
  tuiRef: any = null;
  private vw: (t: string) => number = (t) => t.replace(ANSI, "").length;
  private truncW: ((t: string, w: number, ellipsis?: string) => string) | null = null;
  private overlay: any = null;
  private footerRows = -1;
  private shownW = 0;
  private readonly G = globalThis as any;

  constructor(
    private a: BuddyApp,
    private alive: () => boolean,
  ) {
    a.display.mode = () => this.tuiRef?.mode;
  }

  /** Приглушённый цвет из темы pi; если не вышло — просто dim */
  private dim(t: string): string {
    try {
      const out = this.a.ui?.theme?.fg?.("muted", t);
      if (typeof out === "string") return out;
    } catch {
      /* старая тема */
    }
    return `\x1b[2m${t}\x1b[22m`;
  }

  // ---------- кадр питомца ----------

  private eyesNow(): { m: Mood; lines: string[] } {
    const a = this.a;
    const m = a.mood();
    const eye = eyeFor(m, a.blink);
    if (a.pxOn()) return { m, lines: pxRender(this.pxGrid(m), false, a.pxMode()) }; // моргание — в самих кадрах
    const fr = framesFor(a.s);
    const idx = a.quiet() ? 0 : frameIndex(m, fr.length, a.animN);
    return { m, lines: fr[idx].map((l) => l.replace(/E/g, eye)) };
  }

  /** Сетка кадра с предметом, если идёт игра */
  private pxGrid(m: Mood): string[] {
    const a = this.a;
    const px = spec(a.s).px!;
    const grid = px[a.poses.frame(m)] ?? px.S;
    return a.sceneOn() ? withItem(grid, a.scene!.item, a.animN - a.poses.mStart) : grid;
  }

  /** Кадр щенка: своя поза под занятие, иначе — шаг */
  private pupFrame(p: Pup): string[] {
    const px = spec(this.a.s).px!;
    const n = this.a.animN;
    const two = (x: PxFrame, y: PxFrame) => px[n % 2 ? y : x] ?? px[n % 2 ? "WB" : "WA"];
    if (p.status === "done") return px[n % 2 ? "WU" : "WM"]; // готов — виляет
    if (p.status === "err") return px.SAD;
    if (p.status === "wait") return px[n % 4 === 0 ? "SB" : "S"];
    switch (p.act) {
      case "sniff": return two("SN1", "SN2");
      case "dig": return two("DG1", "DG2");
      case "sit": return px[n % 4 === 0 ? "SITB" : "SIT"] ?? px.S;
      case "alert": return px.AL ?? px.S;
      case "think": return px[n % 4 < 2 ? "TH" : "TH2"] ?? px.S;
      default: return two("WA", "WB");
    }
  }

  /** Полоса со щенками (до трёх) + подписи. Пиксельно — если питомец пиксельный, иначе строкой */
  private packLines(cw: number): string[] {
    const a = this.a;
    const pack = a.pack.pack;
    if (!a.pack.visible() || !pack!.pups.length) return [];
    const pups = pack!.pups.slice(0, 3);
    const mark = (p: Pup) => (p.status === "done" ? "✓" : p.status === "err" ? "✗" : p.status === "wait" ? "·" : "…");
    if (!a.pxOn()) {
      const t = "стая: " + pack!.pups.map((p) => p.name + mark(p)).join(" ");
      return [t.length > cw ? t.slice(0, cw - 1) + "…" : t];
    }
    const grid = Array.from({ length: 6 }, () => ".".repeat(PX_W).split(""));
    const x0 = Math.floor((PX_W - pups.length * 8) / 2);
    pups.forEach((p, i) => {
      miniSprite(this.pupFrame(p)).forEach((row, y) => [...row].forEach((c, x) => { if (c !== ".") grid[y][x0 + i * 8 + x] = c; }));
    });
    const art = pxRender(grid.map((r) => r.join("")), false, a.pxMode());
    const label = " ".repeat(x0) + pups.map((p) => (p.name.slice(0, 6) + mark(p)).padEnd(8).slice(0, 8)).join("");
    const more = pack!.pups.length > 3 ? ` +${pack!.pups.length - 3}` : "";
    return [...art, this.dim((label + more).slice(0, cw))];
  }

  // ---------- колонки рядом с полем ввода ----------

  /** Колонка справа от поля ввода: реплика, арт, имя. Статы уходят в футер. */
  private sideColumn(): string[] {
    const a = this.a;
    const s = a.s;
    const { m, lines } = this.eyesNow();
    const col: string[] = [];
    // зона реплики всегда 2 строки: живая реплика или дежурная серым — высота не прыгает
    const cw = Math.max(SIDE_W, a.dockW() - 1);
    const talk = a.bubbleOn() ? wrapWords(a.bubble, cw - 2, 2) : wrapWords(a.standby(), cw - 2, 2).map((t) => this.dim(t));
    while (talk.length < 2) talk.unshift("");
    col.push(...talk.map((l) => (l ? " " + l : "")));
    col.push(...this.packLines(cw)); // субагенты, если работают
    col.push(...lines);
    const nm = `${s.shiny ? "~" : ""}${s.name}${s.shiny ? "~" : ""} lv.${level(s.xp)}${decoFor(m, a.quiet(), a.animN)}`;
    col.push(nm.length > cw ? nm.slice(0, cw - 1) + "…" : nm);
    const p = (v: number) => String(Math.round(v)).padStart(3);
    col.push(`ед${p(s.food)} рд${p(s.joy)} сл${p(s.energy)}`);
    return col;
  }

  /** Подмена render() у редактора: редактор сужается, питомец встаёт справа, низы выровнены */
  private sideRender(orig: (w: number) => string[], width: number): string[] {
    const a = this.a;
    if (!this.alive()) return orig(width); // старый экземпляр после /new ничего не дорисовывает
    if (!a.s.visible || a.placement() !== "side" || width < MIN_TERM_W) return orig(width);
    const size = a.s.size ?? "dock";
    a.display.termW = width;
    if (size === "dock") {
      if (!a.display.dockReady) return this.sideCompact(orig, width);
      // в обычном (не полноэкранном) режиме оверлей прилипает к низу терминала, а не к полю
      // ввода, — там питомец встаёт прямо рядом с полем ввода
      return this.fullscreen() ? orig(width - a.dockW() - 1) : this.sideBig(orig, width);
    }
    return size === "big" ? this.sideBig(orig, width) : this.sideCompact(orig, width);
  }

  /**
   * Компактный режим: НЕ добавляет ни одной строки.
   * Реплика вписывается в верхнюю рамку поля ввода, справа — мордочка, имя и статы.
   */
  private sideCompact(orig: (w: number) => string[], width: number): string[] {
    const a = this.a;
    const s = a.s;
    const vw = this.vw;
    const leftW = width - MINI_W - 1;
    const rows = orig(leftW);
    if (!rows.length) return rows;
    const { m } = this.eyesNow();
    const eye = eyeFor(m, a.blink);
    const live = a.bubbleOn();
    let talk = live ? a.bubble : a.standby();
    const room = leftW - 12; // слева на рамке оставляем место под служебные пометки pi
    if (talk.length + 2 > room) talk = talk.slice(0, Math.max(0, room - 3)) + "…";
    if (talk && this.truncW) {
      const head = this.truncW(rows[0], leftW - vw(talk) - 2, "");
      rows[0] = head + " ".repeat(Math.max(0, leftW - vw(talk) - 2 - vw(head))) + " " + (live ? talk : this.dim(talk)) + " ";
    }
    const cut = (t: string) => (t.length > MINI_W ? t.slice(0, MINI_W - 1) + "…" : t);
    const face = miniFor(s).replace(/E/g, eye);
    const n = (v: number) => String(Math.round(v)).padStart(3);
    const cells = [
      cut(`${face}${decoFor(m, a.quiet(), a.animN)}`),
      cut(`${s.name} lv.${level(s.xp)}`),
      this.dim(cut(`ед${n(s.food)} рд${n(s.joy)} сл${n(s.energy)}`)),
    ];
    // без truncateToWidth реплику кладём в колонку вместо мордочки
    if (talk && !this.truncW) cells[0] = live ? cut(talk) : this.dim(cut(talk));
    return rows.map((l, i) => l + " ".repeat(Math.max(0, leftW - vw(l))) + " " + (cells[i] ?? ""));
  }

  /** Большой режим: полный арт справа, поле ввода растёт на высоту арта */
  private sideBig(orig: (w: number) => string[], width: number): string[] {
    const leftW = width - Math.max(SIDE_W, this.a.dockW()) - 1;
    const left = orig(leftW);
    const col = this.sideColumn();
    const h = Math.max(left.length, col.length);
    const lpad = h - left.length;
    const cpad = h - col.length;
    const out: string[] = [];
    for (let i = 0; i < h; i++) {
      const l = i < lpad ? "" : left[i - lpad];
      const c = i < cpad ? "" : col[i - cpad];
      out.push(l + " ".repeat(Math.max(0, leftW - this.vw(l))) + " " + c);
    }
    return out;
  }

  /** Перерисовка: сбоку — просим TUI перерисоваться; сверху — виджет над полем ввода */
  render() {
    const a = this.a;
    const ui: any = a.ui;
    if (!ui || !this.alive()) return;
    const s = a.s;
    if (!s.visible) {
      ui.setWidget(WIDGET_ID, undefined);
      ui.setStatus?.(WIDGET_ID, undefined);
      this.tuiRef?.requestRender?.();
      return;
    }
    if (a.placement() === "side") {
      ui.setWidget(WIDGET_ID, undefined);
      ui.setStatus?.(WIDGET_ID, undefined);
      this.tuiRef?.requestRender?.();
      return;
    }
    ui.setStatus?.(WIDGET_ID, undefined);
    this.tuiRef?.requestRender?.();

    const { m, lines } = this.eyesNow();
    const w = Math.max(...lines.map((l) => l.length)) + 2;
    const info = [
      `${s.shiny ? "~" : ""}${s.name}${s.shiny ? "~" : ""} (${labelFor(s)})  lv.${level(s.xp)}  ${RARITY_STARS[s.rarity]}${decoFor(m, a.quiet(), a.animN)}`,
      `еда ${bar(s.food)}  радость ${bar(s.joy)}`,
      `сил ${bar(s.energy)}  xp ${s.xp}`,
    ];
    const rows = Math.max(lines.length, info.length);
    const out: string[] = [];
    out.push(" ".repeat(Math.max(0, w - 4)) + (a.bubbleOn() ? `( ${a.bubble} )` : this.dim(`  ${a.standby()}`)));
    for (let i = 0; i < rows; i++) out.push((lines[i] ?? "").padEnd(w) + (info[i] ?? ""));
    ui.setWidget(WIDGET_ID, out);
  }

  // ---------- режим dock: полоса справа через оверлей ----------

  /** Полноэкранный режим pi: только в нём полоса-оверлей стоит у поля ввода */
  private fullscreen() {
    return this.tuiRef?.mode === undefined || this.tuiRef?.mode === "fullscreen";
  }
  private dockOn(termW: number) {
    const a = this.a;
    return this.alive() && a.s.visible && a.placement() === "side" && (a.s.size ?? "dock") === "dock" && termW >= MIN_TERM_W && this.fullscreen();
  }

  /** Содержимое полосы: реплика, полный арт, имя, статы — всё шириной полосы */
  private dockComponent = {
    render: (_w: number) => this.sideColumn().map((l) => l + " ".repeat(Math.max(0, this.a.dockW() - this.vw(l)))),
    invalidate: () => {},
  };

  private showDock() {
    if (!this.tuiRef?.showOverlay || !this.alive()) return;
    this.shownW = this.a.dockW();
    // прячем и свою прошлую полосу, и оставшуюся от прежнего экземпляра (после /new)
    this.hideOverlays();
    // прижат к правому нижнему углу, но над футером (там путь и модель — их не закрываем)
    this.overlay = this.tuiRef.showOverlay(this.dockComponent, {
      anchor: "bottom-right",
      width: this.shownW,
      offsetY: -Math.max(0, this.footerRows),
      nonCapturing: true,
      visible: (tw: number) => this.dockOn(tw),
    });
    this.G.__piBuddyOverlay = this.overlay;
  }

  private hideOverlays() {
    for (const o of new Set([this.overlay, this.G.__piBuddyOverlay])) {
      try {
        o?.hide();
      } catch {
        /* уже скрыт */
      }
    }
  }

  /** Убрать свою полосу (выход или нас сменил новый экземпляр) */
  hide() {
    try {
      this.overlay?.hide();
    } catch {
      /* ок */
    }
    if (this.G.__piBuddyOverlay === this.overlay) this.G.__piBuddyOverlay = null;
  }

  /**
   * Сужаем по ширине все корневые блоки, кроме футера, — справа освобождается полоса.
   * Футер не трогаем, только меряем его высоту, чтобы встать ровно над ним.
   */
  private installDock(tui: any, editor: any): boolean {
    const kids: any[] = Array.isArray(tui?.children) ? tui.children : [];
    if (!kids.length || typeof tui.showOverlay !== "function") return false;
    // Обёртки ставятся один раз на TUI, а логику берут из актуального экземпляра расширения:
    // после /reload старые замыкания не должны управлять раскладкой
    tui.__buddyHook = {
      cut: (w: number) => (this.dockOn(w) ? this.a.dockW() + 1 : 0),
      editor,
      footer: (w: number, rows: number) => {
        this.a.display.termW = w;
        if (rows !== this.footerRows || (this.overlay && this.shownW !== this.a.dockW())) {
          this.footerRows = rows;
          queueMicrotask(() => this.showDock()); // футер поменял высоту или полоса ширину — переставляем
        }
      },
    };
    const hook = () => tui.__buddyHook;
    const footer = kids.find((k) => k?.children?.some((c: any) => c?.constructor?.name === "FooterComponent")) ?? kids[kids.length - 1];
    for (const k of kids) {
      if (!k || k.__buddyDock || typeof k.render !== "function") continue;
      const orig = k.render.bind(k);
      if (k.children?.includes(editor)) {
        // контейнер поля ввода: сам редактор сужается в sideRender, а диалоги pi
        // (select, confirm), которые временно встают на его место, сужаем здесь
        k.render = (w: number) => {
          const h = hook();
          return h && !k.children.includes(h.editor) ? orig(w - h.cut(w)) : orig(w);
        };
      } else if (k === footer) {
        k.render = (w: number) => {
          const r = orig(w);
          hook()?.footer(w, r.length);
          return r;
        };
      } else {
        k.render = (w: number) => orig(w - (hook()?.cut(w) ?? 0));
      }
      k.__buddyDock = true;
    }
    return true;
  }

  /**
   * Встраиваемся в поле ввода, как /buddy в Claude Code. Если другое расширение
   * уже поставило свой редактор (vim-режим и т.п.) — оборачиваем его, а не заменяем.
   */
  async installSide(ctx: any) {
    if (!ctx.ui?.setEditorComponent) return;
    const tuiMod = await importPi("pi-tui");
    if (tuiMod?.visibleWidth) this.vw = tuiMod.visibleWidth;
    if (tuiMod?.truncateToWidth) this.truncW = tuiMod.truncateToWidth;

    let base = ctx.ui.getEditorComponent?.();
    if (base?.__buddyBase !== undefined) base = base.__buddyBase; // после /reload не оборачиваем дважды
    let make = base;
    if (!make) {
      const Editor = (await importPi("pi-coding-agent"))?.CustomEditor;
      if (!Editor) return; // не нашли редактор — остаёмся виджетом сверху
      // те же опции, что у встроенного редактора pi: индикатор «Working» остаётся
      // в верхней рамке поля ввода, а не выносится отдельной строкой над ним
      const opts: Record<string, unknown> = { embedWorkingStatus: true };
      for (const f of [
        path.join(os.homedir(), ".pi", "agent", "settings.json"),
        path.join(String(ctx.cwd ?? process.cwd()), ".pi", "settings.json"),
      ]) {
        try {
          const st = JSON.parse(fs.readFileSync(f, "utf8"));
          if (st.editorPaddingX !== undefined) opts.paddingX = st.editorPaddingX;
          if (st.autocompleteMaxVisible !== undefined) opts.autocompleteMaxVisible = st.autocompleteMaxVisible;
        } catch {
          /* нет файла — значения по умолчанию */
        }
      }
      make = (tui: any, theme: any, kb: any) => new Editor(tui, theme, kb, opts);
    }
    const factory: any = (tui: any, theme: any, kb: any) => {
      this.tuiRef = tui;
      const ed = make(tui, theme, kb);
      const orig = ed.render.bind(ed);
      ed.render = (width: number) => this.sideRender(orig, width);
      // корневые контейнеры появляются после монтирования редактора
      setTimeout(() => {
        try {
          this.a.display.dockReady = this.installDock(tui, ed);
          if (this.a.display.dockReady) this.showDock();
        } catch {
          this.a.display.dockReady = false; // не вышло — работаем в compact
        }
        tui.requestRender?.();
      }, 0);
      return ed;
    };
    factory.__buddyBase = base ?? null;
    ctx.ui.setEditorComponent(factory);
    this.a.display.sideReady = true;
  }
}

/** Предмет поверх кадра: у земли, в ближайшем свободном месте справа; мячик подпрыгивает */
export function withItem(grid: string[], it: PxItem, t: number): string[] {
  const h = it.art.length;
  const w = Math.max(...it.art.map((r) => r.length));
  const free = (x: number) => {
    for (let y = 16 - h; y < 16; y++) for (let i = 0; i < w; i++) if ((grid[y]?.[x + i] ?? ".") !== ".") return false;
    return true;
  };
  let x0 = PX_W - w;
  for (let x = PX_W - w; x >= 0; x--) if (free(x)) { x0 = x; break; }
  const up = it.mode === "toss" ? [0, 2, 3, 2][t % 4] : 0;
  const out = grid.map((r) => r.padEnd(PX_W, ".").split(""));
  it.art.forEach((row, i) => {
    const y = 16 - h + i - up;
    if (y >= 0) [...row].forEach((c, j) => { if (c !== "." && x0 + j < PX_W) out[y][x0 + j] = c; });
  });
  return out.map((r) => r.join(""));
}

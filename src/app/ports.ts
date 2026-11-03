/** Порты: что приложению нужно от внешнего мира (файлы, часы, экран, окружение) */
import type { BuddyState, PxMode } from "../domain/types.ts";

/** Общее состояние питомца (~/.pi/agent/buddy.json) */
export interface PetStore {
  read(): BuddyState | null;
  write(s: BuddyState): void;
  /** Прочитать и записать под одной блокировкой. Ошибка означает, что сохранение не подтверждено. */
  update(change: (disk: BuddyState | null) => BuddyState): BuddyState;
}

/** Свои и выученные фразы (~/.pi/agent/buddy-phrases.json). read() бросает, если файла нет */
export interface PhraseStore {
  readonly path: string;
  read(): any;
  write(file: any): void;
  exists(): boolean;
}

/** status.json фонового запуска pi-subagents */
export interface RunStatusReader {
  read(dir: string): any | null;
}

export interface Clock {
  now(): number;
  rng(): number;
}

/** Окружение процесса */
export interface Env {
  version?: string;
  user(): string;
  host(): string;
  argv: string[];
  idleSleepMs: number;
  autoPxMode(): PxMode;
}

/** Таймер анимации и отложенные действия */
export interface Scheduler {
  startTimer(): void;
  later(fn: () => void, ms: number): void;
}

/** Экран: перерисовать питомца */
export interface View {
  render(): void;
}

/** Диалоги pi */
export interface Ui {
  notify(msg: string, level: "info" | "warning" | "error"): void;
  select?(title: string, opts: string[]): Promise<string | undefined>;
  confirm?(title: string, msg: string): Promise<boolean>;
  theme?: any;
}

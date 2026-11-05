/** Файлы в ~/.pi/agent: состояние питомца, свои фразы; status.json фоновых субагентов */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BuddyError } from "../../app/errors.ts";
import type { PetStore, PhraseStore, RunStatusReader } from "../../app/ports.ts";
import type { BuddyState } from "../../domain/types.ts";

const agentDir = () => path.join(os.homedir(), ".pi", "agent");

/** ~/.pi/agent/buddy.json — общий для всех терминалов */
export class FilePetStore implements PetStore {
  constructor(
    readonly file = path.join(agentDir(), "buddy.json"),
    private knownSpecies: (key: string) => boolean = () => true,
  ) {}

  read(): BuddyState | null {
    let primaryError: unknown;
    try {
      return this.readFile(this.file);
    } catch (e) {
      primaryError = e;
    }
    try {
      return this.readFile(`${this.file}.bak`);
    } catch (backupError) {
      if (missing(primaryError) && missing(backupError)) return null;
      throw new BuddyError("petRead", this.file, { cause: primaryError });
    }
  }

  private readFile(file: string): BuddyState {
    const st = JSON.parse(fs.readFileSync(file, "utf8"));
    const numeric = ["born", "food", "joy", "energy", "xp", "lastTick", "lastActivity", "toolCalls", "errors"];
    const optionalNumeric = ["generations", "tokensOut", "cleanRuns"];
    if (!st || typeof st !== "object" || Array.isArray(st)
      || typeof st.name !== "string" || typeof st.species !== "string"
      || typeof st.visible !== "boolean" || typeof st.shiny !== "boolean"
      || !["common", "uncommon", "rare", "epic", "legendary"].includes(st.rarity)
      || numeric.some((k) => !Number.isFinite(st[k]) || st[k] < 0)
      || optionalNumeric.some((k) => st[k] !== undefined && (!Number.isFinite(st[k]) || st[k] < 0))) {
      throw new BuddyError("petState", file);
    }
    // Миграция старых видов сохраняет опыт и остальные характеристики.
    if (!this.knownSpecies(st.species) && st.species.startsWith("veo")) st.species = "veo";
    st.language = st.language === undefined ? "ru" : ["auto", "ru", "en"].includes(st.language) ? st.language : "auto";
    return st as BuddyState;
  }

  write(s: BuddyState) {
    this.update(() => s);
  }

  /** Блокировка охватывает чтение, слияние и запись, а не только rename. */
  update(change: (disk: BuddyState | null) => BuddyState): BuddyState {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    try {
      fs.mkdirSync(lock);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      clearDeadLock(lock);
      throw new BuddyError("petBusy", this.file);
    }
    try {
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
      const disk = this.read();
      const next = change(disk);
      // Сначала оставляем последнюю читаемую версию, затем публикуем новую.
      if (disk) this.atomicWrite(`${this.file}.bak`, disk);
      this.atomicWrite(this.file, next);
      return next;
    } finally {
      fs.rmSync(path.join(lock, "owner"), { force: true });
      fs.rmdirSync(lock);
    }
  }

  private atomicWrite(file: string, s: BuddyState) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
      fs.renameSync(tmp, file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
}

function clearDeadLock(lock: string) {
  // После аварийного завершения PID больше не существует. При живом владельце ждём
  // следующего checkpoint; неизвестные блокировки не удаляем.
  try {
    const before = fs.lstatSync(lock);
    let pid: number;
    try {
      pid = Number(fs.readFileSync(path.join(lock, "owner"), "utf8"));
    } catch (e) {
      // Процесс мог упасть между mkdir и записью PID. Свежую пустую папку не трогаем.
      if (!missing(e) || Date.now() - before.mtimeMs < 30_000) return;
      pid = 0;
    }
    if (pid !== 0) {
      if (!Number.isSafeInteger(pid) || pid < 0) return;
      try {
        process.kill(pid, 0);
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") return;
      }
    }
    const after = fs.lstatSync(lock);
    if (before.ino === after.ino && before.dev === after.dev) {
      fs.rmSync(path.join(lock, "owner"), { force: true });
      fs.rmdirSync(lock);
    }
  } catch {
    // Владелец мог уже освободить блокировку.
  }
}

function missing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * ~/.pi/agent/buddy-phrases.json, например
 *  { "done": ["моя фраза"], "veo": { "hello": ["..."] } }
 * Дополняют встроенные, применяются после /reload (выученные — сразу).
 */
export class FilePhraseStore implements PhraseStore {
  constructor(readonly file = path.join(agentDir(), "buddy-phrases.json")) {}
  get path() {
    return this.file;
  }
  read(): any {
    return JSON.parse(fs.readFileSync(this.file, "utf8"));
  }
  write(data: any) {
    this.update(() => data);
  }
  update(change: (file: unknown) => unknown): unknown {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    // A contending writer gets an explicit error instead of silently losing phrases.
    try { fs.mkdirSync(lock); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      clearDeadLock(lock);
      throw new BuddyError("phrasesBusy", this.file);
    }
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
      const raw = this.exists() ? this.read() : {};
      const next = change(raw);
      if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.version === undefined && this.exists()) {
        try { fs.copyFileSync(this.file, `${this.file}.bak`, fs.constants.COPYFILE_EXCL); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      }
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, this.file);
      return next;
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(path.join(lock, "owner"), { force: true });
      fs.rmdirSync(lock);
    }
  }
  exists() {
    return fs.existsSync(this.file);
  }
}

/** status.json фонового запуска pi-subagents */
export class FileRunStatus implements RunStatusReader {
  read(dir: string): any | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
    } catch {
      return null;
    }
  }
}

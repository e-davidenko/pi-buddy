import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { FilePetStore } from "../src/adapters/storage/files.ts";
import { hatch } from "../src/domain/rules.ts";
import { NAMES, RARITY_WEIGHTS, SPECIES } from "../src/content/species.ts";

function setup(t: { after(fn: () => void): void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-buddy-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "buddy.json");
  const store = new FilePetStore(file, (k) => !!SPECIES[k]);
  const pet = hatch("test", Date.now(), SPECIES, RARITY_WEIGHTS, NAMES);
  return { dir, file, store, pet };
}

test("только отсутствие обоих файлов означает первого питомца", (t) => {
  const { file, store } = setup(t);
  assert.equal(store.read(), null);
  fs.writeFileSync(file, "{broken");
  assert.throws(() => store.read(), /резервную копию/);
});

test("повреждённый или отсутствующий основной файл восстанавливается из backup", (t) => {
  const { file, store, pet } = setup(t);
  store.write({ ...pet, xp: 100 });
  store.write({ ...pet, xp: 110 });
  fs.writeFileSync(file, "{broken");
  assert.equal(store.read()!.xp, 100);
  store.update((disk) => ({ ...disk!, xp: disk!.xp + 5 }));
  assert.equal(store.read()!.xp, 105);
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")).xp, 100);
  fs.unlinkSync(file);
  assert.equal(store.read()!.xp, 100);
});

test("валидный JSON с неверной структурой не превращается в нового питомца", (t) => {
  const { file, store, pet } = setup(t);
  for (const invalid of [null, [], {}, { ...pet, xp: "100" }, { ...pet, xp: -1 }, { ...pet, tokensOut: "10" }]) {
    fs.writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => store.read());
  }
});

test("старый вид ВЕО мигрирует с сохранением XP", (t) => {
  const { file, store, pet } = setup(t);
  fs.writeFileSync(file, JSON.stringify({ ...pet, species: "veo_retired", xp: 1000 }));
  assert.equal(store.read()!.species, "veo");
  assert.equal(store.read()!.xp, 1000);
});

test("ошибка записи видна вызывающему коду и освобождает блокировку", (t) => {
  const { file, store, pet } = setup(t);
  store.write(pet);
  fs.mkdirSync(`${file}.${process.pid}.tmp`);
  assert.throws(() => store.write({ ...pet, xp: 100 }));
  assert.equal(store.read()!.xp, 0);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test("блокировка охватывает всё обновление и не пропускает второго писателя", (t) => {
  const { store, file, pet } = setup(t);
  store.write(pet);
  const second = new FilePetStore(file);
  store.update((disk) => {
    assert.throws(() => second.write({ ...pet, xp: 100 }), /занят/);
    return { ...disk!, xp: 10 };
  });
  assert.equal(store.read()!.xp, 10);
  second.update((disk) => ({ ...disk!, xp: disk!.xp + 20 }));
  assert.equal(store.read()!.xp, 30);
});

test("ошибка сценария обновления не оставляет блокировку", (t) => {
  const { store, pet } = setup(t);
  assert.throws(() => store.update(() => { throw new Error("scenario failed"); }), /scenario failed/);
  store.write(pet);
  assert.equal(store.read()!.xp, 0);
});

test("забытая блокировка после завершения процесса освобождается для повторной попытки", async (t) => {
  const { file, store, pet } = setup(t);
  store.write(pet);
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    fs.mkdirSync(process.argv[1]);
    fs.writeFileSync(path.join(process.argv[1], 'owner'), String(process.pid));
  `;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, `${file}.lock`]);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  });
  assert.throws(() => store.write({ ...pet, xp: 100 }), /занят/);
  store.write({ ...pet, xp: 100 });
  assert.equal(store.read()!.xp, 100);
});

test("свежая блокировка без PID занята, старая пустая блокировка восстанавливается", (t) => {
  const { file, store, pet } = setup(t);
  fs.mkdirSync(`${file}.lock`);
  assert.throws(() => store.write(pet), /занят/);
  assert.equal(fs.existsSync(`${file}.lock`), true);
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(`${file}.lock`, past, past);
  assert.throws(() => store.write(pet), /занят/);
  store.write(pet);
  assert.equal(store.read()!.xp, 0);
});

test("несколько процессов сохраняют все приращения опыта", async (t) => {
  const { file, store, pet } = setup(t);
  store.write(pet);
  const moduleUrl = new URL("../src/adapters/storage/files.ts", import.meta.url).href;
  const script = `
    import { FilePetStore } from ${JSON.stringify(moduleUrl)};
    import { setTimeout } from 'node:timers/promises';
    const store = new FilePetStore(process.argv[1]);
    for (let n = 0, attempts = 0; n < 30; attempts++) {
      if (attempts > 1000) throw new Error('lock retry limit');
      try {
        store.update(disk => ({ ...disk, xp: disk.xp + 1 }));
        n++;
      } catch (e) {
        if (!e.message.includes('занят')) throw e;
        await setTimeout(2);
      }
    }
  `;
  await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", script, file]);
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  assert.equal(store.read()!.xp, 120);
});

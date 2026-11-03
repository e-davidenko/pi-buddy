// Curated behavioral mutations; run in a disposable copy, never in the working tree.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const sandbox = mkdtempSync(join(tmpdir(), 'pi-buddy-mutations-'));
for (const path of ['src', 'test', 'package.json']) cpSync(join(root, path), join(sandbox, path), { recursive: true });
symlinkSync(join(root, 'node_modules'), join(sandbox, 'node_modules'), 'dir');
const tests = readdirSync(join(sandbox, 'test')).filter(x => x.endsWith('.test.ts')).map(x => `test/${x}`);
const run = () => spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], { cwd: sandbox, encoding: 'utf8', timeout: 15000, maxBuffer: 4e6 });
const baseline = run();
if (baseline.status !== 0) throw new Error(`Baseline failed: ${baseline.stdout}\n${baseline.stderr}`);
const mutations = [];
function add(file, from, to) { mutations.push({ file: `src/${file}.ts`, from, to }); }
const rules = [
 ['Math.min(100, v)', 'Math.min(99, v)'],
 ['Math.floor(Math.sqrt(xp / 10))', 'Math.ceil(Math.sqrt(xp / 10))'],
 ['level(xp) >= GROW_LEVEL', 'level(xp) > GROW_LEVEL'],
 ['if (x < acc)', 'if (x <= acc)'],
 ['(h >>> 24) % 100 === 0', 'false'],
 ['if (hours <= 0) return;', 'if (false) return;'],
 ['clamp(base + (v - base) * Math.exp(-hours / tau))', 'clamp(base + (v - base) * Math.exp(-hours * tau))'],
 ['s.lastTick = now;', 's.lastTick = s.lastTick;'],
 ['disk.born !== base.born', 'disk.born === base.born'],
 ['Math.max(local, (disk[k] ?? 0) + Math.max(0, local - (base[k] ?? 0)))', '(disk[k] ?? 0) + Math.max(0, local - (base[k] ?? 0))'],
 ['dg[k] + (mine[k] - bg[k])', 'dg[k] - (mine[k] - bg[k])'],
 ['if (dirty.has(k))', 'if (!dirty.has(k))'],
 ['hadErrors ? 0 : streak + 1', 'hadErrors ? streak : streak + 1'],
 ['Math.max(disk.lastActivity ?? 0, mine.lastActivity ?? 0)', 'Math.min(disk.lastActivity ?? 0, mine.lastActivity ?? 0)'],
 ['Math.min(GAIN.tokFoodMax, out * GAIN.tokFood)', 'out * GAIN.tokFood'],
 ['s.energy + GAIN.genEnergy', 's.energy - GAIN.genEnergy'],
 ['Math.floor(out * GAIN.tokXp)', 'Math.ceil(out * GAIN.tokXp)'],
 ['s.toolCalls++;', 's.toolCalls += 0;'],
 ['s.xp += GAIN.toolXp;', 's.xp += 0;'],
 ['s.energy + GAIN.toolEnergy', 's.energy - GAIN.toolEnergy'],
 ['s.joy + GAIN.toolJoy', 's.joy - GAIN.toolJoy'],
 ['s.errors++;', 's.errors += 0;'],
 ['s.joy + GAIN.errJoy', 's.joy - GAIN.errJoy'],
 ['s.toolCalls += tools;', 's.toolCalls += 0;'],
 ['gens * GAIN.genXp + tools * GAIN.toolXp', 'gens * GAIN.genXp - tools * GAIN.toolXp'],
];
for (const pair of rules) add('domain/rules', ...pair);
for (const [from, to] of [
 ['i.now < i.tempUntil', 'i.now <= i.tempUntil'], ['if (i.working)', 'if (!i.working)'],
 ['i.energy < 10', 'i.energy <= 10'], ['!i.herding()', 'i.herding()'],
 ['i.joy < 30', 'i.joy <= 30'], ['i.joy > 80', 'i.joy >= 80'],
 ['i.food > 60', 'i.food >= 60'], ['>= i.idleSleepMs', '> i.idleSleepMs'],
 ['>= REST_AFTER_MS', '> REST_AFTER_MS'],
]) add('domain/mood', from, to);
for (const [from, to] of [
 ['s().food > 95', 's().food >= 95'], ['s().food + 30', 's().food - 30'],
 ['s().joy + 15', 's().joy - 15'], ['s().energy < 15', 's().energy <= 15'],
 ['s().energy - 15', 's().energy + 15'], ['s().energy + 40', 's().energy - 40'],
 ['s().rarity = SPECIES[key].rarity;', 's().rarity = s().rarity;'],
 ['s().muted = true;', 's().muted = false;'], ['.slice(0, 20)', '.slice(0, 21)'],
 ['if (!ok) {', 'if (ok) {'], ['app.sync();', '// removed save'],
]) add('app/commands', from, to);
for (const [from, to] of [
 ['if (this.headless) return;', 'if (false) return;'],
 ['this.dirty.clear();\n        this.runEnds = [];', '// retain dirty\n        this.runEnds = [];'], ['this.base = { ...disk };', 'this.base = { ...this.s };'],
 ['onGeneration(this.s, out);', '// skip generation'],
 ['onToolError(this.s);', '// skip error'], ['this.runErrors++;\n      this.errRow++;', 'this.runErrors += 0;\n      this.errRow++;'],
 ['if (n % ticks(30_000) === 0) this.sync();', 'if (false) this.sync();'],
]) add('app/buddy', from, to);

// Regressions in the newly agreed behavior.
add('domain/rules', 'errJoy: -10', 'errJoy: -4');
add('domain/rules', 'if (!hadErrors) s.joy', 'if (true) s.joy');
add('domain/rules', '(ok ? GAIN.runJoy : GAIN.errJoy)', '(ok ? GAIN.errJoy : GAIN.runJoy)');
add('app/commands', 's().food = clamp(s().food - 5);', 's().food = clamp(s().food - 5); s().xp += 2;');
add('app/commands', '(app.s as any)[key] = previous[key];', '(app.s as any)[key] = undefined;');
add('app/buddy', 'if (this.tempMood === "sleep")', 'if (false)');
add('app/buddy', 'this.s = saved;', 'Object.assign(this.s, saved);');
add('app/buddy', 'this.runEnds.push(hadErrors);', '// lose pending outcome');
add('domain/pack', 'ok = ok && [...pack.runs.values()].every((r) => r.ok !== false) && !pack.pups.some((p) => p.status === "err");', 'ok = ok;');

// Validate all targets before starting the expensive run.
for (const mutation of mutations) {
 const original = readFileSync(join(sandbox, mutation.file), 'utf8');
 const offset = original.indexOf(mutation.from);
 if (offset < 0 || original.indexOf(mutation.from, offset + 1) >= 0) throw new Error(`Nonunique mutation: ${mutation.from}`);
}
const results = [];
for (const [index, mutation] of mutations.entries()) {
 const path = join(sandbox, mutation.file);
 const original = readFileSync(path, 'utf8');
 const offset = original.indexOf(mutation.from);
 if (offset < 0 || original.indexOf(mutation.from, offset + 1) >= 0) throw new Error(`Nonunique mutation: ${mutation.from}`);
 const line = original.slice(0, offset).split('\n').length;
 let result;
 try { writeFileSync(path, original.replace(mutation.from, mutation.to)); result = run(); }
 finally { writeFileSync(path, original); }
 const output = `${result.stdout}\n${result.stderr}`;
 const status = result.error ? 'error' : result.status === 0 ? 'survived' : /not ok \d/.test(output) && !/ERR_TEST_FAILURE|TransformError|SyntaxError/.test(result.stderr) ? 'killed' : 'error';
 results.push({ ...mutation, line, status, failures: output.split('\n').filter(x => x.startsWith('not ok ')), ...(status === 'error' ? { output } : {}) });
 console.log(`${index + 1}/${mutations.length} ${status}: ${mutation.file}:${line} ${mutation.from} -> ${mutation.to}`);
}
const counts = Object.fromEntries(['killed', 'survived', 'error'].map(s => [s, results.filter(r => r.status === s).length]));
const report = { scope: 'Curated mutations in rules, mood, commands, buddy and pack; not an exhaustive mutation score', sandbox, counts, results };
writeFileSync(join(root, 'mutation-report.json'), JSON.stringify(report, null, 2) + '\n');
const markdown = [
 '# Проверка устойчивости тестов к мутациям', '',
 `Выборочная проверка: ${results.length} поведенческая мутация в rules, mood, commands, buddy и pack.`,
 'Каждый мутант запускается отдельно со всеми тестами в изолированной временной копии.', '',
 `Обнаружены: **${counts.killed}**. Выжили: **${counts.survived}**. Ошибки запуска: **${counts.error}**.`, '',
 'Это результат заранее выбранной выборки, а не полный mutation score проекта.',
 'Первоначально тесты обнаруживали 16 из 52 мутаций. После согласования поведения изменившиеся цели обновлены, добавлены проверки новых правил; выборки не полностью идентичны.', '',
 'Согласованные правила: [docs/behavior.md](docs/behavior.md).', '',
 'Повторный запуск: `node scripts/mutation-check.mjs`.',
 'Полный список мутаций и упавших тестов: [mutation-report.json](mutation-report.json).', '',
 '## Выжившие мутации', '',
 ...results.filter(r => r.status === 'survived').map(r => `- ${r.file}:${r.line}: ${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}`),
 ...(counts.survived ? [] : ['Нет.']), '',
];
writeFileSync(join(root, 'mutation-report.md'), markdown.join('\n'));

console.log(JSON.stringify(counts));
if (counts.error) process.exitCode = 1;

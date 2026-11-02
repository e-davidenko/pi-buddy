/**
 * pi-buddy — тамагочи для pi coding agent (по мотивам /buddy из Claude Code).
 *
 * Команды:
 *   /buddy              показать/спрятать
 *   /buddy feed|pet|play|nap
 *   /buddy choose [вид]  выбрать питомца (без аргумента — меню)
 *   /buddy name <имя>
 *   /buddy side|top     сбоку от поля ввода (по умолчанию) или виджетом сверху
 *   /buddy dock         полный арт в полосе справа, ничего не сдвигается (по умолчанию)
 *   /buddy compact|big  мини-мордочка без потери ширины / большой арт с ростом поля ввода
 *   /buddy mute|unmute  выключить/включить болтовню
 *   /buddy pxcolor fg|bg|auto  как красить пиксельного питомца (fg — для терминала IntelliJ)
 *   /buddy anim on|off|auto  анимация; auto — в простое не пишет в терминал вне fullscreen
 *   /buddy bark (голос)  подать голос
 *   /buddy learn [тема|пожелание]  модель pi придумает новые фразы (сохраняются в buddy-phrases.json)
 *   /buddy phrases      создать файл со своими фразами
 *   В чате: «добавь Сальсе фраз про Kafka» — агент сам вызовет инструмент buddy_phrases
 *   /buddy stats
 *   /buddy hatch        вылупить нового (сброс!)
 *
 * Код — в ../src (pi загружает TypeScript сам, сборка не нужна).
 */
export { default } from "../src/index.ts";

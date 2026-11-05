# Pet behavior

[Русский](behavior.ru.md) · English

These rules are covered by domain and application tests.

## Care

All meters are clamped to 0–100. Time gradually returns food and joy to 60 and energy to 100, with time constants of 3, 2 and 1 hours respectively. Tick frequency does not affect the result; time moving backward does not change the state.

| Command | Effect |
|---|---|
| feed | Food +30, energy +5; refused when food is above 95 |
| pet | Joy +15 |
| play | Joy +25, energy −15, food −5; refused below 15 energy |
| nap | Energy +40 immediately; temporary sleep reaction for 8 seconds |

Care has no cooldown and gives no XP. Starting agent work interrupts temporary sleep and keeps the restored energy.

## Agent work

- Generation: XP +2 and +1 per full thousand output tokens; food +5 plus min(8, tokens / 400); energy −1.5.
- Tool call: counter +1, XP +1, energy −0.4 regardless of outcome.
- Successful tool: joy +1.5. Failed tool: errors +1, joy −10.
- Successful request completion: joy +4 and success streak +1. Errors reset the streak without another bonus or penalty.
- Pack return: XP +2 per generation and +1 per tool regardless of outcome. A successful return gives +4 joy; a failed return costs 10 joy once for the entire pack. Individual subagent and launcher errors are not penalized again. Any failed background run makes the entire pack return unsuccessful.
- The parent session saves subagent progress; headless children do not modify shared state.

## Mood

Rapid tool calls queue activity poses; each is displayed for at least five seconds.

Priority: temporary reaction → work → sleep → sadness → happiness → idle. Temporary reactions also apply while working; starting work clears only temporary sleep.

- Energy below 10 causes sleep; joy below 30 causes sadness.
- Joy above 80 and food above 60 cause happiness.
- After 3 idle minutes the pet lies down; after 10 it sleeps, exactly at the threshold. Configure the sleep threshold with `PI_BUDDY_IDLE_SLEEP_MS`.
- An active pack prevents idle sleep, but exhaustion can still put the pet to sleep.
- Temporary reactions expire exactly at their deadline.

## Choosing and hatching

`choose` changes species and its rarity, preserving name, XP, age, meters, counters and shiny status. Adult artwork, where available, starts at level 5.

`hatch` creates a new name, rarity and shiny status, resets XP and counters, and starts food and joy at 80 and energy at 100. Visibility, placement, size, animation, mute, pixel color and language are preserved. Confirmation is required; without a dialog, enter `/buddy hatch confirm`. Canceling changes nothing.

## Multiple terminals

XP and counters merge without double counting. Meters merge as deltas with elapsed time accounted for. The latest activity timestamp wins. Each terminal writes only the settings it changed; concurrent edits of the same setting use the last successful write.

The success streak is shared: request outcomes are applied in successful save order. Failed writes leave outcomes in memory for retry; reads do not acknowledge them. A new egg replaces the pet across all terminals and discards unsaved progress and settings belonging to the old pet.

## Language and phrases

The shared `language` setting is `ru`, `en` or `auto`. Existing states without it keep `ru`; new pets start with `auto`. Auto resolves independently from each terminal's locale. Changing language preserves pet progress and clears transient speech and toy scenes.

Custom phrases are stored per language and species. Legacy custom files belong to Russian. Learning captures language and species before calling the model; a later language or species change does not redirect the result to a different set. Phrase writes use an exclusive lock and atomic file replacement; a busy writer reports an error so the command can be retried.

# Localization maintenance

The initial supported locales are `ru` and `en`. Use `/buddy lang ru|en|auto` to switch; `/buddy lang` reports both the setting and resolved locale.

## Catalogs and boundaries

- `src/content/locales/ui.ts`: complete UI sentences, typed keys and named parameters. `ru` defines the parameter contract; `en` must provide the same keys and placeholders.
- `src/content/locales/en.ts`: English common speech, species-specific speech, voices, pack captions, toys, names and model topic hints.
- Existing `src/content/phrases.ts`, `species.ts`, `items.ts`, `zooWork.ts` and `topicHints.ts`: Russian content. Sprite data is shared.
- `src/app/localization.ts`: locale resolution, catalog composition, plurals and display labels. Domain speech receives ready-to-use pools through its environment; it never reads locale files or process variables.
- `src/domain/topics.ts`: language-neutral validation errors. The application translates their codes for display.

Translate whole sentences. Keep placeholders unchanged. Use `Intl.PluralRules` for quantities with grammatical forms, and `Intl.NumberFormat` for formatted numbers. Do not translate stable command, topic, species, toy, mode, tool or pose IDs.

## Speech

Keep each phrase under 35 visible graphemes, excluding the optional `@pose:` prefix. Topic pose constraints are in `TOPIC_POSES`; all built-in phrases are checked in tests. Favor short, natural lines that fit two terminal rows. Preserve species character without introducing another animal's anatomy.

Technical topics may mix common and species-specific phrases. `OWN_ONLY` topics use species-specific text when present. Missing English species topics use neutral English common text; Russian text is never mixed into English pools. Tests require the complete UI, common topic set, species labels and toy catalog for supported languages.

## Custom data

Version 2 stores `locales.<locale>.common` and `locales.<locale>.species.<species>`. An unversioned file is Russian. Reading does not rewrite the source. The first edit converts it and backs up the original. Unknown versions and malformed data must not be replaced by templates or generated content.

All read-modify-write operations go through `PhraseStore.update` in file storage. A contending process gets an explicit error and must retry. Generated content is saved against the locale and species captured when the request began.

The tool description is stable English metadata. The current pet language is supplied to pi at `before_agent_start`; `buddy_phrases` resolves its optional `locale` at execution. No tool re-registration is required after switching language. The command's registered description is bilingual; its completions and responses are resolved at use time.

## Adding a locale

1. Add the locale to the `Locale`/`Language` types and language command/tool options.
2. Add a complete UI and speech/content catalog, register it in the application resolver and define environment normalization and fallback behavior.
3. Extend custom-file locale validation and model output-language instructions; keep old file versions readable.
4. Add plural forms, documentation and catalog coverage tests.
5. Run `npm test`, `npm run typecheck`, and `npm pack --dry-run`.
6. Inspect real terminal output in dock, compact, big and top modes, including narrow widths and names with combining marks or emoji.

Pi's width functions are used when installed; fallback rendering measures graphemes and common wide characters. Safe Unicode width handling alone does not constitute CJK or RTL localization support. Those languages need dedicated line-breaking, direction and terminal checks.

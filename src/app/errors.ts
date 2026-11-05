/** Errors crossing a port carry a stable code; the UI chooses the language. */
import type { Locale } from "../domain/types.ts";
import { message } from "../content/locales/ui.ts";
export type ErrorCode = "petRead" | "petState" | "petBusy" | "phrasesBusy" | "phraseFile" | "phraseTopics" | "phraseVersion" | "phraseLocale" | "phraseTopic" | "phraseKey";
export class BuddyError extends Error {
  constructor(readonly code: ErrorCode, readonly detail = "", options?: ErrorOptions) {
    super(message("ru", code, { detail }), options);
  }
}
export function errorText(error: unknown, locale: Locale): string {
  return error instanceof BuddyError ? message(locale, error.code, { detail: error.detail })
    : error instanceof Error ? error.message : String(error);
}

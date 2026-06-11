// Lightweight i18n: a reactive `i18n.t(key, params?)` whose active locale comes
// from `app.settings.language` ("system" → the device language) and falls back
// to English. No external dependency; adding a locale is one file + one line.
// See docs/i18n.md.

import { app } from "$lib/state/app.svelte";
import { en, type MessageKey } from "./locales/en";
import { es } from "./locales/es";

const dictionaries: Record<string, Record<MessageKey, string>> = { en, es };

/** Locales offered in the language picker. */
export const LOCALES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
] as const;

function detectDeviceLocale(): string {
  const lang = typeof navigator !== "undefined" ? navigator.language : "en";
  const code = lang.slice(0, 2).toLowerCase();
  return code in dictionaries ? code : "en";
}

class I18n {
  /** Active locale code, from the setting ("system" → device) or English. */
  get locale(): string {
    const setting = app.settings.language;
    if (setting && setting !== "system") {
      return setting in dictionaries ? setting : "en";
    }
    return detectDeviceLocale();
  }

  /** Translate a key, interpolating `{name}`-style params. Unknown keys fall
   *  back to English, then to the key itself. */
  t(key: MessageKey, params?: Record<string, string | number>): string {
    const dict = dictionaries[this.locale] ?? en;
    let message: string = dict[key] ?? en[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        message = message.split(`{${name}}`).join(String(value));
      }
    }
    return message;
  }

  /** Pick singular/plural by `n` and interpolate `{n}`. */
  plural(n: number, one: MessageKey, other: MessageKey): string {
    return this.t(n === 1 ? one : other, { n });
  }
}

/** Singleton translator. Reading `i18n.t(...)` in a component is reactive to the
 *  language setting (it reads `app.settings.language`). */
export const i18n = new I18n();

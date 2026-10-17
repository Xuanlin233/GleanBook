// Interface language. Source strings are the Simplified Chinese text itself, so the code
// reads as before and needs no key names: tr('总览') looks the text up in the active
// language's file (src/locales/*.ts) and falls back to the Chinese when there is no entry.
// Placeholders use {name}: tr('{n} 条待同步', { n: 3 }).
// The language is chosen once per page load (Settings → language reloads the page), so
// module-level labels such as category names follow it too. Node (tests, the server) and
// browsers without storage always get Chinese unless GLEANBOOK_LANG says otherwise.
import { en } from './locales/en';

export const languages = { 'zh-CN': '简体中文', en: 'English' } as const;
export type Language = keyof typeof languages;
const dictionaries: Record<Language, Record<string, string> | null> = { 'zh-CN': null, en };
const STORAGE_KEY = 'gleanbook-language';

function detect(): Language {
  // Node also has a global navigator, so tell browsers apart by window.
  if (typeof window === 'undefined') {
    const env = typeof process !== 'undefined' ? process.env?.GLEANBOOK_LANG : undefined;
    return env && env in languages ? (env as Language) : 'zh-CN';
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in languages) return saved as Language;
  } catch {
    /* no storage (Node, private mode) */
  }
  return /^zh\b/i.test(navigator.language || 'zh') ? 'zh-CN' : 'en';
}

export const language: Language = detect();
// BCP 47 tag for Intl date and number formatting.
export const locale = language === 'en' ? 'en-US' : 'zh-CN';
const dictionary = dictionaries[language];

if (typeof document !== 'undefined') document.documentElement.lang = locale;

export function tr(text: string, vars?: Record<string, string | number | undefined>): string {
  const out = dictionary?.[text] ?? text;
  return vars
    ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
    : out;
}

export function setLanguage(next: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* the choice then lasts only for this page */
  }
  location.reload();
}

// "5 月" in Chinese, "May" in English, for a "YYYY-MM" month.
export function monthLabel(month: string) {
  const m = Number(month.slice(5, 7));
  return language === 'en'
    ? new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
        Date.UTC(2000, m - 1, 1),
      )
    : `${m} 月`; // i18n-ignore
}

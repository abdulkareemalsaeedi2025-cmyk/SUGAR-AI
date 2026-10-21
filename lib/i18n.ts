/**
 * Minimal bilingual (Arabic first / English) helpers.
 *
 * The dashboard is Arabic-first: every user-facing string defaults to Arabic
 * and renders an English variant when the header toggle is set to EN. This
 * module only holds tiny shared helpers; each component picks its own strings
 * via `pick()` or a local AR/EN dictionary.
 */

export type Lang = 'ar' | 'en';

/** localStorage key for the persisted UI language. */
export const LANG_STORE_KEY = 'ui-lang-v1';

/** Pick the variant for the active language. */
export const pick = <T,>(lang: Lang, ar: T, en: T): T => (lang === 'en' ? en : ar);

/** Relative "x ago" label from an already-rounded number of seconds. */
export function ago(lang: Lang, sec: number): string {
  if (sec < 2) return lang === 'ar' ? 'الآن' : 'now';
  if (sec < 60) return lang === 'ar' ? `قبل ${sec} ث` : `${sec}s ago`;
  if (sec < 3600) return lang === 'ar' ? `قبل ${Math.round(sec / 60)} د` : `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return lang === 'ar' ? `قبل ${Math.round(sec / 3600)} س` : `${Math.round(sec / 3600)}h ago`;
  return lang === 'ar' ? `قبل ${Math.round(sec / 86400)} ي` : `${Math.round(sec / 86400)}d ago`;
}

/** Days-ago label for snapshot stamps (0 = today). */
export function daysAgo(lang: Lang, days: number): string {
  if (days <= 0) return lang === 'ar' ? 'اليوم' : 'today';
  if (days === 1) return lang === 'ar' ? 'قبل يوم' : '1 day ago';
  return lang === 'ar' ? `قبل ${days} أيام` : `${days} days ago`;
}
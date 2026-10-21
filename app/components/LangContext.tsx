'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LANG_STORE_KEY, type Lang } from '../../lib/i18n';

/**
 * Dashboard-wide UI language (Arabic first, English toggle).
 *
 * Mirrors ContractContext: persisted per browser, restored on load. The
 * header toggle calls setLang, and every card reads the current language from
 * here instead of receiving it as a prop.
 */

type LangContextValue = {
  lang: Lang;
  setLang: (l: Lang) => void;
};

const FALLBACK: LangContextValue = { lang: 'ar', setLang: () => {} };

const LangCtx = createContext<LangContextValue>(FALLBACK);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  // Restore the persisted choice (after hydration so SSR HTML stays stable).
  useEffect(() => {
    try {
      const v = localStorage.getItem(LANG_STORE_KEY);
      if (v === 'ar' || v === 'en') setLangState(v);
    } catch {
      /* private mode */
    }
  }, []);

  // Keep the document language/direction in sync with the UI language.
  useEffect(() => {
    try {
      const el = document.documentElement;
      el.lang = lang;
      el.dir = lang === 'ar' ? 'rtl' : 'ltr';
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_STORE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LangContextValue>(() => ({ lang, setLang }), [lang, setLang]);

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangCtx);
}
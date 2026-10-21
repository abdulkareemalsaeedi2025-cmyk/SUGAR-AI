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
import { CENTS_LB_TO_USD_MT } from '../../lib/pricing';

/**
 * Dashboard-wide contract selection.
 *
 * One place decides which Sugar No.11 delivery month is "active"; the price
 * card, the chart and the White Premium read it from here. The White Premium is
 * computed live from the selected No.11 contract against London No.5:
 *
 *   White Premium ($/MT) = London #5 ($/MT) − NY #11 (¢/lb) × 22.0462262
 *
 * Selection is persisted per browser. The default (empty string) means "auto":
 * follow the nearest upcoming contract, which is what a trader wants by default.
 */

export type ContractOption = {
  symbol: string;
  label: string;
  labelAr: string;
  labelEn: string;
  monthsOut: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  near: boolean;
  source?: string;
  sourceUrl?: string;
};

type ContractContextValue = {
  nyOptions: ContractOption[];
  /** '' = auto (nearest contract). */
  nyChoice: string;
  setNyChoice: (symbol: string) => void;
  nyContract: ContractOption | null;
  /** Selected No.11 price in US¢/lb. */
  nyPrice: number | null;
  /** London No.5 price in US$/MT, or null when unavailable. */
  londonPrice: number | null;
  /** London #5 ($/MT) − NY #11 converted ($/MT). */
  whitePremium: number | null;
  snapshotFetchedAt: string | null;
  stale: boolean;
  note: string | null;
  loading: boolean;
  error: string | null;
};

const STORE_KEY = 'contract-selection-v1';

const FALLBACK: ContractContextValue = {
  nyOptions: [],
  nyChoice: '',
  setNyChoice: () => {},
  nyContract: null,
  nyPrice: null,
  londonPrice: null,
  whitePremium: null,
  snapshotFetchedAt: null,
  stale: false,
  note: null,
  loading: true,
  error: null,
};

const ContractCtx = createContext<ContractContextValue>(FALLBACK);

export function ContractProvider({ children }: { children: ReactNode }) {
  const [nyOptions, setNyOptions] = useState<ContractOption[]>([]);
  const [nyChoice, setNyChoiceState] = useState('');
  const [liveNy, setLiveNy] = useState<number | null>(null);
  const [londonPrice, setLondonPrice] = useState<number | null>(null);
  const [snapshotFetchedAt, setSnapshotFetchedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore the pinned contract choice.
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORE_KEY);
      if (v) setNyChoiceState(v);
    } catch {
      /* private mode */
    }
  }, []);

  const setNyChoice = useCallback((symbol: string) => {
    setNyChoiceState(symbol);
    try {
      if (symbol) localStorage.setItem(STORE_KEY, symbol);
      else localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Contract curve.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await fetch('/api/contracts', { cache: 'no-store' }).then((r) => r.json());
        if (!alive) return;
        setNyOptions(Array.isArray(j.ny) ? j.ny : []);
        setSnapshotFetchedAt(j.snapshotFetchedAt ?? null);
        setStale(!!j.stale);
        setNote(j.note ?? null);
        setError(j.ok === false ? j.error ?? 'contracts_unavailable' : null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (alive) setLoading(false);
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Live front-month price (only used in auto mode).
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await fetch('/api/market', { cache: 'no-store' }).then((r) => r.json());
        if (!alive) return;
        const last = j?.contracts?.[0]?.last;
        setLiveNy(typeof last === 'number' ? last : null);
      } catch {
        /* keep previous */
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // London No.5 price.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await fetch('/api/london', { cache: 'no-store' }).then((r) => r.json());
        if (!alive) return;
        setLondonPrice(j.available && j.data?.last != null ? Number(j.data.last) : null);
      } catch {
        /* keep previous */
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const nyContract = useMemo(() => {
    if (!nyOptions.length) return null;
    if (nyChoice) return nyOptions.find((o) => o.symbol === nyChoice) ?? nyOptions[0] ?? null;
    return nyOptions.find((o) => o.near) ?? nyOptions[0] ?? null;
  }, [nyOptions, nyChoice]);

  const nyPrice = useMemo(() => {
    if (!nyContract) return liveNy;
    if (!nyChoice && liveNy != null) return liveNy; // auto → live front month
    return nyContract.last;
  }, [nyContract, nyChoice, liveNy]);

  const whitePremium = useMemo(() => {
    if (nyPrice == null || londonPrice == null) return null;
    return londonPrice - nyPrice * CENTS_LB_TO_USD_MT;
  }, [nyPrice, londonPrice]);

  const value = useMemo<ContractContextValue>(
    () => ({
      nyOptions,
      nyChoice,
      setNyChoice,
      nyContract,
      nyPrice,
      londonPrice,
      whitePremium,
      snapshotFetchedAt,
      stale,
      note,
      loading,
      error,
    }),
    [nyOptions, nyChoice, setNyChoice, nyContract, nyPrice, londonPrice, whitePremium, snapshotFetchedAt, stale, note, loading, error],
  );

  return <ContractCtx.Provider value={value}>{children}</ContractCtx.Provider>;
}

export function useContract(): ContractContextValue {
  return useContext(ContractCtx);
}

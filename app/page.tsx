'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CashChart from './components/CashChart';
import NearContractCard from './components/NearContractCard';
import NextContractCard from './components/NextContractCard';
import LondonSugarCard from './components/LondonSugarCard';
import InventoryHub from './components/InventoryHub';
import VesselTracker from './components/VesselTracker';
import RecommendationCard from './components/RecommendationCard';
import DriversPanel from './components/DriversPanel';
import ReportsDaily from './components/ReportsDaily';
import RefinedPrices from './components/RefinedPrices';
import ChatAssistant from './components/ChatAssistant';
import NewsTicker, { type TickerItem } from './components/NewsTicker';
import ExecutiveSnapshot from './components/ExecutiveSnapshot';
import { ContractProvider, useContract } from './components/ContractContext';
import { LangProvider, useLang } from './components/LangContext';
import { AuthProvider } from './components/AuthContext';
import UserBadge from './components/UserBadge';
// NOTE: PricingLedger (manual lots) hidden for now — may be re-enabled later.
// Vessel pricing (report-fed) lives on in VesselPricingTable.
import VesselPricingTable from './components/VesselPricingTable';
import type { LondonData, LondonFeed } from './components/LondonSugarCard';

type Contract = {
  symbol: string; name: string; label: string; role: 'forward'; available: boolean;
  last: number | null; open: number | null; high: number | null; low: number | null;
  prevClose: number | null; change: number | null; changePct: number | null;
  mode: string; source: string; sourceUrl: string; note: string | null;
};
type Market = {
  updatedAt: string; source: string; mode: string;
  providers: { barchart: boolean; stooq?: boolean; yahoo: boolean };
  note: string | null; snapshotFetchedAt?: string | null;
  contracts: Contract[];
  spreads: { from: string; to: string; value: number | null; pct: number | null }[];
  coverage: { total: number; priced: number };
};

type DriverNews = {
  title: string; titleAr?: string; link: string; source: string; publishedAt: string | null;
  topic: string; topicAr: string; topicEn: string;
};
type DriversFeed = {
  news?: DriverNews[];
  uploads?: { items?: { id: string; text: string; topicAr: string; topicEn: string; file: string }[] } | null;
};

const A = {
  ar: {
    title: 'Smart Sugar AI', sub: 'لوحة موحدة لاتخاذ القرار',
    refresh: 'تحديث', auto: 'تحديث تلقائي', updated: 'آخر تحديث', source: 'المصدر',
    tickerLabel: 'عوامل السكر',
  },
  en: {
    title: 'Smart Sugar AI', sub: 'Single decision dashboard',
    refresh: 'Refresh', auto: 'Auto refresh', updated: 'Updated', source: 'Source',
    tickerLabel: 'Sugar drivers',
  },
};

export default function Page() {
  return (
    <LangProvider>
      <AuthProvider>
        <ContractProvider>
          <Dashboard />
        </ContractProvider>
      </AuthProvider>
    </LangProvider>
  );
}

function Dashboard() {
  const { lang, setLang } = useLang();
  const t = A[lang];
  const { nyPrice: selectedNyPrice } = useContract();
  const [market, setMarket] = useState<Market | null>(null);
  const [last, setLast] = useState('');
  const [feed, setFeed] = useState<DriversFeed | null>(null);
  const [londonFeed, setLondonFeed] = useState<LondonFeed>({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const m = await fetch('/api/market', { cache: 'no-store' }).then((r) => r.json());
      setMarket(m);
      setLast(new Date().toLocaleTimeString(lang === 'ar' ? 'ar-YE' : 'en-US'));
    } catch { /* keep last good snapshot */ }
    try {
      const j = await fetch('/api/london', { cache: 'no-store' }).then((r) => r.json());
      if (j.available && j.data) {
        setLondonFeed({ data: j.data as LondonData, loading: false, error: null });
      } else {
        setLondonFeed((f) => ({ ...f, loading: false, error: j.error || (lang === 'ar' ? 'لا توجد بيانات متاحة' : 'No data available') }));
      }
    } catch (e) {
      setLondonFeed((f) => ({ ...f, loading: false, error: e instanceof Error ? e.message : (lang === 'ar' ? 'فشل الاتصال' : 'Connection failed') }));
    }
  }, [lang]);

  const loadDrivers = useCallback(async () => {
    try {
      const j = await fetch('/api/drivers').then((r) => r.json());
      setFeed({ news: j.news ?? [], uploads: j.uploads ?? null });
    } catch { /* ticker stays on last items */ }
  }, []);

  useEffect(() => {
    load();
    loadDrivers();
    const id = setInterval(load, 60_000);
    const did = setInterval(loadDrivers, 5 * 60_000);
    return () => { clearInterval(id); clearInterval(did); };
  }, [load, loadDrivers]);

  const nyPrice = market?.contracts?.[0]?.last ?? null;

  const tickerItems = useMemo<TickerItem[]>(() => {
    const items: TickerItem[] = [];
    if (nyPrice != null) {
      const c = market?.contracts?.[0];
      items.push({
        id: 'price',
        text: `${c?.label ?? 'Sugar #11'}: ${nyPrice.toFixed(2)}¢/lb`,
        topic: 'ICE', topicAr: 'سعر', source: 'Yahoo',
      });
    }
    const HAZARD = new Set(['weather', 'quake', 'geopolitics', 'shipping']);
    const ranked = [...(feed?.news ?? [])].sort((a, b) => {
      const r = (n: DriverNews) => (HAZARD.has(n.topic) ? 0 : n.topic === 'general' ? 2 : 1);
      return r(a) - r(b);
    });
    ranked.slice(0, 20).forEach((n, i) => {
      items.push({
        id: `n${i}`,
        text: lang === 'ar' ? (n.titleAr ?? n.title) : n.title,
        topic: n.topicEn, topicAr: n.topicAr, source: n.source, href: n.link, origin: 'live',
      });
    });
    (feed?.uploads?.items ?? []).slice(0, 10).forEach((u) => {
      items.push({
        id: u.id, text: u.text,
        topic: u.topicEn, topicAr: u.topicAr, source: u.file, origin: 'upload',
      });
    });
    return items;
  }, [market, nyPrice, feed]);

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="shell">
      <header className="top">
        <div>
          <div className="eyebrow">SMART SUGAR AI · EXECUTIVE DASHBOARD</div>
          <h1>{t.title}</h1>
        </div>
        <div className="actions">
          <UserBadge />
          <button onClick={() => setLang('ar')} className={lang === 'ar' ? 'active' : ''}>عربي</button>
          <button onClick={() => setLang('en')} className={lang === 'en' ? 'active' : ''}>EN</button>
          <button onClick={load}>{t.refresh}</button>
        </div>
      </header>

      {/* Executive decision KPI strip */}
      <ExecutiveSnapshot ny={market?.contracts?.[0] ?? null} london={londonFeed.data} />

      {/* Prices row + raw-sugar chart (chart takes the old S&P500 slot) */}
      <section className="grid-row grid-row--3">
        <div className="grid-stack">
          <NearContractCard />
          <NextContractCard />
        </div>
        <LondonSugarCard nyPrice={selectedNyPrice ?? nyPrice} feed={londonFeed} />
        <CashChart compact />
      </section>

      {/* Inventory + Vessels + Recommendation */}
      <section className="grid-row grid-row--3">
        <InventoryHub />
        <VesselTracker />
        <RecommendationCard />
      </section>

      {/* Pricing ledger — hidden for now (may be re-enabled later) */}

      {/* Vessel pricing — fed from daily reports */}
      <VesselPricingTable />

      {/* Market news & drivers */}
      <DriversPanel />

      {/* Refined sugar prices (pulled from reports) */}
      <RefinedPrices />

      {/* Daily reports — system feed (upload zone at the very bottom) */}
      <ReportsDaily />

      {/* Status + sugar-drivers strips (moved from the header to the bottom) */}
      <section className="statusbar">
        <span className="dot" />
        {t.auto}: 60s · {t.updated}: {last || '—'} · {t.source}: {market?.source || '—'}
        {market?.note ? ` · ${lang === 'ar' ? 'حدّث لقطة العقود: npm run fetch:contracts' : market.note}` : ''}
      </section>

      <NewsTicker items={tickerItems} lang={lang} labelAr={t.tickerLabel} labelEn={t.tickerLabel} />

      <footer>
        <span>Smart Sugar AI — Executive Sugar Market &amp; Procurement Intelligence Platform</span>
        <span>v2.1</span>
      </footer>

      <ChatAssistant />
    </main>
  );
}

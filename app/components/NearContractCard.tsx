'use client';
import { useEffect, useRef, useState } from 'react';
import { useContract } from './ContractContext';
import { useLang } from './LangContext';
import { ago, pick } from '../../lib/i18n';

type Contract = {
  symbol: string;
  labelAr: string;
  labelEn: string;
  monthsOut: number;
  expired: boolean;
  next?: { symbol: string; labelAr: string; labelEn: string } | null;
};
type Point = { t: number; c: number; o?: number | null; h?: number | null; l?: number | null };
type Series = {
  updatedAt?: string;
  stale?: boolean;
  rollHint?: string;
  symbol?: string;
  contract?: Contract;
  last?: number | null;
  change?: number | null;
  changePct?: number | null;
  periodHigh?: number | null;
  periodLow?: number | null;
  prevClose?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  bars?: number;
  granularity?: 'intraday' | 'hourly' | 'daily';
  points?: Point[];
};

export default function NearContractCard({ contractSymbol, customLabel }: { contractSymbol?: string; customLabel?: string }) {
  const { nyChoice } = useContract();
  const { lang } = useLang();
  const [d, setD] = useState<Series | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  // When a fixed symbol is given (e.g. SBK27 May 2027) the card always shows
  // that contract; otherwise it follows the selector / nearest contract.
  const effective = contractSymbol ?? nyChoice;

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const q = effective ? `contract=${encodeURIComponent(effective)}` : 'contract=near';
        const r = await fetch(`/api/series?range=1d&${q}`, { cache: 'no-store', signal: ctl.signal });
        const j = (await r.json()) as Series;
        if (!alive) return;
        setD(j);
        const t = j.updatedAt ? Date.parse(j.updatedAt) : NaN;
        setAge(Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null);
      } catch {
        /* keep last good value */
      }
    };
    pull();
    const id = setInterval(pull, 30_000);
    const tick = setInterval(() => setD((p) => p), 1000);
    return () => { alive = false; clearInterval(id); clearInterval(tick); abort.current?.abort(); };
  }, [effective]);

  useEffect(() => {
    if (!d?.updatedAt) return setAge(null);
    const t = Date.parse(d.updatedAt);
    if (!Number.isFinite(t)) return setAge(null);
    setAge(Math.max(0, Math.round((Date.now() - t) / 1000)));
  }, [d]);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const selectedLabel = pick(lang, 'العقد المحدد', 'Selected contract');
  const nearLabel = pick(lang, 'أقرب عقد قادم', 'Nearest upcoming contract');
  const loadingLabel = pick(lang, 'جارِ التحميل…', 'Loading…');
  const headLabel = customLabel ?? (effective ? selectedLabel : nearLabel);

  if (!d?.contract) {
    return (
      <section className="nearcard nearcard--wait" dir={dir}>
        <div className="nearcard__main">
          <span className="nearcard__label">{headLabel}</span>
          <strong className="nearcard__price">{loadingLabel}</strong>
        </div>
      </section>
    );
  }

  const c = d.contract;
  const up = (d.change ?? 0) >= 0;
  const months = c.monthsOut;

  // One-day OHLC: intraday → first bar open + session max/min; daily → last
  // trade day's own bar. (Never the multi-day period stats — removed per owner.)
  const pts = d.points ?? [];
  let dayOpen: number | null = null, dayHigh: number | null = null, dayLow: number | null = null;
  if (pts.length) {
    if (d.granularity === 'intraday') {
      dayOpen = pts[0].o ?? pts[0].c ?? null;
      dayHigh = Math.max(...pts.map((p) => p.h ?? p.c));
      dayLow = Math.min(...pts.map((p) => p.l ?? p.c));
    } else {
      const b = pts[pts.length - 1];
      dayOpen = b.o ?? b.c ?? null;
      dayHigh = b.h ?? b.c ?? null;
      dayLow = b.l ?? b.c ?? null;
    }
  }

  const monthsTxt = pick(
    lang,
    months <= 0 ? 'تسليم الحالي' : `تسليم خلال ${months} ${months === 1 ? 'شهر' : 'أشهر'}`,
    months <= 0 ? 'Current delivery' : `Delivery in ${months} ${months === 1 ? 'month' : 'months'}`,
  );
  const sinceTxt = pick(lang, 'تغير اليوم', 'today');

  return (
    <section className="nearcard" dir={dir}>
      <div className="nearcard__main">
        <span className="nearcard__label">
          <i className="nearcard__pulse" />
          {headLabel} · Sugar No.11
        </span>
        <div className="nearcard__price">
          {d.last != null ? d.last.toFixed(2) : '—'}
          <small>US¢/lb</small>
        </div>
        <div className="nearcard__delta">
          <b className={up ? 'up' : 'dn'}>
            {d.change != null ? `${up ? '+' : ''}${d.change.toFixed(2)}` : '—'}
            {d.changePct != null ? ` (${up ? '+' : ''}${d.changePct.toFixed(2)}%)` : ''}
          </b>
          <span className="nearcard__since">{sinceTxt}</span>
        </div>
      </div>

      <div className="nearcard__meta">
        <div className="nearcard__month">
          <span className="nearcard__sym">{c.symbol}</span>
          <strong>{pick(lang, c.labelAr, c.labelEn)}</strong>
          <em>{monthsTxt}</em>
        </div>

        <div className="nearcard__ohlc">
          <div><span>{pick(lang, 'الفتح', 'Open')}</span><b>{dayOpen != null ? dayOpen.toFixed(2) : '—'}</b></div>
          <div><span>{pick(lang, 'أعلى', 'High')}</span><b>{dayHigh != null ? dayHigh.toFixed(2) : '—'}</b></div>
          <div><span>{pick(lang, 'أدنى', 'Low')}</span><b>{dayLow != null ? dayLow.toFixed(2) : '—'}</b></div>
          <div><span>{pick(lang, 'إغلاق سابق', 'Prev close')}</span><b>{d.prevClose?.toFixed(2) ?? '—'}</b></div>
        </div>
      </div>

      <div className="nearcard__foot">
        <span className="nearcard__roll">
          {c.expired
            ? pick(lang, 'انتهت كل العقود المتتبعة — شغّل npm run fetch:contracts', 'All tracked contracts expired — run npm run fetch:contracts')
            : c.next
              ? pick(
                  lang,
                  `ينتقل تلقائياً إلى ${c.next.labelAr} (${c.next.symbol}) عند انتهاء ${c.labelAr}`,
                  `Rolls automatically to ${c.next.labelEn} (${c.next.symbol}) when ${c.labelEn} expires`,
                )
              : pick(lang, 'لا يوجد عقد تالٍ في اللقطة الحالية', 'No next contract in the current snapshot')}
        </span>
        <span className="nearcard__age">
          {age != null ? `${pick(lang, 'آخر جلب', 'fetched')} ${ago(lang, age)}` : '—'}
          {d.stale ? pick(lang, ' · بيانات مخزنة', ' · cached data') : ''}
        </span>
      </div>
    </section>
  );
}
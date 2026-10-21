'use client';
import { useEffect, useRef, useState } from 'react';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

const ICE_LONDON_URL = 'https://www.theice.com/products/29696643/White-Sugar-Futures';
const BARCHART_LONDON_URL = 'https://www.barchart.com/futures/quotes/SW*0/futures-prices';

export type LondonData = {
  symbol: string;
  name: string;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  source: string;
  mode: string;
};

export type LondonFeed = {
  data: LondonData | null;
  loading: boolean;
  error: string | null;
};

type Props = {
  nyPrice?: number | null; // Sugar No.11 price in US¢/lb
  /** Shared page-level fetch. When omitted the card fetches on its own. */
  feed?: LondonFeed;
};

export default function LondonSugarCard({ nyPrice, feed }: Props) {
  const { lang } = useLang();
  const [ownData, setOwnData] = useState<LondonData | null>(null);
  const [ownLoading, setOwnLoading] = useState(true);
  const [ownError, setOwnError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const useOwn = feed === undefined;

  useEffect(() => {
    if (!useOwn) return;
    let alive = true;
    const pull = async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const r = await fetch('/api/london', { cache: 'no-store', signal: ctl.signal });
        const j = await r.json();
        if (!alive) return;
        if (j.available && j.data) {
          setOwnData(j.data);
          setOwnError(null);
        } else {
          setOwnError(j.error || pick(lang, 'لا توجد بيانات متاحة', 'No data available'));
        }
      } catch (e) {
        if (alive) setOwnError(e instanceof Error ? e.message : pick(lang, 'فشل الاتصال', 'Connection failed'));
      } finally {
        if (alive) setOwnLoading(false);
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); abort.current?.abort(); };
  }, [useOwn, lang]);

  const data = useOwn ? ownData : feed.data;
  const error = useOwn ? ownError : feed.error;
  const loading = useOwn ? ownLoading : feed.loading;
  void loading;

  const hasPrice = data?.last != null;
  const up = (data?.change ?? 0) >= 0;

  // Calculate White Premium
  // NY No.11 in ¢/lb → convert to $/tonne: multiply by 22.0462
  const nyInTonne = nyPrice != null ? nyPrice * 22.0462 : null;
  const premium = hasPrice && nyInTonne != null && data.last != null ? data.last - nyInTonne : null;

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <div className="london-card" dir={dir}>
      <div className="london-card__head">
        <span className="london-card__label">
          <i className="london-card__pulse" />
          {pick(lang, 'بورصة لندن · Sugar No.5 (White Sugar)', 'London Exchange · Sugar No.5 (White)')}
        </span>
        <div className="london-card__links">
          <a href={ICE_LONDON_URL} target="_blank" rel="noreferrer noopener">ICE ↗</a>
          <a href={BARCHART_LONDON_URL} target="_blank" rel="noreferrer noopener">Barchart ↗</a>
        </div>
      </div>

      {hasPrice ? (
        <>
          <div className="london-card__price">
            {data.last?.toFixed(2)}
            <small>US$/tonne</small>
          </div>
          <div className="london-card__delta">
            <b className={up ? 'up' : 'dn'}>
              {data.change != null ? `${up ? '+' : ''}${data.change.toFixed(2)}` : '—'}
              {data.changePct != null ? ` (${up ? '+' : ''}${data.changePct.toFixed(2)}%)` : ''}
            </b>
            <span className="london-card__since">{(() => {
              const m = data.source.match(/^Derived — live NY \+ report white premium(?: \(([^)]+)\))?/);
              const src = m
                ? pick(lang, `مشتق — NY الحي + بريميوم التقرير${m[1] ? ` (${m[1]})` : ''}`, data.source)
                : data.source;
              const mode = data.mode === 'estimated'
                ? pick(lang, 'تقديري', 'estimated')
                : data.mode === 'delayed'
                  ? pick(lang, 'مؤجل', 'delayed')
                  : data.mode;
              return `${src} · ${mode}`;
            })()}</span>
          </div>
          <div className="london-card__ohlc">
            <div><span>{pick(lang, 'الفتح', 'Open')}</span><b>{data.open?.toFixed(2) ?? '—'}</b></div>
            <div><span>{pick(lang, 'الأعلى', 'High')}</span><b>{data.high?.toFixed(2) ?? '—'}</b></div>
            <div><span>{pick(lang, 'الأدنى', 'Low')}</span><b>{data.low?.toFixed(2) ?? '—'}</b></div>
          </div>

          {premium != null && (
            <div className="london-card__premium">
              <span className="london-card__premium-label">White Premium</span>
              <b className={premium >= 0 ? 'up' : 'dn'}>
                {premium >= 0 ? '+' : ''}{premium.toFixed(2)} US$/tonne
              </b>
              <small>{pick(lang, 'الفارق بين السكر الأبيض والخام', 'White vs raw sugar spread')}</small>
            </div>
          )}
        </>
      ) : (
        <div className="london-card__empty">
          <b>{pick(lang, 'السعر اللحظي غير متاح', 'Live price unavailable')}</b>
          <span>{pick(lang, 'عقود لندن لا تتوفر على البيانات المجانية العامة.', 'London contracts have no public free feed.')}</span>
          <span>{pick(lang, 'لتفعيلها، أضف BARCHART_API_KEY في ملف .env', 'To enable, add BARCHART_API_KEY to .env')}</span>
          <div className="london-card__empty-links">
            <a href={ICE_LONDON_URL} target="_blank" rel="noreferrer noopener">ICE London ↗</a>
            <a href={BARCHART_LONDON_URL} target="_blank" rel="noreferrer noopener">Barchart ↗</a>
          </div>
        </div>
      )}

      {error && hasPrice && <div className="london-card__err">{error}</div>}
    </div>
  );
}
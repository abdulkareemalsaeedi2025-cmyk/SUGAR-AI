'use client';
import { useEffect, useRef, useState } from 'react';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

type SP500Data = {
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
  updatedAt: string;
};

export default function SP500Card() {
  const { lang } = useLang();
  const [data, setData] = useState<SP500Data | null>(null);
  const [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const r = await fetch('/api/sp500', { cache: 'no-store', signal: ctl.signal });
        const j = await r.json();
        if (!alive) return;
        if (j.available) {
          setData(j);
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); abort.current?.abort(); };
  }, []);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const label = pick(lang, 'مؤشر S&P 500', 'S&P 500 Index');
  const pts = pick(lang, 'نقطة', 'pts');

  if (loading || !data?.last) {
    return (
      <div className="sp500-card sp500-card--loading" dir={dir}>
        <span className="sp500-card__label">{label}</span>
        <strong>{pick(lang, 'جارِ التحميل…', 'Loading…')}</strong>
      </div>
    );
  }

  const up = (data.change ?? 0) >= 0;

  return (
    <div className="sp500-card" dir={dir}>
      <div className="sp500-card__head">
        <span className="sp500-card__label">
          <i className="sp500-card__pulse" />
          {label}
        </span>
        <span className="sp500-card__source">{data.source}</span>
      </div>

      <div className="sp500-card__price">
        {data.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <small>{pts}</small>
      </div>

      <div className="sp500-card__delta">
        <b className={up ? 'up' : 'dn'}>
          {data.change != null ? `${up ? '+' : ''}${data.change.toFixed(2)}` : '—'}
          {data.changePct != null ? ` (${up ? '+' : ''}${data.changePct.toFixed(2)}%)` : ''}
        </b>
        <span className="sp500-card__since">{data.mode}</span>
      </div>

      <div className="sp500-card__ohlc">
        <div><span>{pick(lang, 'الفتح', 'Open')}</span><b>{data.open?.toFixed(2) ?? '—'}</b></div>
        <div><span>{pick(lang, 'الأعلى', 'High')}</span><b>{data.high?.toFixed(2) ?? '—'}</b></div>
        <div><span>{pick(lang, 'الأدنى', 'Low')}</span><b>{data.low?.toFixed(2) ?? '—'}</b></div>
      </div>
    </div>
  );
}
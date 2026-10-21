'use client';
import { useCallback, useEffect, useState } from 'react';
import NearContractCard from './NearContractCard';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

/**
 * The contract AFTER the nearest one (May 2027 = SBK27) plus the prominent
 * March–May spread. Both spread legs come from the SAME Stooq snapshot, so
 * the spread is always internally consistent; it refreshes whenever the
 * contracts snapshot refreshes (npm run fetch:contracts / /api/refresh).
 */
type NyContract = { symbol: string; last: number | null; change: number | null; changePct: number | null };
type Feed = {
  snapshotFetchedAt: string | null;
  ny: NyContract[];
};

const MAR = 'SBH27';
const MAY = 'SBK27';

export default function NextContractCard() {
  const { lang } = useLang();
  const [feed, setFeed] = useState<Feed | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/contracts', { cache: 'no-store' }).then((r) => r.json());
      setFeed({ snapshotFetchedAt: j.snapshotFetchedAt ?? null, ny: Array.isArray(j.ny) ? j.ny : [] });
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const mar = feed?.ny.find((c) => c.symbol === MAR);
  const may = feed?.ny.find((c) => c.symbol === MAY);
  const spread = mar?.last != null && may?.last != null ? +(mar.last - may.last).toFixed(2) : null;
  const backwardation = spread != null && spread > 0;
  const snapDate = feed?.snapshotFetchedAt ? feed.snapshotFetchedAt.slice(0, 10) : null;

  return (
    <div className="next-contract">
      <NearContractCard contractSymbol={MAY} customLabel={pick(lang, 'العقد اللاحق — مايو 2027', 'Next contract — May 2027')} />

      <div className={`spread-band ${backwardation ? 'spread-band--backward' : 'spread-band--contango'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="spread-band__main">
          <span className="spread-band__label">{pick(lang, 'SPREAD مارس / مايو', 'SPREAD Mar / May')}</span>
          <b className="spread-band__value">
            {spread != null ? `${spread > 0 ? '+' : ''}${spread.toFixed(2)}` : '—'}
            <small>¢/lb</small>
          </b>
        </div>
        <div className="spread-band__legs">
          <span>{pick(lang, 'مارس', 'Mar')} {mar?.last != null ? mar.last.toFixed(2) : '—'}</span>
          <span>−</span>
          <span>{pick(lang, 'مايو', 'May')} {may?.last != null ? may.last.toFixed(2) : '—'}</span>
        </div>
        <div className="spread-band__state">
          {spread != null
            ? backwardation
              ? pick(lang, 'مارس بعلاوة (Backwardation)', 'Mar at premium (Backwardation)')
              : pick(lang, 'مايو بعلاوة (Contango)', 'May at premium (Contango)')
            : pick(lang, 'بانتظار لقطة العقود', 'Awaiting contracts snapshot')}
          {snapDate ? ` · ${pick(lang, 'لقطة', 'snapshot')} ${snapDate}` : ''}
        </div>
      </div>
    </div>
  );
}

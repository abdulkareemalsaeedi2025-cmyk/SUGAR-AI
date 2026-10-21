'use client';
import { useContract } from './ContractContext';
import { useLang } from './LangContext';
import { daysAgo, pick } from '../../lib/i18n';

const ICE_NY_URL = 'https://www.theice.com/products/7/Sugar-No-11-Futures';
const ICE_LONDON_URL = 'https://www.theice.com/products/29696643/White-Sugar-Futures';
const BARCHART_URL = 'https://www.barchart.com/futures/quotes/SB*0/futures-prices';

export default function ContractSelector() {
  const { lang } = useLang();
  const {
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
  } = useContract();

  const premiumUp = (whitePremium ?? 0) >= 0;
  const nyUp = (nyContract?.change ?? 0) >= 0;

  const age = (() => {
    if (!snapshotFetchedAt) return '—';
    const t = Date.parse(snapshotFetchedAt);
    if (!Number.isFinite(t)) return '—';
    const days = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
    return daysAgo(lang, days);
  })();

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <section className="csel" dir={dir}>
      <div className="csel__head">
        <span className="csel__title">
          <i className="csel__dot" />
          {pick(lang, 'مُنتقي العقود · Contract Selector', 'Contract Selector')}
        </span>
        <div className="csel__links">
          <a href={ICE_NY_URL} target="_blank" rel="noreferrer noopener">ICE No.11 ↗</a>
          <a href={ICE_LONDON_URL} target="_blank" rel="noreferrer noopener">ICE No.5 ↗</a>
          <a href={BARCHART_URL} target="_blank" rel="noreferrer noopener">Barchart ↗</a>
        </div>
      </div>

      <div className="csel__row">
        <label className="csel__field">
          <span>Sugar No.11 ({pick(lang, 'نيويورك', 'New York')})</span>
          <select
            value={nyChoice}
            onChange={(e) => setNyChoice(e.target.value)}
            disabled={loading && !nyOptions.length}
          >
            <option value="">{pick(lang, 'تلقائي — أقرب عقد قادم', 'Auto — nearest upcoming')}</option>
            {nyOptions.map((o) => (
              <option key={o.symbol} value={o.symbol}>
                {pick(lang, o.labelAr, o.labelEn)} ({o.symbol}){o.near ? ` • ${pick(lang, 'أقرب', 'near')}` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="csel__stat">
          <span>{nyChoice ? pick(lang, 'العقد المحدد', 'Selected contract') : pick(lang, 'أقرب عقد (تلقائي)', 'Nearest (auto)')}</span>
          <b className={nyUp ? 'up' : 'dn'}>
            {nyPrice != null ? nyPrice.toFixed(2) : '—'}
            <small> ¢/lb</small>
          </b>
          <em>{nyContract ? `${pick(lang, nyContract.labelAr, nyContract.labelEn)} · ${nyContract.symbol}` : '—'}</em>
          {nyContract?.last != null && nyChoice && (
            <i className={nyUp ? 'up' : 'dn'}>
              {nyContract.change != null ? `${nyUp ? '+' : ''}${nyContract.change.toFixed(2)}` : '—'}
              {nyContract.changePct != null ? ` (${nyUp ? '+' : ''}${nyContract.changePct.toFixed(2)}%)` : ''}
            </i>
          )}
        </div>

        <div className="csel__stat">
          <span>{pick(lang, 'لندن رقم 5 (أبيض)', 'London No.5 (White)')}</span>
          <b>{londonPrice != null ? londonPrice.toFixed(2) : '—'}<small> US$/MT</small></b>
          <em>London No.5 · White Sugar</em>
        </div>

        <div className={`csel__stat csel__stat--premium${premiumUp ? ' up' : ' dn'}`}>
          <span>White Premium</span>
          <b>
            {whitePremium != null ? `${premiumUp ? '+' : ''}${whitePremium.toFixed(2)}` : '—'}
            <small> US$/MT</small>
          </b>
          <em>{pick(lang, 'لندن − نيويورك (محوّل ×22.0462)', 'London − NY (converted ×22.0462)')}</em>
        </div>
      </div>

      <div className="csel__foot">
        <span className="csel__note">
          {error
            ? pick(lang, `تعذّر تحميل منحنى العقود (${error}).`, `Could not load the contract curve (${error}).`)
            : note
              ? note
              : pick(
                  lang,
                  `منحنى العقود من لقطة Stooq · آخر تحديث ${age}${stale ? ' · بيانات قديمة' : ''}.`,
                  `Contract curve from Stooq snapshot · last update ${age}${stale ? ' · stale data' : ''}.`,
                )}
        </span>
        <span className="csel__count">
          {nyOptions.length} {pick(lang, 'عقد مُسعّر', 'priced contracts')}
        </span>
      </div>
    </section>
  );
}
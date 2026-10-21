'use client';
import { useEffect, useRef } from 'react';

export type TickerItem = {
  id: string;
  text: string;
  topic?: string;
  topicAr?: string;
  source?: string;
  href?: string;
  origin?: 'live' | 'upload';
};

type Props = {
  items: TickerItem[];
  labelAr?: string;
  labelEn?: string;
  lang?: 'ar' | 'en';
};

export default function NewsTicker({ items, labelAr = 'عوامل السكر', labelEn = 'Sugar drivers', lang = 'ar' }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const rafRef = useRef<number>(0);
  const speedRef = useRef(0.8); // pixels per frame
  const hasItems = items.length > 0;

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !hasItems) return;

    const animate = () => {
      const half = track.scrollWidth / 2;
      posRef.current += speedRef.current;
      if (half > 0 && posRef.current >= half) {
        posRef.current = 0;
      }
      track.style.transform = `translateX(${-posRef.current}px)`;
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hasItems]); // restart only when going from empty → has items (first load)

  if (!hasItems) {
    return (
      <div className="ticker ticker--empty">
        <span className="ticker__label">{lang === 'ar' ? labelAr : labelEn}</span>
        <span className="ticker__idle">{lang === 'ar' ? 'جارِ تحميل العوامل...' : 'Loading drivers...'}</span>
      </div>
    );
  }

  const run = [...items, ...items];

  return (
    <div className="ticker">
      <span className="ticker__label">
        <span className="ticker__live" />
        {lang === 'ar' ? labelAr : labelEn}
      </span>

      <div className="ticker__viewport" ref={viewportRef}>
        <div ref={trackRef} className="ticker__track" style={{ animation: 'none', willChange: 'transform' }}>
          {run.map((it, i) => (
            <span className="ticker__item" key={`${it.id}-${i}`}>
              {it.origin === 'upload' && <em className="ticker__tag ticker__tag--file">{lang === 'ar' ? 'ملف' : 'file'}</em>}
              {it.topic && <em className="ticker__tag">{lang === 'ar' ? it.topicAr : it.topic}</em>}
              {it.href ? (
                <a href={it.href} target="_blank" rel="noreferrer noopener">
                  {it.text}
                </a>
              ) : (
                it.text
              )}
              {it.source && <span className="ticker__src">{it.source}</span>}
            </span>
          ))}
        </div>
      </div>

      <div className="ticker__ctl">
        <button type="button" onClick={() => { speedRef.current = Math.min(3, speedRef.current + 0.3); }} title="faster">
          +
        </button>
        <button type="button" onClick={() => { speedRef.current = Math.max(0.2, speedRef.current - 0.3); }} title="slower">
          −
        </button>
      </div>
    </div>
  );
}

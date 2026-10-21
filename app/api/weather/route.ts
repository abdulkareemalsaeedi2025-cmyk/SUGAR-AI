import { NextResponse } from 'next/server';
import { cachedWithMeta } from '../../../lib/cache';

async function buildWeather() {
  const lat = Number(process.env.WEATHER_LAT ?? -23.96);
  const lon = Number(process.env.WEATHER_LON ?? -46.33);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&hourly=precipitation_probability&forecast_days=5&timezone=auto`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  return {
    source: 'Open-Meteo',
    sourceUrl: 'https://open-meteo.com/',
    current: j.current ?? null,
    hourly: j.hourly ?? null,
  };
}

export async function GET() {
  // Crop weather moves slowly; a 10-minute shared cache keeps the ticker and the
  // assistant off Open-Meteo on every poll.
  try {
    const { value, cached, at } = await cachedWithMeta('weather', 10 * 60_000, buildWeather, {
      staleMaxMs: 12 * 3600_000,
    });
    return NextResponse.json({ ...value, cached, fetchedAt: new Date(at).toISOString() });
  } catch {
    return NextResponse.json({ source: 'Open-Meteo', current: null, hourly: null }, { status: 200 });
  }
}

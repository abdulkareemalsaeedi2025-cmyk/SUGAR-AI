import { NextResponse } from 'next/server';
import { kvGet, kvSet, dbStatus, logAudit } from '../../../lib/db';
import { requireAdmin, unauthorized, forbidden, sessionFromRequest } from '../../../lib/auth';
import {
  VESSELS_KEY,
  DEFAULT_VESSELS,
  sanitizeVessel,
  sanitizeVessels,
  type Vessel,
} from '../../../lib/userData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function aisInfo() {
  const key = process.env.VESSELFINDER_API_KEY;
  return {
    connected: Boolean(key),
    source: 'VesselFinder AIS',
    sourceUrl: 'https://www.vesselfinder.com/realtime-ais-data',
    message: key
      ? 'AIS provider configured; vessels with IMO/MMSI can be polled live.'
      : 'AIS غير متصل — أضف VESSELFINDER_API_KEY في .env لتشغيل المواقع اللحظية.',
  };
}

type AisShip = {
  vesselId?: string;
  imo?: string;
  mmsi?: string;
  lat: number;
  lng: number;
  speedKn?: number | null;
  headingDeg?: number | null;
  dest?: string;
  eta?: string;
  at?: string | null;
};

const pickNum = (o: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

const pickStr = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
  }
  return '';
};

/**
 * Live AIS positions via VesselFinder (only when VESSELFINDER_API_KEY is set
 * and a ship has an IMO/MMSI). Every failure path is honest: no key, no
 * enrolled ship, HTTP error or a malformed feed all return a clear message
 * instead of fabricated coordinates.
 */
async function fetchAisLive(vessels: Vessel[]): Promise<{
  live: boolean;
  message: string;
  ships: AisShip[];
  at: string | null;
}> {
  const key = process.env.VESSELFINDER_API_KEY;
  if (!key) {
    return { live: false, message: aisInfo().message, ships: [], at: null };
  }
  const enrolled = vessels.filter((v) => (v.imo ?? '').trim() || (v.mmsi ?? '').trim());
  if (!enrolled.length) {
    return {
      live: false,
      message: 'لا توجد سفن مسجلة بـ IMO/MMSI — أضف معرفات AIS لكل سفينة أولاً ثم أعد التحديث.',
      ships: [],
      at: null,
    };
  }

  const ships: AisShip[] = [];
  const errors: string[] = [];
  for (const v of enrolled) {
    try {
      const params = new URLSearchParams({ userkey: key });
      if ((v.imo ?? '').trim()) params.set('imo', v.imo as string);
      else if ((v.mmsi ?? '').trim()) params.set('mmsi', v.mmsi as string);
      const r = await fetch(`https://api.vesselfinder.com/vesselslist?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        errors.push(`${v.name}: HTTP ${r.status}`);
        continue;
      }
      const payload: unknown = await r.json();
      const hits = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { vessels?: unknown[] }).vessels)
          ? (payload as { vessels: unknown[] }).vessels
          : null;
      const row = Array.isArray(hits) ? (hits[0] as Record<string, unknown> | undefined) : null;
      if (!row) {
        errors.push(`${v.name}: بلا نتائج`);
        continue;
      }
      const lat = pickNum(row, ['lat', 'LAT', 'latitude', 'Latitude']);
      const lng = pickNum(row, ['lon', 'lng', 'LON', 'longitude', 'Longitude']);
      if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        errors.push(`${v.name}: إحداثيات ناقصة في استجابة AIS`);
        continue;
      }
      ships.push({
        vesselId: v.id,
        imo: v.imo,
        mmsi: v.mmsi,
        lat,
        lng,
        speedKn: pickNum(row, ['speed', 'SPEED', 'SOG', 'sog', 'Speed']),
        headingDeg: pickNum(row, ['heading', 'HEADING', 'COG', 'cog', 'Heading']),
        dest: pickStr(row, ['dest', 'DEST', 'destination', 'DESTINATION']),
        eta: pickStr(row, ['eta', 'ETA']),
        at: pickStr(row, ['timestamp', 'TIMESTAMP', 'updatetime', 'UPDATETIME', 'at', 'AT']),
      });
    } catch (e) {
      errors.push(`${v.name}: ${e instanceof Error ? e.message : 'خطأ اتصال'}`);
    }
  }

  const live = ships.length > 0;
  return {
    live,
    message: live
      ? `جاهزة: مواضع مباشرة لـ ${ships.length} من ${enrolled.length} سفينة مسجلة.`
      : `فشل جلب AIS — ${errors.slice(0, 3).join(' · ') || 'لا مزيد من التفاصيل'}`,
    ships,
    at: new Date().toISOString(),
  };
}

async function storedVessels(): Promise<Vessel[] | null> {
  const stored = await kvGet<Vessel[]>(VESSELS_KEY);
  return Array.isArray(stored) && stored.length ? stored : null;
}

async function readVessels(): Promise<Vessel[]> {
  return (await storedVessels()) ?? DEFAULT_VESSELS;
}

function payload(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

function body(req: Request): Promise<Record<string, unknown>> {
  return payload(req).then((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {}));
}

async function reply(vessels: Vessel[], extra: Record<string, unknown> = {}) {
  const status = await dbStatus();
  return NextResponse.json(
    {
      ok: true,
      storage: status.persistent ? 'server' : status.ok ? 'memory' : 'unavailable',
      persistent: status.persistent,
      saved: (await storedVessels()) !== null,
      ...aisInfo(),
      vessels,
      ...extra,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** GET /api/vessels → AIS provider status + the stored fleet. `?ais=1` polls live positions. */
export async function GET(req: Request) {
  const vessels = await readVessels();
  if (new URL(req.url).searchParams.get('ais') === '1') {
    const ais = await fetchAisLive(vessels);
    return reply(vessels, { ais });
  }
  return reply(vessels);
}

/** POST /api/vessels → add one ship. (admin only) */
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const b = await body(req);
  const raw = (b.vessel ?? b) as Record<string, unknown>;
  const withId = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `v${Date.now().toString(36)}`,
    ...raw,
  };
  const vessel = sanitizeVessel(withId);
  if (!vessel || !vessel.name || vessel.name === '—') {
    return NextResponse.json({ ok: false, error: 'invalid_vessel', reason: 'name_required' }, { status: 422 });
  }

  const vessels = [...(await readVessels()), vessel];
  if (!(await kvSet(VESSELS_KEY, vessels))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }
  await logAudit({ action: 'vessel.create', entity: 'vessel', entityId: vessel.id, details: { name: vessel.name } });
  return reply(vessels, { vessel });
}

/** PUT /api/vessels → update one ship by id (full replace of that record). (admin only) */
export async function PUT(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const b = await body(req);
  const raw = (b.vessel ?? b) as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const current = await readVessels();
  if (!current.some((v) => v.id === id)) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const merged = sanitizeVessel({ ...current.find((v) => v.id === id), ...raw });
  if (!merged) return NextResponse.json({ ok: false, error: 'invalid_vessel' }, { status: 422 });

  const vessels = current.map((v) => (v.id === id ? merged : v));
  if (!(await kvSet(VESSELS_KEY, vessels))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }
  await logAudit({ action: 'vessel.update', entity: 'vessel', entityId: id, details: { name: merged.name } });
  return reply(vessels, { vessel: merged });
}

/** DELETE /api/vessels?id=… → remove one ship. (admin only) */
export async function DELETE(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const current = await readVessels();
  const vessels = current.filter((v) => v.id !== id);
  if (vessels.length === current.length) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  if (!(await kvSet(VESSELS_KEY, vessels))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }
  await logAudit({ action: 'vessel.delete', entity: 'vessel', entityId: id });
  return reply(vessels);
}

/** PATCH /api/vessels with {vessels:[…]} → bulk replace (used by tests / import). (admin only) */
export async function PATCH(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const b = await body(req);
  const vessels = sanitizeVessels(b.vessels ?? b);
  if (!vessels.length) return NextResponse.json({ ok: false, error: 'empty_payload' }, { status: 422 });
  if (!(await kvSet(VESSELS_KEY, vessels))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }
  await logAudit({ action: 'vessel.replace', entity: 'vessel', details: { count: vessels.length } });
  return reply(vessels);
}

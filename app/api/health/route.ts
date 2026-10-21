import { NextResponse } from 'next/server';
import { dbStatus, dbAvailable, kvIndex } from '../../../lib/db';
import { cacheIndex } from '../../../lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/health → one-glance status of the data layer and integrations. */
export async function GET() {
  const db = await dbStatus();
  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      storage: {
        ...db,
        available: await dbAvailable(),
        keys: (await kvIndex()).map((r) => ({ key: r.key, updatedAt: r.updatedAt })),
      },
      cache: await cacheIndex(),
      integrations: {
        llm: Boolean(process.env.LLM_API_KEY),
        llmModel: process.env.LLM_MODEL ?? null,
        barchart: Boolean(process.env.BARCHART_API_KEY),
        vesselFinder: Boolean(process.env.VESSELFINDER_API_KEY),
        uploadsEnabled: process.env.NEXT_PUBLIC_UPLOAD_ENABLED === '1',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

import { NextResponse } from 'next/server';
import { kvGet } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await kvGet<unknown>('refined-prices');
  return NextResponse.json({ data: data ?? null });
}

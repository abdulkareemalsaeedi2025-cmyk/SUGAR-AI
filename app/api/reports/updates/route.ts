import { NextResponse } from 'next/server';
import { listUpdates } from '../../../../lib/reportUpdates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await listUpdates();
  return NextResponse.json({ items });
}

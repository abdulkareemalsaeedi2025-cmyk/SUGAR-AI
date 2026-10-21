import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { listReports, saveReports } from '../../../lib/reportsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await listReports();
  return NextResponse.json({ items });
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id مطلوب' }, { status: 400 });
    const items = await listReports();
    const idx = items.findIndex((i) => i.id === id);
    if (idx < 0) return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    const fp = path.join(process.cwd(), 'data', 'daily-reports', items[idx].fileName);
    try { await fs.unlink(fp); } catch { /* file may already be gone */ }
    items.splice(idx, 1);
    await saveReports(items);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 });
  }
}

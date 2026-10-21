import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { listReports } from '../../../../../lib/reportsStore';
import { CLOUD_MODE, fileGet } from '../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await listReports();
  const it = items.find((x) => x.id === id);
  if (!it) return NextResponse.json({ error: 'غير موجود' }, { status: 404 });

  if (CLOUD_MODE) {
    const f = await fileGet(id);
    if (!f) return NextResponse.json({ error: 'الملف غير موجود في المخزن' }, { status: 404 });
    const headers = new Headers();
    headers.set('Content-Type', f.mime || it.mimeType || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(it.originalName)}`);
    return new NextResponse(new Uint8Array(f.bytes), { headers });
  }

  try {
    const fp = path.join(process.cwd(), 'data', 'daily-reports', it.fileName);
    const buf = await fs.readFile(fp);
    const headers = new Headers();
    headers.set('Content-Type', it.mimeType || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(it.originalName)}`);
    return new NextResponse(new Uint8Array(buf), { headers });
  } catch {
    return NextResponse.json({ error: 'الملف غير موجود على القرص' }, { status: 404 });
  }
}

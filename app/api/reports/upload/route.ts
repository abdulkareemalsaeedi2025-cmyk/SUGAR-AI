import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { listReports, saveReports, classifyReport, catLabel, todayStr, type ReportItem } from '../../../../lib/reportsStore';
import { extractText, analyzeText } from '../../../../lib/reportExtract';
import { parseConsolidatedSheet } from '../../../../lib/sugarSheet';
import { applyReportToSystem } from '../../../../lib/reportApply';
import { addUpdate } from '../../../../lib/reportUpdates';
import { requireAdmin, unauthorized, forbidden, sessionFromRequest } from '../../../../lib/auth';
import { CLOUD_MODE, filePut } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['.pdf', '.docx', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.csv', '.json']);

export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const reportDate = (form.get('reportDate') as string) || todayStr();
    const manualCat = (form.get('category') as string) || '';

    if (!file) return NextResponse.json({ error: 'ملف مفقود' }, { status: 400 });
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED.has(ext)) return NextResponse.json({ error: `صيغة غير مدعومة: ${ext}` }, { status: 400 });
    if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'الحجم الأقصى 25MB' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const dir = path.join(process.cwd(), 'data', 'daily-reports');
    await fs.mkdir(dir, { recursive: true });

    const id = 'rep_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const fileName = id + ext;
    const fp = path.join(dir, fileName);
    if (CLOUD_MODE) {
      // Cloud: the binary lives in Postgres (report_files), not on the
      // ephemeral host disk. Extraction reads from the in-memory buffer.
      await filePut(id, file.name, file.type || 'application/octet-stream', buf);
    } else {
      await fs.writeFile(fp, buf);
    }

    // extract -> classify -> analyze -> apply to system
    const text = await extractText(buf, ext);
    const sheet = parseConsolidatedSheet(text);
    const category = (['market', 'meeting', 'summary', 'bourse', 'general'].includes(manualCat)
      ? manualCat
      : classifyReport(file.name, text)) as ReportItem['category'];
    const ex = analyzeText(text);
    const { fields, changed } = await applyReportToSystem(ex, sheet);
    const effectiveDate = sheet?.reportDate ?? reportDate;

    const now = new Date().toISOString();
    const item: ReportItem = {
      id,
      originalName: file.name,
      fileName,
      ext,
      mimeType: file.type || 'application/octet-stream',
      size: buf.length,
      category,
      categoryAr: catLabel(category).ar,
      categoryEn: catLabel(category).en,
      reportDate: effectiveDate,
      uploadedAt: now,
      updatedAt: null,
      version: 1,
    };
    const items = await listReports();
    items.push(item);
    await saveReports(items);

    await addUpdate({
      id: 'upd_' + id,
      reportId: id,
      reportName: file.name,
      categoryAr: item.categoryAr,
      categoryEn: item.categoryEn,
      appliedAt: now,
      fields,
      summaryAr: changed > 0
        ? `تمت تغذية النظام: ${changed} تحديث مطبق + ${fields.length - changed} مؤشر مرصود`
        : fields.length > 0
          ? `رُصد ${fields.length} مؤشر — لم تُطبق تغييرات تلقائية (تحقق يدوي)`
          : 'لم يتم رصد بيانات قابلة للتغذية في هذا الملف',
      summaryEn: changed > 0
        ? `System fed: ${changed} applied updates + ${fields.length - changed} detected indicators`
        : fields.length > 0
          ? `${fields.length} indicators detected — no automatic changes applied`
          : 'No feedable data detected in this file',
    });

    return NextResponse.json({
      ok: true, item, changed,
      factsPreview: sheet
        ? {
            reportDate: sheet.reportDate,
            rawSugarMT: sheet.rawSugarMT, refinedSugarMT: sheet.refinedSugarMT, totalMT: sheet.totalMT,
            nyFront: sheet.nyFront, londonFront: sheet.londonFront, whitePremium: sheet.whitePremium,
            refinedPrices: sheet.refinedPrices,
            vessels: sheet.vessels.map((v) => ({ name: v.name, priced: v.priced, position: v.position, eta: v.etaISO, qtyMT: v.qtyMT, price: v.price })),
          }
        : ex.facts,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 });
  }
}

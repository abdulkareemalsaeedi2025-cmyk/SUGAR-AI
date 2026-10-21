/**
 * Daily reports store — metadata in kv (cloud) or data/daily-reports/meta.json
 * (local), binaries in Postgres report_files (cloud) or next to it (local).
 * Classification is automatic from the file name + extracted text, so the
 * user never has to pick a category manually.
 */
import fs from 'fs/promises';
import path from 'path';
import { CLOUD_MODE, kvGet, kvSet } from './db';

export type ReportCategory = 'market' | 'meeting' | 'summary' | 'bourse' | 'general';

export interface ReportItem {
  id: string;
  originalName: string;
  fileName: string;
  ext: string;
  mimeType: string;
  size: number;
  category: ReportCategory;
  categoryAr: string;
  categoryEn: string;
  reportDate: string; // YYYY-MM-DD
  uploadedAt: string; // ISO
  updatedAt: string | null;
  version: number;
}

const DIR = path.join(process.cwd(), 'data', 'daily-reports');
const META = path.join(DIR, 'meta.json');
const META_KEY = 'reports-meta';

async function ensure() {
  await fs.mkdir(DIR, { recursive: true });
  try { await fs.access(META); } catch { await fs.writeFile(META, '[]', 'utf8'); }
}

export async function listReports(): Promise<ReportItem[]> {
  if (CLOUD_MODE) {
    const arr = (await kvGet<ReportItem[]>(META_KEY)) ?? [];
    return arr.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  await ensure();
  try {
    const raw = await fs.readFile(META, 'utf8');
    const arr = JSON.parse(raw) as ReportItem[];
    return arr.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  } catch {
    return [];
  }
}

export async function saveReports(items: ReportItem[]) {
  if (CLOUD_MODE) {
    await kvSet(META_KEY, items);
    return;
  }
  await ensure();
  await fs.writeFile(META, JSON.stringify(items, null, 2), 'utf8');
}

const CAT_LABELS: Record<ReportCategory, { ar: string; en: string }> = {
  bourse:  { ar: 'تقارير البورصة',   en: 'Exchange Reports' },
  meeting: { ar: 'تقارير اجتماعات',  en: 'Meeting Reports' },
  summary: { ar: 'ملخصات',           en: 'Summaries' },
  market:  { ar: 'تقارير السوق',     en: 'Market Reports' },
  general: { ar: 'تقارير عامة',      en: 'General Reports' },
};

export function catLabel(c: ReportCategory) {
  return CAT_LABELS[c] ?? CAT_LABELS.general;
}

/**
 * Auto-classify from file name + extracted text. Priority order matters:
 * meeting words are strong signals even inside market sheets, so we check
 * them first, then exchange-specific signals, then summaries, then market.
 */
export function classifyReport(name: string, text: string): ReportCategory {
  const n = (name || '').toLowerCase();
  const t = (text || '').toLowerCase().slice(0, 20000);

  if (/محضر|اجتماع|meeting|minutes|agenda/.test(n) || /محضر اجتماع|meeting minutes|attendees|الحضور/.test(t)) {
    return 'meeting';
  }
  if (/bourse|exchange|ice|nybot|#11|#5/.test(n) || /ice futures|ny\s*#?\s*11|london\s*#?\s*5|settlement price|open interest/.test(t)) {
    return 'bourse';
  }
  if (/summary|ملخص|brief/.test(n) || /executive summary|ملخص تنفيذي|key highlights/.test(t)) {
    return 'summary';
  }
  if (/sugar|sheet|market|daily|price|vessel|cargo|shipment|stock|سكر|سوق|أسعار|مخزون|بواخر|شحن/.test(n)
    || /white premium|raw sugar|refined sugar|fob|cif|سكر خام|سكر مكرر/.test(t)) {
    return 'market';
  }
  return 'general';
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

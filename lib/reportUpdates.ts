/**
 * Applied-updates log: every report that feeds the system records what it
 * changed here, so the UI can show "what was updated" instead of raw files.
 * Stored in kv (cloud) or data/daily-reports/updates.json (local).
 */
import fs from 'fs/promises';
import path from 'path';
import { CLOUD_MODE, kvGet, kvSet } from './db';

export interface AppliedField {
  /** e.g. vessels.MV TK ORTAKOY.etaAt or inventory.rawSugar */
  path: string;
  labelAr: string;
  labelEn: string;
  oldValue: unknown;
  newValue: unknown;
  confidence: number; // 0..1
  applied: boolean;   // true = written to the system, false = detected only
}

export interface ReportUpdate {
  id: string;
  reportId: string;
  reportName: string;
  categoryAr: string;
  categoryEn: string;
  appliedAt: string;
  fields: AppliedField[];
  summaryAr: string;
  summaryEn: string;
}

const DIR = path.join(process.cwd(), 'data', 'daily-reports');
const UPD = path.join(DIR, 'updates.json');
const UPD_KEY = 'reports-updates';

async function ensure() {
  await fs.mkdir(DIR, { recursive: true });
  try { await fs.access(UPD); } catch { await fs.writeFile(UPD, '[]', 'utf8'); }
}

export async function listUpdates(): Promise<ReportUpdate[]> {
  if (CLOUD_MODE) {
    const arr = (await kvGet<ReportUpdate[]>(UPD_KEY)) ?? [];
    return arr.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }
  await ensure();
  try {
    const raw = await fs.readFile(UPD, 'utf8');
    const arr = JSON.parse(raw) as ReportUpdate[];
    return arr.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  } catch {
    return [];
  }
}

export async function addUpdate(u: ReportUpdate) {
  const arr = await listUpdates();
  arr.unshift(u);
  if (CLOUD_MODE) {
    await kvSet(UPD_KEY, arr.slice(0, 100));
    return;
  }
  await ensure();
  await fs.writeFile(UPD, JSON.stringify(arr.slice(0, 100), null, 2), 'utf8');
}

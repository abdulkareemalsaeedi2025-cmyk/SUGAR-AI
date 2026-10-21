/**
 * Text extraction (PDF/DOCX/XLSX/TXT/CSV) + light-weight fact detection.
 * No external services: everything runs locally on the uploaded file.
 */
import fs from 'fs/promises';
import path from 'path';

export interface ReportFacts {
  dates: string[];
  prices: Array<{ label: string; value: string }>;
  vessels: string[];
  numbers: Array<{ label: string; value: number }>;
  meetings: string[];
  actions: string[];
}

export interface ExtractResult {
  text: string;
  preview: string;
  facts: ReportFacts;
}

function clean(s: string) {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractText(source: string | Buffer, ext: string): Promise<string> {
  const buf = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  const e = ext.toLowerCase();
  try {
    if (e === '.pdf') {
      // NOTE: import the inner lib directly — the package entry falls into a
      // debug branch (reads a test fixture) when bundled by Next.js.
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const res = await pdfParse(buf);
      return clean(res.text || '');
    }
    if (e === '.docx') {
      const mammoth = (await import('mammoth')).default;
      const res = await mammoth.extractRawText({ buffer: buf });
      return clean(res.value || '');
    }
    if (e === '.xlsx' || e === '.xls' || e === '.csv') {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'buffer' });
      let out = '';
      for (const name of wb.SheetNames) {
        out += '\n## ' + name + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      }
      return clean(out);
    }
    // txt / json / ppt fallback: best-effort utf8 slice
    return clean(buf.toString('utf8').slice(0, 300000));
  } catch {
    return '';
  }
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Normalise "8 Oct 2026" / "08/10/2026" / "2026-10-08" to ISO dates. */
export function findDates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\b(\d{1,2})[\/\.](\d{1,2})[\/\.](20\d{2})\b/g)) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    if (+mo <= 12 && +d <= 31) out.add(`${m[3]}-${mo}-${d}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*,?\s*(20\d{2})/gi)) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) out.add(`${m[3]}-${mo}-${m[1].padStart(2, '0')}`);
  }
  return [...out].sort().slice(0, 20);
}

export function analyzeText(text: string): ExtractResult {
  const facts: ReportFacts = { dates: findDates(text), prices: [], vessels: [], numbers: [], meetings: [], actions: [] };

  // prices: NY#11 / London#5 / white premium / cents per lb / $ per MT
  for (const m of text.matchAll(/(ny\s*#?\s*11|sugar\s*#?\s*11|london\s*#?\s*5|white\s*premium|wp\b|premium)[^\d\n]{0,30}(\d+[\.,]?\d*)/gi)) {
    facts.prices.push({ label: m[1].trim(), value: m[2] });
  }
  facts.prices = facts.prices.slice(0, 20);

  // vessels: MV/MT NAME
  for (const m of text.matchAll(/\b(?:MV|MT|M\/T)\s+([A-Z][A-Z0-9 \-\.]{2,30})/g)) {
    facts.vessels.push(('MV ' + m[1].trim()).replace(/\s+/g, ' '));
  }
  facts.vessels = [...new Set(facts.vessels)].slice(0, 15);

  // labelled numbers: "raw sugar 85,000" / "stock: 120000 MT"
  for (const m of text.matchAll(/(raw sugar|refined sugar|total stock|inventory|stock|production|sales|مخزون|إنتاج|مبيعات|سكر خام|سكر مكرر)[^\d\n]{0,20}(\d[\d,\. ]{1,12})/gi)) {
    const v = Number(m[2].replace(/[,\s]/g, ''));
    if (Number.isFinite(v) && v > 0) facts.numbers.push({ label: m[1].trim().toLowerCase(), value: Math.round(v) });
  }
  facts.numbers = facts.numbers.slice(0, 20);

  for (const m of text.matchAll(/(meeting|minutes|اجتماع|محضر)[^\n]{0,60}/gi)) facts.meetings.push(m[0].trim());
  facts.meetings = [...new Set(facts.meetings)].slice(0, 8);

  for (const m of text.matchAll(/(action|decision|قرار|مهمة|يجب|to\s*do)\s*[:\-]?\s*[^\n]{5,80}/gi)) facts.actions.push(m[0].trim());
  facts.actions = [...new Set(facts.actions)].slice(0, 8);

  return { text, preview: text.slice(0, 1500), facts };
}

/**
 * Parser for the company's "CONSOLIDATED SUGAR POSITION" daily sheet (PDF).
 *
 * The sheet's columns are glued together by PDF text extraction
 * ("$65.4021,576" = premium $65.40 + qty 21,576), so this parser works on
 * the raw extracted text with format-aware ungluing rules. It only returns
 * data when the sheet's fingerprint is present — otherwise null, and the
 * caller falls back to the generic analyzer.
 */

export interface SheetVessel {
  name: string;
  code: string;
  priced: 'priced' | 'unpriced';
  position: string; // IN STOCK / IN TRANSIT / …
  etaISO: string | null;
  contract: string; // e.g. "NY OCT'26"
  lots: number | null;
  premium: number | null; // C&F premium $/MT
  qtyMT: number | null;
  price: number | null;   // C&F price $/MT
  value: number | null;   // C&F value $
  invoice: number | null; // provisional / invoice price
}

export interface RefinedPrice {
  /** group: container CFR / break-bulk CFR / basis premium / replacement */
  group: 'container' | 'breakbulk' | 'basis' | 'replacement';
  label: string;   // e.g. "OCTOBER Egyptian 45s CFR (row 1)"
  value: number;   // $/MT
  note?: string;
}

export interface ConsolidatedSheet {
  reportDate: string | null;
  rawSugarMT: number | null;
  refinedSugarMT: number | null;
  totalMT: number | null;
  nyFront: { contract: string; cLb: number; usdMt: number } | null;
  londonFront: { contract: string; usdMt: number } | null;
  whitePremium: { value: number; period: string } | null;
  avgPricedStock: { qty: number; price: number; value: number } | null;
  refinedPrices: RefinedPrice[];
  vessels: SheetVessel[];
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

function parseDMY(d: string, m: string, y: string): string | null {
  const dd = +d, mm = +m;
  let yy = +y;
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** "474$46.24" → "474 $46.24", "$65.4021,576" → "$65.40 21,576", "162.40$402" → "162.40 $402" */
function unglue(s: string): string {
  return s
    .replace(/(\d)\$/g, '$1 $')
    .replace(/(\.\d{2})(\d{1,3}(?:,\d{3})+)/g, '$1 $2');
}

function parseVesselWindow(name: string, code: string, win: string): SheetVessel {
  const v: SheetVessel = {
    name: 'MV ' + name.trim().replace(/\s+/g, ' '),
    code,
    priced: /UNPRICED/i.test(win) ? 'unpriced' : 'priced',
    position: win.match(/(IN STOCK|IN TRANSIT|AT ANCHOR|EN ROUTE|LOADING|DISCHARGED)/)?.[1] ?? '',
    etaISO: null,
    contract: '',
    lots: null, premium: null, qtyMT: null, price: null, value: null, invoice: null,
  };

  const eta = win.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (eta) v.etaISO = parseDMY(eta[1], eta[2], eta[3]);

  const cm = win.match(/(NY|LDN)\s*([A-Z]{3}'\d{2})/);
  if (!cm) return v; // no contract → numbers would be ambiguous
  v.contract = `${cm[1]} ${cm[2]}`;

  const rest = unglue(win.slice(win.indexOf(cm[0]) + cm[0].length));
  const tokens = [...rest.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)/g)]
    .map((x) => num(x[1]))
    .filter((n): n is number => n !== null);

  if (tokens.length >= 6) {
    [v.lots, v.premium, v.qtyMT, v.price, v.value, v.invoice] = tokens;
  } else if (tokens.length === 5) {
    [v.premium, v.qtyMT, v.price, v.value, v.invoice] = tokens;
  } else {
    // fuzzy: locate the qty (comma-formatted, plausible cargo size)
    const qi = tokens.findIndex((t) => t >= 5000 && t <= 250000 && Number.isInteger(t));
    if (qi > 0) {
      v.premium = tokens[qi - 1] ?? null;
      v.qtyMT = tokens[qi];
      v.price = tokens[qi + 1] ?? null;
      v.value = tokens[qi + 2] ?? null;
      v.invoice = tokens[qi + 3] ?? null;
      if (qi > 1) v.lots = tokens[qi - 2];
    }
  }

  // sanity clamps — reject anything wildly out of range
  if (v.qtyMT !== null && (v.qtyMT < 1000 || v.qtyMT > 250000)) v.qtyMT = null;
  if (v.premium !== null && v.premium > 500) v.premium = null;
  if (v.price !== null && (v.price < 100 || v.price > 1500)) v.price = null;
  if (v.invoice !== null && (v.invoice < 100 || v.invoice > 1500)) v.invoice = null;
  return v;
}

export function parseConsolidatedSheet(text: string): ConsolidatedSheet | null {
  if (!/CONSOLIDATED SUGAR POSITION/i.test(text)) return null;

  const sheet: ConsolidatedSheet = {
    reportDate: null,
    rawSugarMT: null, refinedSugarMT: null, totalMT: null,
    nyFront: null, londonFront: null, whitePremium: null, avgPricedStock: null,
    refinedPrices: [],
    vessels: [],
  };

  // report date: "AS ON:9-Oct-26"
  const rd = text.match(/AS ON:\s*(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/i);
  if (rd) {
    const mo = MONTHS[rd[2].slice(0, 3).toLowerCase()];
    if (mo) {
      let yy = +rd[3]; if (yy < 100) yy += 2000;
      sheet.reportDate = `${yy}-${mo}-${rd[1].padStart(2, '0')}`;
    }
  }

  // stock: comma numbers immediately before the "RAW SUGAR / REFINED SUGAR" labels
  const rawLabel = text.search(/RAW SUGAR/i);
  if (rawLabel > 0) {
    const before = text.slice(Math.max(0, rawLabel - 300), rawLabel);
    const nums = [...before.matchAll(/(\d{1,3}(?:,\d{3})+)/g)].map((m) => num(m[1])!).filter(Boolean);
    if (nums.length >= 3) {
      const [a, b, c] = nums.slice(-3);
      sheet.rawSugarMT = a; sheet.refinedSugarMT = b; sheet.totalMT = c;
    }
  }

  // NY front contract: "NY MAR'2720.15$444.23"
  const ny = text.match(/NY\s*([A-Z]{3})'(\d{2})\s*(\d+\.\d+)\s*\$?(\d+\.\d+)/);
  if (ny) sheet.nyFront = { contract: `NY ${ny[1]}'${ny[2]}`, cLb: +ny[3], usdMt: +ny[4] };

  // London front: "LDN DEC'26$541.10"
  const ldn = text.match(/LDN\s*([A-Z]{3})'(\d{2})\s*\$?(\d+\.\d+)/);
  if (ldn) sheet.londonFront = { contract: `LDN ${ldn[1]}'${ldn[2]}`, usdMt: +ldn[3] };

  // white premium: "$96.87OCT/OCT'26"
  const wp = text.match(/\$\s*(\d+\.\d+)\s*([A-Z]{3}\/[A-Z]{3}'\d{2})/);
  if (wp) sheet.whitePremium = { value: +wp[1], period: wp[2] };

  // average priced position (stock): "AVERAGE PRICED POSITION (Stock)49,517$475.21$23,531,103.82"
  const avg = text.match(/AVERAGE PRICED POSITION \(Stock\)\s*([\d,]+)\s*\$?([\d.]+)\s*\$?([\d,]+(?:\.\d+)?)/i);
  if (avg) sheet.avgPricedStock = { qty: num(avg[1])!, price: +avg[2], value: num(avg[3])! };

  /* ================= WHITE / REFINED SUGAR PRICES ================= */

  // 1) Container CFR table — month blocks like:
  //    "OCTOBER\n(NY H+$220)\n$664.23$754.23$781.10\n$616.10$616.10$614.23"
  //    columns: Egyptian 45s · Indian/ME 45s · Brazilian 150s
  //    business rule (confirmed by the owner): value row 1 = HODEIDAH, row 2 = ADEN
  const CONT_COLS = ['Egyptian 45s', 'Indian/ME 45s', 'Brazilian 150s'];
  const CONT_PORT = (i: number) => (i < 3 ? 'Hodeidah' : 'Aden');
  for (const m of text.matchAll(/(OCTOBER|NOVEMBER|DECEMBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER)\s*\(NY H\+\$(\d+)\)\s*((?:\$?[\d.]+\$?\s*(?:\n)?){2,8})/gi)) {
    const month = m[1].toUpperCase();
    const vals = [...m[3].matchAll(/\$?([\d]+\.[\d]+)/g)].map((x) => +x[1]).filter((v) => v > 100 && v < 1500);
    vals.slice(0, 6).forEach((v, i) => {
      sheet.refinedPrices.push({
        group: 'container',
        label: `${month} ${CONT_COLS[i % 3]} containers CFR ${CONT_PORT(i)}`,
        value: v,
        note: `NY H+$${m[2]}`,
      });
    });
  }

  // 2) Basis premium table — "OCTOBERH-100 points  (NY MAR'27)$444.23 $508.23N.A. $526.23N.A."
  for (const m of text.matchAll(/(OCTOBER|NOVEMBER|DECEMBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER)\s*H-(\d+)\s*points\s*\(([^)]+)\)\s*((?:\$?[\d.]+\$?\s*(?:N\.?A\.?)?\s*){1,5})/gi)) {
    const vals = [...m[4].matchAll(/\$?([\d]+\.[\d]+)/g)].map((x) => +x[1]).filter((v) => v > 100 && v < 1500);
    vals.forEach((v, i) => {
      sheet.refinedPrices.push({
        group: 'basis',
        label: `${m[1].toUpperCase()} basis H-${m[2]} (${m[3]})${i === 0 ? ' market' : ` flat #${i}`}`,
        value: v,
      });
    });
  }

  // 3) Break-bulk CFR Aden — "Break-bulk 10/25,000 MT CFR ADENIndian 45s\n$706.10"
  const bb1 = text.match(/Break-bulk[\s\S]{0,45}?CFR ADEN\s*([A-Za-z\/ ]*\d+s)?\s*\n?\s*\$?([\d]+\.[\d]+)/i);
  if (bb1) sheet.refinedPrices.push({ group: 'breakbulk', label: `Break-bulk CFR ADEN ${bb1[1]?.trim() || ''}`.trim(), value: +bb1[2] });
  // "…$707.10\nBrazilian 150s:-   ADEN" (value precedes its label)
  const bb2 = text.match(/Brazilian 150s:-\s*ADEN/i);
  if (bb2) {
    const back = text.slice(Math.max(0, bb2.index! - 120), bb2.index!);
    const v = [...back.matchAll(/\$\s*([\d]+\.[\d]+)/g)].map((x) => +x[1]).filter((x) => x > 100 && x < 1500).pop();
    if (v) sheet.refinedPrices.push({ group: 'breakbulk', label: 'Brazilian 150s break-bulk CFR ADEN', value: v });
  }

  // 4) Replacement reference — "White Premium Future Month $70.00" & "C&F Premium TQ $64.00 $68.00"
  const rwp = text.match(/White Premium\s*\n?\s*Future Month\s*\n?\s*\$?([\d]+\.[\d]+)/i);
  if (rwp) sheet.refinedPrices.push({ group: 'replacement', label: 'White premium (replacement ref)', value: +rwp[1] });
  const tq = text.match(/C&F Premium TQ\s*\n?\s*\$?([\d]+\.[\d]+)\s*\n?\s*\$?([\d]+\.[\d]+)/i);
  if (tq) {
    sheet.refinedPrices.push({ group: 'replacement', label: 'C&F Premium TQ (1)', value: +tq[1] });
    sheet.refinedPrices.push({ group: 'replacement', label: 'C&F Premium TQ (2)', value: +tq[2] });
  }

  // de-duplicate identical label+value pairs
  sheet.refinedPrices = sheet.refinedPrices.filter((p, i, a) => a.findIndex((x) => x.label === p.label && x.value === p.value) === i);

  // vessel rows — window ends at the next vessel row or a section marker,
  // so numbers/pricing never leak in from neighbouring rows
  const mvMatches = [...text.matchAll(/MV\s+([A-Z][A-Z0-9 .\-]+?)\s*\(([A-Z0-9]{6,})\)/g)];
  for (let i = 0; i < mvMatches.length; i++) {
    const m = mvMatches[i];
    const start = m.index!;
    let end = i + 1 < mvMatches.length ? mvMatches[i + 1].index! : start + 500;
    const within = text.slice(start, end);
    const marker = within.search(/\n(AVERAGE|TOTAL|UNSOLD|Shipment Period|NOTE:)/i);
    if (marker > 0) end = start + marker;
    sheet.vessels.push(parseVesselWindow(m[1], m[2], text.slice(start, end)));
  }

  return sheet;
}

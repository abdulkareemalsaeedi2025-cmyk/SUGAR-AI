/**
 * Arabic translations for English news headlines.
 *
 * Rules (owner standing orders):
 *  - Translate ONCE, store forever (kv key `news-i18n`) — a headline is never
 *    re-translated.
 *  - Free Groq tier only (same OpenAI-compatible endpoint as the chat).
 *  - Never invent a translation: on any failure the caller just keeps the
 *    original English title.
 */
import { kvGet, kvSet } from './db';

const KV_KEY = 'news-i18n';
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);

type Store = Record<string, string>;

async function readStore(): Promise<Store> {
  try {
    return (await kvGet<Store>(KV_KEY)) ?? {};
  } catch {
    return {};
  }
}

let writing = false;
async function writeStore(s: Store) {
  if (writing) return; // avoid interleaved bulk writes; next batch persists the rest
  writing = true;
  try {
    // keep the map bounded — newest 2,000 entries
    const entries = Object.entries(s).slice(-2000);
    await kvSet(KV_KEY, Object.fromEntries(entries));
  } finally {
    writing = false;
  }
}

/** Translate a batch of headlines in ONE LLM round-trip (JSON array in/out). */
async function llmTranslate(titles: string[]): Promise<string[] | null> {
  if (!LLM_API_KEY || !titles.length) return null;
  try {
    const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.1,
        max_tokens: 2200,
        messages: [
          {
            role: 'system',
            content:
              'You translate English commodity-market headlines into concise professional Arabic. ' +
              'Keep numbers, symbols, months and proper nouns accurate (Sugar No.11 = سكر رقم 11, ICE = آيس, white premium = البريميوم الأبيض). ' +
              'Reply with ONLY a JSON array of Arabic strings, same order, same length, no commentary.',
          },
          { role: 'user', content: JSON.stringify(titles) },
        ],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt: string = j?.choices?.[0]?.message?.content ?? '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length !== titles.length) return null;
    return arr.map((x) => (typeof x === 'string' && x.trim() ? x.trim() : ''));
  } catch {
    return null;
  }
}

/**
 * Attach `titleAr` to news items (mutates nothing — returns a new list).
 * Translates at most `maxNew` new headlines per call so the response stays
 * fast; the rest trickle in on the next poll (they are cached forever then).
 */
export async function withArabicTitles<T extends { title: string }>(items: T[], maxNew = 12): Promise<(T & { titleAr?: string })[]> {
  const store = await readStore();
  const missing: { idx: number; key: string }[] = [];
  const out = items.map((n, i) => {
    const key = norm(n.title);
    const ar = store[key];
    if (ar) return { ...n, titleAr: ar };
    if (missing.length < maxNew) missing.push({ idx: i, key });
    return { ...n };
  });

  if (missing.length) {
    const translated = await llmTranslate(missing.map((m) => items[m.idx].title));
    if (translated) {
      let dirty = false;
      missing.forEach((m, i) => {
        const ar = translated[i];
        if (ar) {
          store[m.key] = ar;
          out[m.idx] = { ...out[m.idx], titleAr: ar };
          dirty = true;
        }
      });
      if (dirty) await writeStore(store);
    }
  }
  return out;
}

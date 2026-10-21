'use client';
import { useEffect, useRef, useState } from 'react';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

type Msg = { role: 'user' | 'assistant'; content: string; id: string };

const uid = () => Math.random().toString(36).slice(2, 9);

const WELCOME = `أهلاً بك في Smart Sugar AI — مستشارك وكبير محللي أسواق السكر.

أجيب عن جميع أسئلة البورصة (الأسعار، العقود، الفروقات، التحليل الأساسي والفني، التقارير العالمية، المشتريات والتغطية) اعتماداً حصراً على مصادر عالمية موثوقة: ICE · Yahoo Finance · Barchart · Reuters/Bloomberg وتقارير القطاع · بيانات الطقس الرسمية.

اسأل بحرية أو اختر سؤالاً سريعاً 👇`;

const WELCOME_EN = `Welcome to Smart Sugar AI — your advisor and senior sugar-market analyst.

I answer all market questions (prices, contracts, spreads, fundamental & technical analysis, global reports, procurement and hedging) based exclusively on trusted global sources: ICE · Yahoo Finance · Barchart · Reuters/Bloomberg and industry reports · official weather data.

Ask freely or pick a quick question 👇`;

const SUGGESTIONS = [
  'ما السعر الحالي لعقد Sugar No.11 واتجاهه؟',
  'حلّل لي قوى الصعود والهبوط في السوق هذا الأسبوع',
  'كم White Premium الآن؟ وهل هو مرتفع؟',
  'هل الآن وقت مناسب للشراء التدريجي؟',
  'كيف يؤثر طقس البرازيل والهند على أسعار السكر؟',
  'ما العوامل التي يجب أن أتابعها قبل قرار الشراء؟',
];

const SUGGESTIONS_EN = [
  'What is the current Sugar No.11 price and its trend?',
  'Analyse this week\u2019s bull and bear forces in the market',
  'What is the White Premium now? Is it high?',
  'Is now a good time to buy gradually?',
  'How do Brazil and India weather affect sugar prices?',
  'Which factors should I watch before a purchase decision?',
];

/* ---------- minimal safe markdown (escape first, then add tags) ---------- */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s: string) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function renderRich(text: string) {
  const lines = esc(text).split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const m = h ? /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(h[1]) : /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(line);
    const body = m ? m[1] : null;
    if (h && !m) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p><strong>${inlineMd(h[1])}</strong></p>`;
    } else if (m && body != null) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMd(body)}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      // blank markdown lines just separate blocks — <p> margins do the spacing
      if (line.trim() !== '') html += `<p>${inlineMd(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

/** Inventory/vessels live in localStorage only — send them so the analyst
 *  can answer procurement questions about THIS company instead of guessing. */
function readClientContext() {
  const out: { inventory?: unknown; vessels?: unknown } = {};
  try {
    const raw = localStorage.getItem('procurement-inventory-v3');
    if (raw) out.inventory = JSON.parse(raw);
  } catch { /* storage unavailable */ }
  try {
    const raw = localStorage.getItem('vessel-tracker-data');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        out.vessels = list.slice(0, 10).map((v: any) => ({
          name: v?.name, status: v?.status, destination: v?.destination, eta: v?.eta,
        }));
      }
    }
  } catch { /* storage unavailable */ }
  return out;
}

export default function ChatAssistant() {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: lang === 'en' ? WELCOME_EN : WELCOME, id: uid() }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // If the user flips the language before starting the conversation, the
  // welcome message follows; once chatting, history is left untouched.
  useEffect(() => {
    setMsgs((p) =>
      p.length === 1 && (p[0].content === WELCOME || p[0].content === WELCOME_EN)
        ? [{ ...p[0], content: lang === 'en' ? WELCOME_EN : WELCOME }]
        : p,
    );
  }, [lang]);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  useEffect(() => {
    if (open && textareaRef.current) textareaRef.current.focus();
  }, [open]);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    const userMsg: Msg = { role: 'user', content: text, id: uid() };
    setMsgs((p) => [...p, userMsg]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const history = [...msgs, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, client: readClientContext() }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response stream');

      const assistantId = uid();
      setMsgs((p) => [...p, { role: 'assistant', content: '', id: assistantId }]);

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(trimmed.slice(6));
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                setMsgs((p) =>
                  p.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
                );
              }
            } catch {
              /* ignore malformed sse */
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'فشل الاتصال', 'Connection failed'));
      setMsgs((p) => [
        ...p,
        {
          role: 'assistant',
          content: pick(
            lang,
            'عذراً، حدث خطأ في الاتصال بالمساعد الذكي. تأكد من إعداد مفتاح LLM_API_KEY في ملف .env',
            'Sorry, the assistant connection failed. Make sure LLM_API_KEY is set in the .env file',
          ),
          id: uid(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const showSuggestions = msgs.length === 1 && !busy;

  return (
    <>
      <button
        type="button"
        className="chatfab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? pick(lang, 'إغلاق المحادثة', 'Close chat') : pick(lang, 'فتح المحادثة', 'Open chat')}
        title={open ? pick(lang, 'إغلاق', 'Close') : pick(lang, 'مستشار أسواق السكر الذكي', 'Smart Sugar Market Advisor')}
      >
        {open ? '✕' : '🤖'}
      </button>

      {open && (
        <div className="chatpanel" dir="rtl">
          <div className="chathead">
            <span className="chathead__title">
              <i className="chathead__dot" />
              {pick(lang, 'المستشار الذكي — أسواق السكر', 'Smart Advisor — Sugar Markets')}
            </span>
            <span className="chathead__sub">
              {pick(lang, 'محلل خبير · مصادر عالمية موثوقة فقط (ICE · Yahoo · Reuters/Bloomberg)', 'Expert analyst · trusted global sources only (ICE · Yahoo · Reuters/Bloomberg)')}
            </span>
          </div>

          <div className="chatbody">
            {msgs.map((m) => (
              <div key={m.id} className={`chatmsg chatmsg--${m.role}`}>
                <div
                  className="chatmsg__bubble"
                  {...(m.role === 'assistant' ? { dangerouslySetInnerHTML: { __html: renderRich(m.content) } } : {})}
                >
                  {m.role === 'user' ? m.content : null}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chatmsg chatmsg--assistant">
                <div className="chatmsg__bubble chatmsg__bubble--typing">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            {showSuggestions && (
              <div className="chatsug">
                {(lang === 'en' ? SUGGESTIONS_EN : SUGGESTIONS).map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {error && <div className="chaterror">{error}</div>}
            <div ref={bottomRef} />
          </div>

          <div className="chatfoot">
            <textarea
              ref={textareaRef}
              className="chatinput"
              rows={1}
              placeholder={pick(lang, 'اسأل عن الأسعار، العقود، التحليل، التقارير...', 'Ask about prices, contracts, analysis, reports...')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={busy}
            />
            <button type="button" className="chatsend" onClick={() => send()} disabled={busy || !input.trim()}>
              {pick(lang, 'إرسال', 'Send')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

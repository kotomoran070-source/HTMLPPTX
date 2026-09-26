/** Цвета темы для {accent|…}: как в text-style.ts (здесь без импорта, чтобы html.ts не тянул зависимостей) */
const THEME_CSS: Record<string, string> = {
  accent: 'var(--ac)', accent2: 'var(--ach)', text: 'var(--tx)', text2: 'var(--tx2)', muted: 'var(--mu)',
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Экранирование для текста и значений атрибутов. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Адрес ссылки из текста: только http(s), mailto и tel. */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : null;
}

/**
 * Разметка внутри строки: **жирный**, *курсив*, __подчёркнутый__, [ссылка](https://…),
 * {#2563EB|цветной} или {accent|цвет темы}.
 * Строки, начинающиеся с «- », — пункты списка. \* и подобные — буквальный символ.
 */
function inline(line: string): string {
  const keep: string[] = [];
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`;
  // 1. Экранированные символы — как есть
  let s = line.replace(/\\([\\*_[\]()\-{])/g, (_, c: string) => hold(esc(c)));
  // 2. Ссылки: адрес прячем, чтобы * и _ в нём не превратились в оформление
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = safeUrl(url);
    return href ? `${hold(`<a class="md-a" href="${esc(href)}" target="_blank" rel="noopener">`)}${label}${hold('</a>')}` : m;
  });
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Цвет части текста: {#2563EB|текст} или {accent|текст}
    .replace(/\{(#[0-9a-f]{3,8}|accent2?|text2?|muted)\|([^{}]*?)\}/gi, (_, c: string, inner: string) =>
      `<span class="md-c" data-c="${c}" style="color:${THEME_CSS[c.toLowerCase()] ?? c}">${inner}</span>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

/** Текст из данных в HTML: экранирование, разметка, переносы строк и списки. */
export function t(value: unknown): string {
  const src = String(value ?? '').trim().replace(/\r/g, '');
  if (!src) return '';
  let out = '';
  let prevBlock = true;
  for (const line of src.split('\n')) {
    const li = /^[-•]\s+(.*)$/.exec(line);
    if (li) {
      out += `<span class="md-li">${inline(li[1])}</span>`;
      prevBlock = true;
    } else {
      out += (prevBlock ? '' : '<br>') + inline(line);
      prevBlock = false;
    }
  }
  return out;
}

/** Строка атрибута style из необязательного CSS блока. */
export function styleAttr(...parts: (string | number | undefined | null | false)[]): string {
  const css = parts.filter(Boolean).join(';');
  return css ? ` style="${esc(css)}"` : '';
}

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Число в русском формате: 1,6 */
export function num(v: number, digits?: number): string {
  const s = digits == null ? String(v) : v.toFixed(digits);
  return s.replace('.', ',');
}

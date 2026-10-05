import { textGradientCss } from './gradients';

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
 * Неразрывные пробелы при выводе (в данных их нет — при правке они снова обычные, см. serialize):
 * короткое слово не остаётся в конце строки («в», «и», «на», «для»), тире не начинает строку,
 * число не отрывается от своих разрядов и единиц («17 234», «5 км», «18 %»).
 */
const SHORT = /(^|[\s(«„"'|\u0000])([А-Яа-яЁёA-Za-z]{1,2}|[Дд]ля|[Бб]ез|[Пп]од|[Нн]ад|[Пп]ри|[Пп]ро|[Ии]з-за|[Ии]з-под) (?=\S)/g;
const UNIT = /(\d) (?=(?:[%‰°₽$€]|км|см|мм|м|кг|г|т|мс|с|мин|ч|сут|ГБ|МБ|КБ|ТБ|кГц|МГц|ГГц|Гц|дБм|дБ|кВт|Вт|В|А|руб|млн|млрд|тыс|шт|px|pt|ms|km|kg|GB|MB)(?![А-Яа-яЁёA-Za-z]))/g;
export function typo(s: string): string {
  return s
    .replace(SHORT, '$1$2\u00a0')
    // Второй проход: «и в доме» — оба коротких подряд
    .replace(SHORT, '$1$2\u00a0')
    .replace(/ ([—–])(?=\s)/g, '\u00a0$1')
    .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0')
    .replace(UNIT, '$1\u00a0');
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
  // Формулы {{price*2}} (видны при правке) — как есть: * там умножение, а не курсив
  s = s.replace(/\{\{[^{}]*\}\}/g, (m) => hold(esc(m)));
  // 2. Ссылки: адрес прячем, чтобы * и _ в нём не превратились в оформление
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = safeUrl(url);
    return href ? `${hold(`<a class="md-a" href="${esc(href)}" target="_blank" rel="noopener">`)}${label}${hold('</a>')}` : m;
  });
  s = esc(typo(s))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    // Цвет части текста: {#2563EB|текст} или {accent|текст}
    .replace(/\{(#[0-9a-f]{3,8}|accent2?|text2?|muted)\|([^{}]*?)\}/gi, (_, c: string, inner: string) =>
      `<span class="md-c" data-c="${c}" style="color:${THEME_CSS[c.toLowerCase()] ?? c}">${inner}</span>`)
    // Градиент части текста: {g:ocean|текст}
    .replace(/\{(g:[a-z-]+)\|([^{}]*?)\}/gi, (m, c: string, inner: string) => {
      const css = textGradientCss(c);
      return css ? `<span class="md-c md-g" data-c="${c}" style="${css}">${inner}</span>` : m;
    });
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

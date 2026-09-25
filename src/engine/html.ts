const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Экранирование для текста и значений атрибутов. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Текст из данных: экранирование, **жирный** и переносы строк. */
export function t(value: unknown): string {
  return esc(String(value ?? '').trim())
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
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

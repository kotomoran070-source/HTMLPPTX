/**
 * Короткая подпись объекта для списков студии (область выделения, «Анимация», дерево кода). Отдельным модулем:
 * раньше она жила в code-tree.ts рядом с редактором кода, и ради неё студия при каждом открытии грузила
 * CodeMirror и yaml — треть своего файла (docs/AUDIT.md)
 */

/** Текст без разметки, одной строкой, не длиннее подписи */
export const clean = (v: string) => v.replace(/\{[^|}]*\|([^}]*)\}/g, '$1').replace(/[*_`[\]#]/g, '').replace(/\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);

/** Короткая подпись узла: первый текст блока без разметки. */
export function snippet(o: Record<string, unknown>): string {
  for (const k of ['title', 'text', 'label', 'value', 'name', 'heading', 'caption']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return clean(v);
  }
  if (Array.isArray(o.header)) return o.header.filter((x) => typeof x === 'string').join(' · ').slice(0, 48);
  // Импортированная вёрстка: первые слова её текста, а если текста нет — картинка
  // Вёрстка с текстами отдельным списком (импорт, разобранный шаблон): первые из них
  if (Array.isArray(o.texts)) {
    const t = o.texts.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3).join(' ');
    if (t) return clean(t);
  }
  if (typeof o.html === 'string') {
    const text = o.html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 48);
    const alt = /<img[^>]*alt="([^"]+)"/i.exec(o.html)?.[1];
    return alt ? `картинка «${alt}»` : /<(img|svg)/i.test(o.html) ? 'картинка' : '';
  }
  return '';
}

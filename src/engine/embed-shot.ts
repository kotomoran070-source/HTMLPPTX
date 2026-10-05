import { embedHtml } from '../components/html/html';
import { snapshot } from './import-ui';

/**
 * Снимок живой вставки (embed) картинкой PNG — для заставки, PPTX и печати.
 * Документ отрабатывает в изолированной рамке (скрипты, canvas), затем снимок без скриптов
 * рисуется в картинку. light — в цветах светлой темы (так снимается заставка).
 * Не вышло (ошибка, пустой документ) — null.
 */
export async function embedShot(
  p: { src?: string; code?: string; theme?: boolean },
  w: number, h: number, o: { light?: boolean; pixelRatio?: number; from?: Element | null } = {},
): Promise<string | null> {
  try {
    const snap = await snapshot(await embedHtml(p, o.light, o.from), { w, h });
    if (!snap) return null;
    const { toPng } = await import('html-to-image');
    const f = document.createElement('iframe');
    // Без скриптов: снимок только показывается, поэтому рамке можно дать доступ к её документу
    f.setAttribute('sandbox', 'allow-same-origin');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px;border:0`;
    document.body.appendChild(f);
    try {
      await new Promise((r) => { f.onload = r; f.srcdoc = snap; setTimeout(r, 4000); });
      const doc = f.contentDocument;
      if (!doc) return null;
      await doc.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return await toPng(doc.documentElement, { pixelRatio: o.pixelRatio ?? 2, skipFonts: true, width: w, height: h });
    } finally {
      f.remove();
    }
  } catch {
    return null;
  }
}

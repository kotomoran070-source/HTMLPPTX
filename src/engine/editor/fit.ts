/**
 * Сколько можно сжать объект на слайде: не меньше 20 px по каждой стороне (у маленькой рамки остаются только угловые
 * ручки, block-edit). Объект с текстом — не ниже высоты, на которой текст виден целиком (у таблицы — свои строки)
 */

/** Внутри — рамка со своей страницей или живая сцена: текст в ней отсюда не измерить */
const OPAQUE = new Set(['embed', 'sandbox', 'video', 'model', 'table']);

/** Самый малый размер объекта, px слайда */
export function minSize(_b: unknown): { w: number; h: number } {
  return { w: 20, h: 20 };
}

/**
 * Высота, ниже которой текст объекта обрезается. Снимок — при текущем размере: что уже скрыто (бегущая строка,
 * барабан «Числа набегают», сжатое раньше), то и дальше не считается. min(h) — при ширине, которая сейчас стоит
 * у элемента: h, если текст влезает, иначе наименьшая высота, при которой влезает (null — не влезает и в натуральную)
 */
export class ContentFit {
  private texts: HTMLElement[];
  private clips: HTMLElement[];
  private cache = new Map<number, number | null>();

  private constructor(private el: HTMLElement) {
    const all = [...el.querySelectorAll<HTMLElement>('*')];
    this.texts = all.filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && !!n.textContent?.trim()));
    this.clips = [el, ...all.filter((x) => { const cs = getComputedStyle(x); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; })];
    const hidden = new Set(this.clipped());
    this.texts = this.texts.filter((t) => !hidden.has(t));
  }

  /** null — проверять нечего: текста нет или он внутри вставки */
  static of(el: HTMLElement, block: unknown): ContentFit | null {
    if (OPAQUE.has(String((block as { type?: unknown } | null)?.type))) return null;
    const f = new ContentFit(el);
    return f.texts.length ? f : null;
  }

  private clipped(): HTMLElement[] {
    const boxes = this.clips.map((c) => [c, c.getBoundingClientRect()] as const);
    return this.texts.filter((t) => {
      const r = t.getBoundingClientRect();
      if (!r.height) return false;
      return boxes.some(([c, q]) => c.contains(t) && (r.bottom > q.bottom + 1.5 || r.top < q.top - 1.5));
    });
  }

  private fitsAt(h: number): boolean {
    this.el.style.height = `${h}px`;
    return this.clipped().length === 0;
  }

  min(h: number): number {
    const was = this.el.style.height;
    const w = Math.round(this.el.offsetWidth);
    const known = this.cache.get(w);
    let out = h;
    if (known !== undefined) out = known === null ? h : Math.max(h, known);
    else if (!this.fitsAt(h)) {
      // Влезает в натуральную высоту — ищем наименьшую делением пополам; нет — не мешаем
      this.el.style.height = '';
      let hi = this.el.offsetHeight;
      if (hi <= h || !this.fitsAt(hi)) this.cache.set(w, null);
      else {
        let lo = h;
        while (hi - lo > 2) {
          const mid = Math.round((lo + hi) / 2);
          if (this.fitsAt(mid)) hi = mid;
          else lo = mid;
        }
        this.cache.set(w, hi);
        out = hi;
      }
    }
    this.el.style.height = was;
    return out;
  }
}

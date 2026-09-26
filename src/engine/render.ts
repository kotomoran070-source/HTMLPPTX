import type { Block, Deck, SlideData } from '../types';
import {
  blockNames, getBlock, getTemplate, templateNames,
  type Component, type MountCtx, type RenderCtx,
} from './component';
import { asArray, esc } from './html';
import { applyDeckCss } from './deck-css';
import { indexPaths, pathOf } from './marks';

let uidCounter = 0;

/** Эффекты появления свободных объектов: enter: rise (см. base.css) */
const FX = new Set(['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop']);

interface PendingMount {
  component: Component;
  props: unknown;
}

/**
 * Превращает данные слайдов в разметку. Один Renderer — одна вставка в DOM:
 * он запоминает, каким компонентам нужен mount(), и вызывает их в activate().
 */
export class Renderer {
  private mounts = new Map<string, PendingMount>();
  private cssKey: string | null;

  constructor(private deck: Deck, private logo?: string) {
    // Пути нужны для режима правки: каждый элемент знает, какое значение он показывает
    indexPaths(deck);
    // Стили презентации (из импортированного HTML) — только внутри её слайдов-холстов
    this.cssKey = applyDeckCss((deck as { css?: unknown }).css);
  }

  slide(slide: SlideData, index: number, extraClass = ''): string {
    const name = slide.template ?? 'content';
    const tpl = getTemplate(name);
    const ctx = this.ctx(slide, index);
    let inner: string;
    let cls = 'slide';
    let attrs = '';
    if (!tpl) {
      inner = errorBox(`Неизвестный шаблон слайда «${esc(name)}». Доступны: ${templateNames().join(', ')}`);
    } else {
      inner = safe(() => tpl.render(slide, ctx), `шаблоне «${name}»`);
      if (tpl.className) cls += ' ' + tpl.className;
      if (tpl.mount) attrs = ctx.mount(tpl, slide);
    }
    if (extraClass) cls += ' ' + extraClass;
    if (this.cssKey) attrs += ` data-css="${this.cssKey}"`;
    return `<section class="${cls}" data-index="${index}" data-tpl="${esc(name)}"${attrs}>${inner}${this.freeLayer(slide, ctx)}</section>`;
  }

  /**
   * Свободные объекты слайда (slide.free): лежат поверх раскладки на своих координатах.
   * place: { x, y, w, h } — в пикселях слайда 1280×720; без h высота по содержимому.
   * enter: rise (fade, drop, left, right, scale, pop) и delay: 380 — появление при открытии слайда.
   */
  private freeLayer(slide: SlideData, ctx: RenderCtx): string {
    const list = Array.isArray(slide.free) ? (slide.free as Block[]) : [];
    return list.map((b, i) => {
      const pl = placeOf(b);
      const p = pathOf(b);
      const fx = FX.has(String(b.enter)) ? ` fx fx-${b.enter}` : '';
      const delay = fx && Number(b.delay) > 0 ? `--fx-d:${Math.min(20000, Math.round(Number(b.delay)))}ms;` : '';
      const css = `left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;${pl.h ? `height:${pl.h}px;` : ''}z-index:${10 + i};${delay}`;
      return `<div class="free${pl.h ? '' : ' auto-h'}${fx}"${p ? ` data-free="${esc(JSON.stringify(p))}"` : ''} style="${css}">${this.block(b, ctx)}</div>`;
    }).join('');
  }

  /** Вызывает mount() у всех компонентов внутри root. Возвращает функцию очистки. */
  activate(root: HTMLElement, base: Omit<MountCtx, 'slide'>): () => void {
    const cleanups: (() => void)[] = [];
    root.querySelectorAll<HTMLElement>('[data-mount]').forEach((el) => {
      const m = this.mounts.get(el.dataset.mount!);
      if (!m?.component.mount) return;
      const slide = el.closest<HTMLElement>('.slide') ?? root;
      try {
        const c = m.component.mount(el, m.props, { ...base, slide });
        if (typeof c === 'function') cleanups.push(c);
      } catch (e) {
        console.error('Ошибка mount()', e);
      }
    });
    return () => cleanups.forEach((c) => c());
  }

  private ctx(slide: SlideData, index: number): RenderCtx {
    const ctx: RenderCtx = {
      deck: this.deck,
      slide,
      index,
      logo: this.logo,
      block: (b) => asArray(b).map((item) => this.block(item, ctx)).join(''),
      mount: (component, props) => {
        const id = 'm' + ++uidCounter;
        this.mounts.set(id, { component, props });
        return ` data-mount="${id}"`;
      },
      uid: (prefix = 'u') => `${prefix}${++uidCounter}`,
    };
    return ctx;
  }

  private block(b: Block, ctx: RenderCtx): string {
    if (b == null || typeof b !== 'object') return errorBox(`Ожидался блок с полем type, получено: ${esc(JSON.stringify(b))}`);
    const c = getBlock(b.type);
    if (!c) return errorBox(`Неизвестный компонент «${esc(b.type)}». Доступны: ${blockNames().join(', ')}`);
    let html = safe(() => c.render(b, ctx), `компоненте «${b.type}»`);
    // Корень блока знает свой путь: режим правки выделяет, открепляет и удаляет блоки
    const p = pathOf(b);
    const attrs = (c.mount ? ctx.mount(c, b) : '') + (p ? ` data-block="${esc(JSON.stringify(p))}" data-type="${esc(b.type)}"` : '');
    if (attrs) html = html.replace(/^(\s*)<([a-z0-9-]+)/i, `$1<$2${attrs}`);
    return html;
  }
}

function safe(fn: () => string, what: string): string {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return errorBox(`Ошибка в ${what}: ${esc((e as Error).message)}`);
  }
}

export function errorBox(msg: string): string {
  return `<div class="block-error">${msg}</div>`;
}

/** Название слайда для обзора и режима докладчика. */
export function slideLabel(slide: SlideData, index: number): string {
  return slide.label ?? slide.title ?? `Слайд ${index + 1}`;
}

export interface Place { x: number; y: number; w: number; h?: number }

/** Координаты свободного объекта с проверкой и значениями по умолчанию. */
export function placeOf(b: unknown): Place {
  const pl = (b as { place?: Partial<Place> })?.place ?? {};
  const n = (v: unknown, d: number, min: number, max: number) => {
    const x = Number(v);
    // Десятые доли пикселя: импортированная вёрстка (1920 → 1280) переносится без сдвигов
    return Number.isFinite(x) ? Math.round(Math.max(min, Math.min(max, x)) * 10) / 10 : d;
  };
  const h = Number(pl.h);
  return {
    x: n(pl.x, 440, -1280, 2560),
    y: n(pl.y, 300, -720, 1440),
    w: n(pl.w, 400, 20, 2560),
    h: Number.isFinite(h) && h > 0 ? n(h, 0, 20, 1440) : undefined,
  };
}

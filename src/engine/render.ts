import type { Block, Deck, SlideData } from '../types';
import {
  blockNames, getBlock, getTemplate, templateNames,
  type Component, type MountCtx, type RenderCtx,
} from './component';
import { asArray, esc } from './html';
import { applyDeckCss, applyDeckDefs, applyScopedCss } from './deck-css';
import { indexPaths, pathOf } from './marks';

/** Переходы между слайдами (slide.transition); без поля — стандартное появление */
export const TRANSITION_IDS = new Set(['none', 'fade', 'push', 'cover', 'zoom', 'blur']);

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
    applyDeckDefs((deck as { defs?: unknown }).defs);
    // Вёрстка из других презентаций — со своими стилями, в своём пространстве
    applyScopedCss(deck.scoped);
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
    // Слайд целиком из другой презентации (его вёрстка в своём пространстве стилей) — без стилей
    // этой: иначе её переменные и правила (:root, .slide) перекрасили бы чужую вёрстку
    const body = slide.body as { type?: unknown; ns?: unknown } | undefined;
    const foreign = !!body && !Array.isArray(body) && body.type === 'html' && typeof body.ns === 'string';
    if (this.cssKey && !foreign) attrs += ` data-css="${this.cssKey}"`;
    // Переход к слайду и его длительность
    if (typeof slide.transition === 'string' && TRANSITION_IDS.has(slide.transition)) attrs += ` data-tr="${slide.transition}"`;
    const trMs = Number(slide.transitionMs);
    if (trMs > 0) attrs += ` style="--tr-ms:${Math.min(3000, Math.round(trMs))}ms"`;
    // Живой слайд: исходный файл в рамке поверх обычной копии (см. components/live)
    const empty = !slide.body && !(Array.isArray(slide.free) && slide.free.length);
    const live = slide.live && typeof slide.live === 'object'
      ? this.block({ ...(slide.live as object), type: 'live', empty, label: slideLabel(slide, index) } as Block, ctx) : '';
    if (live) cls += ' live-slide';
    // Анимированный фон (частицы, сияние, сетка): первым слоем, под содержимым
    const kind = slide.backdrop;
    const backdrop = typeof kind === 'string' && ['particles', 'aurora', 'grid'].includes(kind) && getBlock('backdrop')
      ? this.block({ type: 'backdrop', kind } as Block, ctx) : '';
    if (backdrop) cls += ' has-backdrop';
    return `<section class="${cls}" data-index="${index}" data-tpl="${esc(name)}"${attrs}>${backdrop}${inner}${this.freeLayer(slide, ctx)}${live}</section>`;
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
      // Свой эффект: имя анимации и её время — из deck.effects
      const own = !FX.has(String(b.enter)) && typeof b.enter === 'string' && /^ufx-[\w-]+$/.test(b.enter) ? this.deck.effects?.[b.enter] : undefined;
      const fx = FX.has(String(b.enter)) ? ` fx fx-${b.enter}` : own ? ' fx fx-own' : '';
      const delay = fx && Number(b.delay) > 0 ? `--fx-d:${Math.min(20000, Math.round(Number(b.delay)))}ms;` : '';
      const ownCss = own
        ? `--fx:${b.enter};--fx-ms:${Math.max(100, Math.min(4000, Math.round(Number(own.ms) || 600)))}ms;${typeof own.ease === 'string' && /^[\w\s().,-]+$/.test(own.ease) ? `--fx-ease:${own.ease};` : ''}`
        : '';
      const css = `left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;${pl.h ? `height:${pl.h}px;` : ''}z-index:${10 + i};${delay}${ownCss}`;
      // Закреплённый объект в редакторе не выделяется мышью (см. editor.css)
      const lock = b.locked === true ? ' locked' : '';
      return `<div class="free${pl.h ? '' : ' auto-h'}${fx}${lock}"${p ? ` data-free="${esc(JSON.stringify(p))}"` : ''} style="${css}">${this.block(b, ctx)}</div>`;
    }).join('');
  }

  /** Вызывает mount() у всех компонентов внутри root. Возвращает функцию очистки. */
  activate(root: HTMLElement, base: Omit<MountCtx, 'slide'>): () => void {
    const cleanups: (() => void)[] = [];
    // Корень тоже может быть компонентом (слайд с mount() у шаблона)
    const els = [...(root.matches('[data-mount]') ? [root] : []), ...root.querySelectorAll<HTMLElement>('[data-mount]')];
    els.forEach((el) => {
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
  const raw = slide.label ?? slide.title;
  return typeof raw === 'string' && raw.trim() ? plainText(raw) : `Слайд ${index + 1}`;
}

/** Текст без разметки для подписей: {цвет|слова} → слова, без ** __ * и ссылок */
function plainText(s: string): string {
  return s.replace(/\{[^{}|]+\|([^{}]*)\}/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*/g, (_m, a, b, c) => a ?? b ?? c).replace(/\s+/g, ' ').trim();
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

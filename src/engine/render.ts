import type { Block, Deck, SlideData } from '../types';
import {
  blockNames, getBlock, getTemplate, templateNames,
  type Component, type MountCtx, type RenderCtx,
} from './component';
import { asArray, esc } from './html';
import { applyDeckCss, applyDeckDefs, applyScopedCss } from './deck-css';
import { applyDeckFonts } from './fonts';
import { indexPaths, pathOf } from './marks';
import { controlRange, deriveVars, hasFormula, resolve, type ControlProps } from './formula';

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
  private fontKey: string | null;

  constructor(private deck: Deck, private logo?: string, private varsOverride?: Map<number, Record<string, number>>) {
    // Пути нужны для режима правки: каждый элемент знает, какое значение он показывает
    indexPaths(deck);
    // Стили презентации (из импортированного HTML) — только внутри её слайдов-холстов
    this.cssKey = applyDeckCss((deck as { css?: unknown }).css);
    applyDeckDefs((deck as { defs?: unknown }).defs);
    // Свои шрифты презентации и её шрифт по умолчанию
    this.fontKey = applyDeckFonts(deck.fonts, deck.theme?.font);
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
    if (this.fontKey) attrs += ` data-fonts="${this.fontKey}"`;
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
      const ang = angleOf(b);
      const css = `left:${pl.x}px;top:${pl.y}px;width:${pl.w}px;${pl.h ? `height:${pl.h}px;` : ''}${ang ? `rotate:${ang}deg;` : ''}z-index:${10 + i};${delay}${ownCss}`;
      // Закреплённый объект в редакторе не выделяется мышью (см. editor.css)
      const lock = b.locked === true ? ' locked' : '';
      // Действие по щелчку при показе: переход к слайду или ссылка
      const act = actionOf(b.action);
      // Имя объекта — для кнопок «показать / скрыть»; hidden — скрыт при показе до щелчка
      const obj = typeof b.id === 'string' && OBJ_ID.test(b.id) ? ` data-obj="${esc(b.id)}"` : '';
      const hid = b.hidden === true ? ' trig-hid' : '';
      const emph = typeof b.emphasis === 'string' && (EMPHASIS as readonly string[]).includes(b.emphasis) ? ` data-emph="${b.emphasis}"` : '';
      return `<div class="free${pl.h ? '' : ' auto-h'}${fx}${lock}${act ? ' act' : ''}${hid}"${p ? ` data-free="${esc(JSON.stringify(p))}"` : ''}${obj}${emph}${hid ? ' data-hid' : ''}${act ? ` data-action="${esc(act)}"` : ''} style="${css}">${this.block(b, ctx)}</div>`;
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

  /** Переменные слайда: начальные значения его ползунков, поверх — то, что выставили при показе */
  slideVars(slide: SlideData, index: number): Record<string, number> {
    const vars: Record<string, number> = {};
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      const b = v as Block;
      if (b.type === 'control' && typeof b.name === 'string' && b.name) vars[b.name] = controlRange(b as ControlProps).value;
      for (const k of ['body', 'free', 'items', 'visual']) if (k in b) walk((b as Record<string, unknown>)[k]);
    };
    walk(slide.body);
    walk(slide.free);
    return deriveVars(slide.vars, { ...vars, ...(this.varsOverride?.get(index) ?? {}) });
  }

  /** Разметка одного блока слайда — для пересчёта при движении ползунка */
  blockHtml(b: Block, slide: SlideData, index: number): string {
    return this.block(b, this.ctx(slide, index));
  }

  private ctx(slide: SlideData, index: number): RenderCtx {
    const ctx: RenderCtx = {
      vars: this.slideVars(slide, index),
      deck: this.deck,
      slide,
      index,
      logo: this.logo,
      logoDark: this.deck.brand?.logoDark,
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
    // Формулы («=x*2», «{{x}}») — по переменным слайда; копия знает те же пути для правки
    const p = pathOf(b);
    let calc = false;
    if (b.type !== 'control' && ctx.vars && Object.keys(ctx.vars).length && hasFormula(b)) {
      const rb = resolve(b, ctx.vars);
      if (p) indexPaths(rb, p);
      b = rb;
      calc = true;
    }
    let html = safe(() => c.render(b, ctx), `компоненте «${b.type}»`);
    // Корень блока знает свой путь: режим правки выделяет, открепляет и удаляет блоки
    const attrs = (c.mount ? ctx.mount(c, b) : '') + (p ? ` data-block="${esc(JSON.stringify(p))}" data-type="${esc(b.type)}"` : '')
      // Пересчёт подменяет разметку на месте; вёрстку (html) так обновлять можно, остальное с mount — нет
      + (calc && (!c.mount || b.type === 'html') ? ' data-calc' : '');
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
/** Куда ведёт действие: номер слайда или адрес ссылки */
export function actionTarget(action: string, deck: Deck, index: number): { slide: number } | { url: string } | null {
  if (TRIGGER.test(action)) return null;
  const n = deck.slides.length;
  if (action === 'next') return index + 1 < n ? { slide: index + 1 } : null;
  if (action === 'prev') return index > 0 ? { slide: index - 1 } : null;
  if (action === 'first') return { slide: 0 };
  if (action === 'last') return { slide: n - 1 };
  if (action.startsWith('slide:')) {
    const id = action.slice(6);
    const k = deck.slides.findIndex((s) => s.id === id);
    return k >= 0 ? { slide: k } : null;
  }
  return { url: action };
}

/** Имя свободного объекта (id): латиница, цифры, «-» и «_» */
export const OBJ_ID = /^[\w-]+$/;

/**
 * Действие над объектами слайда: show:<id>, hide:<id>, toggle:<id>, play:<id> (проиграть анимацию); объектов — несколько через запятую,
 * команд — несколько через «;» (вкладки: «show:a;hide:b,c»)
 */
export const TRIGGER = /^(show|hide|toggle|play):[\w-]+(,[\w-]+)*(;(show|hide|toggle|play):[\w-]+(,[\w-]+)*)*$/;

/** Анимации выделения по кнопке (play:<id>): иначе объект заново играет своё появление */
export const EMPHASIS = ['pulse', 'shake', 'spin', 'bounce', 'flash'] as const;

/**
 * Действие объекта по щелчку при показе: next, prev, first, last, slide:<id слайда>
 * ссылка (https://…, mailto:, tel:) или show/hide/toggle:<id объекта>. Остальное — без действия.
 */
export function actionOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const a = v.trim();
  if (/^(next|prev|first|last)$/.test(a) || /^slide:[\w-]+$/.test(a) || TRIGGER.test(a)) return a;
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(a)) return a;
  return null;
}

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

/**
 * Поворот свободного объекта, градусы по часовой (поле angle рядом с place): вокруг центра,
 * как в PowerPoint. 0 и мусор — без поворота
 */
export function angleOf(b: unknown): number {
  const a = Number((b as { angle?: unknown })?.angle);
  if (!Number.isFinite(a)) return 0;
  const n = Math.round((((a % 360) + 540) % 360 - 180) * 10) / 10;
  return n === -180 ? 180 : n;
}

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

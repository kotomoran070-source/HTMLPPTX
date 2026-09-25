import type { Block, Deck, SlideData } from '../types';
import {
  blockNames, getBlock, getTemplate, templateNames,
  type Component, type MountCtx, type RenderCtx,
} from './component';
import { asArray, esc } from './html';

let uidCounter = 0;

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

  constructor(private deck: Deck, private logo?: string) {}

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
    return `<section class="${cls}" data-index="${index}" data-tpl="${esc(name)}"${attrs}>${inner}</section>`;
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
    if (c.mount) html = html.replace(/^(\s*)<([a-z0-9-]+)/i, `$1<$2${ctx.mount(c, b)}`);
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

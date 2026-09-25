import type { Block, Deck, SlideData } from '../types';

export interface RenderCtx {
  deck: Deck;
  slide: SlideData;
  index: number;
  /** URL логотипа из brand.logo (уже с учётом сборки) */
  logo?: string;
  /** Рендер вложенного блока или списка блоков */
  block(b: Block | Block[] | undefined): string;
  /** Атрибут data-mount: после вставки в DOM у компонента вызовется mount() */
  mount(component: Component<any>, props: unknown): string;
  /** Уникальный id в пределах документа (для SVG-градиентов и т.п.) */
  uid(prefix?: string): string;
}

export interface MountCtx {
  stage: HTMLElement;
  slide: HTMLElement;
  reducedMotion: boolean;
}

export interface Component<P = any> {
  /** Возвращает HTML-разметку. Должна быть самодостаточной: миниатюры и печать используют только её. */
  render(props: P, ctx: RenderCtx): string;
  /** Необязательная интерактивность: подсветка, параллакс и т.п. */
  mount?(el: HTMLElement, props: P, ctx: MountCtx): void | (() => void);
}

export interface SlideTemplate<P = any> extends Component<P> {
  /** Дополнительные классы для <section class="slide ..."> */
  className?: string;
  /** Скрывать логотип в углу и общий фон-сетку */
  bare?: boolean;
}

const blocks = new Map<string, Component>();
const templates = new Map<string, SlideTemplate>();

export function defineBlock<P>(name: string, c: Component<P>): Component<P> {
  blocks.set(name, c as Component);
  return c;
}

export function defineTemplate<P>(name: string, c: SlideTemplate<P>): SlideTemplate<P> {
  templates.set(name, c as SlideTemplate);
  return c;
}

export function getBlock(name: string): Component | undefined {
  return blocks.get(name);
}

export function getTemplate(name: string): SlideTemplate | undefined {
  return templates.get(name);
}

export function blockNames(): string[] {
  return [...blocks.keys()].sort();
}

export function templateNames(): string[] {
  return [...templates.keys()].sort();
}

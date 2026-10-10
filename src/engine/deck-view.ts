import type { Block, Deck } from '../types';
import { countUp } from './count-up';
import { morph as morphTo, unmorph } from './morph';
import { getAt, type Path } from './data';
import { Renderer } from './render';

export const W = 1280;
export const H = 720;

/** Прожектор: раскладки (выделяется то, что в них) и украшения — не выделяются */
const SPOT_LAYOUT = new Set(['grid', 'stack', 'spacer']);
const SPOT_DECOR = new Set(['shape', 'backdrop', 'spacer', 'qr']);
const SPOT_LINE = new Set(['text', 'note', 'chips']);

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Все слайды колоды на одной сцене 1280×720; показывается слайд с классом .on */
export class DeckView {
  readonly stage: HTMLElement;
  slides: HTMLElement[] = [];
  private current = -1;
  /** Очистка mount() каждого слайда: слайд можно перерисовать отдельно */
  private cleanups: ((() => void) | null)[] = [];
  /** Данные, по которым нарисован каждый слайд, и общие поля презентации */
  private sigs: string[] = [];
  private deckSig = '';
  private deck!: Deck;
  private r!: Renderer;
  /** Значения ползунков, выставленные при показе (по слайдам): переживают перерисовку */
  private vars = new Map<number, Record<string, number>>();

  constructor(deck: Deck, container: HTMLElement) {
    this.stage = document.createElement('div');
    this.stage.className = 'stage canvas';
    container.appendChild(this.stage);
    this.build(deck);
    // Ползунок на слайде сдвинули: пересчитать связанные с ним блоки
    this.stage.addEventListener('slideria:var', (e) => {
      const d = (e as CustomEvent<{ name: string; value: number }>).detail;
      const i = Number((e.target as Element).closest<HTMLElement>('.slide')?.dataset.index);
      if (!Number.isInteger(i) || !d) return;
      this.vars.set(i, { ...(this.vars.get(i) ?? {}), [d.name]: d.value });
      this.recalc(i);
      // Для второго окна (докладчик ↔ показ)
      dispatchEvent(new CustomEvent('slideria:vars', { detail: { index: i, vars: this.vars.get(i) } }));
    });
  }

  /**
   * Пауза сцены (экономный режим пульта на телефоне): CSS- и SVG-анимации замирают,
   * живые вставки и песочница уступают место заставке. Слайд при этом виден и листается.
   */
  private paused = false;
  setPaused(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    this.stage.classList.toggle('paused', on);
    this.stage.querySelectorAll<SVGSVGElement>('svg').forEach((s) => {
      if (s.parentElement?.closest('svg')) return;
      if (on) s.pauseAnimations?.();
      else s.unpauseAnimations?.();
    });
  }

  /** Код песочницы пришёл из другого окна показа: редактор и результат — те же */
  setCode(i: number, block: string, code: string, run = false): void {
    const el = [...(this.slides[i]?.querySelectorAll<HTMLElement>('[data-type="sandbox"][data-block]') ?? [])].find((x) => x.dataset.block === block);
    el?.dispatchEvent(new CustomEvent('slideria:set-code', { detail: { code, run } }));
  }

  /** Значения ползунков пришли из другого окна: ползунки встают туда же, связанные блоки пересчитываются */
  setVars(i: number, vars: Record<string, number>): void {
    const el = this.slides[i];
    if (!el) return;
    this.vars.set(i, { ...(this.vars.get(i) ?? {}), ...vars });
    el.querySelectorAll<HTMLElement>('[data-type="control"]').forEach((c) => {
      for (const [name, value] of Object.entries(vars)) c.dispatchEvent(new CustomEvent('slideria:set-var', { detail: { name, value } }));
    });
    this.recalc(i);
  }

  /**
   * Кнопка «показать / скрыть»: show:a, hide:a, toggle:a,b — объекты слайда с этими id.
   * Появление — эффектом объекта (или подъёмом), исчезновение — плавным растворением.
   */
  trigger(i: number, action: string): boolean {
    const el = this.slides[i];
    const cmds = action.split(';').map((c) => /^(show|hide|toggle|play):(.+)$/.exec(c.trim()));
    if (!el || !cmds.length || cmds.some((m) => !m)) return false;
    // Несколько команд за щелчок: «show:a;hide:b,c» — так из кнопок собираются вкладки
    for (const m of cmds as RegExpExecArray[]) this.apply(el, m[1], m[2].split(','));
    return true;
  }

  private apply(el: HTMLElement, verb: string, ids: string[]): void {
    el.querySelectorAll<HTMLElement>(':scope > .free[data-obj]').forEach((o) => {
      if (!ids.includes(o.dataset.obj!)) return;
      if (verb === 'play') {
        // Заново: выделение (pulse, shake…) или появление объекта; скрытый объект при этом появляется
        clearTimeout(Number(o.dataset.trigT));
        o.classList.remove('trig-in', 'trig-out', 'trig-hid', 'trig-play');
        void o.offsetWidth;
        o.classList.add('trig-play');
        restartGifs(o);
        return;
      }
      const hidden = o.classList.contains('trig-hid') || o.classList.contains('trig-out');
      const show = verb === 'show' || (verb === 'toggle' && hidden);
      if (show === !hidden) return;
      clearTimeout(Number(o.dataset.trigT));
      o.classList.remove('trig-in', 'trig-out', 'trig-hid', 'trig-play');
      void o.offsetWidth;
      if (show) {
        o.classList.add('trig-in');
        restartGifs(o);
      } else {
        o.classList.add('trig-out');
        o.dataset.trigT = String(window.setTimeout(() => { o.classList.replace('trig-out', 'trig-hid'); }, reducedMotion() ? 0 : 260));
      }
    });
  }

  /** При заходе на слайд объекты снова в начальном виде: скрытые до щелчка — скрыты */
  private static resetTriggers(el: HTMLElement | undefined): void {
    el?.querySelectorAll<HTMLElement>(':scope > .free.trig-in, :scope > .free.trig-out, :scope > .free.trig-hid, :scope > .free.trig-play, :scope > .free[data-hid]').forEach((o) => {
      clearTimeout(Number(o.dataset.trigT));
      o.classList.remove('trig-in', 'trig-out', 'trig-play');
      o.classList.toggle('trig-hid', o.hasAttribute('data-hid'));
    });
  }

  /** Блоки слайда с формулами — заново по текущим значениям; в разметке меняется только отличающееся */
  private recalc(i: number): void {
    const el = this.slides[i];
    const slide = this.deck.slides[i];
    if (!el || !slide) return;
    el.querySelectorAll<HTMLElement>('[data-calc]').forEach((node) => {
      if (node.parentElement?.closest('[data-calc]')) return;
      let path: Path;
      try { path = JSON.parse(node.dataset.block ?? ''); } catch { return; }
      const b = getAt(this.deck, path) as Block | undefined;
      if (!b) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = this.r.blockHtml(b, slide, i);
      const fresh = tmp.firstElementChild;
      if (fresh) morph(node, fresh);
    });
  }

  private base() {
    return { stage: this.stage, reducedMotion: reducedMotion() };
  }

  /** Порядок появления блоков: каждому .r на слайде — свой индекс задержки. */
  private static order(slide: HTMLElement): void {
    slide.querySelectorAll<HTMLElement>('.r').forEach((e, k) => e.style.setProperty('--i', String(k)));
  }

  /** Перерисовывает все слайды из данных, оставаясь на текущем слайде. */
  build(deck: Deck): void {
    this.cleanups.forEach((c) => c?.());
    const r = new Renderer(deck, deck.brand?.logo, this.vars);
    this.r = r;
    this.deck = deck;
    // Слой указки и другие вложения сцены не относятся к слайдам: сохраняем их
    const extras = [...this.stage.children].filter((el) => !el.classList.contains('slide'));
    this.stage.innerHTML = deck.slides.map((s, i) => r.slide(s, i)).join('');
    extras.forEach((el) => this.stage.appendChild(el));
    this.slides = [...this.stage.querySelectorAll<HTMLElement>(':scope > .slide')];
    this.slides.forEach(DeckView.order);
    this.cleanups = this.slides.map((el) => r.activate(el, this.base()));
    this.sigs = deck.slides.map((s) => JSON.stringify(s));
    this.deckSig = deckSignature(deck);
    const cur = this.current;
    this.current = -1;
    if (cur >= 0 && this.slides.length) this.show(Math.min(cur, this.slides.length - 1));
  }

  /**
   * Перерисовывает только изменившиеся слайды: остальные остаются как есть —
   * без мигания, перезапуска живой графики и перезагрузки вставок.
   * Если поменялось общее (тема, стили, логотип) или число слайдов — всё заново.
   */
  update(deck: Deck): void {
    if (deckSignature(deck) !== this.deckSig || deck.slides.length !== this.slides.length) return this.build(deck);
    this.deck = deck;
    let r: Renderer | null = null;
    deck.slides.forEach((s, i) => {
      const sig = JSON.stringify(s);
      if (sig === this.sigs[i]) return;
      r ??= new Renderer(deck, deck.brand?.logo, this.vars);
      this.r = r;
      this.cleanups[i]?.();
      const tmp = document.createElement('div');
      tmp.innerHTML = r.slide(s, i);
      const el = tmp.firstElementChild as HTMLElement;
      DeckView.order(el);
      if (i === this.current) el.classList.add('on');
      this.slides[i].replaceWith(el);
      this.slides[i] = el;
      this.cleanups[i] = r.activate(el, this.base());
      this.sigs[i] = sig;
    });
  }

  get index(): number {
    return this.current;
  }

  /** Переходы между слайдами (в редакторе выключены: там слайды листаются мгновенно) */
  transitions = true;
  private outTimer = 0;

  show(i: number): void {
    if (i === this.current) return;
    const prev = this.slides[this.current];
    const back = i < this.current;
    this.current = i;
    this.endOut();
    unmorph(this.slides[i]);
    this.spot(null);
    this.slides.forEach((s, k) => s.classList.toggle('on', k === i));
    DeckView.resetTriggers(this.slides[i]);
    restartGifs(this.slides[i]);
    if (this.transitions && prev) this.runOut(prev, this.slides[i], back);
    // После перехода: морф снимает копии с настоящего текста, а не с «0» начала отсчёта
    this.count(this.slides[i]);
  }

  /**
   * Прожектор при показе: блок слайда (по его пути data-block) в светлом окне, остальное приглушено.
   * null — снять. Переход к другому слайду снимает сам.
   */
  spotted: string | null = null;
  spot(key: string | null): void {
    this.stage.querySelectorAll('.spot-frame').forEach((f) => f.remove());
    this.spotted = null;
    const slide = this.slides[this.current];
    if (!key || !slide) return;
    const el = [...slide.querySelectorAll<HTMLElement>('[data-block]')].find((x) => x.getAttribute('data-block') === key);
    if (!el) return;
    // Свободный объект — по его рамке (поворот, свои поля)
    const box = el.parentElement?.classList.contains('free') ? el.parentElement : el;
    const sr = slide.getBoundingClientRect();
    const k = sr.width / (slide.offsetWidth || 1);
    const r = box.getBoundingClientRect();
    const pad = 12;
    const f = document.createElement('div');
    f.className = 'spot-frame';
    Object.assign(f.style, {
      left: `${(r.left - sr.left) / k - pad}px`, top: `${(r.top - sr.top) / k - pad}px`,
      width: `${r.width / k + pad * 2}px`, height: `${r.height / k + pad * 2}px`,
    });
    slide.appendChild(f);
    requestAnimationFrame(() => f.classList.add('on'));
    this.spotted = key;
  }

  /**
   * Что выделить прожектором по щелчку: путь блока; '' — щелчок мимо (снять); null — щелчок по
   * управлению (ползунок, кнопка, видео) — прожектор не трогать.
   *
   * Выделяется смысловая единица, а не деталь под курсором: от блока под мышью вверх берётся самый
   * крупный, который ещё можно показать отдельно — карточка целиком, а не строка в ней; свободный
   * объект целиком. Не выделяются раскладки (сетка, столбец), украшения (фигуры, логотип), совсем
   * мелкое (отдельная метка) и почти весь слайд.
   */
  static spotKey(target: Element, slide: HTMLElement): string | null {
    if (target.closest('input, textarea, select, button, a, video, model-viewer, canvas, iframe, label, [data-nospot]')) return null;
    const area = slide.offsetWidth * slide.offsetHeight || 1;
    let best: HTMLElement | null = null;
    for (let el = target.closest<HTMLElement>('[data-block]'); el && slide.contains(el); el = el.parentElement?.closest<HTMLElement>('[data-block]') ?? null) {
      const type = el.getAttribute('data-type') ?? '';
      if (SPOT_LAYOUT.has(type)) continue;
      const share = (el.offsetWidth * el.offsetHeight) / area;
      if (share > 0.45) break;
      if (SPOT_DECOR.has(type) || el.querySelector('.logo, .corner-logo') || share < 0.012) continue;
      // Одна строчка подписи или ряд меток сами по себе — не то, что показывают прожектором
      if (SPOT_LINE.has(type) && el.offsetHeight < 56) continue;
      best = el;
    }
    return best?.getAttribute('data-block') ?? '';
  }

  /** «Число набегает» у объектов слайда (остановка прежнего отсчёта возвращает текст как был) */
  private stopCount: () => void = () => {};
  private count(el: HTMLElement | undefined): void {
    this.stopCount();
    this.stopCount = countUp(el);
  }

  /** Заново проиграть появление слайда — вместе с переходом от предыдущего */
  replay(i: number): void {
    const el = this.slides[i];
    if (!el) return;
    this.endOut();
    unmorph(el);
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    DeckView.resetTriggers(el);
    restartGifs(el);
    const prev = this.slides[i - 1];
    if (prev) this.runOut(prev, el, false);
    this.count(el);
  }

  /** Уходящий слайд остаётся видимым, пока идёт переход (растворение, сдвиг, наплыв…) */
  private runOut(prev: HTMLElement, next: HTMLElement | undefined, back: boolean): void {
    // Назад по слайду с морфом — тоже морф (как и вперёд)
    const tr = back && prev.dataset.tr === 'morph' ? 'morph' : next?.dataset.tr;
    if (!next || !tr || tr === 'none' || reducedMotion()) return;
    const ms = parseFloat(getComputedStyle(tr === 'morph' && back ? prev : next).getPropertyValue('--tr-ms')) || (tr === 'morph' ? 800 : 600);
    this.stage.dataset.tr = tr;
    this.stage.dataset.dir = back ? 'back' : 'fwd';
    prev.classList.add('out');
    if (tr === 'morph') this.endMorph = morphTo(this.stage, prev, next, ms);
    this.outTimer = window.setTimeout(() => this.endOut(), ms + 60);
  }

  private endMorph: (() => void) | null = null;
  private endOut(): void {
    clearTimeout(this.outTimer);
    this.endMorph?.();
    this.endMorph = null;
    this.stage.querySelectorAll(':scope > .slide.out').forEach((s) => s.classList.remove('out'));
    delete this.stage.dataset.tr;
  }

  /** Вписывает сцену в прямоугольник с сохранением пропорций. */
  fit(width: number, height: number, offsetY = 0): number {
    this.box = { w: width, h: height, oy: offsetY };
    this.stage.style.top = `calc(50% + ${offsetY}px)`;
    return this.place();
  }

  /**
   * «Крупнее» при показе: слайд крупнее окна, z — во сколько раз, (zx, zy) — сдвиг слайда
   * от центра в его пикселях. Края слайда в окно не заходят.
   */
  private box = { w: W, h: H, oy: 0 };
  private z = 1;
  private zx = 0;
  private zy = 0;
  get zoom(): number {
    return this.z;
  }
  private fitScale(): number {
    return Math.max(0.05, Math.min(this.box.w / W, this.box.h / H));
  }
  private place(): number {
    const s = this.fitScale();
    const S = s * this.z;
    const mx = Math.max(0, W / 2 - this.box.w / 2 / S);
    const my = Math.max(0, H / 2 - this.box.h / 2 / S);
    this.zx = Math.max(-mx, Math.min(mx, this.zx));
    this.zy = Math.max(-my, Math.min(my, this.zy));
    this.stage.style.transform = this.z === 1 ? `translate(-50%, -50%) scale(${s})` : `translate(-50%, -50%) scale(${S}) translate(${this.zx}px, ${this.zy}px)`;
    // Логотип в углу при «Крупнее» уходит за край — не торчит половинкой, а прячется
    this.stage.classList.toggle('zoomed', this.z > 1);
    // Увеличенный слайд не заходит под панель показа
    const vp = this.stage.parentElement;
    if (vp) {
      const top = vp.clientHeight / 2 + this.box.oy - this.box.h / 2;
      vp.style.clipPath = this.z === 1 ? '' : `inset(${Math.max(0, top)}px 0 ${Math.max(0, vp.clientHeight - top - this.box.h)}px 0)`;
    }
    return s;
  }
  /** Слайд снова целиком */
  resetZoom(smooth = false): void {
    if (this.z === 1) return;
    this.z = 1;
    this.zx = 0;
    this.zy = 0;
    this.smooth(smooth);
    this.place();
  }
  /**
   * «Крупнее»: содержимое слайда i — во всё окно. Пустые поля по краям уходят за окно,
   * увеличение не больше max. Возвращает получившийся масштаб.
   */
  fitContent(i: number, max: number, smooth = false): number {
    const b = this.contentBox(i);
    let z = 1;
    let cx = W / 2;
    let cy = H / 2;
    if (b) {
      // Запас у края окна: поля слайда уходят почти целиком
      const m = 12;
      const x0 = Math.max(0, b[0] - m);
      const y0 = Math.max(0, b[1] - m);
      const x1 = Math.min(W, b[2] + m);
      const y1 = Math.min(H, b[3] + m);
      z = Math.min(this.box.w / (x1 - x0), this.box.h / (y1 - y0)) / this.fitScale();
      z = Math.max(1, Math.min(max, Math.round(z * 100) / 100));
      cx = (x0 + x1) / 2;
      cy = (y0 + y1) / 2;
    }
    if (z < 1.02) z = 1;
    this.z = z;
    this.zx = z === 1 ? 0 : W / 2 - cx;
    this.zy = z === 1 ? 0 : H / 2 - cy;
    this.smooth(smooth);
    this.place();
    return z;
  }

  /**
   * Где на слайде содержимое, в пикселях слайда: строки текста, картинки, графики, плашки
   * с фоном или рамкой. Фон во весь слайд и живой фон не в счёт. Объекты меряются такими,
   * какими станут после анимации появления, скрытые до щелчка — тоже.
   */
  contentBox(i: number): [number, number, number, number] | null {
    const slide = this.slides[i];
    if (!slide || !slide.isConnected) return null;
    // Анимации появления — на миг в конец (до отрисовки кадра всё вернётся)
    const anims = slide.getAnimations({ subtree: true }).filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    const saved = anims.map((a) => a.currentTime);
    anims.forEach((a) => { a.currentTime = Number(a.effect!.getComputedTiming().endTime); });
    try {
      const sr = slide.getBoundingClientRect();
      const k = sr.width / W;
      if (!k) return null;
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      const add = (r: DOMRect) => {
        if (r.width < 1 || r.height < 1) return;
        box[0] = Math.min(box[0], (r.left - sr.left) / k);
        box[1] = Math.min(box[1], (r.top - sr.top) / k);
        box[2] = Math.max(box[2], (r.right - sr.left) / k);
        box[3] = Math.max(box[3], (r.bottom - sr.top) / k);
      };
      const range = document.createRange();
      const big = W * H * 0.6 * k * k;
      const visit = (el: Element) => {
        if (el.matches(CONTENT_SKIP)) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.opacity === '0') return;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < big) {
          if (CONTENT_MEDIA.has(el.localName)) return add(r);
          if (hasBox(cs)) add(r);
        }
        for (const c of el.childNodes) {
          if (c.nodeType === Node.TEXT_NODE) {
            if (!c.nodeValue?.trim()) continue;
            range.selectNodeContents(c);
            for (const t of range.getClientRects()) add(t);
          } else if (c.nodeType === Node.ELEMENT_NODE) visit(c as Element);
        }
      };
      for (const c of slide.children) visit(c);
      if (!Number.isFinite(box[0])) return null;
      return [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(W, box[2]), Math.min(H, box[3])];
    } finally {
      anims.forEach((a, j) => { a.currentTime = saved[j]; });
    }
  }

  private smoothTimer = 0;
  private smooth(on: boolean): void {
    clearTimeout(this.smoothTimer);
    this.stage.classList.toggle('zoom-anim', on && !reducedMotion());
    if (on) this.smoothTimer = window.setTimeout(() => this.stage.classList.remove('zoom-anim'), 320);
  }
}

/** «Крупнее»: что не считается содержимым слайда */
const CONTENT_SKIP = '.backdrop, .canvas-bg, .corner-logo, .spot-frame, script, style, template, [aria-hidden="true"]:not(svg)';
const CONTENT_MEDIA = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'model-viewer', 'input', 'textarea', 'select', 'button', 'picture']);
/** У элемента видна своя плашка: фон, рамка или тень */
function hasBox(cs: CSSStyleDeclaration): boolean {
  const seen = (c: string) => !/^(transparent|rgba\(.*,\s*0(\.0+)?\))$/.test(c) && !/\/\s*0\)$/.test(c);
  return seen(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none'
    || (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderRightWidth) > 0 && seen(cs.borderTopColor));
}

/** Всё, что влияет на вид любого слайда, кроме самих слайдов. */
function deckSignature(deck: Deck): string {
  const { slides: _s, title: _t, ...rest } = deck;
  return JSON.stringify(rest);
}

const thumbObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => entries.forEach((e) => {
    const inner = e.target.firstElementChild as HTMLElement | null;
    if (inner) inner.style.transform = `scale(${(e.target as HTMLElement).clientWidth / W})`;
  }))
  : null;

/**
 * Статичная копия слайда (для миниатюр и превью). Без width миниатюра тянется
 * по ширине контейнера и сама подгоняет масштаб.
 */
export function staticSlide(deck: Deck, index: number, width?: number): HTMLElement {
  const box = document.createElement('div');
  box.className = 'thumb';
  box.style.aspectRatio = `${W} / ${H}`;
  if (width) box.style.width = `${width}px`;
  const inner = document.createElement('div');
  inner.className = 'thumb-stage canvas static';
  inner.style.transform = `scale(${(width ?? 220) / W})`;
  const slide = deck.slides[index];
  if (slide) inner.innerHTML = new Renderer(deck, deck.brand?.logo).slide(slide, index, 'on static');
  // SMIL-анимации CSS не останавливает: убираем их из статичной копии
  inner.querySelectorAll('animateMotion').forEach((a) => a.parentElement?.remove());
  inner.querySelectorAll('animate, animateTransform').forEach((a) => a.remove());
  // Миниатюра — картинка, а не место для правки
  inner.querySelectorAll('[data-edit],[data-edit-img],[data-edit-url]').forEach((e) => {
    // Пометка «здесь текст»: по ней экспорт подгоняет текст импортированной вёрстки
    if (e.hasAttribute('data-edit')) e.setAttribute('data-text', '');
    e.removeAttribute('data-edit');
    e.removeAttribute('data-edit-img');
    e.removeAttribute('data-edit-url');
  });
  box.appendChild(inner);
  thumbObserver?.observe(box);
  return box;
}

const GIF = /^data:image\/gif[;,]|\.gif(?:[?#]|$)/i;

/**
 * GIF на слайде — с первого кадра при каждом заходе, как видео: иначе одноразовая анимация
 * при повторном показе стоит на последнем кадре, а зацикленная продолжает с середины.
 */
function restartGifs(slide: HTMLElement | undefined): void {
  slide?.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || !GIF.test(src)) return;
    img.src = '';
    img.src = src;
  });
}

/**
 * Подмена разметки «на месте»: те же элементы получают новые атрибуты и текст. Анимации появления
 * не перезапускаются, а высота столбцов и линии графика меняются плавно (через transition).
 */
function morph(a: Element, b: Element): void {
  if (a.tagName !== b.tagName) { a.replaceWith(b); return; }
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  const ac = [...a.childNodes];
  const bc = [...b.childNodes];
  if (ac.length !== bc.length) { a.replaceChildren(...bc); return; }
  ac.forEach((n, k) => {
    const m = bc[k];
    if (n.nodeType !== m.nodeType || (n.nodeType === 1 && (n as Element).tagName !== (m as Element).tagName)) n.replaceWith(m);
    else if (n.nodeType === 3) { if (n.textContent !== m.textContent) n.textContent = m.textContent; }
    else if (n.nodeType === 1) morph(n as Element, m as Element);
  });
}

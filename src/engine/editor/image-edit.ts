import { icon } from '../../components/icons';
import { getAt, setAt, type Path } from '../data';
import { W } from '../deck-view';
import { darkPath, frameCss, type ImageFrame } from '../marks';
import { frameAt, removeFrame } from '../../components/layout/frame-list';
import { PRESET_KINDS, presetGeometry } from '../../components/shape/shape';

export interface ImageHost {
  deck(): Record<string, unknown>;
  stage(): HTMLElement;
  commit(fn: (d: Record<string, unknown>) => void, opts?: { rebuild?: boolean; merge?: string }): boolean;
  toast(text: string, ms?: number, error?: boolean): void;
  pick(path: Path): void;
  blockOf(path: Path): Path | null;
  removeBlock(path: Path): void;
}

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

interface Selected {
  el: HTMLElement;
  /** Атрибут data-edit-img: по нему элемент находится снова после перерисовки */
  key: string;
  path: Path;
  owner: Path | null;
  kind: 'photo' | 'logo';
}

const POS = /^(\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/;

/**
 * Картинки в режиме правки: выделение кликом, панель (заменить, вписать или заполнить,
 * масштаб, кадр, убрать), перетаскивание кадра мышью, высота блока-картинки.
 */
export class ImageEditor {
  private sel: Selected | null = null;
  /** Режим «Кадр» у свободной картинки: перетаскивание двигает снимок в рамке, а не объект */
  private cropping = false;
  /** Снимок обрезан или масштабирован: кадр есть куда сдвигать */
  private pannable = false;
  readonly bar: HTMLElement;
  private handle: HTMLElement;
  /** Кадр: снимок целиком — полупрозрачно вокруг рамки, с ручками масштаба по углам; контур формы обрезки */
  private ghost: HTMLElement;
  private outline: SVGSVGElement;

  constructor(private host: ImageHost) {
    document.body.insertAdjacentHTML('beforeend', `
<div class="edimg" id="ed-img" role="toolbar" aria-label="Картинка">
  <button type="button" data-i="replace" title="Заменить изображение">${icon('image')}<span>Заменить</span></button>
  <i class="edsep" data-g="photo"></i>
  <span class="edseg" data-g="photo" role="group" aria-label="Как показывать">
    <button type="button" data-i="contain" title="Вписать целиком, без обрезки">${icon('contain')}<span>Целиком</span></button>
    <button type="button" data-i="cover" title="Заполнить рамку">${icon('cover')}<span>Заполнить</span></button>
  </span>
  <label class="edzoom" data-g="photo" title="Масштаб">${icon('search')}<input type="range" data-i="zoom" min="30" max="300" step="5" aria-label="Масштаб"><output></output></label>
  <button type="button" data-i="crop" data-g="crop" title="Кадр: перетащите снимок в рамке (Esc — готово)">${icon('crop')}<span>Кадр</span></button>
  <span class="edtip" data-g="tip">${icon('move')} тяните картинку, чтобы сдвинуть</span>
  <button type="button" data-i="reset" data-g="framed" title="Сбросить кадр">Сбросить кадр</button>
  <i class="edsep" data-g="img"></i>
  <span class="edseg" data-g="img" role="group" aria-label="Тёмная тема">
    <button type="button" data-i="dark">${icon('moon')}<span>Тёмная тема</span></button>
    <button type="button" data-i="undark" title="Убрать вариант для тёмной темы" aria-label="Убрать вариант для тёмной темы">${icon('close')}</button>
  </span>
  <i class="edsep"></i>
  <button type="button" data-i="remove" class="danger" title="Убрать картинку (Delete)" aria-label="Убрать картинку">${icon('close')}</button>
</div>
<div class="edhandle" id="ed-handle" title="Потяните, чтобы изменить высоту" aria-hidden="true"></div>
<div class="edghost" id="ed-ghost" title="Тяните снимок, чтобы сдвинуть; углы — масштаб" aria-hidden="true">${['nw', 'ne', 'se', 'sw'].map((c) => `<i data-c="${c}"></i>`).join('')}</div>
<svg class="edghost-o" id="ed-ghost-o" aria-hidden="true" preserveAspectRatio="none"><path/></svg>`);
    this.bar = document.getElementById('ed-img')!;
    this.handle = document.getElementById('ed-handle')!;
    this.ghost = document.getElementById('ed-ghost')!;
    this.outline = document.getElementById('ed-ghost-o') as unknown as SVGSVGElement;
    this.bind();
  }

  get selected(): boolean {
    return this.sel !== null;
  }

  /** Выделенная картинка (рамка с data-edit-img) */
  get element(): HTMLElement | null {
    return this.sel?.el ?? null;
  }

  owns(node: Node | null): boolean {
    return !!node && (this.bar.contains(node) || this.handle.contains(node) || this.ghost.contains(node));
  }

  select(el: HTMLElement): void {
    // Щелчок после сдвига кадра выделяет ту же картинку снова: режим «Кадр» остаётся
    const keepCrop = this.cropping && this.sel?.key === el.getAttribute('data-edit-img');
    this.clear();
    const path = readPath(el, 'data-edit-img');
    if (!path) return;
    this.cropping = keepCrop;
    this.sel = {
      el,
      key: el.getAttribute('data-edit-img')!,
      path,
      owner: readPath(el, 'data-img-owner'),
      kind: el.getAttribute('data-img-kind') === 'logo' ? 'logo' : 'photo',
    };
    el.classList.add('ed-selected');
    this.render();
  }

  clear(): void {
    this.sel?.el.classList.remove('ed-selected', 'ed-pan', 'ed-crop');
    this.sel = null;
    this.cropping = false;
    this.pannable = false;
    this.bar.classList.remove('on');
    this.handle.classList.remove('on');
    this.ghost.classList.remove('on');
    this.outline.classList.remove('on');
  }

  /** После перерисовки слайда выделение переходит на новый элемент. */
  refresh(): void {
    if (!this.sel) return;
    const key = this.sel.key;
    const slide = this.host.stage().querySelector('.slide.on');
    const el = slide ? [...slide.querySelectorAll<HTMLElement>('[data-edit-img]')].find((x) => x.getAttribute('data-edit-img') === key) : null;
    // Режим «Кадр» переживает перерисовку после каждого сдвига
    const crop = this.cropping;
    if (el) this.select(el);
    else this.clear();
    if (el && crop) this.setCrop(true);
  }

  private frame(): ImageFrame {
    const o = this.sel?.owner ? getAt(this.host.deck(), this.sel.owner) : null;
    return (o && typeof o === 'object' ? o : {}) as ImageFrame;
  }

  private img(): HTMLImageElement | null {
    return this.sel?.el.querySelector('img') ?? (this.sel?.el instanceof HTMLImageElement ? this.sel.el : null);
  }

  private render(): void {
    const s = this.sel;
    if (!s) return;
    const value = getAt(this.host.deck(), s.path);
    const hasImage = typeof value === 'string' && value !== '';
    const f = this.frame();
    const photo = s.kind === 'photo' && hasImage && !!s.owner;
    const cover = photo && f.fit !== 'contain';
    const z = Number(f.zoom) || 1;
    const framed = photo && (!!f.position || z !== 1);
    // Сдвигать есть что, когда картинка обрезана или уменьшена/увеличена
    const pannable = photo && (cover || z !== 1);
    const block = s.owner ? this.host.blockOf(s.owner) : null;
    const isImageBlock = !!block && (getAt(this.host.deck(), block) as { type?: string })?.type === 'image';
    const show = (g: string, v: boolean) => this.bar.querySelectorAll<HTMLElement>(`[data-g="${g}"]`).forEach((e) => (e.hidden = !v));
    // Свободную картинку тянут как объект: кадр — в режиме «Кадр» (или с Alt);
    // картинку в раскладке тянут за кадр сразу
    const inFree = !!s.el.closest('[data-free]');
    this.pannable = pannable;
    if (!pannable) this.cropping = false;
    show('photo', photo);
    show('crop', pannable && inFree);
    show('tip', pannable && (!inFree || this.cropping));
    show('framed', framed);
    // Своя картинка для тёмной темы — у кадра-объекта (srcDark), у кадра строкой её некуда записать
    show('img', hasImage && typeof s.path[s.path.length - 1] !== 'number');
    const dark = getAt(this.host.deck(), darkPath(s.path));
    const hasDark = typeof dark === 'string' && dark !== '';
    const q = (k: string) => this.bar.querySelector<HTMLElement>(`[data-i="${k}"]`)!;
    q('replace').querySelector('span')!.textContent = hasImage ? 'Заменить' : 'Вставить';
    q('contain').classList.toggle('on', photo && !cover);
    q('cover').classList.toggle('on', cover);
    q('remove').hidden = !hasImage;
    q('dark').classList.toggle('on', hasDark);
    q('dark').title = hasDark
      ? 'Заменить вариант для тёмной темы'
      : `Своя ${s.kind === 'logo' ? 'версия логотипа' : 'картинка'} для тёмной темы. Без неё в обеих темах — эта же`;
    q('undark').hidden = !hasDark;
    q('remove').title = s.kind === 'logo' ? 'Убрать логотип со всех слайдов (Delete)' : 'Убрать картинку (Delete)';
    const zoom = this.bar.querySelector<HTMLInputElement>('[data-i="zoom"]')!;
    zoom.value = String(Math.round((Number(f.zoom) || 1) * 100));
    this.bar.querySelector('output')!.textContent = `${zoom.value}%`;
    s.el.classList.toggle('ed-pan', pannable && (!inFree || this.cropping));
    s.el.classList.toggle('ed-crop', pannable && inFree && this.cropping);
    q('crop').classList.toggle('on', this.cropping);
    this.bar.classList.add('on');
    // Свободной картинке высоту задают ручки рамки объекта
    this.handle.classList.toggle('on', isImageBlock && !inFree);
    const tip = this.bar.querySelector<HTMLElement>('.edtip');
    if (tip) tip.lastChild!.textContent = inFree ? ' тяните снимок · Esc — готово' : ' тяните картинку, чтобы сдвинуть';
    this.position();
  }

  /** Можно ли сейчас сдвигать кадр выделенной картинки (иначе свободный объект двигается целиком) */
  get canCrop(): boolean {
    return !!this.sel && this.bar.querySelector<HTMLElement>('[data-i="crop"]')?.hidden === false;
  }

  /** Режим «Кадр» (лента «Рисунок», кнопка на панели картинки) */
  setCrop(on: boolean): void {
    if (!this.sel || (on && !this.canCrop)) return;
    this.cropping = on;
    this.render();
  }

  get isCropping(): boolean {
    return this.cropping;
  }

  /** Нажатие должно сдвигать кадр, а не объект: Alt или режим «Кадр», по самой картинке */
  wantsPan(e: PointerEvent): boolean {
    const s = this.sel;
    return !!s && this.pannable && s.el.contains(e.target as Node) && (e.altKey || this.cropping);
  }

  position(): void {
    const s = this.sel;
    if (!s) return;
    const r = s.el.getBoundingClientRect();
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    const top = r.top - h - 10 > 60 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10);
    this.bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    this.bar.style.top = `${top}px`;
    this.placeGhost();
    if (this.handle.classList.contains('on')) {
      const box = s.el.closest('figure') ?? s.el;
      const b = box.getBoundingClientRect();
      this.handle.style.left = `${b.left + b.width / 2 - 24}px`;
      this.handle.style.top = `${b.bottom - 5}px`;
    }
  }

  private setFrame(patch: Partial<ImageFrame>, merge?: string): void {
    const s = this.sel;
    if (!s?.owner) return;
    const owner = s.owner;
    // Кадр строкой (images: [a.jpg]) становится объектом {src}: у объекта есть своё вписывание и кадр.
    // Выделение — по новому адресу, чтобы пережить перерисовку
    if (typeof getAt(this.host.deck(), owner) === 'string') {
      s.path = [...owner, 'src'];
      s.key = JSON.stringify(s.path);
    }
    this.host.commit((d) => {
      const cur = getAt(d, owner);
      if (typeof cur === 'string') setAt(d, owner, { src: cur });
      for (const [k, v] of Object.entries(patch)) setAt(d, [...owner, k], v);
    }, { rebuild: true, merge });
  }

  private bind(): void {
    this.bar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
    });
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-i]');
      const s = this.sel;
      if (!b || !s) return;
      switch (b.dataset.i) {
        case 'replace': this.host.pick(s.path); break;
        case 'dark': this.host.pick(darkPath(s.path)); break;
        case 'undark': {
          const p = darkPath(s.path);
          if (this.host.commit((d) => setAt(d, p, undefined), { rebuild: true })) this.host.toast('Вариант для тёмной темы убран. Вернуть — Ctrl+Z', 3000);
          break;
        }
        case 'crop': this.setCrop(!this.cropping); break;
        case 'contain': this.setFrame({ fit: 'contain' }); break;
        case 'cover': this.setFrame({ fit: 'cover' }); break;
        case 'reset': this.setFrame({ position: undefined, zoom: undefined }); break;
        case 'remove': {
          const logo = s.kind === 'logo';
          const { path, owner } = s;
          this.clear();
          // Кадр картинки с кадрами: убирается этот кадр, остальные остаются
          const fr = owner && !logo ? frameAt(owner, (p) => getAt(this.host.deck(), p)) : null;
          if (fr) {
            if (this.host.commit((d) => removeFrame(getAt(d, fr.block) as Record<string, unknown>, fr.k), { rebuild: true })) this.host.toast('Кадр убран. Вернуть — Ctrl+Z', 2500);
            break;
          }
          if (this.host.commit((d) => {
            setAt(d, path, undefined);
            setAt(d, darkPath(path), undefined);
            // Настройки кадра без картинки не нужны
            if (owner && !logo) for (const k of ['fit', 'position', 'zoom']) setAt(d, [...owner, k], undefined);
          }, { rebuild: true })) {
            this.host.toast(logo ? 'Логотип убран со всех слайдов. Вернуть — Ctrl+Z' : 'Картинка убрана. Вернуть — Ctrl+Z', 3000);
          }
          break;
        }
      }
    });

    // Масштаб: видно сразу, в данные — одним шагом отмены
    const zoom = this.bar.querySelector<HTMLInputElement>('[data-i="zoom"]')!;
    zoom.addEventListener('input', () => {
      const img = this.img();
      const z = Number(zoom.value) / 100;
      this.bar.querySelector('output')!.textContent = `${zoom.value}%`;
      if (img) img.setAttribute('style', frameCss({ ...this.frame(), zoom: z }));
      this.placeGhost({ ...this.frame(), zoom: z });
    });

    // Снимок целиком вокруг рамки: потянуть за него — сдвиг кадра, за угол — масштаб от середины рамки
    this.ghost.addEventListener('pointerdown', (e) => {
      const c = (e.target as Element).closest<HTMLElement>('[data-c]');
      if (!c) return void this.pointerDown(e);
      const s = this.sel;
      const img = this.img();
      if (!s || !img) return;
      e.preventDefault();
      e.stopPropagation();
      const f = this.frame();
      const z0 = Number(f.zoom) || 1;
      const box = this.box()!;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
      let z = z0;
      const move = (ev: PointerEvent) => {
        z = Math.round(Math.max(0.3, Math.min(4, (z0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0)) * 100) / 100;
        img.setAttribute('style', frameCss({ ...f, zoom: z }));
        zoom.value = String(Math.round(z * 100));
        this.bar.querySelector('output')!.textContent = `${zoom.value}%`;
        this.placeGhost({ ...f, zoom: z });
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        if (z !== z0) this.setFrame({ zoom: Math.abs(z - 1) > 0.001 ? z : undefined }, 'zoom');
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    zoom.addEventListener('change', () => {
      const z = Number(zoom.value) / 100;
      this.setFrame({ zoom: Math.abs(z - 1) > 0.001 ? Math.round(z * 100) / 100 : undefined }, 'zoom');
    });
    zoom.addEventListener('keydown', (e) => e.stopPropagation());

    // Высота блока-картинки
    this.handle.addEventListener('pointerdown', (e) => {
      const s = this.sel;
      if (!s) return;
      e.preventDefault();
      const fig = (s.el.closest('figure') ?? s.el) as HTMLElement;
      const startY = e.clientY;
      const startH = fig.getBoundingClientRect().height;
      const scale = this.host.stage().getBoundingClientRect().width / W;
      this.handle.setPointerCapture(e.pointerId);
      let h = startH / scale;
      const move = (ev: PointerEvent) => {
        h = Math.max(80, Math.min(640, Math.round((startH + ev.clientY - startY) / scale)));
        fig.style.height = `${h}px`;
        this.position();
      };
      const up = () => {
        this.handle.removeEventListener('pointermove', move);
        this.handle.removeEventListener('pointerup', up);
        // Высота — у блока: у картинки с кадрами хозяин открытого кадра может быть кадром из images
        const block = s.owner ? this.host.blockOf(s.owner) : null;
        if (block) this.host.commit((d) => setAt(d, [...block, 'height'], h), { rebuild: true });
      };
      this.handle.addEventListener('pointermove', move);
      this.handle.addEventListener('pointerup', up);
    });
  }

  /** Рамка снимка на экране (без масштаба кадра: transform у самой картинки) */
  private box(): DOMRect | null {
    const img = this.img();
    const par = img?.parentElement;
    if (!img || !par) return null;
    const pr = par.getBoundingClientRect();
    const k = par.offsetWidth ? pr.width / par.offsetWidth : 1;
    return new DOMRect(pr.left + img.offsetLeft * k, pr.top + img.offsetTop * k, img.offsetWidth * k, img.offsetHeight * k);
  }

  /**
   * Снимок целиком в режиме «Кадр»: где он лежит относительно рамки (левый край = p · (рамка − снимок), как
   * у object-position с масштабом от той же точки), и контур формы, если снимок обрезан по фигуре
   */
  private placeGhost(f: ImageFrame = this.frame()): void {
    const s = this.sel;
    const img = this.img();
    const box = this.box();
    const on = !!s && !!img?.naturalWidth && !!box && s.el.classList.contains('ed-pan');
    this.ghost.classList.toggle('on', on);
    const crop = on ? getComputedStyle(img!.parentElement!).getPropertyValue('--crop').trim() : '';
    this.outline.classList.toggle('on', on && !!PRESET_KINDS[crop]);
    if (!on) return;
    const nw = img!.naturalWidth;
    const nh = img!.naturalHeight;
    const z = Math.max(0.3, Math.min(4, Number(f.zoom) || 1));
    const base = (f.fit === 'contain' ? Math.min : Math.max)(box!.width / nw, box!.height / nh);
    const w = nw * base * z;
    const h = nh * base * z;
    const m = POS.exec(f.position ?? '');
    const px = m ? Number(m[1]) / 100 : 0.5;
    const py = m ? Number(m[2]) / 100 : 0.5;
    Object.assign(this.ghost.style, {
      left: `${box!.left + px * (box!.width - w)}px`, top: `${box!.top + py * (box!.height - h)}px`, width: `${w}px`, height: `${h}px`,
    });
    this.ghost.style.setProperty('--g', `url(${JSON.stringify(img!.currentSrc || img!.src)})`);
    if (PRESET_KINDS[crop]) {
      Object.assign(this.outline.style, { left: `${box!.left}px`, top: `${box!.top}px`, width: `${box!.width}px`, height: `${box!.height}px` });
      this.outline.setAttribute('viewBox', `0 0 ${Math.round(box!.width)} ${Math.round(box!.height)}`);
      this.outline.querySelector('path')!.setAttribute('d', presetGeometry(crop, Math.round(box!.width), Math.round(box!.height)).filter((g) => g.fill).map((g) => g.d).join(' '));
    }
  }

  /**
   * Перетаскивание картинки внутри рамки: картинка идёт за мышью.
   * Левый край картинки в рамке = p · (ширина рамки − ширина картинки с учётом масштаба),
   * поэтому сдвиг мыши dx меняет p на dx / (рамка − картинка): знак сам учитывает,
   * больше картинка рамки или меньше.
   */
  pointerDown(e: PointerEvent): boolean {
    const s = this.sel;
    if (!s || !(s.el.contains(e.target as Node) || this.ghost.contains(e.target as Node)) || !this.pannable) return false;
    // У свободной картинки обычное перетаскивание двигает объект, кадр — в режиме «Кадр» или с Alt
    if (s.el.closest('[data-free]') && !e.altKey && !this.cropping) return false;
    const img = this.img();
    if (!img || !img.naturalWidth) return false;
    e.preventDefault();
    const f = this.frame();
    const m = POS.exec(f.position ?? '');
    const start = { x: m ? Number(m[1]) : 50, y: m ? Number(m[2]) : 50 };
    const box = (img.parentElement ?? s.el).getBoundingClientRect();
    const zoom = Math.max(0.3, Math.min(4, Number(f.zoom) || 1));
    const base = (f.fit === 'contain' ? Math.min : Math.max)(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const rangeX = box.width - img.naturalWidth * base * zoom;
    const rangeY = box.height - img.naturalHeight * base * zoom;
    let pos = start;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      pos = {
        x: Math.abs(rangeX) < 1 ? start.x : clamp(start.x + (dx / rangeX) * 100),
        y: Math.abs(rangeY) < 1 ? start.y : clamp(start.y + (dy / rangeY) * 100),
      };
      img.setAttribute('style', frameCss({ ...f, position: `${pos.x}% ${pos.y}%` }));
      this.placeGhost({ ...f, position: `${pos.x}% ${pos.y}%` });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      // Сдвигать было некуда (снимок по этой оси целиком в рамке) — данные не трогаем
      if (moved && (pos.x !== start.x || pos.y !== start.y)) this.setFrame({ position: `${pos.x}% ${pos.y}%` });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return true;
  }
}

const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

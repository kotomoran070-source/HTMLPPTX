import { icon } from '../../components/icons';
import { getAt, setAt, type Path } from '../data';
import { W } from '../deck-view';
import { frameCss, type ImageFrame } from '../marks';

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
  readonly bar: HTMLElement;
  private handle: HTMLElement;

  constructor(private host: ImageHost) {
    document.body.insertAdjacentHTML('beforeend', `
<div class="edimg" id="ed-img" role="toolbar" aria-label="Картинка">
  <button type="button" data-i="replace" title="Заменить картинку (или перетащите файл)">${icon('image')}<span>Заменить</span></button>
  <i class="edsep" data-g="photo"></i>
  <span class="edseg" data-g="photo" role="group" aria-label="Как показывать">
    <button type="button" data-i="contain" title="Вписать целиком, без обрезки">${icon('contain')}<span>Целиком</span></button>
    <button type="button" data-i="cover" title="Заполнить блок, лишнее обрезается">${icon('cover')}<span>Заполнить</span></button>
  </span>
  <label class="edzoom" data-g="photo" title="Масштаб: меньше 100% — картинка уменьшается внутри рамки">${icon('search')}<input type="range" data-i="zoom" min="30" max="300" step="5" aria-label="Масштаб"><output></output></label>
  <span class="edtip" data-g="pan">${icon('move')} тяните картинку, чтобы сдвинуть</span>
  <button type="button" data-i="reset" data-g="framed" title="Вернуть кадр по центру и без увеличения">Сбросить кадр</button>
  <i class="edsep"></i>
  <button type="button" data-i="remove" class="danger" title="Убрать картинку (Delete)" aria-label="Убрать картинку">${icon('close')}</button>
</div>
<div class="edhandle" id="ed-handle" title="Потяните, чтобы изменить высоту" aria-hidden="true"></div>`);
    this.bar = document.getElementById('ed-img')!;
    this.handle = document.getElementById('ed-handle')!;
    this.bind();
  }

  get selected(): boolean {
    return this.sel !== null;
  }

  owns(node: Node | null): boolean {
    return !!node && (this.bar.contains(node) || this.handle.contains(node));
  }

  select(el: HTMLElement): void {
    this.clear();
    const path = readPath(el, 'data-edit-img');
    if (!path) return;
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
    this.sel?.el.classList.remove('ed-selected', 'ed-pan');
    this.sel = null;
    this.bar.classList.remove('on');
    this.handle.classList.remove('on');
  }

  /** После перерисовки слайда выделение переходит на новый элемент. */
  refresh(): void {
    if (!this.sel) return;
    const key = this.sel.key;
    const slide = this.host.stage().querySelector('.slide.on');
    const el = slide ? [...slide.querySelectorAll<HTMLElement>('[data-edit-img]')].find((x) => x.getAttribute('data-edit-img') === key) : null;
    if (el) this.select(el);
    else this.clear();
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
    show('photo', photo);
    show('pan', pannable);
    show('framed', framed);
    const q = (k: string) => this.bar.querySelector<HTMLElement>(`[data-i="${k}"]`)!;
    q('replace').querySelector('span')!.textContent = hasImage ? 'Заменить' : 'Вставить';
    q('contain').classList.toggle('on', photo && !cover);
    q('cover').classList.toggle('on', cover);
    q('remove').hidden = !hasImage;
    q('remove').title = s.kind === 'logo' ? 'Убрать логотип со всех слайдов (Delete)' : 'Убрать картинку (Delete)';
    const zoom = this.bar.querySelector<HTMLInputElement>('[data-i="zoom"]')!;
    zoom.value = String(Math.round((Number(f.zoom) || 1) * 100));
    this.bar.querySelector('output')!.textContent = `${zoom.value}%`;
    s.el.classList.toggle('ed-pan', pannable);
    this.bar.classList.add('on');
    // Свободной картинке высоту задают ручки рамки объекта
    const inFree = !!s.el.closest('[data-free]');
    this.handle.classList.toggle('on', isImageBlock && !inFree);
    const tip = this.bar.querySelector<HTMLElement>('.edtip');
    if (tip) tip.lastChild!.textContent = inFree ? ' Alt + тяните картинку — сдвинуть кадр' : ' тяните картинку, чтобы сдвинуть';
    this.position();
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
    if (this.handle.classList.contains('on')) {
      const box = s.el.closest('figure') ?? s.el;
      const b = box.getBoundingClientRect();
      this.handle.style.left = `${b.left + b.width / 2 - 24}px`;
      this.handle.style.top = `${b.bottom - 5}px`;
    }
  }

  private setFrame(patch: Partial<ImageFrame> & { height?: number }, merge?: string): void {
    const s = this.sel;
    if (!s?.owner) return;
    const owner = s.owner;
    this.host.commit((d) => {
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
        case 'contain': this.setFrame({ fit: 'contain' }); break;
        case 'cover': this.setFrame({ fit: 'cover' }); break;
        case 'reset': this.setFrame({ position: undefined, zoom: undefined }); break;
        case 'remove': {
          const logo = s.kind === 'logo';
          const { path, owner } = s;
          this.clear();
          if (this.host.commit((d) => {
            setAt(d, path, undefined);
            // Настройки кадра без картинки не нужны
            if (owner && !logo) for (const k of ['fit', 'position', 'zoom']) setAt(d, [...owner, k], undefined);
          }, { rebuild: true })) {
            this.host.toast(logo ? 'Логотип убран со всех слайдов. Вернуть: Ctrl+Z' : 'Картинка убрана. Вернуть: Ctrl+Z', 3000);
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
        this.setFrame({ height: h });
      };
      this.handle.addEventListener('pointermove', move);
      this.handle.addEventListener('pointerup', up);
    });
  }

  /**
   * Перетаскивание картинки внутри рамки: картинка идёт за мышью.
   * Левый край картинки в рамке = p · (ширина рамки − ширина картинки с учётом масштаба),
   * поэтому сдвиг мыши dx меняет p на dx / (рамка − картинка): знак сам учитывает,
   * больше картинка рамки или меньше.
   */
  pointerDown(e: PointerEvent): boolean {
    const s = this.sel;
    if (!s || !s.el.contains(e.target as Node) || !s.el.classList.contains('ed-pan')) return false;
    // У свободной картинки обычное перетаскивание двигает объект, кадр — с Alt
    if (s.el.closest('[data-free]') && !e.altKey) return false;
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
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (moved) this.setFrame({ position: `${pos.x}% ${pos.y}%` });
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return true;
  }
}

const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

import { icon } from '../components/icons';
import { HEX_RE } from '../engine/accent';
import { getAt, setAt, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { placeOf, slideLabel } from '../engine/render';
import type { Block, Deck } from '../types';

export interface InspectorHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  /** Команда студии (выравнивание, порядок, удаление…) */
  run(cmd: string): void;
  /** Размер свободного объекта на слайде (высота по содержимому, если она не задана) */
  measure(free: Path): { w: number; h: number } | null;
}

export const EFFECTS: [string, string][] = [
  ['', 'Без анимации'], ['fade', 'Проявление'], ['rise', 'Всплытие снизу'], ['drop', 'Появление сверху'],
  ['left', 'Выезд слева'], ['right', 'Выезд справа'], ['scale', 'Увеличение'], ['pop', 'Пружина'],
];

const TEMPLATES: Record<string, string> = {
  content: 'Обычный', cover: 'Обложка', finale: 'Финал', space: 'Космос', canvas: 'Холст',
};

const ALIGN: [string, string, string][] = [
  ['align.left', 'obj-left', 'По левому краю'], ['align.center', 'obj-center', 'По центру'], ['align.right', 'obj-right', 'По правому краю'],
  ['align.top', 'obj-top', 'По верхнему краю'], ['align.middle', 'obj-middle', 'По середине'], ['align.bottom', 'obj-bottom', 'По нижнему краю'],
];

/** Короткое описание объекта для списка слоёв: тип и начало текста. */
function objectLabel(b: Block): string {
  const texts = Array.isArray(b.texts) ? b.texts : [];
  const raw = [b.text, b.title, b.caption, texts[0], b.label].find((v) => typeof v === 'string' && v.trim());
  const snippet = typeof raw === 'string' ? raw.replace(/\{[\w#-]+\|([^}]*)\}/g, '$1').replace(/<[^>]+>|[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 34) : '';
  return snippet;
}

const cmdBtn = (cmd: string, ic: string, label: string, cls = '') =>
  `<button type="button" class="st-pbtn ${cls}" data-cmd="${cmd}" title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span></button>`;

/**
 * Панель свойств справа. Ничего не выделено — свойства слайда и презентации,
 * выделен блок — его положение, размер, анимация, порядок и действия.
 * Значения полей обновляются на месте, поле в фокусе не трогается.
 */
export class Inspector {
  private key = '';

  constructor(private root: HTMLElement, private host: InspectorHost) {
    root.addEventListener('change', (e) => this.onChange(e.target as HTMLInputElement));
    root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      // Цвет меняется сразу, пока тянут ползунок палитры
      if (el.type === 'color') this.onChange(el);
    });
    root.addEventListener('keydown', (e) => {
      const el = e.target as HTMLInputElement;
      if (e.key === 'Enter' && el.tagName === 'INPUT') {
        e.preventDefault();
        this.onChange(el);
        el.select?.();
      }
      if (e.key === 'Escape') {
        el.blur();
        this.key = '';
        this.sync();
      }
    });
    root.addEventListener('click', (e) => {
      const t = e.target as Element;
      const cmd = t.closest<HTMLElement>('[data-cmd]')?.dataset.cmd;
      if (cmd) return this.host.run(cmd);
      const layer = t.closest<HTMLElement>('[data-layer]')?.dataset.layer;
      if (layer !== undefined) this.host.editor().selectFree(this.host.index(), Number(layer));
      if (t.closest('[data-a="accent-reset"]')) this.host.editor().setAccent(null);
    });
  }

  /** Перестроить панель, если сменился предмет, и обновить значения полей. */
  sync(): void {
    const sel = this.host.editor().selection;
    const i = this.host.index();
    const deck = this.host.deck();
    const key = sel ? `b:${JSON.stringify(sel.free ?? sel.block)}:${sel.type}` : `s:${i}:${deck.slides[i]?.template ?? ''}:${(deck.slides[i]?.free ?? []).length}`;
    if (key !== this.key) {
      this.key = key;
      this.root.innerHTML = sel ? this.blockHtml() : this.slideHtml();
    }
    this.fill();
  }

  // ---------------- разметка ----------------

  private blockHtml(): string {
    const sel = this.host.editor().selection!;
    const deck = this.host.deck();
    const content = (deck.slides[this.host.index()]?.template ?? 'content') === 'content';
    const head = `<header class="st-p-head"><span class="st-p-kind">${sel.free ? 'Свободный объект' : 'Блок в раскладке'}</span><h2>${blockName(sel.type)}</h2></header>`;
    if (!sel.free) {
      return head + `<section class="st-p-sec"><p class="st-p-note">Блок стоит в раскладке слайда и двигается вместе с ней. Сделайте его свободным, чтобы перемещать мышью, менять размер и задать анимацию.</p>
<div class="st-p-col">${cmdBtn('obj.free', 'move', 'Сделать свободным', 'primary')}${sel.hasParent ? cmdBtn('obj.parent', 'up', 'Выделить внешний блок') : ''}</div></section>
<section class="st-p-sec st-p-end">${cmdBtn('obj.del', 'trash', 'Удалить блок', 'danger')}</section>`;
    }
    return head + `<section class="st-p-sec"><h3>Положение и размер</h3>
<div class="st-p-grid">
  <label><span>X</span><input type="number" data-f="x" step="1"></label>
  <label><span>Y</span><input type="number" data-f="y" step="1"></label>
  <label><span>Ширина</span><input type="number" data-f="w" min="20" step="1"></label>
  <label><span>Высота</span><input type="number" data-f="h" min="20" step="1"></label>
</div>
<div class="st-p-icons" role="group" aria-label="Выровнять на слайде">${ALIGN.map(([c, ic, l]) => `<button type="button" data-cmd="${c}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>
</section>
<section class="st-p-sec"><h3>Анимация появления</h3>
<label class="st-p-field"><span>Эффект</span><select data-f="enter">${EFFECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
<label class="st-p-field"><span>Задержка, мс</span><input type="number" data-f="delay" min="0" max="20000" step="100"></label>
${cmdBtn('show.preview', 'play', 'Просмотр анимации слайда')}
</section>
<section class="st-p-sec"><h3>Порядок</h3>
<div class="st-p-row">${cmdBtn('obj.front', 'front', 'Вперёд')}${cmdBtn('obj.back', 'back', 'Назад')}</div>
</section>
<section class="st-p-sec st-p-end"><div class="st-p-row">${cmdBtn('obj.dup', 'copy', 'Дублировать')}${content ? cmdBtn('obj.attach', 'grid', 'В раскладку') : ''}</div>
${cmdBtn('obj.del', 'trash', 'Удалить', 'danger')}</section>`;
  }

  private slideHtml(): string {
    const deck = this.host.deck();
    const i = this.host.index();
    const s = deck.slides[i];
    if (!s) return '';
    const tpl = s.template ?? 'content';
    const free = Array.isArray(s.free) ? (s.free as Block[]) : [];
    const layers = free.map((b, k) => ({ b, k })).reverse().map(({ b, k }) => {
      const snip = objectLabel(b);
      return `<button type="button" class="st-layer" data-layer="${k}"><b>${blockName(b.type)}</b>${snip ? `<span>${esc(snip)}</span>` : ''}</button>`;
    }).join('');
    return `<header class="st-p-head"><span class="st-p-kind">Слайд ${i + 1} · ${esc(TEMPLATES[tpl] ?? tpl)}</span><h2>${esc(slideLabel(s, i))}</h2></header>
<section class="st-p-sec"><h3>Слайд</h3>
<label class="st-p-field"><span>Название в списке</span><input type="text" data-f="label" placeholder="${esc(s.title ?? `Слайд ${i + 1}`)}"></label>
${tpl === 'canvas' ? `<label class="st-p-field"><span>Фон</span><span class="st-p-color"><input type="color" data-f="bgcolor" aria-label="Цвет фона"><input type="text" data-f="bg" placeholder="как у темы" spellcheck="false"></span></label>` : ''}
${tpl === 'content' ? `<label class="st-p-check"><input type="checkbox" data-f="logo"><span>Логотип в углу</span></label>` : ''}
${cmdBtn('show.preview', 'play', 'Просмотр анимации слайда')}
</section>
<section class="st-p-sec"><h3>Объекты на слайде</h3>
${layers ? `<div class="st-layers">${layers}</div>` : '<p class="st-p-note">Свободных объектов нет. Добавьте текст или картинку на вкладке «Вставка» или сделайте свободным блок раскладки.</p>'}
</section>
<section class="st-p-sec"><h3>Презентация</h3>
<label class="st-p-field"><span>Название</span><input type="text" data-f="title"></label>
<label class="st-p-field"><span>Акцентный цвет</span><span class="st-p-color"><input type="color" data-f="accent" aria-label="Акцентный цвет"><button type="button" class="st-link" data-a="accent-reset">Стандартный</button></span></label>
</section>`;
  }

  // ---------------- значения ----------------

  private values(): Record<string, string | boolean> {
    const deck = this.host.deck();
    const sel = this.host.editor().selection;
    if (sel?.free) {
      const b = getAt(deck, sel.free) as Block;
      const pl = placeOf(b);
      return {
        x: String(Math.round(pl.x)), y: String(Math.round(pl.y)), w: String(Math.round(pl.w)), h: pl.h ? String(Math.round(pl.h)) : '',
        enter: EFFECTS.some(([v]) => v === b.enter) ? String(b.enter) : '',
        delay: Number(b.delay) > 0 ? String(b.delay) : '',
      };
    }
    if (sel) return {};
    const s = deck.slides[this.host.index()];
    const bg = typeof s?.bg === 'string' ? s.bg : '';
    const accent = deck.theme?.accent;
    return {
      label: typeof s?.label === 'string' ? s.label : '',
      bg,
      bgcolor: HEX_RE.test(bg.trim()) ? bg.trim().toLowerCase() : '#ffffff',
      logo: s?.logo !== false,
      title: deck.title ?? '',
      accent: (typeof accent === 'string' && HEX_RE.test(accent) ? accent : getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()).toLowerCase(),
    };
  }

  private fill(): void {
    const v = this.values();
    const sel = this.host.editor().selection;
    this.root.querySelectorAll<HTMLInputElement>('[data-f]').forEach((el) => {
      const f = el.dataset.f!;
      if (!(f in v) || el === document.activeElement) return;
      if (el.type === 'checkbox') el.checked = !!v[f];
      else el.value = String(v[f]);
    });
    // Высота по содержимому: подсказка с настоящим размером
    const h = this.root.querySelector<HTMLInputElement>('[data-f="h"]');
    if (h && sel?.free) h.placeholder = `авто · ${this.host.measure(sel.free)?.h ?? ''}`;
    const reset = this.root.querySelector<HTMLElement>('[data-a="accent-reset"]');
    if (reset) reset.hidden = !this.host.deck().theme?.accent;
    const delay = this.root.querySelector<HTMLInputElement>('[data-f="delay"]');
    if (delay) delay.disabled = !v.enter;
  }

  // ---------------- правки ----------------

  private onChange(el: HTMLInputElement): void {
    const f = el.dataset.f;
    if (!f) return;
    const ed = this.host.editor();
    const i = this.host.index();
    const sel = ed.selection;
    const raw = el.value.trim();
    if (sel?.free && ['x', 'y', 'w', 'h'].includes(f)) {
      const path = sel.free;
      const n = Math.round(Number(raw));
      if (raw && !Number.isFinite(n)) return this.fill();
      ed.commit((d) => {
        const pl = placeOf(getAt(d, path));
        const next: Record<string, number | undefined> = { ...pl };
        if (f === 'h') next.h = raw ? Math.max(20, n) : undefined;
        else if (raw) next[f] = f === 'w' ? Math.max(20, n) : n;
        if (next.h === undefined) delete next.h;
        setAt(d, [...path, 'place'], next);
      }, { rebuild: true });
    } else if (sel?.free && f === 'enter') {
      const path = sel.free;
      ed.commit((d) => {
        const b = getAt(d, path) as Block;
        if (raw) b.enter = raw;
        else { delete b.enter; delete b.delay; }
      }, { rebuild: true });
    } else if (sel?.free && f === 'delay') {
      const path = sel.free;
      const n = Math.max(0, Math.min(20000, Math.round(Number(raw) || 0)));
      ed.commit((d) => {
        const b = getAt(d, path) as Block;
        if (n) b.delay = n;
        else delete b.delay;
      }, { rebuild: true });
    } else if (f === 'label') {
      ed.commit((d) => {
        if (raw) d.slides[i].label = raw;
        else delete d.slides[i].label;
      }, { rebuild: false, merge: `label:${i}` });
    } else if (f === 'logo') {
      ed.commit((d) => {
        if (el.checked) delete d.slides[i].logo;
        else d.slides[i].logo = false;
      }, { rebuild: true });
    } else if (f === 'bg' || f === 'bgcolor') {
      ed.commit((d) => {
        if (raw) d.slides[i].bg = raw;
        else delete d.slides[i].bg;
      }, { rebuild: true, merge: `bg:${i}` });
    } else if (f === 'title') {
      if (!raw) return this.fill();
      ed.commit((d) => { d.title = raw; }, { rebuild: false, merge: 'title' });
      document.title = `${raw} — редактор`;
    } else if (f === 'accent') {
      ed.setAccent(raw);
    }
  }
}

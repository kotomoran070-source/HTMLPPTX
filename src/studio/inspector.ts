import { icon } from '../components/icons';
import { HEX_RE } from '../engine/accent';
import { getAt, setAt, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { placeOf, slideLabel } from '../engine/render';
import type { Block, Deck } from '../types';
import { fillForm, formHtml, formSig, onFieldAction, onFieldChange, onGridPaste, type FormEdit } from './form';
import { BLOCKS, STYLE_FIELD, TEMPLATES, type Field } from './schema';
import { partsOf, type Part } from './structure';

export interface InspectorHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  /** Команда студии (выравнивание, порядок, удаление…) */
  run(cmd: string): void;
  /** Размер свободного объекта на слайде (высота по содержимому, если она не задана) */
  measure(free: Path): { w: number; h: number } | null;
  /** Один эффект появления всем выделенным */
  groupEffect(effect: string): void;
  /** Появление по очереди в порядке чтения (выделенные или указанные объекты) */
  sequence(paths?: Path[]): void;
  stage(): HTMLElement;
}

/** Оформление этих блоков — на контекстной вкладке ленты, в панели его не дублируем */
const ON_RIBBON: Record<string, { tab: string; name: string; keys: string[] }> = {
  shape: { tab: 'shape', name: 'Фигура', keys: ['kind', 'fill', 'stroke', 'width', 'radius', 'rotate', 'shadow'] },
  table: { tab: 'table', name: 'Таблица', keys: ['variant', 'labels', 'highlight', 'size'] },
};

/** Какие разделы панели развёрнуты: запоминается между выделениями и сеансами */
const FOLD_KEY = 'htmlpptx-studio-folds';
const FOLD_DEFAULT: Record<string, boolean> = { frame: false, pos: true, anim: false, parts: false, more: false, layout: true, objects: true, deck: false };
let folds: Record<string, boolean> = { ...FOLD_DEFAULT };
try { folds = { ...folds, ...JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') }; } catch { /* нет сохранённого */ }

/** Сворачиваемый раздел панели. */
const sec = (key: string, title: string, body: string, extra = '') =>
  `<details class="st-p-sec st-p-fold" data-sec="${key}"${folds[key] ? ' open' : ''}><summary>${title}${extra}</summary><div class="st-p-body">${body}</div></details>`;

/** Шаг между появлениями при перестановке в списке, мс */
const STEP = 300;

/** Готовые фоны холста: значение поля bg и как выглядит образец. */
const BACKGROUNDS: [string, string, string][] = [
  ['', 'Точки', 'radial-gradient(var(--bd2) 1px, transparent 1px) 0 0 / 6px 6px, var(--bg)'],
  ['var(--bg)', 'Ровный', 'var(--bg)'],
  ['var(--surf)', 'Светлый', 'var(--surf)'],
  ['var(--acs)', 'Акцентный', 'var(--acs)'],
  ['linear-gradient(135deg, var(--acs), var(--bg) 70%)', 'Градиент', 'linear-gradient(135deg, var(--acs), var(--bg) 70%)'],
];

const fmtDelay = (ms: number) => (ms ? `${(ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с` : 'сразу');

export const EFFECTS: [string, string][] = [
  ['', 'Без анимации'], ['fade', 'Проявление'], ['rise', 'Всплытие снизу'], ['drop', 'Появление сверху'],
  ['left', 'Выезд слева'], ['right', 'Выезд справа'], ['scale', 'Увеличение'], ['pop', 'Пружина'],
];

const TEMPLATE_NAMES: Record<string, string> = {
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
  /** Поля формы на панели сейчас и путь объекта, которому они принадлежат */
  private fields: Field[] = [];
  private base: Path = [];
  private edit: FormEdit;
  /** Части выделенного блока (раздел «Состав») */
  private parts: Part[] = [];

  constructor(private root: HTMLElement, private host: InspectorHost) {
    this.edit = {
      commit: (fn) => { this.host.editor().commit((d) => fn(d), { rebuild: true }); },
      pickImage: (p) => this.host.editor().pickImage(p),
    };
    root.addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      const key = d.dataset?.sec;
      if (!key) return;
      folds[key] = d.open;
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch { /* нет доступа */ }
    }, true);
    root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.t) {
        if (!onFieldChange(el, this.edit)) this.fill();
        return;
      }
      if (el.dataset.anim !== undefined) return this.setAnim(Number(el.dataset.anim), el.value);
      this.onChange(el);
    });
    // Наведение на часть блока подсвечивает её на слайде
    root.addEventListener('pointerover', (e) => {
      const part = (e.target as Element).closest<HTMLElement>('[data-part]');
      this.peek(part ? this.parts[Number(part.dataset.part)]?.el ?? null : null);
    });
    root.addEventListener('pointerleave', () => this.peek(null));
    root.addEventListener('paste', (e) => {
      const el = e.target as HTMLInputElement;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (onGridPaste(el, text, this.edit)) e.preventDefault();
    });
    root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      // Цвет меняется сразу, пока тянут ползунок палитры
      if (el.type === 'color') this.onChange(el);
    });
    root.addEventListener('keydown', (e) => {
      const el = e.target as HTMLInputElement;
      if (e.key === 'Enter' && el.tagName === 'INPUT' && el.type !== 'checkbox') {
        e.preventDefault();
        // Enter — применить; для полей формы значение уходит через change при потере фокуса
        if (el.dataset.t) el.blur();
        else { this.onChange(el); el.select?.(); }
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
      const act = t.closest<HTMLElement>('[data-act]');
      if (act) {
        onFieldAction(act, this.fields, this.base, this.edit);
        return;
      }
      const part = t.closest<HTMLElement>('[data-part]');
      if (part) {
        const it = this.parts[Number(part.dataset.part)];
        this.peek(null);
        if (it?.kind === 'block') this.host.editor().selectBlock(it.el);
        else if (it) this.host.editor().editField(it.el);
        return;
      }
      const mv = t.closest<HTMLElement>('[data-anim-move]');
      if (mv) return this.moveAnim(Number(mv.dataset.animMove), Number(mv.dataset.dir) as 1 | -1);
      if (t.closest('[data-a="seq-all"]')) {
        const n = (this.host.deck().slides[this.host.index()].free ?? []).length;
        return this.host.sequence(Array.from({ length: n }, (_x, k) => ['slides', this.host.index(), 'free', k]));
      }
      const bg = t.closest<HTMLElement>('[data-bg]');
      if (bg) return this.setBg(bg.dataset.bg ?? '');
      const layer = t.closest<HTMLElement>('[data-layer]')?.dataset.layer;
      if (layer !== undefined && !t.closest('select')) this.host.editor().selectFree(this.host.index(), Number(layer));
      if (t.closest('[data-a="accent-reset"]')) this.host.editor().setAccent(null);
    });
  }

  private peeked: HTMLElement | null = null;
  private peek(el: HTMLElement | null): void {
    if (el === this.peeked) return;
    this.peeked?.classList.remove('st-peek');
    this.peeked = el;
    el?.classList.add('st-peek');
  }

  /** Элемент выделенного блока на слайде. */
  private blockEl(block: Path): HTMLElement | null {
    const key = JSON.stringify(block);
    return [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === key) ?? null;
  }

  /** Перестроить панель, если сменился предмет, и обновить значения полей. */
  sync(): void {
    const sel = this.host.editor().selection;
    const i = this.host.index();
    const deck = this.host.deck();
    if (sel && sel.group.length > 1) {
      this.fields = [];
      this.base = [];
      const key = `m:${JSON.stringify(sel.group)}`;
      if (key !== this.key) {
        this.key = key;
        this.root.innerHTML = this.multiHtml(sel.group.length);
        this.root.dataset.subject = key;
      }
      return this.fill();
    }
    if (sel) {
      const skip = new Set(ON_RIBBON[sel.type]?.keys ?? []);
      this.fields = [...(BLOCKS[sel.type]?.fields ?? []).filter((f) => !skip.has(f.k)), STYLE_FIELD];
      this.base = sel.block;
    } else {
      this.fields = TEMPLATES[deck.slides[i]?.template ?? 'content']?.fields ?? [];
      this.base = ['slides', i];
    }
    const sig = formSig(this.fields, deck, this.base);
    const el = sel ? this.blockEl(sel.block) : null;
    this.parts = el ? partsOf(el) : [];
    const key = sel
      ? `b:${JSON.stringify(sel.free ?? sel.block)}:${sel.type}:${sig}:${this.parts.map((x) => x.label + x.snippet).join('|')}`
      : `s:${i}:${deck.slides[i]?.template ?? ''}:${sig}:${this.animSig()}:${String(deck.slides[i]?.bg ?? '')}`;
    if (key !== this.key) {
      this.key = key;
      // Прокрутка панели сохраняется, когда форма перестраивается (добавили пункт)
      const top = this.root.scrollTop;
      const same = this.root.dataset.subject === (sel ? JSON.stringify(sel.block) : `s${i}`);
      this.root.innerHTML = sel ? this.blockHtml() : this.slideHtml();
      this.root.dataset.subject = sel ? JSON.stringify(sel.block) : `s${i}`;
      if (same) this.root.scrollTop = top;
    }
    this.fill();
  }

  // ---------------- разметка ----------------

  private blockHtml(): string {
    const sel = this.host.editor().selection!;
    const deck = this.host.deck();
    const content = (deck.slides[this.host.index()]?.template ?? 'content') === 'content';
    const head = `<header class="st-p-head"><span class="st-p-kind">${sel.free ? 'Свободный объект' : 'Блок в раскладке'}</span><h2>${blockName(sel.type)}</h2></header>`;
    const schema = BLOCKS[sel.type];
    const ribbon = ON_RIBBON[sel.type];
    // Кадр картинки (обрезка, увеличение) нужен реже: отдельный свёрнутый раздел
    const FRAME = ['fit', 'zoom', 'position'];
    const all = (schema?.fields ?? []).filter((f) => !ribbon?.keys.includes(f.k));
    const own = all.filter((f) => !FRAME.includes(f.k));
    const frame = all.filter((f) => FRAME.includes(f.k));
    const ribbonNote = ribbon ? `<button type="button" class="st-p-hint" data-cmd="tab.${ribbon.tab}">${icon('layers')}<span>Цвета и вид — на вкладке «${ribbon.name}» ленты</span></button>` : '';
    const contentSec = own.length || schema?.about || ribbon
      ? `<section class="st-p-sec"><h3>Содержимое</h3>${ribbonNote}${schema?.about ? `<p class="st-p-note">${esc(schema.about)}</p>` : ''}${formHtml(own, deck, sel.block)}</section>`
        + (frame.length ? sec('frame', 'Кадр картинки', formHtml(frame, deck, sel.block)) : '')
      : '';
    const extra = this.partsHtml() + sec('more', 'Дополнительно', formHtml([STYLE_FIELD], deck, sel.block));
    // Действия — одной строкой значков: они же есть на ленте и в меню по правому клику
    const actions = (list: [string, string, string, string?][]) => `<section class="st-p-sec st-p-end"><div class="st-p-acts">${list.map(([c, ic, l, cls]) =>
      `<button type="button" class="st-pbtn${cls ? ` ${cls}` : ''}" data-cmd="${c}" title="${esc(l)}" aria-label="${esc(l)}">${icon(ic)}</button>`).join('')}</div></section>`;
    if (!sel.free) {
      return head + contentSec + sec('layout', 'Раскладка', `<p class="st-p-note">Блок стоит в раскладке слайда. Потяните его мышью или нажмите «Сделать свободным», чтобы двигать, менять размер и задать анимацию.</p>
<div class="st-p-col">${cmdBtn('obj.free', 'move', 'Сделать свободным', 'primary')}${sel.hasParent ? cmdBtn('obj.parent', 'up', 'Выделить внешний блок') : ''}</div>`)
        + extra + actions([['obj.ungroup', 'ungroup', 'Разгруппировать'], ['obj.del', 'trash', 'Удалить блок', 'danger']]);
    }
    return head + contentSec
      + sec('pos', 'Положение и размер', `<div class="st-p-grid">
  <label><span>X</span><input type="number" data-f="x" step="1"></label>
  <label><span>Y</span><input type="number" data-f="y" step="1"></label>
  <label><span>Ширина</span><input type="number" data-f="w" min="20" step="1"></label>
  <label><span>Высота</span><input type="number" data-f="h" min="20" step="1"></label>
</div>
<div class="st-p-icons" role="group" aria-label="Выровнять на слайде">${ALIGN.map(([c, ic, l]) => `<button type="button" data-cmd="${c}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>`)
      + sec('anim', 'Анимация появления', `<label class="st-p-field"><span>Эффект</span><select data-f="enter">${EFFECTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
<label class="st-p-field"><span>Задержка, мс</span><input type="number" data-f="delay" min="0" max="20000" step="100"></label>
${cmdBtn('show.preview', 'play', 'Просмотр анимации слайда')}`, `<span class="st-p-sum" data-sum="enter"></span>`)
      + extra
      + actions([['obj.dup', 'copy', 'Дублировать (Ctrl+D)'], ['obj.front', 'front', 'На передний план'], ['obj.back', 'back', 'На задний план'], ['obj.ungroup', 'ungroup', 'Разгруппировать'], ...(content ? [['obj.attach', 'grid', 'В раскладку'] as [string, string, string]] : []), ['obj.del', 'trash', 'Удалить (Delete)', 'danger']]);
  }

  private bgHtml(cur: string): string {
    const known = BACKGROUNDS.some(([v]) => v === cur);
    return `<div class="st-p-field"><span>Фон</span><div class="st-bgs" role="radiogroup" aria-label="Фон слайда">${BACKGROUNDS.map(([v, l, look]) =>
      `<button type="button" role="radio" aria-checked="${v === cur}" data-bg="${esc(v)}" title="${esc(l)}"><i style="background:${look}"></i><span>${esc(l)}</span></button>`).join('')}
<label class="st-bg-own" title="Свой цвет"><i style="background:${!known && HEX_RE.test(cur) ? cur : 'conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)'}"></i><input type="color" data-f="bgcolor" aria-label="Свой цвет фона"><span>Свой</span></label></div>
${!known ? `<p class="st-p-note">Сейчас: <code>${esc(cur.length > 60 ? cur.slice(0, 60) + '…' : cur)}</code></p>` : ''}</div>
<details class="st-p-more"><summary>CSS фона</summary><label class="st-p-field"><input type="text" data-f="bg" placeholder="как у темы" spellcheck="false"></label></details>`;
  }

  private slideHtml(): string {
    const deck = this.host.deck();
    const i = this.host.index();
    const s = deck.slides[i];
    if (!s) return '';
    const tpl = s.template ?? 'content';
    return `<header class="st-p-head"><span class="st-p-kind">Слайд ${i + 1} · ${esc(TEMPLATE_NAMES[tpl] ?? tpl)}</span><h2>${esc(slideLabel(s, i))}</h2></header>
<section class="st-p-sec"><h3>Слайд</h3>
<label class="st-p-field"><span>Название в списке</span><input type="text" data-f="label" placeholder="${esc(s.title ?? `Слайд ${i + 1}`)}"></label>
${tpl === 'canvas' ? this.bgHtml(typeof s.bg === 'string' ? s.bg.trim() : '') : ''}
${formHtml(this.fields, deck, ['slides', i])}
${cmdBtn('show.preview', 'play', 'Просмотр анимации слайда')}
</section>
${sec('objects', 'Объекты и порядок появления', this.animHtml())}
${sec('deck', 'Презентация', `<label class="st-p-field"><span>Название</span><input type="text" data-f="title"></label>
<label class="st-p-field"><span>Акцентный цвет</span><span class="st-p-color"><input type="color" data-f="accent" aria-label="Акцентный цвет"><button type="button" class="st-link" data-a="accent-reset">Стандартный</button></span></label>`)}`;
  }

  /** Раздел «Состав»: вложенные блоки и поля выделенного блока. Клик — выделить или править. */
  private partsHtml(): string {
    const list = this.parts;
    // Для блока из одного поля состав очевиден
    if (list.length < 2 && !list.some((x) => x.kind === 'block')) return '';
    return sec('parts', 'Состав', `<div class="st-parts">${list.map((x, k) =>
      `<button type="button" class="st-part ${x.kind}" data-part="${k}" title="${x.kind === 'block' ? 'Выделить' : 'Править текст'}"><b>${esc(x.label)}</b>${x.snippet ? `<span>${esc(x.snippet)}</span>` : ''}<i aria-hidden="true">${x.kind === 'block' ? '›' : '✎'}</i></button>`).join('')}</div>
<p class="st-p-note">Esc — к внешнему блоку. Путь к выделенному — над слайдом.</p>`, ` <span class="st-p-count">${list.length}</span>`);
  }

  private multiHtml(n: number): string {
    return `<header class="st-p-head"><span class="st-p-kind">Несколько объектов</span><h2>Выделено: ${n}</h2></header>
<section class="st-p-sec"><h3>Выровнять относительно друг друга</h3>
<div class="st-p-icons" role="group" aria-label="Выровнять">${ALIGN.map(([c, ic, l]) => `<button type="button" data-cmd="${c}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>
<div class="st-p-icons" role="group" aria-label="Распределить">
  <button type="button" data-cmd="dist.h" title="Равные промежутки по ширине" aria-label="Распределить по ширине">${icon('dist-h')}</button>
  <button type="button" data-cmd="dist.v" title="Равные промежутки по высоте" aria-label="Распределить по высоте">${icon('dist-v')}</button>
</div>
<p class="st-p-note">Распределение — от трёх объектов. Тяните любой из выделенных, чтобы переместить всех; стрелки сдвигают на 1 px.</p>
</section>
<section class="st-p-sec"><h3>Анимация появления</h3>
<label class="st-p-field"><span>Эффект для всех</span><select data-f="genter"><option value="" disabled hidden>Разные</option>${EFFECTS.map(([v, l]) => `<option value="${v || 'none'}">${l}</option>`).join('')}</select></label>
${cmdBtn('anim.sequence', 'sparkle', 'Появляться по очереди')}
<p class="st-p-note">По очереди — сверху вниз и слева направо, шаг ${STEP / 1000} с.</p>
</section>
<section class="st-p-sec st-p-end"><div class="st-p-row">${cmdBtn('obj.dup', 'copy', 'Дублировать')}${cmdBtn('obj.del', 'trash', 'Удалить', 'danger')}</div></section>`;
  }

  /** Свободные объекты слайда в порядке появления: сначала анимированные по задержке, потом остальные. */
  private animOrder(): { b: Block; k: number; delay: number; on: boolean }[] {
    const free = (this.host.deck().slides[this.host.index()]?.free ?? []) as Block[];
    return free.map((b, k) => ({ b, k, delay: Number(b.delay) || 0, on: EFFECTS.some(([v]) => v && v === b.enter) }))
      .sort((a, b) => (a.on === b.on ? a.delay - b.delay || a.k - b.k : a.on ? -1 : 1));
  }

  private animSig(): string {
    return this.animOrder().map((o) => `${o.k}:${o.on ? o.b.enter : ''}:${o.delay}`).join(',');
  }

  private animHtml(): string {
    const list = this.animOrder();
    if (!list.length) return '<p class="st-p-note">Свободных объектов нет. Добавьте блок на вкладке «Вставка» или сделайте свободным блок раскладки.</p>';
    const animated = list.filter((o) => o.on);
    return `<div class="st-anim">${list.map((o, pos) => {
      const snip = objectLabel(o.b);
      const n = animated.indexOf(o);
      return `<div class="st-anim-row${o.on ? '' : ' still'}" data-layer="${o.k}" role="button" tabindex="0" title="Выделить объект">
  <span class="st-anim-n">${o.on ? n + 1 : '·'}</span>
  <span class="st-anim-name"><b>${blockName(o.b.type)}</b>${snip ? `<span>${esc(snip)}</span>` : ''}</span>
  <span class="st-anim-t">${o.on ? fmtDelay(o.delay) : ''}</span>
  <select data-anim="${o.k}" aria-label="Эффект появления">${EFFECTS.map(([v, l]) => `<option value="${v}"${(o.on ? o.b.enter : '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
  <span class="st-f-tools">${o.on ? `<button type="button" data-anim-move="${o.k}" data-dir="-1" title="Раньше" aria-label="Появляться раньше"${n === 0 ? ' disabled' : ''}>${icon('up')}</button><button type="button" data-anim-move="${o.k}" data-dir="1" title="Позже" aria-label="Появляться позже"${n === animated.length - 1 ? ' disabled' : ''}>${icon('back')}</button>` : ''}</span>
</div>`.replace(/\n/g, '') + (pos === animated.length - 1 && pos < list.length - 1 ? '<div class="st-anim-sep">Без анимации: видны сразу</div>' : '');
    }).join('')}</div>
<div class="st-p-row">${`<button type="button" class="st-pbtn" data-a="seq-all">${icon('sparkle')}<span>Все по очереди</span></button>`}${cmdBtn('show.preview', 'play', 'Просмотр')}</div>`;
  }

  /** Эффект объекта из списка: новый анимированный появляется последним. */
  private setAnim(k: number, effect: string): void {
    const i = this.host.index();
    const order = this.animOrder().filter((o) => o.on && o.k !== k);
    const last = order.length ? Math.max(...order.map((o) => o.delay)) + STEP : 0;
    this.host.editor().commit((d) => {
      const b = d.slides[i].free![k] as Block;
      const was = EFFECTS.some(([v]) => v && v === b.enter);
      if (!effect) { delete b.enter; delete b.delay; return; }
      b.enter = effect;
      if (!was) {
        if (last) b.delay = last;
        else delete b.delay;
      }
    }, { rebuild: true });
  }

  /** Раньше/позже: порядок анимированных меняется, задержки пересчитываются с равным шагом. */
  private moveAnim(k: number, dir: 1 | -1): void {
    const i = this.host.index();
    const order = this.animOrder().filter((o) => o.on);
    const at = order.findIndex((o) => o.k === k);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    const first = Math.min(...order.map((o) => o.delay));
    this.host.editor().commit((d) => order.forEach((o, n) => {
      const b = d.slides[i].free![o.k] as Block;
      const delay = first + n * STEP;
      if (delay) b.delay = delay;
      else delete b.delay;
    }), { rebuild: true, merge: `anim:${i}` });
  }

  private setBg(value: string): void {
    const i = this.host.index();
    this.host.editor().commit((d) => {
      if (value) d.slides[i].bg = value;
      else delete d.slides[i].bg;
    }, { rebuild: true });
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
    if (sel && sel.group.length > 1) {
      const effects = new Set(sel.group.map((p) => {
        const e = (getAt(deck, p) as Block).enter;
        return EFFECTS.some(([v]) => v && v === e) ? String(e) : 'none';
      }));
      return { genter: effects.size === 1 ? [...effects][0] : '' };
    }
    if (sel) return {};
    const s = deck.slides[this.host.index()];
    const bg = typeof s?.bg === 'string' ? s.bg : '';
    const accent = deck.theme?.accent;
    return {
      label: typeof s?.label === 'string' ? s.label : '',
      bg,
      bgcolor: HEX_RE.test(bg.trim()) ? bg.trim().toLowerCase() : '#ffffff',
      title: deck.title ?? '',
      accent: (typeof accent === 'string' && HEX_RE.test(accent) ? accent : getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()).toLowerCase(),
    };
  }

  private fill(): void {
    fillForm(this.root, this.host.deck(), (u) => u);
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
    const sum = this.root.querySelector<HTMLElement>('[data-sum="enter"]');
    if (sum) sum.textContent = v.enter ? EFFECTS.find(([k]) => k === v.enter)?.[1] ?? '' : '';
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
    } else if (f === 'bg' || f === 'bgcolor') {
      ed.commit((d) => {
        if (raw) d.slides[i].bg = raw;
        else delete d.slides[i].bg;
      }, { rebuild: true, merge: `bg:${i}` });
    } else if (f === 'title') {
      if (!raw) return this.fill();
      ed.commit((d) => { d.title = raw; }, { rebuild: false, merge: 'title' });
      document.title = `${raw} — редактор`;
    } else if (f === 'genter') {
      this.host.groupEffect(raw === 'none' ? '' : raw);
    } else if (f === 'accent') {
      ed.setAccent(raw);
    }
  }
}

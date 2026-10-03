import { icon } from '../components/icons';
import { HEX_RE } from '../engine/accent';
import { getAt, setAt, type Path } from '../engine/data';
import { BACKDROPS } from '../components/backdrop/backdrop';
import { blockName, keepsRatio } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { OBJ_ID, actionOf, angleOf, placeOf, slideLabel } from '../engine/render';
import type { Block, Deck } from '../types';
import { fillForm, formHtml, formSig, onFieldAction, onFieldChange, onGridPaste, type FormEdit } from './form';
import { BLOCKS, STYLE_FIELD, TEMPLATES, type Field } from './schema';
import { partsOf, type Part } from './structure';
import { effectName } from './anim-tab';

export interface InspectorHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  /** Команда студии (выравнивание, порядок, удаление…) */
  run(cmd: string): void;
  /** Размер свободного объекта на слайде (высота по содержимому, если она не задана) */
  measure(free: Path): { w: number; h: number } | null;
  stage(): HTMLElement;
}

/** Оформление этих блоков — на контекстной вкладке ленты, в панели его не дублируем */
const ON_RIBBON: Record<string, { tab: string; name: string; keys: string[] }> = {
  shape: { tab: 'shape', name: 'Фигура', keys: ['kind', 'fill', 'stroke', 'width', 'dash', 'radius', 'rotate', 'shadow', 'opacity', 'valign'] },
  table: { tab: 'table', name: 'Таблица', keys: ['variant', 'labels', 'highlight', 'size', 'total', 'density', 'widths', 'align', 'head'] },
};

/** Какие разделы панели развёрнуты: запоминается между выделениями и сеансами */
const FOLD_KEY = 'htmlpptx-studio-folds';
const FOLD_DEFAULT: Record<string, boolean> = { frame: false, pos: true, anim: false, parts: false, more: false, layout: true, objects: true, deck: false };
let folds: Record<string, boolean> = { ...FOLD_DEFAULT };
try { folds = { ...folds, ...JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') }; } catch { /* нет сохранённого */ }

/** Сворачиваемый раздел панели. */
const sec = (key: string, title: string, body: string, extra = '') =>
  `<details class="st-p-sec st-p-fold" data-sec="${key}"${folds[key] ? ' open' : ''}><summary>${title}${extra}</summary><div class="st-p-body">${body}</div></details>`;

/** Готовые фоны холста: значение поля bg и как выглядит образец. */
const BACKGROUNDS: [string, string, string][] = [
  ['', 'Точки', 'radial-gradient(var(--bd2) 1px, transparent 1px) 0 0 / 6px 6px, var(--bg)'],
  ['var(--bg)', 'Ровный', 'var(--bg)'],
  ['var(--surf)', 'Светлый', 'var(--surf)'],
  ['var(--acs)', 'Акцентный', 'var(--acs)'],
  ['linear-gradient(135deg, var(--acs), var(--bg) 70%)', 'Градиент', 'linear-gradient(135deg, var(--acs), var(--bg) 70%)'],
  // Градиенты от цветов темы: текст остаётся читаемым и в тёмной теме
  ['radial-gradient(ellipse 90% 70% at 50% 0%, var(--acs), var(--bg) 70%)', 'Сияние', 'radial-gradient(ellipse 90% 70% at 50% 0%, var(--acs), var(--bg) 70%)'],
  ['linear-gradient(180deg, var(--bg) 35%, var(--alt))', 'Туман', 'linear-gradient(180deg, var(--bg) 35%, var(--alt))'],
  ['radial-gradient(ellipse 60% 60% at 0% 0%, var(--acs), transparent 70%), radial-gradient(ellipse 60% 60% at 100% 100%, color-mix(in srgb, var(--acs) 70%, var(--alt)), transparent 70%), var(--bg)', 'Углы', 'radial-gradient(ellipse 60% 60% at 0% 0%, var(--acs), transparent 70%), radial-gradient(ellipse 60% 60% at 100% 100%, color-mix(in srgb, var(--acs) 70%, var(--alt)), transparent 70%), var(--bg)'],
];

const TEMPLATE_NAMES: Record<string, string> = {
  content: 'Обычный', cover: 'Обложка', finale: 'Финал', space: 'Космос', canvas: 'Холст',
};

const ALIGN: [string, string, string][] = [
  ['align.left', 'obj-left', 'По левому краю'], ['align.center', 'obj-center', 'По центру'], ['align.right', 'obj-right', 'По правому краю'],
  ['align.top', 'obj-top', 'По верхнему краю'], ['align.middle', 'obj-middle', 'По середине'], ['align.bottom', 'obj-bottom', 'По нижнему краю'],
];

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
      pickMedia: (p, k) => this.host.editor().pickMedia(p, k),
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
      // Ползунок видимой части: число рядом обновляется, пока тянут; запись — по change
      if (el.dataset.t === 'framepos') {
        const out = el.parentElement?.querySelector('output');
        if (out) out.textContent = `${el.value}%`;
        return;
      }
      // Цвет меняется сразу, пока тянут ползунок палитры
      if (el.type !== 'color') return;
      // Акцент перекрашивает всю презентацию: пока тянут — только показ, правка — по change
      if (el.dataset.f === 'accent' || el.dataset.f === 'accent2') this.host.editor().previewAccent(el.value, el.dataset.f);
      else this.onChange(el);
    });
    root.addEventListener('focusout', (e) => {
      const f = (e.target as HTMLElement).dataset?.f;
      if (f === 'accent' || f === 'accent2') this.host.editor().endAccentPreview();
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
      const bg = t.closest<HTMLElement>('[data-bg]');
      if (bg) return this.setBg(bg.dataset.bg ?? '');
      const bd = t.closest<HTMLElement>('[data-backdrop]');
      if (bd) {
        const i = this.host.index();
        const v = bd.dataset.backdrop;
        return void this.host.editor().commit((d) => {
          if (v) d.slides[i].backdrop = v;
          else delete d.slides[i].backdrop;
        }, { rebuild: true });
      }
      if (t.closest('[data-a="accent-reset"]')) this.host.editor().setAccent(null);
      if (t.closest('[data-a="accent2-off"]')) this.host.editor().setAccent(null, 'accent2');
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
      : `s:${i}:${deck.slides[i]?.template ?? ''}:${sig}:${String(deck.slides[i]?.bg ?? '')}:${String(deck.slides[i]?.backdrop ?? '')}`;
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
    const inGroup = !sel.free && sel.block.at(-2) === 'items' && (getAt(deck, sel.block.slice(0, -2)) as Block | undefined)?.type === 'group';
    const kind = sel.free ? 'Свободный объект' : inGroup ? 'Объект группы' : 'Блок в раскладке';
    const head = `<header class="st-p-head"><span class="st-p-kind">${kind}</span><h2>${blockName(sel.type)}</h2></header>`;
    const schema = BLOCKS[sel.type];
    const ribbon = ON_RIBBON[sel.type];
    // Кадр картинки (обрезка, увеличение) нужен реже: отдельный свёрнутый раздел
    // Кадр — у картинок (с увеличением); у видео «Кадр» остаётся среди основных полей
    const FRAME = schema?.fields.some((f) => f.k === 'zoom') ? ['fit', 'zoom', 'position'] : [];
    const all = (schema?.fields ?? []).filter((f) => !ribbon?.keys.includes(f.k));
    const own = all.filter((f) => !FRAME.includes(f.k));
    const frame = all.filter((f) => FRAME.includes(f.k));
    const ribbonNote = ribbon ? `<button type="button" class="st-p-hint" data-cmd="tab.${ribbon.tab}">${icon('layers')}<span>Оформление — на вкладке «${ribbon.name}»</span></button>` : '';
    const contentSec = own.length || schema?.about || ribbon
      ? `<section class="st-p-sec"><h3>Содержимое</h3>${ribbonNote}${schema?.about ? `<p class="st-p-note">${esc(schema.about)}</p>` : ''}${formHtml(own, deck, sel.block)}${sel.type === 'model' ? `<div class="st-p-col">${cmdBtn('model.snapshot', 'image', 'Снимок текущего вида')}</div>` : ''}${sel.type === 'embed' || sel.type === 'sandbox' ? `<div class="st-p-col">${cmdBtn('embed.code', 'terminal', sel.type === 'sandbox' ? 'Код песочницы…' : 'Код вставки…', 'primary')}${cmdBtn('embed.poster', 'image', 'Обновить заставку')}</div>` : ''}</section>`
        + (frame.length ? sec('frame', 'Кадр картинки', formHtml(frame, deck, sel.block)) : '')
      : '';
    const extra = this.partsHtml() + sec('more', 'Дополнительно', formHtml([STYLE_FIELD], deck, sel.block));
    // Действия — одной строкой значков: они же есть на ленте и в меню по правому клику
    const actions = (list: [string, string, string, string?][]) => `<section class="st-p-sec st-p-end"><div class="st-p-acts">${list.map(([c, ic, l, cls]) =>
      `<button type="button" class="st-pbtn${cls ? ` ${cls}` : ''}" data-cmd="${c}" title="${esc(l)}" aria-label="${esc(l)}">${icon(ic)}</button>`).join('')}</div></section>`;
    if (!sel.free) {
      if (inGroup) {
        return head + contentSec + sec('layout', 'В группе', `<p class="st-p-note">Объект перемещается внутри группы. Чтобы изменить размер, извлеките его из группы.</p>
<div class="st-p-col">${cmdBtn('obj.free', 'move', 'Извлечь из группы', 'primary')}${cmdBtn('obj.parent', 'up', 'Выделить группу')}</div>`)
          + sec('more', 'Дополнительно', formHtml([STYLE_FIELD], deck, sel.block)) + actions([['obj.del', 'trash', 'Удалить из группы', 'danger']]);
      }
      return head + contentSec + sec('layout', 'Раскладка', `<p class="st-p-note">Блок закреплён в макете слайда. Сделайте его свободным, чтобы перемещать и менять размер.</p>
<div class="st-p-col">${cmdBtn('obj.free', 'move', 'Сделать свободным', 'primary')}${sel.hasParent ? cmdBtn('obj.parent', 'up', 'Выделить внешний блок') : ''}</div>`)
        + extra + actions([['obj.ungroup', 'ungroup', 'Разгруппировать'], ['obj.del', 'trash', 'Удалить блок', 'danger']]);
    }
    return head + contentSec
      + sec('pos', 'Положение и размер', `<div class="st-p-grid">
  <label><span>X</span><input type="number" data-f="x" step="1"></label>
  <label><span>Y</span><input type="number" data-f="y" step="1"></label>
  <label><span>Ширина</span><input type="number" data-f="w" min="20" step="1"></label>
  <label><span>Высота</span><input type="number" data-f="h" min="20" step="1"></label>
  <label title="Поворот по часовой стрелке. На слайде — кружок над рамкой (Shift — шагами по 15°)"><span>Поворот, °</span><input type="number" data-f="angle" min="-180" max="180" step="1"></label>
</div>
<label class="st-p-check" title="Углы рамки и поля «Ширина / Высота» меняют размер без искажения. Shift при перетаскивании — наоборот"><input type="checkbox" data-f="keepRatio"><span>Сохранять пропорции</span></label>
<div class="st-p-icons" role="group" aria-label="Выровнять на слайде">${ALIGN.map(([c, ic, l]) => `<button type="button" data-cmd="${c}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>`)
      + this.actionHtml(deck)
      + `<section class="st-p-sec"><button type="button" class="st-p-hint" data-cmd="tab.anim">${icon('sparkle')}<span>Появление: <b data-sum="enter"></b> — на вкладке «Анимация»</span></button></section>`
      + extra
      + actions([['obj.dup', 'copy', 'Дублировать (Ctrl+D)'], ['obj.front', 'front', 'На передний план'], ['obj.back', 'back', 'На задний план'], ['obj.ungroup', 'ungroup', 'Разгруппировать'], ...(content ? [['obj.attach', 'grid', 'В раскладку'] as [string, string, string]] : []), ['obj.del', 'trash', 'Удалить (Delete)', 'danger']]);
  }

  /** Действие по щелчку при показе: переход к слайду или ссылка (объект становится кнопкой) */
  private actionHtml(deck: Deck): string {
    const slides = deck.slides.map((sl, k) => `<option value="${sl.id ? `slide:${esc(sl.id)}` : `idx:${k}`}">${k + 1} · ${esc(slideLabel(sl, k).slice(0, 40))}</option>`).join('');
    const sel = this.host.editor().selection;
    const own = sel?.free ? Number(sel.free[3]) : -1;
    const free = (deck.slides[this.host.index()]?.free ?? []) as Block[];
    const objs = free.map((b, k) => `<option value="${k}">${k + 1} · ${objLabel(b)}${k === own ? ' (этот объект)' : ''}</option>`).join('');
    return `<section class="st-p-sec"><h3>По щелчку при показе</h3>
<label class="st-p-field"><select data-f="action" aria-label="Действие по щелчку">
  <option value="">Ничего</option>
  <optgroup label="Переход"><option value="next">Следующий слайд</option><option value="prev">Предыдущий слайд</option><option value="first">Первый слайд</option><option value="last">Последний слайд</option></optgroup>
  <optgroup label="Слайд">${slides}</optgroup>
  <optgroup label="Объект на слайде"><option value="show:">Показать объект…</option><option value="hide:">Скрыть объект…</option><option value="toggle:">Показать / скрыть объект…</option><option value="play:">Проиграть анимацию объекта…</option></optgroup>
  <option value="url">Ссылка…</option>
</select></label>
<label class="st-p-field" data-act-url hidden><span>Адрес</span><input type="url" data-f="actionUrl" placeholder="https://… или mailto:…" spellcheck="false"></label>
<label class="st-p-field" data-act-obj hidden><span>Какой объект</span><select data-f="actionObj"><option value="">— выберите —</option>${objs}</select></label>
<label class="st-p-check"><input type="checkbox" data-f="hidden"><span>Скрыт, пока не нажмут кнопку</span></label>
<label class="st-p-field"><span>Анимация по кнопке «Проиграть»</span><select data-f="emphasis"><option value="">Как появление</option><option value="pulse">Пульс</option><option value="shake">Покачивание</option><option value="spin">Вращение</option><option value="bounce">Прыжок</option><option value="flash">Вспышка</option></select></label>
</section>`;
  }

  private bgHtml(cur: string): string {
    const known = BACKGROUNDS.some(([v]) => v === cur);
    return `<div class="st-p-field"><span>Фон</span><div class="st-bgs" role="radiogroup" aria-label="Фон слайда">${BACKGROUNDS.map(([v, l, look]) =>
      `<button type="button" role="radio" aria-checked="${v === cur}" data-bg="${esc(v)}" title="${esc(l)}"><i style="background:${look}"></i><span>${esc(l)}</span></button>`).join('')}
<label class="st-bg-own" title="Свой цвет"><i style="background:${!known && HEX_RE.test(cur) ? cur : 'conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)'}"></i><input type="color" data-f="bgcolor" aria-label="Свой цвет фона"><span>Свой</span></label></div>
${!known ? `<p class="st-p-note">Сейчас: <code>${esc(cur.length > 60 ? cur.slice(0, 60) + '…' : cur)}</code></p>` : ''}</div>
<details class="st-p-more"><summary>CSS фона</summary><label class="st-p-field"><input type="text" data-f="bg" placeholder="как у темы" spellcheck="false"></label></details>`;
  }

  /** Анимированный фон: образцы — тот же статичный вид, что в миниатюрах */
  private backdropHtml(cur: string): string {
    const opts: [string, string][] = [['', 'Нет'], ...BACKDROPS];
    return `<div class="st-p-field"><span>Анимация фона</span><div class="st-bgs st-bds" role="radiogroup" aria-label="Анимация фона">${opts.map(([v, l]) =>
      `<button type="button" role="radio" aria-checked="${v === cur}" data-backdrop="${v}" title="${esc(l)}"><i class="${v ? `backdrop bd-${v}` : ''}"></i><span>${esc(l)}</span></button>`).join('')}</div></div>`;
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
${this.backdropHtml(typeof s.backdrop === 'string' ? s.backdrop : '')}
${formHtml(this.fields, deck, ['slides', i])}
<button type="button" class="st-p-hint" data-cmd="tab.anim">${icon('sparkle')}<span>Переход и появление объектов — на вкладке «Анимация»</span></button>
</section>
${tpl !== 'canvas' && !s.live ? `<section class="st-p-sec"><h3>Раскладка шаблона</h3><p class="st-p-note">Части слайда стоят на своих местах. Разберите слайд, чтобы двигать и масштабировать их по отдельности: вид и анимации сохранятся. Вернуть — Ctrl+Z.</p>${cmdBtn('slide.explode', 'ungroup', 'Разобрать на объекты')}</section>` : ''}
${sec('deck', 'Презентация', `<label class="st-p-field"><span>Название</span><input type="text" data-f="title"></label>
<label class="st-p-field"><span>Акцентный цвет</span><span class="st-p-color"><input type="color" data-f="accent" aria-label="Акцентный цвет"><button type="button" class="st-link" data-a="accent-reset">Стандартный</button></span></label>
<label class="st-p-field"><span>Градиент акцента — второй цвет</span><span class="st-p-color"><input type="color" data-f="accent2" aria-label="Второй цвет градиента"><button type="button" class="st-link" data-a="accent2-off">Без градиента</button></span></label>`)}`;
  }

  /** Раздел «Состав»: вложенные блоки и поля выделенного блока. Клик — выделить или править. */
  private partsHtml(): string {
    const list = this.parts;
    // Для блока из одного поля состав очевиден
    if (list.length < 2 && !list.some((x) => x.kind === 'block')) return '';
    return sec('parts', 'Состав', `<div class="st-parts">${list.map((x, k) =>
      `<button type="button" class="st-part ${x.kind}" data-part="${k}" title="${x.kind === 'block' ? 'Выделить' : 'Править текст'}"><b>${esc(x.label)}</b>${x.snippet ? `<span>${esc(x.snippet)}</span>` : ''}<i aria-hidden="true">${x.kind === 'block' ? '›' : '✎'}</i></button>`).join('')}</div>
<p class="st-p-note">Esc — выделить внешний блок.</p>`, ` <span class="st-p-count">${list.length}</span>`);
  }

  private multiHtml(n: number): string {
    return `<header class="st-p-head"><span class="st-p-kind">Несколько объектов</span><h2>Выделено: ${n}</h2></header>
<section class="st-p-sec"><h3>Выровнять относительно друг друга</h3>
<div class="st-p-icons" role="group" aria-label="Выровнять">${ALIGN.map(([c, ic, l]) => `<button type="button" data-cmd="${c}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join('')}</div>
<div class="st-p-icons" role="group" aria-label="Распределить">
  <button type="button" data-cmd="dist.h" title="Равные промежутки по ширине" aria-label="Распределить по ширине">${icon('dist-h')}</button>
  <button type="button" data-cmd="dist.v" title="Равные промежутки по высоте" aria-label="Распределить по высоте">${icon('dist-v')}</button>
</div>
<p class="st-p-note">Распределение доступно от трёх объектов.</p>
</section>
<section class="st-p-sec"><button type="button" class="st-p-hint" data-cmd="tab.anim">${icon('sparkle')}<span>Появление и порядок — на вкладке «Анимация»</span></button></section>
<section class="st-p-sec st-p-end"><div class="st-p-row">${cmdBtn('obj.dup', 'copy', 'Дублировать')}${cmdBtn('obj.del', 'trash', 'Удалить', 'danger')}</div></section>`;
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
        enter: effectName(deck, b.enter) ? String(b.enter) : '',
        action: typeof b.action === 'string' ? (/^(https?:|mailto:|tel:)/i.test(b.action) ? 'url' : b.action.replace(/^(show|hide|toggle|play):.*/, '$1:')) : '',
        actionUrl: typeof b.action === 'string' && /^(https?:|mailto:|tel:)/i.test(b.action) ? b.action : '',
        ...triggerValues(deck.slides[this.host.index()]?.free as Block[] | undefined, b.action),
        hidden: b.hidden === true,
        keepRatio: keepsRatio(b),
        angle: String(angleOf(b)),
        emphasis: typeof b.emphasis === 'string' ? b.emphasis : '',
      };
    }
    if (sel) return {};
    const s = deck.slides[this.host.index()];
    const bg = typeof s?.bg === 'string' ? s.bg : '';
    const accent = deck.theme?.accent;
    const acNow = (typeof accent === 'string' && HEX_RE.test(accent) ? accent : getComputedStyle(document.documentElement).getPropertyValue('--ac').trim()).toLowerCase();
    const accent2 = deck.theme?.accent2;
    return {
      label: typeof s?.label === 'string' ? s.label : '',
      bg,
      bgcolor: HEX_RE.test(bg.trim()) ? bg.trim().toLowerCase() : '#ffffff',
      title: deck.title ?? '',
      accent: acNow,
      accent2: typeof accent2 === 'string' && HEX_RE.test(accent2) ? accent2.toLowerCase() : acNow,
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
    const actSel = this.root.querySelector<HTMLSelectElement>('[data-f="action"]');
    const actUrl = this.root.querySelector<HTMLElement>('[data-act-url]');
    if (actSel && actUrl) actUrl.hidden = actSel.value !== 'url';
    const actObj = this.root.querySelector<HTMLElement>('[data-act-obj]');
    if (actSel && actObj) actObj.hidden = !/^(show|hide|toggle|play):$/.test(actSel.value);
    const reset = this.root.querySelector<HTMLElement>('[data-a="accent-reset"]');
    if (reset) reset.hidden = !this.host.deck().theme?.accent && !this.host.deck().theme?.accent2;
    const off2 = this.root.querySelector<HTMLElement>('[data-a="accent2-off"]');
    if (off2) off2.hidden = !this.host.deck().theme?.accent2;
    const sum = this.root.querySelector<HTMLElement>('[data-sum="enter"]');
    if (sum) sum.textContent = (v.enter ? effectName(this.host.deck(), v.enter) : '') || 'нет';
  }

  // ---------------- правки ----------------

  /** Кнопка «показать / скрыть объект k»: у объекта появляется имя (id), для «показать» он скрывается до щелчка */
  private setTrigger(path: Path, verb: string, k: number): void {
    const ed = this.host.editor();
    const i = this.host.index();
    let hid = false;
    ed.commit((d) => {
      const free = d.slides[i]?.free as Block[] | undefined;
      const target = free?.[k];
      if (!free || !target) return;
      if (typeof target.id !== 'string' || !OBJ_ID.test(target.id)) {
        const used = new Set(free.map((x) => x.id));
        let id = `obj-${k + 1}`;
        for (let n = 2; used.has(id); n++) id = `obj-${k + 1}-${n}`;
        target.id = id;
      }
      // «Показать» имеет смысл для скрытого объекта: скрываем его сразу (кроме самой кнопки)
      if (verb === 'show:' && target.hidden !== true && Number(path[3]) !== k) { target.hidden = true; hid = true; }
      setAt(d, [...path, 'action'], `${verb}${target.id}`);
    }, { rebuild: true });
    if (hid) ed.toast('Объект скрыт до щелчка — в редакторе он полупрозрачный', 3000);
  }

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
        const b = getAt(d, path);
        const pl = placeOf(b);
        const next: Record<string, number | undefined> = { ...pl };
        if (f === 'h') next.h = raw ? Math.max(20, n) : undefined;
        else if (raw) next[f] = f === 'w' ? Math.max(20, n) : n;
        // Пропорции закреплены: вторая сторона меняется вместе с первой
        if (keepsRatio(b) && raw && pl.h && pl.w && (f === 'w' || f === 'h')) {
          if (f === 'w') next.h = Math.max(20, Math.round((next.w! * pl.h) / pl.w));
          else next.w = Math.max(20, Math.round((next.h! * pl.w) / pl.h));
        }
        if (next.h === undefined) delete next.h;
        setAt(d, [...path, 'place'], next);
      }, { rebuild: true });
    } else if (sel?.free && f === 'action') {
      const path = sel.free;
      const url = this.root.querySelector<HTMLElement>('[data-act-url]');
      // Ссылка: сначала адрес, запись — когда его введут
      if (raw === 'url') {
        if (url) url.hidden = false;
        this.root.querySelector<HTMLInputElement>('[data-f="actionUrl"]')?.focus();
        return;
      }
      if (url) url.hidden = true;
      // Показать / скрыть: сначала выбирают объект
      const obj = this.root.querySelector<HTMLElement>('[data-act-obj]');
      if (/^(show|hide|toggle|play):$/.test(raw)) {
        const pick = this.root.querySelector<HTMLSelectElement>('[data-f="actionObj"]');
        if (obj) obj.hidden = false;
        if (pick?.value) return this.setTrigger(path, raw, Number(pick.value));
        pick?.focus();
        return;
      }
      if (obj) obj.hidden = true;
      ed.commit((d) => {
        let v = raw;
        // Слайд без id: даём ему id, чтобы переход не сбился, если слайды переставят
        if (v.startsWith('idx:')) {
          const k = Number(v.slice(4));
          const target = d.slides[k];
          if (!target) return;
          if (!target.id) {
            const used = new Set(d.slides.map((x) => x.id));
            let id = `slide-${k + 1}`;
            for (let n = 2; used.has(id); n++) id = `slide-${k + 1}-${n}`;
            target.id = id;
          }
          v = `slide:${target.id}`;
        }
        setAt(d, [...path, 'action'], v || undefined);
      }, { rebuild: true });
    } else if (sel?.free && f === 'actionObj') {
      const verb = this.root.querySelector<HTMLSelectElement>('[data-f="action"]')?.value ?? '';
      if (raw && /^(show|hide|toggle|play):$/.test(verb)) this.setTrigger(sel.free, verb, Number(raw));
    } else if (sel?.free && f === 'angle') {
      const path = sel.free;
      const n = Number(raw || 0);
      if (!Number.isFinite(n)) return this.fill();
      ed.commit((d) => setAt(d, [...path, 'angle'], angleOf({ angle: n }) || undefined), { rebuild: true });
    } else if (sel?.free && f === 'emphasis') {
      const path = sel.free;
      ed.commit((d) => setAt(d, [...path, 'emphasis'], raw || undefined), { rebuild: true });
    } else if (sel?.free && f === 'keepRatio') {
      const path = sel.free;
      const on = (el as HTMLInputElement).checked;
      // В данных — только отличие от обычного (картинки — с пропорциями, остальное — без)
      ed.commit((d) => {
        const b = getAt(d, path) as Block;
        setAt(d, [...path, 'keepRatio'], on === (b.type === 'image') ? undefined : on);
      });
    } else if (sel?.free && f === 'hidden') {
      const path = sel.free;
      const on = (el as HTMLInputElement).checked;
      ed.commit((d) => setAt(d, [...path, 'hidden'], on || undefined), { rebuild: true });
    } else if (sel?.free && f === 'actionUrl') {
      const path = sel.free;
      if (raw && !actionOf(raw)) return ed.toast('Адрес должен начинаться с https://, mailto: или tel:', 3000, true);
      ed.commit((d) => setAt(d, [...path, 'action'], raw || undefined), { rebuild: true });
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
      document.title = `${raw} — Slideria`;
    } else if (f === 'accent' || f === 'accent2') {
      ed.setAccent(raw, f);
    }
  }
}

/** Объект слайда в списке: вид блока и начало его текста */
function objLabel(b: Block): string {
  const raw = typeof b.text === 'string' ? b.text : typeof b.title === 'string' ? b.title : typeof b.label === 'string' ? b.label : '';
  const text = raw.replace(/[*_{}#|\\]|\[|\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return `${blockName(String(b.type))}${text ? ` «${esc(text.length > 24 ? `${text.slice(0, 24)}…` : text)}»` : ''}`;
}

/** Поле «Какой объект» для кнопки show/hide/toggle: номер первого объекта из действия */
function triggerValues(free: Block[] | undefined, action: unknown): { actionObj: string } {
  const m = typeof action === 'string' ? /^(?:show|hide|toggle|play):([\w-]+)/.exec(action) : null;
  const k = m && free ? free.findIndex((b) => b.id === m[1]) : -1;
  return { actionObj: k >= 0 ? String(k) : '' };
}

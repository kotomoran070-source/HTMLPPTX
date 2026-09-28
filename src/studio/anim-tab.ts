import { icon } from '../components/icons';
import { getAt, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Block, Deck } from '../types';
import { showMenu, showPopover } from './menu';
import { deckWithEffect, listEffects, removeEffect, type UserEffect } from './templates';

/**
 * Вкладка «Анимация»: переход к слайду и появление объектов.
 * Образцы на ленте — живые: при наведении проигрывают свой эффект.
 */

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

export interface AnimHost {
  deck: Deck;
  editor: Editor;
  index(): number;
  /** Свободные объекты в выделении */
  selPaths(): Path[];
  /** Появление по очереди в порядке чтения */
  sequence(paths?: Path[]): void;
  preview(): void;
}

export const TRANSITIONS: [string, string][] = [
  ['', 'Стандартный'], ['none', 'Без перехода'], ['fade', 'Растворение'], ['push', 'Сдвиг'],
  ['cover', 'Наплыв'], ['zoom', 'Приближение'], ['blur', 'Размытие'],
];

export const EFFECTS: [string, string][] = [
  ['', 'Без анимации'], ['fade', 'Проявление'], ['rise', 'Всплытие снизу'], ['drop', 'Появление сверху'],
  ['left', 'Выезд слева'], ['right', 'Выезд справа'], ['scale', 'Увеличение'], ['pop', 'Пружина'],
];

const SPEEDS: [number, string][] = [[300, 'Быстро · 0,3 с'], [600, 'Обычно · 0,6 с'], [1000, 'Медленно · 1 с'], [1600, 'Очень медленно · 1,6 с']];

/** Шаг между появлениями при перестановке и «по очереди», мс */
export const STEP = 300;

const isStd = (v: unknown) => EFFECTS.some(([k]) => k && k === v);
/** Объект анимирован: стандартный эффект или свой (есть в deck.effects) */
const isOn = (deck: Deck, v: unknown) => isStd(v) || (typeof v === 'string' && !!deck.effects?.[v]);
/** Название эффекта для подписей */
export const effectName = (deck: Deck, v: unknown) => EFFECTS.find(([k]) => k === v)?.[1] ?? (typeof v === 'string' ? deck.effects?.[v]?.name : undefined) ?? '';
const sec = (ms: number) => `${(ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} с`;

const group = (label: string, body: string, id = '') =>
  `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label"${id ? ` id="${id}"` : ''}>${esc(label)}</div></div>`;

const btn = (cmd: string, ic: string, label: string, o: { big?: boolean; menu?: boolean; title?: string; ico?: boolean } = {}) =>
  `<button type="button" class="st-rb${o.big ? ' big' : ''}${o.ico ? ' ico' : ''}" data-cmd="${cmd}" title="${esc(o.title ?? label)}"${o.menu ? ' aria-haspopup="true"' : ''}${o.ico ? ` aria-label="${esc(label)}"` : ''}>`
  + icon(ic) + (o.ico ? '' : `<span>${esc(label)}${o.menu ? '<b class="st-caret"></b>' : ''}</span>`) + '</button>';

/** Образец перехода: два маленьких слайда, «старый» и «новый» */
const trTile = ([v, l]: [string, string]) =>
  `<button type="button" class="st-atile" data-cmd="tr.set.${v || 'default'}" title="${esc(l)}" aria-label="${esc(l)}"><i class="st-trv" data-v="${v || 'default'}"><b></b><b></b></i></button>`;

/** Образец появления: плашка въезжает на «слайд» */
const fxTile = ([v, l]: [string, string]) =>
  `<button type="button" class="st-atile" data-cmd="fx.set.${v || 'none'}" title="${esc(l)}" aria-label="${esc(l)}"><i class="st-fxv" data-v="${v || 'none'}"><b></b></i></button>`;

export function animTabHtml(): string {
  return '<button type="button" role="tab" data-tab="anim" aria-selected="false">Анимация</button>';
}

export function animPanelHtml(): string {
  return `<div class="st-rpanel" data-panel="anim" hidden>
  ${group('Просмотр', btn('show.preview', 'play', 'Просмотр', { big: true, title: 'Проиграть переход и появление объектов на этом слайде' }))}
  ${group('Переход к слайду', `<div class="st-agallery">${TRANSITIONS.map(trTile).join('')}</div>`
    + `<div class="st-rstack">${btn('tr.speed', 'reset', 'Длительность', { menu: true, title: 'Сколько длится переход' })}${btn('tr.all', 'layers', 'Ко всем слайдам', { title: 'Такой же переход у всех слайдов' })}</div>`, 'st-tr-label')}
  ${group('Появление объекта', `<div class="st-agallery">${EFFECTS.map(fxTile).join('')}</div>`
    + `<div class="st-rstack">${btn('fx.mine', 'sparkle', 'Мои эффекты', { menu: true, title: 'Эффекты, сохранённые из импортированных слайдов' })}</div>`, 'st-fx-label')}
  ${group('Время и порядок', `<div class="st-rstack">
    <label class="st-rfield" title="Через сколько секунд после открытия слайда объект появляется"><span>Задержка</span><input type="number" id="st-fx-delay" min="0" max="20" step="0.1" aria-label="Задержка появления, секунды"><span>с</span></label>
    <div class="st-rrow">${btn('anim.earlier', 'up', 'Раньше', { title: 'Появляться раньше' })}${btn('anim.later', 'up', 'Позже', { title: 'Появляться позже' })}</div>
  </div><div class="st-rstack">${btn('anim.seq', 'sparkle', 'По очереди', { title: 'Выделенные объекты (или все на слайде) появляются по очереди: сверху вниз, слева направо' })}${btn('anim.order', 'list', 'Порядок', { menu: true, title: 'Все анимированные объекты слайда по порядку' })}</div>`)}
</div>`;
}

/** Объекты слайда в порядке появления: анимированные по задержке, затем остальные */
function order(deck: Deck, i: number): { b: Block; k: number; delay: number; on: boolean }[] {
  const free = (deck.slides[i]?.free ?? []) as Block[];
  return free.map((b, k) => ({ b, k, delay: Number(b.delay) || 0, on: isOn(deck, b.enter) }))
    .sort((a, b) => (a.on === b.on ? a.delay - b.delay || a.k - b.k : a.on ? -1 : 1));
}

function snippet(b: Block): string {
  const texts = Array.isArray(b.texts) ? b.texts : [];
  const raw = [b.text, b.title, b.caption, texts[0], b.label].find((v) => typeof v === 'string' && v.trim());
  return typeof raw === 'string' ? raw.replace(/\{[\w#-]+\|([^}]*)\}/g, '$1').replace(/<[^>]+>|[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30) : '';
}

export function animCommands(h: AnimHost): Record<string, Command> {
  const { deck, editor: ed } = h;
  const slide = () => deck.slides[h.index()];
  const blocks = () => h.selPaths().map((p) => getAt(deck, p) as Block);
  const hasSel = () => h.selPaths().length > 0;
  const single = () => (h.selPaths().length === 1 ? h.selPaths()[0] : null);
  const cmds: Record<string, Command> = {};

  // ---------- переход к слайду ----------
  for (const [v] of TRANSITIONS) {
    cmds[`tr.set.${v || 'default'}`] = {
      run: () => {
        const i = h.index();
        ed.commit((d) => {
          if (v) d.slides[i].transition = v;
          else delete d.slides[i].transition;
        }, { rebuild: true });
        // Сразу показать, как выглядит
        if (v && v !== 'none') requestAnimationFrame(() => h.preview());
      },
      active: () => (slide()?.transition ?? '') === v,
    };
  }
  cmds['tr.all'] = {
    run: () => {
      const s = slide();
      const v = s?.transition;
      const ms = s?.transitionMs;
      ed.commit((d) => d.slides.forEach((x) => {
        if (v) x.transition = v;
        else delete x.transition;
        if (ms) x.transitionMs = ms;
        else delete x.transitionMs;
      }), { rebuild: true });
      ed.toast('Переход применён ко всем слайдам', 1600);
    },
  };
  cmds['tr.speed'] = {
    run: () => {
      const cur = Number(slide()?.transitionMs) || 600;
      showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="tr.speed"]')!, SPEEDS.map(([ms, l]) => ({
        label: l,
        checked: cur === ms,
        run: () => {
          const i = h.index();
          ed.commit((d) => {
            if (ms === 600) delete d.slides[i].transitionMs;
            else d.slides[i].transitionMs = ms;
          }, { rebuild: true });
        },
      })));
    },
    enabled: () => !!slide()?.transition && slide()?.transition !== 'none',
  };

  // ---------- появление объекта ----------
  /** Эффект выделенным: новый анимированный объект появляется последним */
  const setEffect = (v: string, prep?: (d: Deck) => void) => {
    const paths = h.selPaths();
    const i = h.index();
    const others = order(deck, i).filter((o) => o.on && !paths.some((p) => Number(p[3]) === o.k));
    let next = others.length ? Math.max(...others.map((o) => o.delay)) + STEP : 0;
    ed.commit((d) => {
      prep?.(d);
      paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (!v) { delete b.enter; delete b.delay; return; }
        const was = isOn(d, b.enter);
        b.enter = v;
        if (!was && paths.length === 1) {
          if (next) b.delay = next;
          else delete b.delay;
          next += STEP;
        }
      });
    }, { rebuild: true });
    if (v) requestAnimationFrame(() => h.preview());
  };
  for (const [v] of EFFECTS) {
    cmds[`fx.set.${v || 'none'}`] = {
      run: () => setEffect(v),
      enabled: hasSel,
      active: () => {
        const list = blocks();
        return list.length > 0 && list.every((b) => (isStd(b.enter) ? b.enter : '') === v);
      },
    };
  }
  cmds['fx.mine'] = { run: () => minePopover(h, (e) => setEffect(e.id, (d) => deckWithEffect(d, e))) };

  // ---------- время и порядок ----------
  const move = (dir: 1 | -1, k = Number(single()?.[3] ?? -1)) => {
    if (k < 0) return;
    const i = h.index();
    const list = order(deck, i).filter((o) => o.on);
    const at = list.findIndex((o) => o.k === k);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    const first = Math.min(...list.map((o) => o.delay));
    ed.commit((d) => list.forEach((o, n) => {
      const b = d.slides[i].free![o.k] as Block;
      const delay = first + n * STEP;
      if (delay) b.delay = delay;
      else delete b.delay;
    }), { rebuild: true, merge: `anim:${i}` });
  };
  const canMove = (dir: 1 | -1) => () => {
    const p = single();
    if (!p) return false;
    const list = order(deck, h.index()).filter((o) => o.on);
    const at = list.findIndex((o) => o.k === Number(p[3]));
    return at >= 0 && at + dir >= 0 && at + dir < list.length;
  };
  cmds['anim.earlier'] = { run: () => move(-1), enabled: canMove(-1) };
  cmds['anim.later'] = { run: () => move(1), enabled: canMove(1) };
  cmds['anim.seq'] = {
    run: () => {
      const paths = h.selPaths();
      const i = h.index();
      const n = (deck.slides[i].free ?? []).length;
      h.sequence(paths.length > 1 ? paths : Array.from({ length: n }, (_x, k) => ['slides', i, 'free', k]));
      requestAnimationFrame(() => h.preview());
    },
    enabled: () => h.selPaths().length > 1 || (slide()?.free ?? []).length > 1,
  };
  cmds['anim.order'] = { run: () => orderPopover(h, move), enabled: () => (slide()?.free ?? []).length > 0 };
  return cmds;
}

/** Порядок появления: компактный список, клик — выделить объект, стрелки — переставить */
function orderPopover(h: AnimHost, move: (dir: 1 | -1, k: number) => void): void {
  const anchor = document.querySelector<HTMLElement>('.st-ribbon [data-cmd="anim.order"]')!;
  const html = () => {
    const list = order(h.deck, h.index());
    const on = list.filter((o) => o.on);
    const still = list.length - on.length;
    const selected = new Set(h.selPaths().map((p) => Number(p[3])));
    return `<div class="st-aorder">${on.length ? on.map((o, n) => `<div class="st-aorder-row${selected.has(o.k) ? ' sel' : ''}">
  <button type="button" class="st-aorder-pick" data-k="${o.k}" title="Выделить"><b>${n + 1}</b><span><em>${esc(blockName(o.b.type))}</em>${snippet(o.b) ? ` · ${esc(snippet(o.b))}` : ''}</span><small>${esc(effectName(h.deck, o.b.enter))} · ${o.delay ? sec(o.delay) : 'сразу'}</small></button>
  <button type="button" class="st-aorder-mv" data-mv="${o.k}" data-dir="-1" title="Раньше" aria-label="Раньше"${n === 0 ? ' disabled' : ''}>${icon('up')}</button>
  <button type="button" class="st-aorder-mv" data-mv="${o.k}" data-dir="1" title="Позже" aria-label="Позже"${n === on.length - 1 ? ' disabled' : ''}>${icon('up')}</button>
</div>`).join('') : '<p class="st-aorder-empty">На слайде ещё нет анимации. Выделите объект и выберите эффект.</p>'}
${still ? `<p class="st-aorder-still">Без анимации, видны сразу: ${still}</p>` : ''}</div>`;
  };
  const el = showPopover(anchor, html(), (b) => {
    if (b.dataset.k) {
      const k = Number(b.dataset.k);
      return { run: () => h.editor.selectFree(h.index(), k) };
    }
    if (b.dataset.mv) {
      const k = Number(b.dataset.mv);
      const dir = Number(b.dataset.dir) as 1 | -1;
      return {
        keep: true,
        run: () => {
          move(dir, k);
          el.innerHTML = html();
        },
      };
    }
    return null;
  }, 'st-aorder-pop');
}

/** Анимации своих эффектов для образцов в списке (на странице — один раз) */
function injectEffects(list: UserEffect[]): void {
  let el = document.getElementById('htmlpptx-user-fx');
  if (!el) {
    el = document.createElement('style');
    el.id = 'htmlpptx-user-fx';
    document.head.appendChild(el);
  }
  el.textContent = list.map((e) => e.css).join('\n');
}

/**
 * «Мои эффекты»: сохранённые вручную (правый щелчок по импортированному объекту →
 * «Сохранить появление как эффект…») и те, что уже есть в этой презентации.
 */
function minePopover(h: AnimHost, apply: (e: UserEffect) => void): void {
  const anchor = document.querySelector<HTMLElement>('.st-ribbon [data-cmd="fx.mine"]')!;
  const saved = listEffects();
  const inDeck = Object.entries(h.deck.effects ?? {})
    .filter(([id]) => !saved.some((e) => e.id === id))
    .map(([id, e]) => ({ id, name: e.name, ms: Number(e.ms) || 600, ease: e.ease ?? 'ease', css: '', created: 0 }));
  const all = [...saved, ...inDeck];
  injectEffects(saved);
  const can = h.selPaths().length > 0;
  const cur = new Set(h.selPaths().map((p) => String((getAt(h.deck, p) as Block).enter ?? '')));
  const tile = (e: UserEffect, own: boolean) => `<div class="st-mfx${cur.has(e.id) ? ' on' : ''}"><button type="button" class="st-mfx-pick" data-id="${esc(e.id)}"${can ? '' : ' disabled'} title="${esc(e.name)}">`
    + `<i class="st-fxv own" style="--ufx:${esc(e.id)};--ums:${Math.max(600, e.ms)}ms"><b></b></i><span>${esc(e.name)}</span></button>`
    + (own ? `<button type="button" class="st-mfx-del" data-del="${esc(e.id)}" title="Убрать из списка (в презентациях эффект останется)" aria-label="Убрать эффект «${esc(e.name)}»">${icon('close')}</button>` : '') + '</div>';
  const html = () => `<div class="st-mfx-list">${all.length
    ? all.map((e) => tile(e, saved.some((x) => x.id === e.id))).join('')
    : '<p class="st-mfx-empty">Пока нет своих эффектов. Правый щелчок по импортированному объекту с красивым появлением → «Сохранить появление как эффект…».</p>'}</div>`
    + (all.length && !can ? '<p class="st-mfx-empty">Выделите объект на слайде, чтобы применить эффект.</p>' : '');
  const el = showPopover(anchor, html(), (b) => {
    if (b.dataset.del) {
      const id = b.dataset.del;
      return {
        keep: true,
        run: () => {
          removeEffect(id);
          const k = all.findIndex((e) => e.id === id);
          if (k >= 0) all.splice(k, 1);
          saved.splice(saved.findIndex((e) => e.id === id), 1);
          el.innerHTML = html();
        },
      };
    }
    const e = all.find((x) => x.id === b.dataset.id);
    if (!e || !can) return null;
    // Эффект только из этой презентации: его анимация уже в её стилях
    return { run: () => apply(e.css ? e : { ...e, css: '' }) };
  }, 'st-mfx-pop');
}

/** Подписи групп и поле задержки — по текущему слайду и выделению */
export function syncAnimTab(h: AnimHost): void {
  const s = h.deck.slides[h.index()];
  const trLabel = document.getElementById('st-tr-label');
  if (trLabel) {
    const name = TRANSITIONS.find(([v]) => v === (s?.transition ?? ''))?.[1] ?? 'Стандартный';
    const ms = Number(s?.transitionMs) || 600;
    trLabel.textContent = `Переход: ${name}${s?.transition && s.transition !== 'none' ? ` · ${sec(ms)}` : ''}`;
  }
  const list = h.selPaths().map((p) => getAt(h.deck, p) as Block);
  const fxLabel = document.getElementById('st-fx-label');
  if (fxLabel) {
    const fx = new Set(list.map((b) => (isOn(h.deck, b.enter) ? String(b.enter) : '')));
    fxLabel.textContent = !list.length ? 'Появление: выделите объект'
      : fx.size > 1 ? 'Появление: разные' : `Появление: ${effectName(h.deck, [...fx][0]) || 'Без анимации'}`;
  }
  const delay = document.getElementById('st-fx-delay') as HTMLInputElement | null;
  if (delay && document.activeElement !== delay) {
    const on = list.filter((b) => isOn(h.deck, b.enter));
    delay.disabled = !on.length;
    const ds = new Set(on.map((b) => Number(b.delay) || 0));
    delay.value = ds.size === 1 ? String(([...ds][0] / 1000)) : '';
    delay.placeholder = ds.size > 1 ? 'разные' : '0';
  }
}

/** Поле задержки на ленте: секунды → delay в мс у выделенных анимированных объектов */
export function bindDelayField(h: AnimHost): void {
  const input = document.getElementById('st-fx-delay') as HTMLInputElement | null;
  if (!input) return;
  const apply = () => {
    const raw = input.value.trim().replace(',', '.');
    if (!raw) return;
    const ms = Math.max(0, Math.min(20000, Math.round(Number(raw) * 1000)));
    if (!Number.isFinite(ms)) return;
    const paths = h.selPaths().filter((p) => isOn(h.deck, (getAt(h.deck, p) as Block).enter));
    if (!paths.length) return;
    h.editor.commit((d) => paths.forEach((p) => {
      const b = getAt(d, p) as Block;
      if (ms) b.delay = ms;
      else delete b.delay;
    }), { rebuild: true, merge: `delay:${h.index()}` });
  };
  input.addEventListener('change', apply);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); input.select(); }
    e.stopPropagation();
  });
}

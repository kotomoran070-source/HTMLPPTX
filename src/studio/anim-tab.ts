import { icon } from '../components/icons';
import { actsOf, EMPHASIS, ENTER, EXIT, nameOf, TEXT_ENTER, type ActKind, type Pair } from '../engine/anim';
import { getAt, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { TEXT_FX, TEXT_FX_NAMES, textFxPreview } from '../engine/text-fx';
import type { Block, Deck } from '../types';
import { bindRail, railNav } from './backdrop-pick';
import { showMenu, showPopover } from './menu';
import { deckWithEffect, listEffects, removeEffect, type UserEffect } from './templates';

/**
 * Вкладка «Анимация»: переход к слайду, появление, выделение и исчезновение объектов.
 * Образцы на ленте — живые: при наведении проигрывают свой эффект; пункты выделения
 * и исчезновения при наведении проигрываются на самих объектах слайда.
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
  ['cover', 'Наплыв'], ['zoom', 'Приближение'], ['blur', 'Размытие'], ['morph', 'Морф'],
];

export const EFFECTS: [string, string][] = [['', 'Без анимации'], ...ENTER.map(([k, n]) => [k, n] as [string, string])];

/** Подсказки к появлениям, которые есть не у всех объектов */
const FX_HINT: Record<string, string> = {
  words: 'По словам: у надписи и текста фигуры', letters: 'По буквам: у надписи и текста фигуры',
  draw: 'Прорисовка: у линий, стрелок и фигур — контур проводится, заливка следом',
};

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
/** Подсказки к переходам, которые не понять по названию */
const TR_HINT: Record<string, string> = { morph: 'Морф: одинаковые объекты (с тем же именем или текстом) перелетают на новое место' };
const trTile = ([v, l]: [string, string]) =>
  `<button type="button" class="st-atile" data-cmd="tr.set.${v || 'default'}" title="${esc(TR_HINT[v] ?? l)}" aria-label="${esc(l)}"><i class="st-trv" data-v="${v || 'default'}"><b></b><b></b></i></button>`;

/** Образец появления: плашка въезжает на «слайд» (по словам и буквам — три плашки по очереди) */
const fxTile = ([v, l]: [string, string]) =>
  `<button type="button" class="st-atile" data-cmd="fx.set.${v || 'none'}" title="${esc(FX_HINT[v] ?? l)}" aria-label="${esc(l)}"><i class="st-fxv" data-v="${v || 'none'}"><b></b>${TEXT_ENTER.has(v) ? '<b></b><b></b>' : ''}</i></button>`;

export function animTabHtml(): string {
  return '<button type="button" role="tab" data-tab="anim" aria-selected="false">Анимация</button>';
}

export function animPanelHtml(): string {
  return `<div class="st-rpanel" data-panel="anim" hidden>
  ${group('Просмотр', btn('show.preview', 'play', 'Просмотр', { big: true, title: 'Проиграть переход и появление объектов на этом слайде' }))}
  ${group('Переход к слайду', `<div class="st-agallery">${TRANSITIONS.map(trTile).join('')}</div>`
    + `<div class="st-rstack">${btn('tr.speed', 'reset', 'Длительность', { menu: true, title: 'Сколько длится переход' })}${btn('tr.all', 'layers', 'Ко всем слайдам', { title: 'Такой же переход у всех слайдов' })}</div>`, 'st-tr-label')}
  ${group('Анимация объекта', `<div class="st-bdpick st-fxpick">${railNav().join(`<div class="st-agallery st-fxgal">${EFFECTS.map(fxTile).join('')}</div>`)}</div>`
    + `<div class="st-rstack">${btn('fx.emph', 'sparkle', 'Выделение', { menu: true, title: 'По щелчку объект пульсирует, качается, светится… — шагом в очереди щелчков' })}`
    + btn('fx.exit', 'close', 'Исчезновение', { menu: true, title: 'По щелчку объект уходит со слайда — шагом в очереди щелчков' })
    + `${btn('fx.mine', 'layers', 'Мои эффекты', { menu: true, title: 'Эффекты, сохранённые из импортированных слайдов' })}</div>`, 'st-fx-label')}
  ${group('Время и порядок', `<div class="st-rstack">
    <label class="st-rfield" title="Через сколько секунд после открытия слайда объект появляется"><span>Задержка</span><input type="number" id="st-fx-delay" min="0" max="20" step="0.1" aria-label="Задержка появления, секунды"><span>с</span></label>
    <div class="st-rrow">${btn('anim.earlier', 'up', 'Раньше', { title: 'Появляться раньше' })}${btn('anim.later', 'up', 'Позже', { title: 'Появляться позже' })}</div>
  </div><div class="st-rstack"><button type="button" class="st-rb st-chk" data-cmd="anim.click" title="При показе объект ждёт щелчка («Далее», пробел, пульт) и появляется своим эффектом; по порядку — как в «Порядке»"><i class="st-box">${icon('check')}</i><span>Ждёт щелчка</span></button>${btn('anim.seq', 'sparkle', 'По очереди', { title: 'Выделенные объекты (или все на слайде) появляются по очереди: сверху вниз, слева направо' })}${btn('anim.order', 'list', 'Порядок', { menu: true, title: 'Все анимированные объекты слайда по порядку' })}</div>`)}
  ${group('Текст', `<div class="st-rstack"><button type="button" class="st-rb st-chk" data-cmd="anim.count" title="Числа в тексте объекта при появлении отсчитываются от нуля до своего значения"><i class="st-box">${icon('check')}</i><span>Число набегает</span></button>${btn('anim.textfx', 'sparkle', 'Эффект текста', { menu: true, title: 'Глитч, неон, блик, волна, печатная машинка, расшифровка — у надписи или текста фигуры' })}</div>`)}
</div>`;
}

/** Анимация слайда: появление (сразу или по щелчку), выделение или исчезновение объекта k; key — место в очереди */
interface Item { b: Block; k: number; kind: ActKind; key: number; click: boolean }
const RANK: Record<ActKind, number> = { in: 0, emph: 1, out: 2 };
/** Место «в конце очереди» у исчезновения без своего места (записано вручную) */
const LAST = Number.MAX_SAFE_INTEGER;

/** Анимации слайда по порядку: сначала появления при открытии (по задержке), потом очередь щелчков */
function items(deck: Deck, i: number): Item[] {
  const free = (deck.slides[i]?.free ?? []) as Block[];
  const out: Item[] = [];
  free.forEach((b, k) => {
    if (isOn(deck, b.enter) && b.click !== true) out.push({ b, k, kind: 'in', key: Number(b.delay) || 0, click: false });
    for (const a of actsOf(b, k)) out.push({ b, k, kind: a.kind, key: a.key, click: true });
  });
  return out.sort((a, c) => Number(a.click) - Number(c.click) || a.key - c.key || RANK[a.kind] - RANK[c.kind] || a.k - c.k);
}

/** Место после всех анимаций слайда (кроме анимаций объектов skip) */
function nextKey(deck: Deck, i: number, skip: Set<number> = new Set()): number {
  const keys = items(deck, i).filter((o) => !skip.has(o.k) && o.key < LAST).map((o) => o.key);
  return keys.length ? Math.max(...keys) + STEP : 0;
}

/** У объекта есть текст: надпись или фигура с текстом */
const texty = (b: Block | undefined) => !!b && (b.type === 'text' || b.type === 'shape') && typeof b.text === 'string' && b.text.trim() !== '';
/** Есть что прорисовать: линия, стрелка, фигура, вставка с рисунком SVG */
const drawable = (b: Block | undefined) => !!b && (b.type === 'shape' || (b.type === 'html' && /<svg/i.test(String(b.html ?? ''))));
/** Появление годится объекту */
const fits = (v: string, b: Block | undefined) => (TEXT_ENTER.has(v) ? texty(b) : v === 'draw' ? drawable(b) : true);

/** Подпись анимации в «Порядке» */
function itemName(deck: Deck, o: Item): string {
  if (o.kind === 'emph') return `Выделение: ${nameOf(EMPHASIS, o.b.emphasis)}`;
  if (o.kind === 'out') return `Исчезновение: ${nameOf(EXIT, o.b.exit)}`;
  return effectName(deck, o.b.enter) || 'Появление';
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
    let next = nextKey(deck, i, new Set(paths.map((p) => Number(p[3]))));
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
      // По словам и буквам — у текста, прорисовка — у линий и фигур
      enabled: () => hasSel() && blocks().every((b) => fits(v, b)),
      active: () => {
        const list = blocks();
        return list.length > 0 && list.every((b) => (isStd(b.enter) ? b.enter : '') === v);
      },
    };
  }
  cmds['fx.mine'] = { run: () => minePopover(h, (e) => setEffect(e.id, (d) => deckWithEffect(d, e))) };

  // ---------- выделение и исчезновение по щелчку ----------
  /** Выделение (emphasis + emphAt) или исчезновение (exit + exitAt) у выделенных; '' — убрать. Новое — в конец очереди */
  const setAct = (kind: 'emph' | 'out', v: string) => {
    const paths = freeSel();
    const i = h.index();
    const [field, at] = kind === 'emph' ? ['emphasis', 'emphAt'] : ['exit', 'exitAt'];
    let next = nextKey(deck, i);
    ed.commit((d) => paths.forEach((p) => {
      const b = getAt(d, p) as Block;
      if (!v) { delete b[field]; delete b[at]; return; }
      b[field] = v;
      if (typeof b[at] !== 'number') { b[at] = next; next += STEP; }
    }), { rebuild: true });
  };
  const objEl = (p: Path) => document.querySelector<HTMLElement>(`#st-canvas .slide.on > .free[data-free='${JSON.stringify(p)}']`);
  /** Меню выделения или исчезновения: наведение на пункт проигрывает его на объектах слайда */
  const actMenu = (kind: 'emph' | 'out') => {
    const paths = freeSel();
    const list: readonly Pair[] = kind === 'emph' ? EMPHASIS : EXIT;
    const cur = new Set(paths.map((p) => {
      const b = getAt(deck, p) as Block;
      return kind === 'emph' ? (typeof b.emphAt === 'number' ? String(b.emphasis ?? '') : '') : String(b.exit ?? '');
    }));
    const objs = paths.map(objEl).filter((x): x is HTMLElement => !!x);
    const marked = paths.every((p) => /\{mark\|/i.test(JSON.stringify(getAt(deck, p) ?? '')));
    showMenu(document.querySelector<HTMLElement>(`.st-ribbon [data-cmd="fx.${kind === 'emph' ? 'emph' : 'exit'}"]`)!, [['', kind === 'emph' ? 'Без выделения' : 'Без исчезновения'] as Pair, ...list].map(([v, l]) => ({
      label: v === 'mark' && !marked ? `${l} — нужен {mark|…} в тексте` : l,
      checked: cur.size === 1 && cur.has(v),
      disabled: v === 'mark' && !marked,
      preview: v ? (on: boolean) => objs.forEach((o) => tryAct(o, kind, on ? v : null)) : undefined,
      run: () => { objs.forEach((o) => tryAct(o, kind, null)); setAct(kind, v); },
    })));
  };
  cmds['fx.emph'] = { run: () => actMenu('emph'), enabled: () => freeSel().length > 0 };
  cmds['fx.exit'] = { run: () => actMenu('out'), enabled: () => freeSel().length > 0 };

  // ---------- время и порядок ----------
  /** Сдвинуть анимацию номер at в очереди слайда; места всех перенумеровываются с шагом STEP */
  const move = (dir: 1 | -1, at: number) => {
    const i = h.index();
    const list = items(deck, i);
    const to = at + dir;
    // Появление при открытии и шаг по щелчку не меняются местами: это разные очереди
    if (at < 0 || to < 0 || to >= list.length || list[at].click !== list[to].click) return;
    [list[at], list[to]] = [list[to], list[at]];
    const keys = list.map((o) => o.key).filter((x) => x < LAST);
    const first = keys.length ? Math.min(...keys) : 0;
    ed.commit((d) => list.forEach((o, n) => {
      const b = d.slides[i].free![o.k] as Block;
      const key = first + n * STEP;
      if (o.kind === 'emph') b.emphAt = key;
      else if (o.kind === 'out') b.exitAt = key;
      else if (key) b.delay = key;
      else delete b.delay;
    }), { rebuild: true, merge: `anim:${i}` });
  };
  /** Первая анимация выделенного объекта — её двигают «Раньше» и «Позже» */
  const selAt = () => {
    const p = single();
    return p ? items(deck, h.index()).findIndex((o) => o.k === Number(p[3])) : -1;
  };
  const canMove = (dir: 1 | -1) => () => {
    const at = selAt();
    const list = items(deck, h.index());
    return at >= 0 && at + dir >= 0 && at + dir < list.length && list[at].click === list[at + dir].click;
  };
  cmds['anim.earlier'] = { run: () => move(-1, selAt()), enabled: canMove(-1) };
  // «Число набегает»: у выделенных объектов, в тексте которых есть число
  const counted = () => h.selPaths().filter((p) => /\d/.test(JSON.stringify(getAt(deck, p) ?? '')));
  // По щелчку: объект ждёт «Далее» при показе; новый — последним в очереди
  const freeSel = () => h.selPaths().filter((p) => p.length === 4 && p[2] === 'free');
  cmds['anim.click'] = {
    run: () => {
      const paths = freeSel();
      const on = !paths.every((p) => (getAt(deck, p) as Block).click === true);
      const i = h.index();
      let next = nextKey(deck, i, new Set(paths.map((p) => Number(p[3]))));
      ed.commit((d) => paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (!on) { delete b.click; return; }
        const was = isOn(d, b.enter) || b.click === true;
        b.click = true;
        if (!was) {
          if (next) b.delay = next;
          else delete b.delay;
          next += STEP;
        }
      }), { rebuild: true });
    },
    enabled: () => freeSel().length > 0,
    active: () => { const p = freeSel(); return p.length > 0 && p.every((x) => (getAt(deck, x) as Block).click === true); },
  };
  cmds['anim.count'] = {
    run: () => {
      const paths = counted();
      const on = !paths.every((p) => (getAt(deck, p) as Block).count === true);
      h.editor.commit((d) => paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (on) b.count = true;
        else delete b.count;
      }), { rebuild: true });
      if (on) requestAnimationFrame(() => h.preview());
    },
    enabled: () => counted().length > 0,
    active: () => { const p = counted(); return p.length > 0 && p.every((x) => (getAt(deck, x) as Block).count === true); },
  };
  // Эффект текста: у выделенных надписей и фигур с текстом; наведение на пункт — примерка на слайде
  const texty = () => h.selPaths().filter((p) => {
    const b = getAt(deck, p) as Block | undefined;
    return !!b && (b.type === 'text' || b.type === 'shape') && typeof b.text === 'string' && b.text.trim() !== '';
  });
  cmds['anim.textfx'] = {
    run: () => {
      const paths = texty();
      const cur = new Set(paths.map((p) => String((getAt(deck, p) as Block).textFx ?? '')));
      const objs = paths.map((p) => document.querySelector<HTMLElement>(`#st-canvas .slide.on > .free[data-free='${JSON.stringify(p)}']`)).filter((x): x is HTMLElement => !!x);
      let stops: (() => void)[] = [];
      const tryFx = (v: string | null) => {
        stops.forEach((f) => f());
        stops = [];
        objs.forEach((o, k) => {
          const own = String((getAt(deck, paths[k]) as Block).textFx ?? '');
          const fx = v ?? own;
          if (fx) o.dataset.tfx = fx;
          else delete o.dataset.tfx;
          if (v !== null && fx) stops.push(textFxPreview(o));
        });
      };
      const set = (v: string) => ed.commit((d) => paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (v) b.textFx = v;
        else delete b.textFx;
      }), { rebuild: true });
      showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="anim.textfx"]')!, [['', 'Без эффекта'] as [string, string], ...TEXT_FX.map((v) => [v, TEXT_FX_NAMES[v]] as [string, string])].map(([v, l]) => ({
        label: l,
        checked: cur.size === 1 && cur.has(v),
        preview: (on: boolean) => tryFx(on ? v : null),
        run: () => { tryFx(null); set(v); if (v) requestAnimationFrame(() => h.preview()); },
      })));
    },
    enabled: () => texty().length > 0,
  };
  cmds['anim.later'] = { run: () => move(1, selAt()), enabled: canMove(1) };
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

/** Порядок анимаций: компактный список, клик — выделить объект, стрелки — переставить */
function orderPopover(h: AnimHost, move: (dir: 1 | -1, at: number) => void): void {
  const anchor = document.querySelector<HTMLElement>('.st-ribbon [data-cmd="anim.order"]')!;
  const html = () => {
    const on = items(h.deck, h.index());
    const free = (h.deck.slides[h.index()]?.free ?? []) as Block[];
    const still = free.filter((_b, k) => !on.some((o) => o.k === k)).length;
    const selected = new Set(h.selPaths().map((p) => Number(p[3])));
    return `<div class="st-aorder">${on.length ? on.map((o, n) => `<div class="st-aorder-row${selected.has(o.k) ? ' sel' : ''}" data-kind="${o.kind}">
  <button type="button" class="st-aorder-pick" data-k="${o.k}" title="Выделить"><b>${n + 1}</b><span><em>${esc(blockName(o.b.type))}</em>${snippet(o.b) ? ` · ${esc(snippet(o.b))}` : ''}</span><small>${esc(itemName(h.deck, o))} · ${o.click ? 'по щелчку' : o.key ? sec(o.key) : 'сразу'}</small></button>
  <button type="button" class="st-aorder-mv" data-mv="${n}" data-dir="-1" title="Раньше" aria-label="Раньше"${n === 0 || on[n - 1].click !== o.click ? ' disabled' : ''}>${icon('up')}</button>
  <button type="button" class="st-aorder-mv" data-mv="${n}" data-dir="1" title="Позже" aria-label="Позже"${n === on.length - 1 || on[n + 1].click !== o.click ? ' disabled' : ''}>${icon('up')}</button>
</div>`).join('') : '<p class="st-aorder-empty">На слайде ещё нет анимации. Выделите объект и выберите эффект.</p>'}
${still ? `<p class="st-aorder-still">Без анимации, видны сразу: ${still}</p>` : ''}</div>`;
  };
  const el = showPopover(anchor, html(), (b) => {
    if (b.dataset.k) {
      const k = Number(b.dataset.k);
      return { run: () => h.editor.selectFree(h.index(), k) };
    }
    if (b.dataset.mv) {
      const at = Number(b.dataset.mv);
      const dir = Number(b.dataset.dir) as 1 | -1;
      return {
        keep: true,
        run: () => {
          move(dir, at);
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
    const ms = Number(s?.transitionMs) || (s?.transition === 'morph' ? 800 : 600);
    trLabel.textContent = `Переход: ${name}${s?.transition && s.transition !== 'none' ? ` · ${sec(ms)}` : ''}`;
  }
  const list = h.selPaths().map((p) => getAt(h.deck, p) as Block);
  const fxLabel = document.getElementById('st-fx-label');
  if (fxLabel) {
    const fx = new Set(list.map((b) => (isOn(h.deck, b.enter) ? String(b.enter) : '')));
    // Выделение и исчезновение по щелчку — коротко после появления
    const more = list.length === 1
      ? `${typeof list[0].emphAt === 'number' && list[0].emphasis ? ` · ${nameOf(EMPHASIS, list[0].emphasis).toLowerCase()}` : ''}${list[0].exit ? ' · исчезает' : ''}`
      : '';
    fxLabel.textContent = !list.length ? 'Анимация: выделите объект'
      : fx.size > 1 ? 'Появление: разные' : `Появление: ${effectName(h.deck, [...fx][0]) || 'Без анимации'}${more}`;
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

/** Лента появлений: листается вбок колесом и стрелками */
export function bindFxGallery(): void {
  const root = document.querySelector<HTMLElement>('.st-fxpick');
  const strip = root?.querySelector<HTMLElement>('.st-fxgal');
  if (root && strip) bindRail(root, strip);
}

/**
 * Примерка выделения или исчезновения на объекте при правке: его вид (data-emph, data-exit) на время
 * меняется, класс st-fx-try включает анимацию (editor.css); null — вернуть как было
 */
function tryAct(o: HTMLElement, kind: 'emph' | 'out', v: string | null): void {
  const attr = kind === 'emph' ? 'emph' : 'exit';
  const cls = kind === 'emph' ? 'st-fx-try-emph' : 'st-fx-try-out';
  if (o.dataset.tryWas === undefined) o.dataset.tryWas = o.dataset[attr] ?? '';
  o.classList.remove(cls);
  if (v === null) {
    const was = o.dataset.tryWas;
    if (was) o.dataset[attr] = was;
    else delete o.dataset[attr];
    delete o.dataset.tryWas;
    return;
  }
  o.dataset[attr] = v;
  void o.offsetWidth;
  o.classList.add(cls);
}

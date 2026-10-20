import { icon } from '../components/icons';
import { actsOf, byItems, clickActs, EMPHASIS, ENTER, EXIT, nameOf, partsOf, TEMPO, TEXT_ENTER, type ActKind, type Pair } from '../engine/anim';
import { getAt, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { TEXT_FX, TEXT_FX_NAMES, textFxPreview } from '../engine/text-fx';
import { TR_DIR_DEFAULT, TR_DIRS, trDir, TRANSITIONS } from '../engine/transitions';
import type { Block, Deck } from '../types';
import { bindRail, railNav } from './backdrop-pick';
import { snippet } from './code-tree';
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
  /** Выделить свободные объекты слайда по номерам, не уводя ленту с «Анимации» */
  select(indexes: number[]): void;
}

export { TRANSITIONS };

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
const TR_HINT: Record<string, string> = {
  morph: 'Морф: одинаковые объекты (с тем же именем или текстом) перелетают на новое место',
  uncover: 'Открывание: старый слайд уезжает, под ним — новый', split: 'Панорама: новый слайд раскрывается от середины к краям',
  clock: 'Часы: новый слайд открывается по кругу, как стрелка', flash: 'Вспышка: экран вспыхивает, на пике — новый слайд',
  cube: 'Куб: слайды — грани куба, он поворачивается', flip: 'Отражение: слайд переворачивается, как карточка',
  gallery: 'Галерея: слайды проходят вбок в глубине, как в галерее', switch: 'Взмах: слайды расходятся и меняются местами',
  doors: 'Двери: слайд распахивается створками, за ним — новый', fall: 'Падение: слайд опрокидывается назад, под ним — новый',
};
const trTile = ([v, l]: readonly [string, string]) =>
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
  ${group('Переход к слайду', `<div class="st-bdpick st-trpick">${railNav().join(`<div class="st-agallery st-fxgal st-trgal">${TRANSITIONS.map(trTile).join('')}</div>`)}</div>`
    + `<div class="st-rstack">${btn('tr.speed', 'reset', 'Длительность', { menu: true, title: 'Сколько длится переход' })}${btn('tr.dir', 'move', 'Направление', { menu: true, title: 'Откуда идёт переход: у Сдвига, Наплыва, Открывания, Шторки, Куба, Отражения, Галереи и Взмаха' })}${btn('tr.all', 'layers', 'Ко всем слайдам', { title: 'Такой же переход у всех слайдов' })}</div>`, 'st-tr-label')}
  ${group('Анимация объекта', `<div class="st-bdpick st-fxpick">${railNav().join(`<div class="st-agallery st-fxgal">${EFFECTS.map(fxTile).join('')}</div>`)}</div>`
    + `<div class="st-rstack">${btn('fx.emph', 'sparkle', 'Выделение', { menu: true, title: 'По щелчку объект пульсирует, качается, светится… — шагом в очереди щелчков' })}`
    + btn('fx.exit', 'close', 'Исчезновение', { menu: true, title: 'По щелчку объект уходит со слайда — шагом в очереди щелчков' })
    + `${btn('fx.mine', 'layers', 'Мои эффекты', { menu: true, title: 'Эффекты, сохранённые из импортированных слайдов' })}</div>`, 'st-fx-label')}
  ${group('Время и порядок', `<div class="st-rstack">
    <label class="st-rfield" title="Через сколько секунд после открытия слайда объект появляется"><span>Задержка</span><input type="number" id="st-fx-delay" min="0" max="20" step="0.1" aria-label="Задержка появления, секунды"><span>с</span></label>
    ${btn('anim.tempo', 'clock', 'Длительность', { menu: true, title: 'Быстрее или медленнее идут все эффекты объекта: появление, выделение, исчезновение' })}
    <div class="st-rrow">${btn('anim.earlier', 'up', 'Раньше', { title: 'Появляться раньше' })}${btn('anim.later', 'up', 'Позже', { title: 'Появляться позже' })}</div>
  </div><div class="st-rstack"><button type="button" class="st-rb st-chk" data-cmd="anim.click" title="При показе объект ждёт щелчка («Далее», пробел, пульт) и появляется своим эффектом; по порядку — как в «Порядке»"><i class="st-box">${icon('check')}</i><span>Ждёт щелчка</span></button>${btn('anim.seq', 'sparkle', 'По очереди', { title: 'Выделенные объекты (или все на слайде) появляются по очереди: сверху вниз, слева направо' })}${btn('anim.order', 'list', 'Порядок', { title: 'Область анимации: все анимации слайда по порядку — панелью сбоку от слайда' })}</div>`)}
  ${group('Текст', `<div class="st-rstack"><span class="st-rsplit"><button type="button" class="st-rb st-chk" data-cmd="anim.count" title="Числа в тексте объекта при появлении отсчитываются от нуля до своего значения"><i class="st-box">${icon('check')}</i><span>Число набегает</span></button>`
    + `<button type="button" class="st-rb st-split-m" data-cmd="anim.count-menu" data-pal="skip" title="Как набегает: отсчёт или одометр" aria-label="Как набегает число" aria-haspopup="menu"><b class="st-caret"></b></button></span>${btn('anim.textfx', 'sparkle', 'Эффект текста', { menu: true, title: 'Глитч, неон, блик, волна, печатная машинка, расшифровка — у надписи или текста фигуры' })}`
    + `<button type="button" class="st-rb st-chk" data-cmd="anim.byitem" title="Список или пункты «- » в тексте появляются по одному; с «Ждёт щелчка» — по щелчку на пункт"><i class="st-box">${icon('check')}</i><span>По пунктам</span></button></div>`)}
</div>`;
}

/**
 * Анимация слайда: появление (сразу или по щелчку), выделение или исчезновение объекта k; key — место в очереди,
 * together — шаг по щелчку вместе с предыдущим. Пункты появления по пунктам — внутри строки появления
 */
type Kind = Exclude<ActKind, 'item'>;
interface Item { b: Block; k: number; kind: Kind; key: number; click: boolean; together: boolean }
const RANK: Record<Kind, number> = { in: 0, emph: 1, out: 2 };
/** Поле «вместе с предыдущим» у шага объекта */
const WITH: Record<Kind, string> = { in: 'clickWith', emph: 'emphWith', out: 'exitWith' };
/** Место «в конце очереди» у исчезновения без своего места (записано вручную) */
const LAST = Number.MAX_SAFE_INTEGER;

/** Анимации слайда по порядку: сначала появления при открытии (по задержке), потом очередь щелчков */
function items(deck: Deck, i: number): Item[] {
  const free = (deck.slides[i]?.free ?? []) as Block[];
  const out: Item[] = [];
  free.forEach((b, k) => {
    if (isOn(deck, b.enter) && b.click !== true) out.push({ b, k, kind: 'in', key: Number(b.delay) || 0, click: false, together: false });
    for (const a of actsOf(b, k)) out.push({ b, k, kind: a.kind as Kind, key: a.key, click: true, together: a.together });
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
  return (effectName(deck, o.b.enter) || 'Появление') + (byItems(o.b) ? ` по пунктам (${partsOf(o.b)})` : '');
}

/** Номера щелчков строк очереди, как у меток на слайде: «3», по пунктам — «3–5» */
function stepNos(free: Block[]): Map<string, string> {
  const acts = clickActs(free);
  const out = new Map<string, string>();
  acts.forEach((a, n) => {
    if (a.kind === 'item') return;
    let last = a.step;
    for (let m = n + 1; m < acts.length && acts[m].kind === 'item' && acts[m].k === a.k; m++) last = acts[m].step;
    out.set(`${a.k}:${a.kind}`, `${a.step + 1}${last > a.step ? `–${last + 1}` : ''}`);
  });
  return out;
}

/** Строка «Порядка»: объект и вид анимации */
const rowId = (o: Item) => `${o.k}:${o.kind}`;

/** Шаги по щелчку одного объекта идут как положено: появление, потом выделение, потом исчезновение */
function inOrder(list: Item[]): boolean {
  const seen = new Map<number, number>();
  for (const o of list) {
    if (!o.click) continue;
    if ((seen.get(o.k) ?? -1) > RANK[o.kind]) return false;
    seen.set(o.k, RANK[o.kind]);
  }
  return true;
}

/** Анимация at на шаг раньше или позже — в своей группе; null — так нельзя */
function swapped(list: Item[], at: number, dir: 1 | -1): Item[] | null {
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length || list[at].click !== list[to].click) return null;
  const out = [...list];
  [out[at], out[to]] = [out[to], out[at]];
  return inOrder(out) ? out : null;
}

/**
 * Анимации ids — на место перед строкой p (в списке с ними, p = длина — в конец), в группу click: появление,
 * перенесённое в другую группу, начинает или перестаёт ждать щелчка. null — так нельзя или ничего не меняется
 */
function placed(list: Item[], ids: Set<string>, p: number, click: boolean): Item[] | null {
  const moving = list.filter((o) => ids.has(rowId(o)));
  // Выделение и исчезновение бывают только по щелчку
  if (!moving.length || (!click && moving.some((o) => o.kind !== 'in'))) return null;
  const rest = list.filter((o) => !ids.has(rowId(o)));
  const at = list.slice(0, p).filter((o) => !ids.has(rowId(o))).length;
  const out = [...rest.slice(0, at), ...moving.map((o) => ({ ...o, click })), ...rest.slice(at)];
  // Группы не перемешиваются: появления при открытии — сверху, очередь щелчков — под ними
  if (out.some((o, n) => n && out[n - 1].click && !o.click) || !inOrder(out)) return null;
  return out.some((o, n) => rowId(o) !== rowId(list[n]) || o.click !== list[n].click) ? out : null;
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
      const dir = s?.transitionDir;
      ed.commit((d) => d.slides.forEach((x) => {
        if (v) x.transition = v;
        else delete x.transition;
        if (ms) x.transitionMs = ms;
        else delete x.transitionMs;
        if (dir) x.transitionDir = dir;
        else delete x.transitionDir;
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
  // Направление перехода: у Сдвига, Наплыва, Открывания и Шторки; сразу показать
  cmds['tr.dir'] = {
    run: () => {
      const s = slide();
      const cur = trDir(s?.transition, s?.transitionDir);
      showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="tr.dir"]')!, TR_DIRS.map(([v, l]) => ({
        label: l,
        checked: cur === v,
        run: () => {
          const i = h.index();
          ed.commit((d) => {
            if (v === TR_DIR_DEFAULT[String(d.slides[i].transition)]) delete d.slides[i].transitionDir;
            else d.slides[i].transitionDir = v;
          }, { rebuild: true });
          requestAnimationFrame(() => h.preview());
        },
      })));
    },
    enabled: () => !!trDir(slide()?.transition, ''),
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
  /**
   * Записать новый порядок анимаций слайда. Появления при открытии получают прежние задержки по возрастанию —
   * ритм слайда остаётся (одновременные, чей порядок не трогали, так и идут вместе); очередь щелчков — места через STEP.
   * Шаги стрелками подряд отменяются одним Ctrl+Z, перетаскивание — каждое своим
   */
  const reorder = (next: Item[], merge = true) => {
    const i = h.index();
    const old = items(deck, i);
    const was = new Map(old.map((o, n) => [rowId(o), { n, o }]));
    const delays = old.filter((o) => !o.click).map((o) => o.key).sort((a, b) => a - b);
    const timed = next.filter((o) => !o.click);
    const tied = (a: Item, b: Item) => {
      const x = was.get(rowId(a));
      const y = was.get(rowId(b));
      return !!x && !!y && !x.o.click && !y.o.click && x.o.key === y.o.key && x.n < y.n;
    };
    // Обычный промежуток между появлениями слайда — им раздвигаются те, кому не хватило места (нет — STEP)
    const gaps = delays.slice(1).map((v, n) => v - delays[n]).filter((v) => v > 0).sort((x, y) => x - y);
    const gap = gaps.length ? gaps[gaps.length >> 1] : STEP;
    const at: number[] = [];
    timed.forEach((o, n) => {
      let v = delays[n] ?? (n ? at[n - 1] + gap : 0);
      if (n && tied(timed[n - 1], o)) v = at[n - 1];
      else if (n && v <= at[n - 1]) v = at[n - 1] + gap;
      at.push(v);
    });
    ed.commit((d) => {
      const free = d.slides[i].free as Block[];
      timed.forEach((o, n) => {
        const b = free[o.k];
        delete b.click;
        delete b.clickWith;
        if (at[n]) b.delay = at[n];
        else delete b.delay;
      });
      next.filter((o) => o.click).forEach((o, n) => {
        const b = free[o.k];
        const key = n * STEP;
        if (o.kind === 'emph') b.emphAt = key;
        else if (o.kind === 'out') b.exitAt = key;
        else {
          b.click = true;
          if (key) b.delay = key;
          else delete b.delay;
        }
      });
    }, { rebuild: true, merge: merge ? `anim:${i}` : undefined });
  };
  /** Сдвинуть анимацию номер at на шаг в своей группе */
  const move = (dir: 1 | -1, at: number) => {
    const next = swapped(items(deck, h.index()), at, dir);
    if (next) reorder(next);
  };
  /** Перетащить анимации в «Порядке»; false — так нельзя */
  const place = (ids: Set<string>, p: number, click: boolean) => {
    const next = placed(items(deck, h.index()), ids, p, click);
    if (next) reorder(next, false);
    return !!next;
  };
  /** Первая анимация выделенного объекта — её двигают «Раньше» и «Позже» */
  const selAt = () => {
    const p = single();
    return p ? items(deck, h.index()).findIndex((o) => o.k === Number(p[3])) : -1;
  };
  const canMove = (dir: 1 | -1) => () => !!swapped(items(deck, h.index()), selAt(), dir);
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
  /** Вид «Число набегает»: true — отсчёт от нуля, odometer — цифры барабаном */
  const COUNTS: [true | 'odometer' | '', string][] = [[true, 'Отсчёт от нуля'], ['odometer', 'Одометр: цифры барабаном'], ['', 'Не набегает']];
  const isCount = (b: Block) => b.count === true || b.count === 'odometer';
  const setCount = (v: true | 'odometer' | '') => {
    h.editor.commit((d) => counted().forEach((p) => {
      const b = getAt(d, p) as Block;
      if (v) b.count = v;
      else delete b.count;
    }), { rebuild: true });
    if (v) requestAnimationFrame(() => h.preview());
  };
  cmds['anim.count-menu'] = {
    run: () => {
      const cur = new Set(counted().map((p) => (getAt(deck, p) as Block).count ?? ''));
      showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="anim.count-menu"]')!, COUNTS.map(([v, l]) => ({
        label: l, checked: cur.size === 1 && cur.has(v), run: () => setCount(v),
      })));
    },
    enabled: () => counted().length > 0,
  };
  cmds['anim.count'] = {
    run: () => {
      const paths = counted();
      const on = !paths.every((p) => isCount(getAt(deck, p) as Block));
      h.editor.commit((d) => paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (!on) delete b.count;
        else if (!isCount(b)) b.count = true;
      }), { rebuild: true });
      if (on) requestAnimationFrame(() => h.preview());
    },
    enabled: () => counted().length > 0,
    active: () => { const p = counted(); return p.length > 0 && p.every((x) => isCount(getAt(deck, x) as Block)); },
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
  /** Шаг по щелчку — вместе с предыдущим (на том же щелчке) или отдельным щелчком */
  const together = (o: Item, on: boolean) => {
    const i = h.index();
    const f = WITH[o.kind];
    ed.commit((d) => {
      const b = d.slides[i].free![o.k] as Block;
      if (on) b[f] = true;
      else delete b[f];
    }, { rebuild: true });
  };
  // Область анимации — панель сбоку от слайда (в студии; на странице без неё — ничего)
  const root = document.getElementById('st-apane');
  const split = document.getElementById('st-sa');
  pane = root && split ? new OrderPane(root, split, h, { move, place, together }) : null;
  // Начали или кончили править текст раскладки — подпись «Анимации» (подсказка «Сделать свободным») обновляется
  const canvasEl = document.getElementById('st-canvas');
  for (const ev of ['focusin', 'focusout']) canvasEl?.addEventListener(ev, () => requestAnimationFrame(() => syncAnimTab(h)));
  cmds['anim.order'] = { run: () => pane?.toggle(), active: () => !!pane?.open };
  // Длительность эффектов выделенных объектов: множитель для появления, выделения и исчезновения
  cmds['anim.tempo'] = {
    run: () => {
      const paths = freeSel();
      const cur = new Set(paths.map((p) => String((getAt(deck, p) as Block).tempo ?? '')));
      showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="anim.tempo"]')!, TEMPO.map(([v, l]) => ({
        label: l,
        checked: cur.size === 1 && cur.has(v),
        run: () => {
          ed.commit((d) => paths.forEach((p) => {
            const b = getAt(d, p) as Block;
            if (v) b.tempo = v;
            else delete b.tempo;
          }), { rebuild: true });
          requestAnimationFrame(() => h.preview());
        },
      })));
    },
    enabled: () => freeSel().length > 0,
  };
  // По пунктам: список или пункты «- » в тексте появляются по одному (с «Ждёт щелчка» — по щелчку на пункт)
  const listy = () => freeSel().filter((p) => partsOf(getAt(deck, p) as Block) > 1);
  cmds['anim.byitem'] = {
    run: () => {
      const paths = listy();
      const on = !paths.every((p) => (getAt(deck, p) as Block).byItem === true);
      const i = h.index();
      let next = nextKey(deck, i, new Set(paths.map((p) => Number(p[3]))));
      ed.commit((d) => paths.forEach((p) => {
        const b = getAt(d, p) as Block;
        if (!on) { delete b.byItem; return; }
        b.byItem = true;
        // Без эффекта появления пунктам нечем появляться: всплытие, новое — в конец очереди
        if (!isOn(d, b.enter)) {
          b.enter = 'rise';
          if (b.click !== true) {
            if (next) b.delay = next;
            next += STEP;
          }
        }
      }), { rebuild: true });
      if (on) requestAnimationFrame(() => h.preview());
    },
    enabled: () => listy().length > 0,
    active: () => { const p = listy(); return p.length > 0 && p.every((x) => (getAt(deck, x) as Block).byItem === true); },
  };
  return cmds;
}

interface OrderAct { move(dir: 1 | -1, at: number): void; place(ids: Set<string>, p: number, click: boolean): boolean; together(o: Item, on: boolean): void }
interface PaneState { open: boolean; side: 'left' | 'right'; w: number }
const PANE_KEY = 'htmlpptx-anim-pane';
const PANE_W: [number, number] = [260, 560];

/**
 * Область анимации (как в PowerPoint): порядок анимаций слайда панелью на всю высоту сбоку от слайда — открыта,
 * пока с ней работают; ширина тянется за край, прикрепить можно слева или справа (запоминается на компьютере).
 * Список по группам — при открытии слайда и по щелчку. Щелчок выделяет объект (Ctrl — добавить, Shift — подряд),
 * стрелки — на шаг, перетаскивание — на любое место, выделенные строки — вместе, звено — вместе с предыдущим.
 * Появление, перетащенное в «По щелчку», начинает ждать щелчка, обратно — появляется само
 */
class OrderPane {
  private st: PaneState = { open: false, side: 'right', w: 320 };
  private body: HTMLElement;
  /** Выделенные строки; selKey — выделение на слайде, под которое они подобраны */
  private picked = new Set<string>();
  private selKey = '';
  private from = -1;
  private drag: Set<string> | null = null;
  private hl: HTMLElement | null = null;

  constructor(private root: HTMLElement, private split: HTMLElement, private h: AnimHost, private act: OrderAct) {
    try { this.st = { ...this.st, ...JSON.parse(localStorage.getItem(PANE_KEY) ?? '{}') }; } catch { /* ещё не открывали */ }
    root.innerHTML = `<header class="st-lyr-head"><b>Анимация слайда</b>
  <button type="button" class="st-lyr-x" data-a="side"></button>
  <button type="button" class="st-lyr-x" data-a="close" title="Закрыть" aria-label="Закрыть область анимации">${icon('close')}</button>
</header><div class="st-apane-body"></div>`;
    this.body = root.querySelector('.st-apane-body')!;
    root.querySelector('[data-a="close"]')!.addEventListener('click', () => this.toggle(false));
    root.querySelector('[data-a="side"]')!.addEventListener('click', () => { this.st.side = this.st.side === 'right' ? 'left' : 'right'; this.apply(); });
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('pointerover', (e) => {
      const r = (e.target as Element).closest?.<HTMLElement>('.st-aorder-row');
      this.light(r ? this.list()[Number(r.dataset.n)]?.k ?? null : null);
    });
    this.body.addEventListener('pointerleave', () => this.light(null));
    this.dnd();
    this.resizer();
    this.apply(false);
  }

  get open(): boolean { return this.st.open; }

  toggle(on = !this.st.open): void {
    this.st.open = on;
    if (!on) this.light(null);
    this.apply();
  }

  /** Раскладка: видна ли, ширина, сторона; запоминается */
  private apply(save = true): void {
    this.st.w = Math.round(Math.max(PANE_W[0], Math.min(PANE_W[1], this.st.w)));
    this.root.hidden = !this.st.open;
    this.split.hidden = !this.st.open;
    // Открытая область — номера анимаций на слайде видны и вне вкладки «Анимация» (studio.css)
    document.body.classList.toggle('st-apane-on', this.st.open);
    document.querySelectorAll('.st-ribbon [data-cmd="anim.order"]').forEach((b) => b.classList.toggle('active', this.st.open));
    // Своя колонка в сетке студии, на всю высоту: между списком слайдов и слайдом или между слайдом и свойствами
    const body = this.root.parentElement!;
    body.style.setProperty('--apl', this.st.open && this.st.side === 'left' ? `${this.st.w}px` : '0px');
    body.style.setProperty('--apr', this.st.open && this.st.side === 'right' ? `${this.st.w}px` : '0px');
    this.root.classList.toggle('left', this.st.side === 'left');
    this.split.classList.toggle('left', this.st.side === 'left');
    const side = this.root.querySelector<HTMLElement>('[data-a="side"]')!;
    const to = this.st.side === 'right' ? 'слева' : 'справа';
    side.innerHTML = icon(this.st.side === 'right' ? 'obj-left' : 'obj-right');
    side.title = `Прикрепить ${to}`;
    side.setAttribute('aria-label', `Прикрепить область анимации ${to}`);
    if (save) try { localStorage.setItem(PANE_KEY, JSON.stringify(this.st)); } catch { /* нет доступа */ }
    if (this.st.open) this.update();
  }

  /** Край панели: тянуть мышью, стрелки ±8 px, двойной щелчок — как было */
  private resizer(): void {
    const s = this.split;
    s.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      const box = this.root.getBoundingClientRect();
      document.querySelector('.studio-app')?.classList.add('resizing');
      const move = (ev: PointerEvent) => {
        this.st.w = this.st.side === 'right' ? box.right - ev.clientX : ev.clientX - box.left;
        this.apply(false);
      };
      const up = () => {
        s.removeEventListener('pointermove', move);
        s.removeEventListener('pointerup', up);
        document.querySelector('.studio-app')?.classList.remove('resizing');
        this.apply();
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', up);
    });
    s.addEventListener('dblclick', () => { this.st.w = 320; this.apply(); });
    s.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -8, ArrowRight: 8 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      this.st.w += this.st.side === 'right' ? -d : d;
      this.apply();
    });
  }

  private list(): Item[] { return items(this.h.deck, this.h.index()); }

  /** Перерисовать список (после правок, смены слайда и выделения); во время перетаскивания — нет */
  update(focus?: string): void {
    if (!this.st.open || this.drag) return;
    const on = this.list();
    // Выделение на слайде сменилось не отсюда — выделены строки его объектов
    const sel = this.h.selPaths().map((p) => Number(p[3]));
    const key = `${this.h.index()}:${sel.join(',')}`;
    if (key !== this.selKey) {
      this.selKey = key;
      this.picked = new Set(on.filter((o) => sel.includes(o.k)).map(rowId));
    }
    const top = this.body.scrollTop;
    this.body.innerHTML = this.html(on);
    this.body.scrollTop = top;
    if (focus) this.body.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private html(on: Item[]): string {
    const free = (this.h.deck.slides[this.h.index()]?.free ?? []) as Block[];
    const still = free.filter((_b, k) => !on.some((o) => o.k === k)).length;
    const both = on.some((o) => o.click) && on.some((o) => !o.click);
    const steps = stepNos(free);
    let num = 0;
    const rows = on.map((o, n) => {
      const first = n === 0 || on[n - 1].click !== o.click;
      if (first) num = 0;
      const label = snippet(o.b as Record<string, unknown>);
      // Шаг по щелчку, кроме первого, — отдельным щелчком или вместе с предыдущим
      const link = o.click && !first
        ? `<button type="button" class="st-aorder-with${o.together ? ' on' : ''}" data-with="${n}" aria-pressed="${o.together}" title="${o.together ? 'Вместе с предыдущим — нажмите, чтобы отдельным щелчком' : 'Отдельным щелчком — нажмите, чтобы вместе с предыдущим'}" aria-label="Вместе с предыдущим">${icon('link')}</button>`
        : '';
      return (both && first ? `<p class="st-aorder-head">${o.click ? 'По щелчку' : 'При открытии слайда'}</p>` : '')
        + `<div class="st-aorder-row${this.picked.has(rowId(o)) ? ' sel' : ''}" draggable="true" data-n="${n}" data-kind="${o.kind}" data-group="${o.click ? 'click' : 'open'}">
  <button type="button" class="st-aorder-pick" data-pick="${n}" title="Выделить (Ctrl — добавить, Shift — подряд); перетащите, чтобы переставить"><b>${o.click ? steps.get(rowId(o)) ?? ++num : ++num}</b><span><em>${esc(blockName(o.b.type))}</em>${label ? ` · ${esc(label)}` : ''}</span><small>${esc(itemName(this.h.deck, o))} · ${o.click ? (o.together && !first ? 'вместе с предыдущим' : 'по щелчку') : o.key ? sec(o.key) : 'сразу'}</small></button>
  ${link}
  <button type="button" class="st-aorder-mv" data-mv="${n}" data-dir="-1" title="Раньше" aria-label="Раньше"${swapped(on, n, -1) ? '' : ' disabled'}>${icon('up')}</button>
  <button type="button" class="st-aorder-mv" data-mv="${n}" data-dir="1" title="Позже" aria-label="Позже"${swapped(on, n, 1) ? '' : ' disabled'}>${icon('up')}</button>
</div>`;
    }).join('');
    return `<div class="st-aorder">${on.length ? rows : '<p class="st-aorder-empty">На слайде ещё нет анимации. Выделите объект и выберите эффект.</p>'}
${on.length > 1 ? '<p class="st-aorder-still">Перетащите строку на новое место; Ctrl или Shift — несколько сразу</p>' : ''}
${still ? `<p class="st-aorder-still">Без анимации, видны сразу: ${still}</p>` : ''}</div>`;
  }

  /** На слайде выделены объекты выделенных строк */
  private sync(): void {
    const ks = [...new Set(this.list().filter((o) => this.picked.has(rowId(o))).map((o) => o.k))].sort((a, b) => a - b);
    this.selKey = `${this.h.index()}:${ks.join(',')}`;
    this.h.select(ks);
  }

  private onClick(e: MouseEvent): void {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    const on = this.list();
    if (b.dataset.pick) {
      const n = Number(b.dataset.pick);
      const id = rowId(on[n]);
      if (e.shiftKey && this.from >= 0) this.picked = new Set(on.slice(Math.min(this.from, n), Math.max(this.from, n) + 1).map(rowId));
      else if (e.ctrlKey || e.metaKey) {
        if (!this.picked.delete(id)) this.picked.add(id);
        this.from = n;
      } else {
        this.picked = new Set([id]);
        this.from = n;
      }
      this.sync();
      this.update(`[data-pick="${n}"]`);
    } else if (b.dataset.with) {
      const n = Number(b.dataset.with);
      if (on[n]) this.act.together(on[n], !on[n].together);
      this.update(`[data-with="${n}"]`);
    } else if (b.dataset.mv) {
      const at = Number(b.dataset.mv);
      const dir = Number(b.dataset.dir) as 1 | -1;
      this.act.move(dir, at);
      this.update(`[data-mv="${at + dir}"][data-dir="${dir}"]`);
    }
  }

  /** Строка под мышью — её объект на слайде обведён */
  private light(k: number | null): void {
    this.hl?.classList.remove('st-aorder-hl');
    this.hl = k === null ? null : document.querySelector<HTMLElement>(`#st-canvas .slide.on > .free[data-free='${JSON.stringify(['slides', this.h.index(), 'free', k])}']`);
    this.hl?.classList.add('st-aorder-hl');
  }

  // ---------- перетаскивание ----------
  private dnd(): void {
    const el = this.body;
    const rows = () => [...el.querySelectorAll<HTMLElement>('.st-aorder-row')];
    const marks = () => rows().forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    /** Куда бросают: строка под мышью — перед ней (верхняя половина) или после (нижняя), в её группу */
    const dropAt = (y: number) => {
      const rs = rows();
      if (!rs.length) return null;
      const r = rs.find((x) => y < x.getBoundingClientRect().bottom) ?? rs[rs.length - 1];
      const box = r.getBoundingClientRect();
      const after = y >= box.top + box.height / 2;
      const n = Number(r.dataset.n);
      return { r, after, p: n + (after ? 1 : 0), click: !!this.list()[n]?.click };
    };
    el.addEventListener('dragstart', (e) => {
      const r = (e.target as Element).closest?.<HTMLElement>('.st-aorder-row');
      const on = this.list();
      const o = r ? on[Number(r.dataset.n)] : undefined;
      if (!o) return;
      // Строка из выделенных — тянутся все выделенные, иначе только она
      if (!this.picked.has(rowId(o))) this.picked = new Set([rowId(o)]);
      const drag = new Set(this.picked);
      this.drag = drag;
      rows().forEach((x) => {
        const it = on[Number(x.dataset.n)];
        x.classList.toggle('sel', !!it && this.picked.has(rowId(it)));
        x.classList.toggle('dragging', !!it && drag.has(rowId(it)));
      });
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', '');
    });
    el.addEventListener('dragover', (e) => {
      if (!this.drag) return;
      const at = dropAt(e.clientY);
      marks();
      // Нельзя (исчезновение — в «При открытии», исчезновение раньше появления) или ничего не меняется — без отметки
      if (!at || !placed(this.list(), this.drag, at.p, at.click)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      at.r.classList.add(at.after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', (e) => {
      if (!this.drag) return;
      e.preventDefault();
      const at = dropAt(e.clientY);
      const ids = this.drag;
      this.drag = null;
      if (at && this.act.place(ids, at.p, at.click)) {
        this.picked = new Set(ids);
        this.sync();
      }
      this.update();
    });
    el.addEventListener('dragend', () => {
      if (!this.drag) return;
      this.drag = null;
      marks();
      rows().forEach((r) => r.classList.remove('dragging'));
    });
  }
}
let pane: OrderPane | null = null;

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
/** Выбранная плитка ленты — на виду, если ушла за край (после смены слайда или выделения) */
function revealActive(strip: HTMLElement): void {
  const cur = strip.querySelector<HTMLElement>('.active');
  if (!cur) return;
  const s = strip.getBoundingClientRect();
  const c = cur.getBoundingClientRect();
  if (c.left >= s.left && c.right <= s.right) return;
  strip.scrollLeft += c.left - s.left - (s.width - c.width) / 2;
}
let shownFor = '';

export function syncAnimTab(h: AnimHost): void {
  pane?.update();
  const key = `${h.index()}|${h.selPaths().map((p) => p.join('.')).join(',')}`;
  if (key !== shownFor) {
    shownFor = key;
    // Кнопкам «выбрано» проставляется после этой функции — через кадр
    requestAnimationFrame(() => document.querySelectorAll<HTMLElement>('.st-ribbon .st-fxgal').forEach(revealActive));
  }
  const s = h.deck.slides[h.index()];
  const trLabel = document.getElementById('st-tr-label');
  if (trLabel) {
    const name = TRANSITIONS.find(([v]) => v === (s?.transition ?? ''))?.[1] ?? 'Стандартный';
    const ms = Number(s?.transitionMs) || (s?.transition === 'morph' ? 800 : 600);
    const dir = TR_DIRS.find(([v]) => v === trDir(s?.transition, s?.transitionDir))?.[1];
    trLabel.textContent = `Переход: ${name}${dir ? ` ${dir.toLowerCase()}` : ''}${s?.transition && s.transition !== 'none' ? ` · ${sec(ms)}` : ''}`;
  }
  const list = h.selPaths().map((p) => getAt(h.deck, p) as Block);
  const fxLabel = document.getElementById('st-fx-label');
  if (fxLabel) {
    const fx = new Set(list.map((b) => (isOn(h.deck, b.enter) ? String(b.enter) : '')));
    // Выделение и исчезновение по щелчку — коротко после появления
    const more = list.length === 1
      ? `${typeof list[0].emphAt === 'number' && list[0].emphasis ? ` · ${nameOf(EMPHASIS, list[0].emphasis).toLowerCase()}` : ''}${list[0].exit ? ' · исчезает' : ''}`
      : '';
    // Выделен (или правится) блок раскладки или поле шаблона: анимация — у свободных объектов
    const layout = !list.length && (!!h.editor.selection || !!document.querySelector('#st-canvas [contenteditable="true"]'));
    fxLabel.textContent = layout ? 'Анимация: блок — «Сделать свободным»' : !list.length ? 'Анимация: выделите объект'
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
  for (const sel of ['.st-fxpick', '.st-trpick']) {
    const root = document.querySelector<HTMLElement>(sel);
    const strip = root?.querySelector<HTMLElement>('.st-fxgal');
    if (!root || !strip) continue;
    bindRail(root, strip);
    // Вкладку «Анимация» открыли (лента стала видна) — выбранная плитка на виду
    let seen = false;
    new ResizeObserver(() => {
      const shown = strip.clientWidth > 0;
      if (shown && !seen) revealActive(strip);
      seen = shown;
    }).observe(strip);
  }
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

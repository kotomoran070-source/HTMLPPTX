/**
 * Помощь в редакторе кода, без новых кнопок:
 *   ошибки — волнистой чертой прямо на строке, текст ошибки — при наведении (YAML слайда и CSS);
 *   подсказки при наборе — поля блока и их значения в YAML, классы и объекты слайда, свои
 *   @keyframes и переменные темы в CSS (Ctrl+Space — показать сразу);
 *   цвет при наведении на #RRGGBB, rgb(), var(--ac) и т. п. — образцом во всплывающей подсказке.
 */
import { type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { cssLanguage } from '@codemirror/lang-css';
import { type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension, type Text } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { isMap, isPair, isScalar, isSeq, parseDocument, visit, type YAMLError } from 'yaml';
import { blockNames, getBlock, getTemplate, templateNames } from '../engine/component';
import { blockName } from '../engine/editor/block-edit';
import { TRANSITION_IDS } from '../engine/render';
import { EFFECTS, TRANSITIONS } from './anim-tab';
import { TEMPLATE_NAMES } from './inspector';
import { BLOCKS, TEMPLATES, type Field } from './schema';

export type CodeMode = 'slide' | 'css' | 'anim';

export interface HintHost {
  mode(): CodeMode;
  /** Открытый слайд на холсте студии: его классы, объекты и цвета темы */
  slide(): HTMLElement | null;
}

// ---------------- ошибки ----------------

/** Ошибки разбора YAML — по-русски (по тексту ошибки библиотеки yaml, затем по коду); незнакомые — как есть */
const YAML_RU: [RegExp, string][] = [
  [/Implicit map keys need to be followed by map values/, 'Не хватает «:» после имени поля'],
  [/Nested mappings are not allowed in compact mappings/, 'Второе «:» в строке — возьмите значение в кавычки или проверьте отступ'],
  [/Implicit keys need to be on a single line/, 'Неверный отступ или нет «:»'],
  [/Missing closing "?quote|Missing closing '/, 'Не закрыта кавычка'],
  [/must be sufficiently indented and end with a ([\]}])/, 'Не закрыта скобка $1'],
  [/Map keys must be unique/, 'Это поле уже есть выше'],
  [/Tabs are not allowed/, 'Отступ табуляцией — нужны пробелы'],
  [/Plain value cannot start with reserved character (\S)/, 'Значение не может начинаться с «$1» — возьмите его в кавычки'],
];
const YAML_CODE_RU: Record<string, string> = {
  BAD_INDENT: 'Неверный отступ',
  BLOCK_AS_IMPLICIT_KEY: 'Неверная вложенность: проверьте двоеточия и отступы',
  UNEXPECTED_TOKEN: 'Лишний знак',
  BAD_DQ_ESCAPE: 'Неверный \\ внутри кавычек',
  MULTIPLE_DOCS: 'Лишний разделитель ---',
  BLOCK_IN_FLOW: 'Внутри {…} или […] нельзя писать столбиком',
};

export function yamlMessage(e: YAMLError): string {
  const text = e.message.split('\n')[0];
  for (const [re, ru] of YAML_RU) {
    const m = re.exec(text);
    if (m) return ru.replace('$1', m[1] ?? '');
  }
  return YAML_CODE_RU[e.code] ?? text.replace(/ at line \d+, column \d+:?$/, '');
}

/** Отметка ошибки: пустой диапазон — на знак перед ним (иначе черту не видно) */
function span(doc: Text, from: number, to: number): { from: number; to: number } {
  from = Math.max(0, Math.min(from, doc.length));
  to = Math.max(from, Math.min(to, doc.length));
  if (to > from) return { from, to };
  return from > 0 ? { from: from - 1, to: from } : { from, to: Math.min(doc.length, 1) };
}

/** Похожее имя: одна-две опечатки (crad → card) */
function near(word: string, names: string[]): string | undefined {
  const d = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
    }
    return row[b.length];
  };
  let best: string | undefined;
  let score = 3;
  for (const n of names) {
    const s = d(word.toLowerCase(), n);
    if (s < score) { score = s; best = n; }
  }
  return best;
}

export interface YamlRead { data?: unknown; problems: Diagnostic[] }

/**
 * Код слайда: данные и ошибки. Ошибка разбора — данных нет. Неизвестный тип блока или шаблон —
 * предупреждение: слайд применяется, но такой блок не нарисуется
 */
export function readSlideYaml(text: string, doc: Text): YamlRead {
  const parsed = parseDocument(text);
  if (parsed.errors.length) {
    // Одна ошибка на строку: следом за первой библиотека часто находит её же другими словами
    const lines = new Set<number>();
    return {
      problems: parsed.errors.flatMap((e) => {
        let at = span(doc, e.pos[0], e.pos[1]);
        const ln = doc.lineAt(at.from);
        const line = ln.number;
        // Ошибка в один знак — черта до конца строки, иначе её почти не видно
        const rest = ln.text.slice(at.from - ln.from).trimEnd().length;
        if (at.to - at.from <= 1 && rest > 1) at = { from: at.from, to: at.from + rest };
        if (lines.has(line)) return [];
        lines.add(line);
        return [{ ...at, severity: 'error' as const, message: yamlMessage(e) }];
      }),
    };
  }
  const problems: Diagnostic[] = [];
  const blocks = blockNames();
  visit(parsed, {
    Pair(_k, pair, path) {
      if (!isScalar(pair.key) || !isScalar(pair.value) || typeof pair.value.value !== 'string' || !pair.value.range) return;
      const key = pair.key.value;
      const v = pair.value.value;
      const [from, to] = pair.value.range;
      if (key === 'template' && path.length === 2 && !getTemplate(v)) {
        const n = near(v, templateNames());
        problems.push({ ...span(doc, from, to), severity: 'warning', message: `Нет шаблона «${v}»${n ? ` — может, «${n}»?` : ''}` });
      }
      if (key !== 'type' || getBlock(v)) return;
      // Тип блока — у объекта в списках free, body, items (группа) или у body-объекта
      const map = path[path.length - 1];
      const up = path[path.length - 2];
      const owner = isSeq(up) ? path[path.length - 3] : up;
      const ownerKey = isPair(owner) && isScalar(owner.key) ? owner.key.value : '';
      if (!isMap(map) || !['free', 'body', 'items'].includes(String(ownerKey))) return;
      const n = near(v, blocks);
      problems.push({ ...span(doc, from, to), severity: 'warning', message: `Нет блока «${v}»${n ? ` — может, «${n}»?` : ''}: на слайде его не будет` });
    },
  });
  return { data: parsed.toJS(), problems };
}

/** Явные ошибки CSS: незакрытая скобка, пропущенная «;», лишняя «}» — по разбору CodeMirror */
export function cssProblems(text: string, doc: Text): Diagnostic[] {
  const out: Diagnostic[] = [];
  let last = -1;
  cssLanguage.parser.parse(text).iterate({
    enter(n) {
      if (!n.type.isError || out.length >= 20) return;
      const line = doc.lineAt(Math.min(n.from, doc.length)).number;
      if (line === last) return;
      last = line;
      out.push({ ...span(doc, n.from, n.to), severity: 'warning', message: 'Похоже на ошибку: проверьте «;», скобки { } и кавычки рядом. Браузер пропустит это правило' });
    },
  });
  return out;
}

// ---------------- подсказки при наборе ----------------

/** Поля любого слайда и любого свободного объекта (схема описывает только особые) */
const SLIDE_KEYS: [string, string][] = [
  ['template', 'Шаблон слайда'], ['title', 'Заголовок'], ['free', 'Свободные объекты'], ['body', 'Раскладка'],
  ['notes', 'Заметки докладчика'], ['transition', 'Переход к слайду'], ['transitionMs', 'Длительность перехода, мс'],
  ['hidden', 'Скрыть при показе'], ['label', 'Название в обзоре'], ['vars', 'Величины для формул'], ['theme', 'Свои цвета слайда'],
];
const OBJECT_KEYS: [string, string][] = [
  ['place', 'Место: x, y, w, h'], ['enter', 'Появление'], ['delay', 'Задержка появления, мс'], ['click', 'Ждёт щелчка'],
  ['angle', 'Поворот, °'], ['id', 'Имя (пара для морфа)'], ['locked', 'Закреплён'], ['style', 'CSS блока'],
];
const PLACE_KEYS: [string, string][] = [['x', 'Слева, px'], ['y', 'Сверху, px'], ['w', 'Ширина, px'], ['h', 'Высота, px']];
const BOOL_KEYS = new Set(['click', 'hidden', 'locked', 'logo']);

/** Ключ строки YAML: отступ, «- » в начале элемента списка, имя и значение после двоеточия */
function keyOf(text: string): { indent: number; col: number; dash: boolean; key: string; value: string } | null {
  const m = /^(\s*)(- +)?([\w-]+):(?:\s+(.*))?$/.exec(text);
  if (!m) return null;
  return { indent: m[1].length, col: m[1].length + (m[2]?.length ?? 0), dash: !!m[2], key: m[3], value: (m[4] ?? '').replace(/^["']|["']$/g, '') };
}

const indentOf = (t: string) => /^\s*/.exec(t)![0].length;

/** Соседние поля того же объекта и поле, внутри которого он лежит */
function around(doc: Text, lineNo: number, col: number, startsItem: boolean): { keys: Map<string, string>; parent: string } {
  const keys = new Map<string, string>();
  let parent = '';
  let limit = startsItem ? col - 2 : col;
  let collect = !startsItem;
  for (let n = lineNo - 1; n >= 1; n--) {
    const t = doc.line(n).text;
    if (!t.trim() || t.trim().startsWith('#')) continue;
    const k = keyOf(t);
    if (collect && k && k.col === col) {
      keys.set(k.key, k.value);
      // Начало элемента списка: соседей выше нет, дальше — только поле-родитель
      if (k.dash) { collect = false; limit = k.indent; }
      continue;
    }
    if (indentOf(t) >= limit) continue;
    parent = k && !k.value ? k.key : '';
    break;
  }
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const t = doc.line(n).text;
    if (!t.trim()) continue;
    if (indentOf(t) < col) break;
    const k = keyOf(t);
    if (k && k.col === col) keys.set(k.key, k.value);
  }
  return { keys, parent };
}

function fieldsOf(type: string | undefined): Field[] {
  return type ? BLOCKS[type]?.fields ?? [] : [];
}

const opt = (label: string, detail: string, apply?: string, type = 'property'): Completion => ({ label, detail, apply, type });

function yamlSource(ctx: CompletionContext): CompletionResult | null {
  const { doc } = ctx.state;
  const line = doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  // Значение поля
  const v = /^(\s*(?:- +)?)([\w-]+):\s+["']?([\w-]*)$/.exec(before);
  if (v) {
    const [, lead, key, word] = v;
    const from = ctx.pos - word.length;
    let list: Completion[] = [];
    if (key === 'type') list = blockNames().sort().map((n) => opt(n, blockName(n).replace(/&amp;/g, '&'), undefined, 'type'));
    else if (key === 'template') list = templateNames().map((n) => opt(n, TEMPLATE_NAMES[n] ?? '', undefined, 'type'));
    else if (key === 'transition') list = TRANSITIONS.filter(([id]) => TRANSITION_IDS.has(id)).map(([id, l]) => opt(id, l, undefined, 'enum'));
    else if (key === 'enter') list = EFFECTS.filter(([id]) => id).map(([id, l]) => opt(id, l, undefined, 'enum'));
    else {
      const { keys } = around(doc, line.number, lead.length, /- +$/.test(lead));
      const f = fieldsOf(keys.get('type')).find((x) => x.k === key);
      if (f?.type === 'select') list = f.options.filter(([id]) => id).map(([id, l]) => opt(id, l, undefined, 'enum'));
      else if (f?.type === 'bool' || BOOL_KEYS.has(key)) list = [opt('true', 'да', undefined, 'keyword'), opt('false', 'нет', undefined, 'keyword')];
    }
    // Пусто после «type: » — список сразу, как только набран пробел
    if (!list.length || (!word && !ctx.explicit && !/:\s$/.test(before))) return null;
    return { from, options: list, validFor: /^[\w-]*$/ };
  }
  // Имя поля
  const k = /^(\s*)(- +)?([\w-]*)$/.exec(before);
  if (!k || (!k[3] && !ctx.explicit)) return null;
  const col = k[1].length + (k[2]?.length ?? 0);
  const { keys, parent } = around(doc, line.number, col, !!k[2]);
  let fields: [string, string][];
  if (parent === 'place') fields = PLACE_KEYS;
  else if (col === 0) {
    const tpl = keys.get('template') ?? 'content';
    fields = [...SLIDE_KEYS, ...(TEMPLATES[tpl]?.fields ?? []).map((f): [string, string] => [f.k, f.label])];
  } else if (['free', 'body', 'items'].includes(parent) || keys.has('type')) {
    const type = keys.get('type');
    fields = [
      ...(type ? [] : [['type', 'Тип блока'] as [string, string]]),
      ...fieldsOf(type).map((f): [string, string] => [f.k, f.label]),
      ...(parent === 'body' ? OBJECT_KEYS.filter(([n]) => n === 'style') : OBJECT_KEYS),
    ];
  } else return null;
  const seen = new Set<string>();
  const options = fields
    .filter(([n]) => !keys.has(n) && !seen.has(n) && seen.add(n))
    .map(([n, l]) => opt(n, l, `${n}: `));
  return options.length ? { from: ctx.pos - k[3].length, options, validFor: /^[\w-]*$/ } : null;
}

/** Переменные темы слайдов (deck-theme.ts) — для var(--…) */
const THEME_VARS: [string, string][] = [
  ['--ac', 'Акцент'], ['--ac2', 'Второй акцент'], ['--on-ac', 'Текст на акценте'], ['--ach', 'Акцент для текста'], ['--acs', 'Акцент, мягкий фон'],
  ['--tx', 'Текст'], ['--tx2', 'Текст, второй'], ['--mu', 'Приглушённый текст'], ['--bg', 'Фон'], ['--surf', 'Карточки'],
  ['--alt', 'Фон, второй'], ['--bd', 'Граница'], ['--bd2', 'Граница, темнее'], ['--slide-bg', 'Фон слайда'],
  ['--font', 'Шрифт'], ['--font-head', 'Шрифт заголовков'], ['--rk', 'Множитель скругления'],
];

function varSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/var\(\s*-{0,2}[\w-]*/);
  if (!m) return null;
  const word = /-{0,2}[\w-]*$/.exec(m.text)![0];
  return { from: ctx.pos - word.length, options: THEME_VARS.map(([n, l]) => opt(n, l, undefined, 'variable')), validFor: /^-{0,2}[\w-]*$/ };
}

/** Служебные классы студии и состояний — не для своих стилей */
const OWN_CLASS = /^(st-|ed-|cm-|morph-|spot-)|^(on|off|sel|still|paused|click-hid)$/;

function cssSource(host: HintHost, ctx: CompletionContext): CompletionResult | null {
  const slide = host.slide();
  // Класс со слайда: «.» в селекторе (не «.5» в значении)
  const cls = ctx.matchBefore(/(?:^|[\s,>+~(}{])\.[\w-]*/);
  if (cls && slide) {
    const word = cls.text.slice(cls.text.indexOf('.') + 1);
    if (/^\d/.test(word)) return null;
    const names = new Set<string>();
    slide.querySelectorAll('*').forEach((el) => el.classList.forEach((c) => { if (!OWN_CLASS.test(c)) names.add(c); }));
    return { from: ctx.pos - word.length, options: [...names].sort().map((n) => opt(n, 'на слайде', undefined, 'class')), validFor: /^[\w-]*$/ };
  }
  // Объект по имени: [data-obj="…"]
  const obj = ctx.matchBefore(/\[data-obj="?[\w-]*/);
  if (obj && slide) {
    const word = /[\w-]*$/.exec(obj.text)![0];
    const ids = new Set([...slide.querySelectorAll('[data-obj]')].map((el) => el.getAttribute('data-obj')!).filter(Boolean));
    return { from: ctx.pos - word.length, options: [...ids].map((n) => opt(n, 'объект слайда', obj.text.includes('"') ? undefined : `"${n}"]`, 'constant')), validFor: /^[\w-]*$/ };
  }
  // Свои @keyframes — в animation
  const an = ctx.matchBefore(/animation(?:-name)?\s*:[^;{}]*?[\w-]*/);
  if (an) {
    const word = /[\w-]*$/.exec(an.text)![0];
    const names = new Set([...ctx.state.doc.toString().matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
    if (!names.size) return null;
    return { from: ctx.pos - word.length, options: [...names].map((n) => opt(n, '@keyframes', undefined, 'function')), validFor: /^[\w-]*$/ };
  }
  return null;
}

// ---------------- цвет при наведении ----------------

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix|color)\((?:[^()]|\([^()]*\))*\)|var\(\s*--[\w-]+(?:[^()]|\([^()]*\))*\)/g;

/** Цвет в цветах открытого слайда (переменные темы); null — это не цвет */
function resolveColor(value: string, slide: HTMLElement | null): { css: string; hex: string } | null {
  const probe = document.createElement('i');
  probe.style.color = value;
  if (!probe.style.color) return null;
  // Переменной нет — цвет наследуется от обёртки: значит, это не цвет
  const wrap = document.createElement('i');
  wrap.style.cssText = 'display:none;color:rgb(1, 2, 3)';
  wrap.append(probe);
  (slide ?? document.body).append(wrap);
  const css = getComputedStyle(probe).color;
  wrap.remove();
  if (css === 'rgb(1, 2, 3)') return null;
  // #RRGGBB и прозрачность: rgb()/rgba() — как есть; oklch(), color-mix() и прочее — через холст
  let rgba = /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, ([\d.]+))?\)$/.exec(css)?.slice(1).map(Number);
  if (rgba) rgba[3] = Number.isNaN(rgba[3]) ? 1 : rgba[3];
  else {
    const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!c) return { css, hex: css };
    c.canvas.width = c.canvas.height = 1;
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    rgba = [d[0], d[1], d[2], d[3] / 255];
  }
  const hex = `#${rgba.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return { css, hex: rgba[3] < 1 ? `${hex} · ${Math.round(rgba[3] * 100)} %` : hex };
}

function colorTip(host: HintHost) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(COLOR_RE)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (pos < from || pos > to) continue;
      const c = resolveColor(m[0], host.slide());
      if (!c) return null;
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'st-color-tip';
          const sw = document.createElement('i');
          sw.style.setProperty('--c', c.css);
          dom.append(sw);
          // Подпись — только если она что-то добавляет: переменная темы, функция, прозрачность
          if (m[0].toUpperCase() !== c.hex) {
            const t = document.createElement('span');
            t.textContent = c.hex;
            dom.append(t);
          }
          return { dom };
        },
      };
    }
    return null;
  }, { hoverTime: 250 });
}

/** Подсказки при наборе и цвет при наведении — для редактора кода */
export function codeHints(host: HintHost): Extension {
  // Одна и та же функция: подсказчик узнаёт свои ответы по ней (новая на каждый вызов — бесконечный перезапрос)
  const autocomplete = (ctx: CompletionContext) => {
    const mode = host.mode();
    return varSource(ctx) ?? (mode === 'slide' ? yamlSource(ctx) : mode === 'css' ? cssSource(host, ctx) : null);
  };
  const data = [{ autocomplete }];
  return [
    EditorState.languageData.of(() => data),
    colorTip(host),
    EditorState.phrases.of({ Diagnostics: 'Ошибки', 'No diagnostics': 'Ошибок нет' }),
  ];
}

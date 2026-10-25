/**
 * Вкладка «Надпись» — как «Формат фигуры» в PowerPoint, но для текста: появляется с выделением
 * надписей (одной или нескольких) и оформляет весь их текст сразу. Готовые стили текста
 * (в цветах темы), шрифт и абзац, эффекты букв — тень, свечение, контур, плашка.
 * Части текста по-прежнему оформляются при правке текста — панелью «Текст» на «Главной».
 */
import { esc } from '../engine/html';
import { textStyleCss, type TextStyle } from '../engine/text-style';

export interface TextLook {
  id: string;
  name: string;
  props: TextStyle;
}

/**
 * Что задаёт стиль текста: цвет, начертание и эффекты. Шрифт, размер, выравнивание, интервалы
 * и прозрачность остаются свои — стиль меняет вид, а не вёрстку
 */
export const LOOK_KEYS = ['color', 'weight', 'upper', 'spacing', 'shadow', 'glow', 'outline', 'outlineColor', 'hollow', 'plate'] as const;
/** Ручки эффектов из «Свойств»: стиль начинает с чистого эффекта */
export const TUNE_KEYS = ['shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle', 'glowSize', 'glowOpacity', 'plateRadius', 'platePad'] as const;

/** Готовые стили: в цветах темы — меняются вместе с ней, светлой и тёмной */
export const TEXT_LOOKS: TextLook[] = [
  { id: 'plain', name: 'Обычный', props: {} },
  { id: 'accent', name: 'Акцент', props: { color: 'accent', weight: 700 } },
  { id: 'gradient', name: 'Градиент', props: { color: 'g:accent', weight: 800 } },
  { id: 'soft', name: 'Мягкая тень', props: { weight: 700, shadow: 'soft' } },
  { id: 'neon', name: 'Неон', props: { color: 'accent', weight: 700, glow: 'accent' } },
  { id: 'outline', name: 'Контурный', props: { weight: 800, hollow: true, outline: 3, outlineColor: 'accent' } },
  { id: 'extrude', name: 'Объёмный', props: { color: 'accent', weight: 800, shadow: 'extrude' } },
  { id: 'plate', name: 'Плашка', props: { color: '#FFFFFF', weight: 700, plate: 'accent' } },
  { id: 'eyebrow', name: 'Надзаголовок', props: { color: 'accent', weight: 700, upper: true, spacing: 0.14 } },
  { id: 'lift', name: 'Парящий', props: { weight: 800, shadow: 'lift' } },
  { id: 'retro', name: 'Ретро', props: { weight: 800, shadow: 'retro' } },
  { id: 'sticker', name: 'Наклейка', props: { color: 'accent', weight: 800, outline: 4, outlineColor: 'surface', shadow: 'soft' } },
  { id: 'marker', name: 'Подложка', props: { color: 'accent2', weight: 600, plate: 'soft' } },
];

/** На ленте — восемь ходовых, все — по стрелке */
export const PINNED_LOOKS = ['plain', 'accent', 'gradient', 'soft', 'neon', 'outline', 'extrude', 'plate'];

/** Разделы окна «Все стили текста» */
export const LOOK_GROUPS: [string, string[]][] = [
  ['Цвет и начертание', ['plain', 'accent', 'gradient', 'eyebrow', 'marker']],
  ['Эффекты', ['soft', 'lift', 'extrude', 'retro', 'neon', 'outline', 'sticker', 'plate']],
];

/** Оформление с ключами стиля — только стиля look, остальное как было */
export function applyLook(st: TextStyle, look: TextLook): TextStyle {
  const out: TextStyle = { ...st };
  for (const k of [...LOOK_KEYS, ...TUNE_KEYS]) delete out[k];
  return { ...out, ...look.props };
}

/** Стиль совпадает с оформлением текста: эффекты, подкрученные в «Свойствах», — уже не этот стиль */
export function lookOn(st: TextStyle, look: TextLook): boolean {
  return LOOK_KEYS.every((k) => (st[k] ?? undefined) === (look.props[k] ?? undefined)) && TUNE_KEYS.every((k) => st[k] === undefined);
}

/** «Аа» в оформлении st (и с поворотом надписи) — образец для окон с вариантами */
export function textSampleHtml(st: TextStyle, angle = 0): string {
  const css = [textStyleCss({ ...st, size: 22, width: undefined, align: undefined }), angle ? `rotate:${angle}deg` : ''].filter(Boolean).join(';');
  return `<i class="st-smp st-smp-tx"><b style="${esc(css)}">Аа</b></i>`;
}

/** Плитка стиля на ленте: образец тем же кодом, что на слайде */
export function lookTile(l: TextLook): string {
  const css = textStyleCss({ ...l.props, size: 15 });
  return `<button type="button" class="st-stile st-xtile" data-cmd="text.style.${l.id}" title="${esc(l.name)}" aria-label="${esc(l.name)}"><i><b style="${esc(css)}">Аа</b></i></button>`;
}

interface Ui {
  btn(cmd: string, ic: string, label: string, o?: { big?: boolean; menu?: boolean; title?: string; swatch?: string; ico?: boolean }): string;
  group(label: string, body: string): string;
  row(...b: string[]): string;
  stack(...b: string[]): string;
  order: string;
}

/** Панель вкладки «Надпись» */
export function textPanelHtml({ btn, group, row, stack, order }: Ui): string {
  const looks = `<div class="st-gallery x">${PINNED_LOOKS.map((id) => lookTile(TEXT_LOOKS.find((l) => l.id === id)!)).join('')}`
    + `<button type="button" class="st-gmore" data-cmd="text.styles" title="Все стили текста" aria-label="Все стили текста" aria-haspopup="true"><b class="st-caret"></b></button></div>`;
  const font = `<button type="button" class="st-rb st-txfont" data-cmd="text.font" title="Шрифт всего текста" aria-haspopup="listbox" aria-expanded="false"><span>Шрифт темы</span><b class="st-caret"></b></button>`;
  const size = `<span class="st-txsize" title="Размер шрифта, px">${btn('text.size.down', 'minus', 'Мельче', { ico: true })}`
    + `<input type="number" min="6" max="300" step="1" data-txsize aria-label="Размер шрифта">${btn('text.size.up', 'plus', 'Крупнее', { ico: true })}</span>`;
  return `<div class="st-rpanel" data-panel="text" hidden>
  ${group('Стили текста', looks)}
  ${group('Шрифт', `<div class="st-txf">${row(font, size)}${row(
    btn('text.bold', 'bold', 'Жирный', { ico: true }), btn('text.italic', 'italic', 'Курсив', { ico: true }), btn('text.underline', 'underline', 'Подчёркнутый', { ico: true }),
    btn('text.upper', 'text-case', 'Все заглавные', { ico: true }),
    `<i class="st-txsep"></i>`,
    btn('text.color', 'text-color', 'Цвет текста', { ico: true, menu: true, swatch: 'tcolor', title: 'Цвет текста: цвета темы, свои, градиент' }),
    btn('text.clear', 'eraser', 'Сбросить оформление', { ico: true, title: 'Сбросить оформление: как в теме' }),
  )}</div>`)}
  ${group('Абзац', stack(
    row(btn('text.align.left', 'align-left', 'По левому краю', { ico: true }), btn('text.align.center', 'align-center', 'По центру', { ico: true }), btn('text.align.right', 'align-right', 'По правому краю', { ico: true }), btn('text.align.justify', 'align-justify', 'По ширине', { ico: true })),
    row(btn('text.valign.top', 'v-top', 'Сверху рамки', { ico: true }), btn('text.valign.middle', 'v-middle', 'Посередине рамки', { ico: true }), btn('text.valign.bottom', 'v-bottom', 'Снизу рамки', { ico: true })),
    row(btn('text.leading', 'leading', 'Междустрочный интервал', { ico: true, menu: true }), btn('text.spacing', 'tracking', 'Интервал между буквами', { ico: true, menu: true })),
  ))}
  ${group('Эффекты', stack(btn('text.shadow', 'text-shadow', 'Тень', { menu: true, title: 'Тень букв' }), btn('text.glow', 'text-glow', 'Свечение', { menu: true, title: 'Свечение вокруг букв' }))
    + stack(btn('text.outline', 'text-outline', 'Контур', { menu: true, title: 'Контур букв: толщина, цвет, только контур' }), btn('text.plate', 'plate', 'Плашка', { menu: true, title: 'Цветная плашка под текстом' }))
    + stack(btn('text.opacity', 'opacity', 'Прозрачность', { menu: true }), btn('text.rotate', 'rotate', 'Поворот', { menu: true })))}
  ${group('Выровнять', btn('text.arrange', 'obj-left', 'Выровнять', { big: true, menu: true, title: 'Выровнять надписи относительно друг друга (или одну — по слайду), равные промежутки' }))}
  ${order}
</div>`;
}

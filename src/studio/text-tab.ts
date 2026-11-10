/**
 * Вкладка «Надпись» — как «Формат фигуры» в PowerPoint, но для текста: появляется с выделением
 * надписей (одной или нескольких) и оформляет весь их текст сразу. Готовые стили текста
 * (в цветах темы), шрифт и абзац, эффекты букв — тень, свечение, контур, плашка.
 * Части текста по-прежнему оформляются при правке текста — панелью «Текст» на «Главной».
 */
import { esc } from '../engine/html';
import { textStyleCss, type TextStyle } from '../engine/text-style';

export { applyLook, FX_NAMES, FX_SWATCH, fxSections, LOOK_GROUPS, LOOK_KEYS, lookOn, PINNED_LOOKS, TEXT_LOOKS, TUNE_KEYS } from '../engine/text-looks';
export type { FxKind, FxOption, FxSection, TextLook } from '../engine/text-looks';
import { PINNED_LOOKS, TEXT_LOOKS, type TextLook } from '../engine/text-looks';

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
    btn('text.color', 'text-color', 'Цвет текста', { ico: true, menu: true, swatch: 'tcolor', title: 'Цвет текста' }),
    btn('text.clear', 'eraser', 'Сбросить оформление', { ico: true, title: 'Сбросить оформление' }),
  )}</div>`)}
  ${group('Абзац', stack(
    row(btn('text.align.left', 'align-left', 'По левому краю', { ico: true }), btn('text.align.center', 'align-center', 'По центру', { ico: true }), btn('text.align.right', 'align-right', 'По правому краю', { ico: true }), btn('text.align.justify', 'align-justify', 'По ширине', { ico: true })),
    row(btn('text.valign.top', 'v-top', 'Сверху рамки', { ico: true }), btn('text.valign.middle', 'v-middle', 'Посередине рамки', { ico: true }), btn('text.valign.bottom', 'v-bottom', 'Снизу рамки', { ico: true })),
    row(btn('text.leading', 'leading', 'Междустрочный интервал', { ico: true, menu: true }), btn('text.spacing', 'tracking', 'Интервал между буквами', { ico: true, menu: true })),
  ))}
  ${group('Эффекты', stack(btn('text.shadow', 'text-shadow', 'Тень', { menu: true, title: 'Тень букв' }), btn('text.glow', 'text-glow', 'Свечение', { menu: true, title: 'Свечение вокруг букв' }))
    + stack(btn('text.outline', 'text-outline', 'Контур', { menu: true, title: 'Контур букв' }), btn('text.plate', 'plate', 'Плашка', { menu: true, title: 'Цветная плашка под текстом' }))
    + stack(btn('text.opacity', 'opacity', 'Прозрачность', { menu: true }), btn('text.rotate', 'rotate', 'Поворот', { menu: true })))}
  ${group('Выровнять', btn('text.arrange', 'obj-left', 'Выровнять', { big: true, menu: true, title: 'Выровнять и распределить надписи' }))}
  ${order}
</div>`;
}


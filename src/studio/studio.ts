import { icon } from '../components/icons';
import { CommandPalette } from './palette';
import { toolsCommands } from './tools';
import { applyAccent, applyAccentFlow, DEFAULT_ACCENT, HEX_RE, setUiAccent, slideAccent, uiAccent } from '../engine/accent';
import { getAt, setAt, type Path } from '../engine/data';
import { DeckView, H, W } from '../engine/deck-view';
import { Editor, SLIDE_PRESETS } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { placeOf, slideLabel } from '../engine/render';
import { brandMark } from '../engine/brand';
import { updateFavicon } from '../engine/show';
import { currentTheme, onThemeChange, toggleTheme } from '../engine/theme';
import type { Block, Deck } from '../types';
import { CLIP_TYPE, putClip, takeClip, type Clip } from './clipboard';
import { crossPaste } from './cross-paste';
import type { CodeView } from './code';
import type { ExportQuality } from './pptx';
import { FindBar } from './find';
import { applyFormat, hasFormat, takeFormat, type Format } from './format-painter';
import { tableGrips } from './table-grips';
import { GRID_STEPS, ViewAids } from './view-aids';
import { setupMarquee } from './marquee';
import { canExplode, explodeSlide } from './explode';
import { blockName, setSnapLines } from '../engine/editor/block-edit';
import { blobToDataUrl } from '../engine/editor/persist';
import { addEffect, addTemplate, assetUrls, findEntrance, deckWithTemplate, listTemplates, pickCss, pickDefs, removeTemplate, replaceUrls, type Template } from './templates';
import { animCommands, animPanelHtml, animTabHtml, bindDelayField, syncAnimTab, type AnimHost } from './anim-tab';
import { contextCommands, tableMenu, contextPanelsHtml, contextTab, contextTabsHtml, syncSwatches, type ContextTab } from './context-tabs';
import { Inspector } from './inspector';
import { closeLibrary, EMBED_SAMPLE, SANDBOX_SAMPLE, showLibrary, type Preset } from './library';
import { openCodeDialog } from './code-dialog';
import { closeMenu, showMenu, showPopover, type MenuEntry } from './menu';
import { projectStorage } from '../engine/storage';
import { LayersPane } from './layers';
import { SlidesPanel } from './slides-panel';
import { crumbs, type Crumb } from './structure';
import { canUngroup, groupObjects, ungroup } from './ungroup';
import './studio.css';

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

/** Шаг между появлениями объектов «по очереди», мс */
export const STEP = 300;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
const PAD = 40;
const NOTES_KEY = 'htmlpptx-studio-notes';

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** Кнопка ленты: большая (иконка над подписью) или малая (в строку). */
function rb(cmd: string, ic: string, label: string, opts: { big?: boolean; key?: string; menu?: boolean; title?: string } = {}): string {
  const tip = (opts.title ?? label) + (opts.key ? ` (${opts.key})` : '');
  return `<button type="button" class="st-rb${opts.big ? ' big' : ''}" data-cmd="${cmd}" title="${esc(tip)}"${opts.menu ? ' aria-haspopup="menu" aria-expanded="false"' : ''}>`
    + `${icon(ic)}<span>${esc(label)}${opts.menu ? '<b class="st-caret"></b>' : ''}</span></button>`;
}

/** Флажок на ленте: отмечен, когда команда активна */
function chk(cmd: string, label: string, title?: string): string {
  return `<button type="button" class="st-rb st-chk" data-cmd="${cmd}" title="${esc(title ?? label)}"><i class="st-box">${icon('check')}</i><span>${esc(label)}</span></button>`;
}

function group(label: string, body: string): string {
  return `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label">${esc(label)}</div></div>`;
}

/**
 * Студия — редактор презентации как в PowerPoint: лента с вкладками, миниатюры слева,
 * слайд в центре, свойства справа, заметки снизу. Правка на слайде — тот же движок, что
 * в режиме правки (Editor), данные и сохранение — через него же (storage).
 */
export function startStudio(deck: Deck, deckKey: string): void {
  document.title = `${deck.title} — Slideria`;
  document.body.classList.add('studio');
  document.body.innerHTML = `
<div class="studio-app">
  <header class="st-top" data-ed-keep>
    <a class="st-home" href="./?all" title="Slideria — все презентации" aria-label="Все презентации">${brandMark()}</a>
    <input class="st-title" id="st-title" aria-label="Название презентации" spellcheck="false">
    <nav class="st-tabs" role="tablist" aria-label="Вкладки ленты">
      <button type="button" role="tab" data-tab="home" aria-selected="true">Главная</button>
      <button type="button" role="tab" data-tab="insert" aria-selected="false">Вставка</button>
      ${animTabHtml()}
      <button type="button" role="tab" data-tab="show" aria-selected="false">Показ</button>
      <button type="button" role="tab" data-tab="tools" aria-selected="false">Инструменты</button>
      <button type="button" role="tab" data-tab="view" aria-selected="false">Вид</button>
      ${contextTabsHtml()}
      <button type="button" class="st-ribbon-toggle" id="st-rt" title="Свернуть ленту (Ctrl+F1)" aria-label="Свернуть ленту" aria-expanded="true">${icon('chev-up')}</button>
    </nav>
    <div class="st-pal" id="st-pal" role="search"></div>
    <div class="st-top-r">
      <button type="button" class="st-status" id="st-status" role="status" aria-live="polite"></button>
      <button class="btn ghost small st-export" type="button" data-cmd="file.export" title="Скачать один HTML-файл или PDF" aria-haspopup="true">${icon('save')}<span>Экспорт</span></button>
      <button class="ibtn small theme-btn" id="st-theme" type="button" aria-label="Тема интерфейса" title="Тема">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
      <button class="btn primary small" type="button" data-cmd="show.current" title="Показ с текущего слайда (Shift+F5)">${icon('play')}<span>Показ</span></button>
    </div>
  </header>
  <div class="st-ribbon" id="st-ribbon" data-ed-keep>
    <div class="st-rpanel" data-panel="home">
      ${group('Слайды', rb('slide.new', 'slide-add', 'Новый слайд', { big: true, key: 'Ctrl+M', menu: true }) + `<div class="st-rstack">${rb('slide.dup', 'copy', 'Дублировать')}${rb('slide.del', 'trash', 'Удалить')}</div>`)}
      ${group('Правка', `<div class="st-rstack">${rb('undo', 'undo', 'Отменить', { key: 'Ctrl+Z' })}${rb('redo', 'redo', 'Повторить', { key: 'Ctrl+Y' })}${rb('format.painter', 'brush', 'Формат по образцу', { title: 'Перенести оформление на другой объект. Двойной щелчок — на несколько объектов' })}</div><div class="st-rstack">${rb('edit.find', 'search', 'Найти', { key: 'Ctrl+F', title: 'Найти и заменить текст во всей презентации (Ctrl+F, замена — Ctrl+H)' })}</div>`)}
      ${group('Текст', '<div id="st-textdock" class="st-textdock"></div>')}
      ${group('Вставка', rb('insert.blocks', 'grid', 'Блоки', { big: true, menu: true, title: 'Готовые блоки: карточки, графики, схемы' }) + `<div class="st-rstack">${rb('insert.text', 'text', 'Надпись')}${rb('insert.image', 'image', 'Картинка')}</div>`)}
      ${group('Упорядочить', `<div class="st-rstack">${rb('obj.front', 'front', 'Вперёд', { title: 'На передний план — поверх других объектов' })}${rb('obj.back', 'back', 'Назад', { title: 'На задний план — под другие объекты' })}${rb('obj.lock', 'lock', 'Закрепить', { title: 'Объект не выделяется и не двигается мышью. Открепить — в области выделения (Alt+F10)' })}</div><div class="st-rstack">${rb('obj.group', 'group', 'Сгруппировать', { key: 'Ctrl+G', title: 'Объединить выделенные объекты в группу' })}${rb('obj.ungroup', 'ungroup', 'Разгруппировать', { key: 'Ctrl+Shift+G', title: 'Разделить на отдельные объекты' })}${rb('obj.free', 'move', 'Сделать свободным', { title: 'Свободно перемещать и менять размер' })}</div>`)}
      ${group('Выровнять', `<div class="st-rgrid">${rb('align.left', 'obj-left', 'Слева')}${rb('align.center', 'obj-center', 'По центру')}${rb('align.right', 'obj-right', 'Справа')}${rb('align.top', 'obj-top', 'Сверху')}${rb('align.middle', 'obj-middle', 'Посередине')}${rb('align.bottom', 'obj-bottom', 'Снизу')}</div><div class="st-rstack">${rb('dist.h', 'dist-h', 'По ширине', { title: 'Равные промежутки по горизонтали' })}${rb('dist.v', 'dist-v', 'По высоте', { title: 'Равные промежутки по вертикали' })}</div>`)}
    </div>
    <div class="st-rpanel" data-panel="insert" hidden>
      ${group('Новый слайд', SLIDE_PRESETS.map((p, k) => rb(`slide.preset.${k}`, ['text', 'grid', 'image', 'frame'][k] ?? 'slide-add', p.name, { big: true })).join(''))}
      ${group('Объекты', rb('insert.blocks', 'grid', 'Блоки', { big: true, menu: true, title: 'Готовые блоки: карточки, графики, схемы' }) + rb('insert.text', 'text', 'Текст', { big: true }) + rb('insert.image', 'image', 'Картинка', { big: true }))}
    </div>
    ${animPanelHtml()}
    <div class="st-rpanel" data-panel="show" hidden>
      ${group('Слайд', `<div class="st-rstack">${chk('show.hide', 'Скрыть слайд', 'Слайд остаётся в презентации, но при показе и в PDF пропускается')}</div>`)}
      ${group('Показ', rb('show.start', 'play', 'С начала', { big: true, key: 'F5' }) + rb('show.current', 'next', 'С текущего слайда', { big: true, key: 'Shift+F5' }) + rb('show.presenter', 'presenter', 'Режим докладчика', { big: true, key: 'Alt+F5', title: 'Показ на втором экране, заметки — на вашем' }))}
    </div>
    <div class="st-rpanel" data-panel="tools" hidden>
      ${group('Презентация', rb('tools.summary', 'chart', 'Сводка', { big: true, title: 'Слайды, слова, время доклада, тяжёлые и лишние файлы, шрифты' }))}
      ${group('Шрифты', rb('tools.font', 'text', 'Заменить шрифт', { big: true, title: 'Один шрифт на другой во всей презентации' }))}
      ${group('Заметки', rb('tools.notes-clear', 'notes', 'Удалить заметки', { big: true, title: 'Заметки докладчика со всех слайдов' }))}
    </div>
    <div class="st-rpanel" data-panel="view" hidden>
      ${group('Панели', rb('view.slides', 'grid', 'Слайды', { big: true, key: 'Ctrl+Shift+1', title: 'Список слайдов слева' }) + rb('view.props', 'sliders', 'Свойства', { big: true, key: 'Ctrl+Shift+2', title: 'Панель свойств справа' }) + rb('view.notes', 'notes', 'Заметки', { big: true, key: 'Ctrl+Shift+3' }) + rb('view.code', 'terminal', 'Код слайда', { big: true, key: 'Ctrl+`', title: 'Код слайда (YAML), стили (CSS) и анимации (HTML/JS)' }) + rb('view.layers', 'layers', 'Область выделения', { big: true, key: 'Alt+F10', title: 'Объекты слайда списком: скрыть, закрепить, поменять порядок' }))}
      ${group('Показать', `<div class="st-rstack">${chk('view.ruler', 'Линейка', 'Линейка сверху и слева; из неё вытягиваются направляющие')}${chk('view.grid', 'Сетка', 'Сетка на слайде, объекты прилипают к ней (Shift+F9)')}${chk('view.guides', 'Направляющие', 'Свои направляющие; объекты прилипают к ним (Alt+F9)')}</div><div class="st-rstack">${rb('view.grid-step', 'grid', 'Шаг сетки', { menu: true })}${rb('view.guides-reset', 'reset', 'Сбросить направляющие', { title: 'Оставить одну вертикальную и одну горизонтальную по центру' })}</div>`)}
      ${group('Скорость', `<div class="st-rstack">${chk('view.lite', 'Облегчённый режим', 'Если редактор подтормаживает: живые фоны, вставки, 3D-модели и анимации на слайде замирают в конечном виде. «Просмотр» и показ — как обычно')}</div>`)}
      ${group('Масштаб', rb('view.fit', 'fullscreen', 'Вписать', { big: true }) + `<div class="st-rstack">${rb('view.zoom-in', 'plus', 'Крупнее')}${rb('view.zoom-out', 'minus', 'Мельче')}</div>`)}
      ${group('Оформление', `<label class="st-accent" title="Акцентный цвет презентации"><input type="color" id="st-accent" aria-label="Акцентный цвет"><span>Акцент</span></label><label class="st-accent" title="Второй цвет: акцентные заливки становятся градиентом от акцента к нему"><input type="color" id="st-accent2" aria-label="Второй цвет градиента"><span>Градиент</span></label><div class="st-rstack">${rb('design.accent-reset', 'reset', 'Стандартный', { title: 'Стандартный акцент, без градиента' })}${rb('design.accent2-off', 'close', 'Без градиента', { title: 'Ровный акцент без второго цвета' })}</div><div class="st-rstack">${chk('design.accent-flow', 'Переливание', 'Цвета градиента акцента плавно текут по акцентным элементам слайда')}</div>`)}
      ${group('Интерфейс', `<div class="st-rstack">${chk('ui.own', 'Свой цвет', 'Кнопки и панели программы — в своём цвете, а не в цветах презентации. Слайды это не меняет. Запоминается на этом компьютере')}</div><label class="st-accent" title="Цвет интерфейса программы"><input type="color" id="st-uiac" aria-label="Цвет интерфейса"><span>Цвет</span></label>`)}
    </div>
    ${contextPanelsHtml()}
  </div>
  <div class="st-body" id="st-body">
    <aside class="st-slides" id="st-slides" aria-label="Слайды"></aside>
    <div class="st-split v" id="st-sl" role="separator" aria-orientation="vertical" aria-label="Ширина ленты слайдов" tabindex="0" title="Потяните, чтобы изменить ширину. Двойной щелчок — сбросить"></div>
    <div class="st-split v" id="st-sr" role="separator" aria-orientation="vertical" aria-label="Ширина панели свойств" tabindex="0" title="Потяните, чтобы изменить ширину. Двойной щелчок — сбросить"></div>
    <main class="st-main">
      <div class="st-work">
        <section class="st-code" id="st-code" data-ed-keep hidden aria-label="Код слайда"></section>
        <div class="st-split v st-sc" id="st-sc" role="separator" aria-orientation="vertical" aria-label="Ширина кода" tabindex="0" title="Потяните, чтобы изменить ширину. Двойной щелчок — сбросить" hidden></div>
        <div class="st-view">
          <nav class="st-crumbs" id="st-crumbs" aria-label="Где находится выделенное" data-ed-keep></nav>
          <div class="st-canvas" id="st-canvas"><div class="st-paper" id="st-paper"></div></div>
        </div>
        <section class="st-layers" id="st-layers" data-ed-keep hidden aria-label="Область выделения"></section>
      </div>
      <section class="st-notes" id="st-notes" data-ed-keep>
        <div class="st-split h" id="st-sn" role="separator" aria-orientation="horizontal" aria-label="Высота заметок" tabindex="0" title="Потяните, чтобы изменить высоту. Двойной щелчок — сбросить"></div>
        <label for="st-notes-text" id="st-notes-label">Заметки докладчика</label>
        <textarea id="st-notes-text" spellcheck="true" placeholder="Что сказать на этом слайде. Видно только в окне докладчика."></textarea>
      </section>
    </main>
    <aside class="st-props" id="st-props" aria-label="Свойства" data-ed-keep></aside>
  </div>
  <footer class="st-foot" data-ed-keep>
    <span id="st-pos"></span>
    <span class="st-foot-r">
      <button type="button" class="st-fbtn" data-cmd="view.slides" title="Слайды слева (Ctrl+Shift+1)">${icon('grid')}<span>Слайды</span></button>
      <button type="button" class="st-fbtn" data-cmd="view.props" title="Свойства справа (Ctrl+Shift+2)">${icon('sliders')}<span>Свойства</span></button>
      <button type="button" class="st-fbtn" data-cmd="view.code" title="Код слайда (Ctrl+\`)">${icon('terminal')}<span>Код</span></button>
      <button type="button" class="st-fbtn" data-cmd="view.notes" title="Заметки докладчика">${icon('notes')}<span>Заметки</span></button>
      <span class="st-zoom" role="group" aria-label="Масштаб">
        <button type="button" class="st-fbtn" data-cmd="view.zoom-out" title="Уменьшить (Ctrl + колесо)" aria-label="Уменьшить">${icon('minus')}</button>
        <button type="button" class="st-fbtn st-zoom-val" id="st-zoom" data-cmd="view.zoom-menu" title="Масштаб" aria-haspopup="menu"></button>
        <button type="button" class="st-fbtn" data-cmd="view.zoom-in" title="Увеличить (Ctrl + колесо)" aria-label="Увеличить">${icon('plus')}</button>
        <button type="button" class="st-fbtn" data-cmd="view.fit" title="Вписать слайд в окно" aria-label="Вписать">${icon('fullscreen')}</button>
      </span>
    </span>
  </footer>
</div>
<div class="st-preview-shield" id="st-shield" title="Esc — остановить просмотр"></div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $('st-canvas');
  const paper = $('st-paper');
  const notesText = $<HTMLTextAreaElement>('st-notes-text');
  const count = () => deck.slides.length;

  applyAccent(deck.theme?.accent, deck.theme?.accent2);

  applyAccentFlow(deck.theme?.accentFlow);
  updateFavicon(deck.brand?.logo);
  const view = new DeckView(deck, paper);
  /** Найти и заменить (создаётся вместе с клавиатурой, ниже) */
  let find: FindBar | null = null;
  // Слайды в редакторе листаются мгновенно; переход виден в «Просмотре» и в показе
  view.transitions = false;
  const hashIndex = () => {
    const m = /^#(\d+)$/.exec(location.hash);
    return m ? Math.max(0, Math.min(count() - 1, parseInt(m[1], 10) - 1)) : 0;
  };
  let index = hashIndex();
  view.show(index);

  // ---------------- масштаб ----------------
  let aids: ViewAids | null = null;
  let zoom: number | 'fit' = 'fit';
  let scale = 1;
  function fitScale(): number {
    return Math.max(0.1, Math.min((canvas.clientWidth - PAD * 2) / W, (canvas.clientHeight - PAD * 2) / H));
  }
  function layout(): void {
    scale = zoom === 'fit' ? fitScale() : zoom;
    paper.style.width = `${Math.round(W * scale)}px`;
    paper.style.height = `${Math.round(H * scale)}px`;
    canvas.classList.toggle('fit', zoom === 'fit');
    view.fit(W * scale, H * scale);
    $('st-zoom').textContent = `${Math.round(scale * 100)}%`;
    editor?.reposition();
    aids?.redraw();
  }
  function setZoom(z: number | 'fit'): void {
    zoom = z === 'fit' ? 'fit' : Math.max(0.1, Math.min(3, z));
    layout();
  }
  const stepZoom = (dir: 1 | -1) => {
    // Шаг к ближайшему «круглому» масштабу, заметно отличающемуся от текущего
    const next = dir > 0 ? ZOOMS.find((z) => z > scale + 0.02) : [...ZOOMS].reverse().find((z) => z < scale - 0.02);
    setZoom(next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]));
  };

  // ---------------- редактор ----------------
  let editor: Editor | null = null;
  /** Область выделения: создаётся ниже, но перерисовки слайдов уже её учитывают */
  let layers: LayersPane | null = null;
  let stateQueued = false;
  const queueState = () => {
    if (stateQueued) return;
    stateQueued = true;
    requestAnimationFrame(() => {
      stateQueued = false;
      syncUi();
    });
  };

  function go(i: number): void {
    const next = Math.max(0, Math.min(count() - 1, i));
    if (next === index && view.index === next) return;
    index = next;
    view.show(index);
    history.replaceState(null, '', `#${index + 1}`);
    editor?.onSlideChange();
    slides.mark();
    syncNotes();
    code?.update();
    layers?.apply();
    queueState();
  }

  editor = new Editor({
    deck,
    deckKey,
    stage: () => view.stage,
    index: () => index,
    go,
    refresh: (rebuild) => {
      if (rebuild) {
        view.update(deck);
        if (index > count() - 1) index = count() - 1;
        view.show(index);
      }
      applyAccent(deck.theme?.accent, deck.theme?.accent2);
      applyAccentFlow(deck.theme?.accentFlow);
      updateFavicon(deck.brand?.logo);
      slides.update();
      code?.update();
      // Скрытые на время правки остаются скрытыми после перерисовки — без мигания
      layers?.apply();
      queueState();
    },
    relayout: layout,
    state: queueState,
  }, true, { studio: true, textDock: $('st-textdock') });
  const ed = editor;

  const slides = new SlidesPanel($('st-slides'), {
    deck: () => deck,
    index: () => index,
    go,
    move: (from, to) => ed.moveSlide(from, to),
    duplicate: (i) => ed.duplicateSlide(i),
    remove: (i) => ed.deleteSlide(i),
    add: (_after, anchor) => newSlideMenu(anchor),
    menu: (i, at) => showMenu(at, slideMenu(i)),
  });

  // ---------------- выделенный объект ----------------
  const freeEl = (free: Path) => [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-free]')]
    .find((x) => x.getAttribute('data-free') === JSON.stringify(free)) ?? null;
  function measure(free: Path): { w: number; h: number } | null {
    const el = freeEl(free);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width / scale), h: Math.round(r.height / scale) };
  }

  /** Выделенные свободные объекты: один или группа. */
  const selPaths = (): Path[] => {
    const sel = ed.selection;
    if (!sel?.free) return [];
    return sel.group.length ? sel.group : [sel.free];
  };
  const boxes = (paths: Path[]) => paths.map((p) => {
    const pl = placeOf(getAt(deck, p));
    return { p, pl, h: pl.h ?? measure(p)?.h ?? 0 };
  });
  function writePlaces(items: { p: Path; pl: ReturnType<typeof placeOf> }[]): void {
    ed.commit((d) => items.forEach(({ p, pl }) => {
      const { h, ...rest } = pl;
      setAt(d, [...p, 'place'], h ? { ...rest, h } : rest);
    }), { rebuild: true });
  }

  /** Один объект — по слайду; несколько — относительно друг друга. */
  /** Закреплённые объекты не выравниваются и не раздвигаются */
  const lockedSel = () => {
    if (!ed.blockEditor.isLocked) return false;
    ed.toast('Среди выделенных есть закреплённый объект — сначала открепите его', 2600);
    return true;
  };

  function align(...kinds: string[]): void {
    if (lockedSel()) return;
    const items = boxes(selPaths());
    if (!items.length) return;
    const multi = items.length > 1;
    const fx = multi ? Math.min(...items.map((b) => b.pl.x)) : 0;
    const fy = multi ? Math.min(...items.map((b) => b.pl.y)) : 0;
    const fr = multi ? Math.max(...items.map((b) => b.pl.x + b.pl.w)) : W;
    const fb = multi ? Math.max(...items.map((b) => b.pl.y + b.h)) : H;
    const has = (k: string) => kinds.includes(k);
    writePlaces(items.map((b) => {
      const pl = { ...b.pl };
      if (has('left')) pl.x = fx;
      if (has('center')) pl.x = Math.round((fx + fr - pl.w) / 2);
      if (has('right')) pl.x = fr - pl.w;
      if (has('top')) pl.y = fy;
      if (has('middle')) pl.y = Math.round((fy + fb - b.h) / 2);
      if (has('bottom')) pl.y = fb - b.h;
      return { p: b.p, pl };
    }));
  }

  /** Равные промежутки между объектами по горизонтали или вертикали (от трёх объектов). */
  function distribute(axis: 'h' | 'v'): void {
    if (lockedSel()) return;
    const items = boxes(selPaths());
    if (items.length < 3) return;
    const pos = (b: typeof items[number]) => (axis === 'h' ? b.pl.x : b.pl.y);
    const size = (b: typeof items[number]) => (axis === 'h' ? b.pl.w : b.h);
    items.sort((a, b) => pos(a) - pos(b));
    const start = pos(items[0]);
    const end = Math.max(...items.map((b) => pos(b) + size(b)));
    const gap = (end - start - items.reduce((sum, b) => sum + size(b), 0)) / (items.length - 1);
    let at = start;
    writePlaces(items.map((b) => {
      const pl = { ...b.pl, [axis === 'h' ? 'x' : 'y']: Math.round(at) };
      at += size(b) + gap;
      return { p: b.p, pl };
    }));
  }

  /** Появление по очереди в порядке чтения. */
  function sequence(paths = selPaths()): void {
    const items = boxes(paths).sort((a, b) => (Math.abs(a.pl.y - b.pl.y) > 24 ? a.pl.y - b.pl.y : a.pl.x - b.pl.x));
    const first = Math.min(...items.map((b) => Number((getAt(deck, b.p) as Block).delay) || 0));
    ed.commit((d) => items.forEach((b, k) => {
      const blk = getAt(d, b.p) as Block;
      if (!blk.enter) blk.enter = 'rise';
      const delay = first + k * STEP;
      if (delay) blk.delay = delay;
      else delete blk.delay;
    }), { rebuild: true });
  }

  function selectAll(): void {
    const list = (deck.slides[index].free ?? []) as Block[];
    if (!list.length) return ed.toast('На слайде нет свободных объектов', 1800);
    // Закреплённые и скрытые не выделяются, как в PowerPoint
    const open = list.map((_b, k) => k).filter((k) => list[k].locked !== true && !layers?.isHidden(index, k));
    if (!open.length) return ed.toast('Все объекты слайда закреплены или скрыты', 2200);
    ed.selectMany(index, open);
  }

  // ---------------- просмотр анимации ----------------
  let previewTimer = 0;
  /** Что было выделено до просмотра: после него выделение возвращается */
  let previewSel: { slide: number; free: number[] } | null = null;
  /**
   * Облегчённый режим: сцена на паузе (фоны, вставки, модели замирают — DeckView.setPaused)
   * и без анимаций (.still — как миниатюра). На время «Просмотра» всё оживает
   */
  function applyLite(): void {
    view.stage.classList.toggle('still', lay.lite);
    view.setPaused(lay.lite && !document.body.classList.contains('st-previewing'));
  }
  function endPreview(): void {
    clearTimeout(previewTimer);
    if (!document.body.classList.contains('st-previewing')) return;
    document.body.classList.remove('st-previewing');
    applyLite();
    document.body.classList.add('editing');
    const back = previewSel;
    previewSel = null;
    if (back && back.slide === index && back.free.length) {
      if (back.free.length === 1) ed.selectFree(index, back.free[0]);
      else ed.selectMany(index, back.free);
    }
  }
  function preview(): void {
    endPreview();
    const slide = view.slides[index];
    if (!slide) return;
    previewSel = { slide: index, free: selPaths().map((p) => Number(p[3])) };
    ed.clearSelection();
    const free = (deck.slides[index].free ?? []) as Block[];
    const longest = Math.max(0, ...free.map((b) => (b.enter ? Number(b.delay) || 0 : 0)));
    const s = deck.slides[index];
    const tr = s.transition && s.transition !== 'none' ? Number(s.transitionMs) || 600 : 0;
    document.body.classList.remove('editing');
    document.body.classList.add('st-previewing');
    applyLite();
    // Перезапуск: переход от предыдущего слайда и появление объектов
    view.replay(index);
    previewTimer = window.setTimeout(endPreview, Math.min(9000, longest + tr + 1600));
  }
  $('st-shield').addEventListener('click', endPreview);

  // ---------------- показ ----------------
  async function openShow(from: number, present = false): Promise<void> {
    await ed.settle();
    const u = new URL(location.href);
    u.searchParams.delete('studio');
    if (present) u.searchParams.set('present', '');
    u.hash = `#${from + 1}`;
    window.open(u.toString(), `htmlpptx-show-${deckKey}`);
  }

  // ---------------- формат по образцу ----------------
  let painter: { f: Format; sticky: boolean } | null = null;
  let formatClip: Format | null = null;
  const singleSel = () => !!ed.selection && ed.selection.group.length <= 1;
  const selectedBlock = () => (ed.selection ? (getAt(deck, ed.selection.block) as Block | undefined) : undefined);
  function sourceFormat(): Format | null {
    const b = selectedBlock();
    if (!b) return null;
    const f = takeFormat(b);
    if (!hasFormat(f)) {
      ed.toast('У объекта нет оформления для переноса', 2000);
      return null;
    }
    return f;
  }
  function startPainter(sticky: boolean): void {
    const f = painter?.f ?? sourceFormat();
    if (!f) return;
    painter = { f, sticky };
    document.body.classList.add('st-painting');
    ed.toast(sticky ? 'Щёлкайте объекты, чтобы применить оформление. Esc — готово' : 'Щёлкните объект, чтобы применить оформление', 2500);
    syncUi();
  }
  function stopPainter(): void {
    painter = null;
    document.body.classList.remove('st-painting');
    syncUi();
  }
  /** Применить оформление к блокам; после — выделить первый из них. */
  function paint(f: Format, paths: Path[]): void {
    let n = 0;
    ed.commit((d) => paths.forEach((p) => { if (applyFormat(d, p, f)) n++; }), { rebuild: true });
    if (!n) ed.toast('К этому объекту оформление не подходит', 2000);
    const key = JSON.stringify(paths[0]);
    const el = [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === key);
    if (el && paths.length === 1) ed.selectBlock(el.parentElement?.hasAttribute('data-free') ? el.parentElement : el);
  }
  function copyFormat(): void {
    const f = sourceFormat();
    if (!f) return;
    formatClip = f;
    ed.toast('Оформление скопировано', 1400);
  }
  function pasteFormat(): void {
    const sel = ed.selection;
    if (!formatClip || !sel) return;
    paint(formatClip, sel.group.length > 1 ? sel.group : [sel.block]);
  }
  // Кисть включена: щелчок по объекту переносит на него оформление, мимо объекта — выключает
  let swallowClick = false;
  view.stage.addEventListener('pointerdown', (e) => {
    if (!painter || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    swallowClick = true;
    const el = (e.target as Element).closest<HTMLElement>('.slide.on [data-block]');
    const path = el ? JSON.parse(el.getAttribute('data-block')!) as Path : null;
    if (!path) return stopPainter();
    const { f, sticky } = painter;
    paint(f, [path]);
    if (!sticky) stopPainter();
  }, true);
  view.stage.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  document.querySelector('.st-ribbon [data-cmd="format.painter"]')!.addEventListener('dblclick', () => startPainter(true));

  // ---------------- снимок 3D-модели ----------------
  async function modelSnapshot(): Promise<void> {
    const sel = ed.selection;
    if (!sel) return;
    const key = JSON.stringify(sel.block);
    const el = [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === key);
    const mv = el?.querySelector('model-viewer') as (HTMLElement & { loaded?: boolean; toBlob?(o: object): Promise<Blob> }) | null;
    if (!mv?.toBlob || !mv.loaded) return ed.toast('Модель ещё загружается', 2000);
    try {
      const blob = await mv.toBlob({ mimeType: 'image/png', idealAspect: true });
      const { url } = await projectStorage.uploadAsset(deckKey, blob, 'model-snapshot.png');
      const path = sel.block;
      ed.commit((d) => setAt(d, [...path, 'poster'], url), { rebuild: true });
      ed.toast('Снимок сохранён', 1500);
    } catch (e) {
      ed.toast(`Не удалось сделать снимок: ${(e as Error).message}`, 4000, true);
    }
  }

  // ---------------- код живой вставки ----------------
  /** Окно кода живой вставки или песочницы: код из поля code или из файла вставки; без кода — пример */
  async function editEmbedCode(path?: Path): Promise<void> {
    const p = path ?? ed.selection?.block;
    const b = p ? getAt(deck, p) as (Block & { src?: string; code?: string; theme?: boolean }) | undefined : undefined;
    if (!p || (b?.type !== 'embed' && b?.type !== 'sandbox')) return;
    let text = typeof b.code === 'string' ? b.code : '';
    if (!text && b.src) {
      try { text = await (await fetch(b.src)).text(); } catch { return ed.toast('Не удалось прочитать файл вставки', 3000, true); }
    }
    const was = text || (b.type === 'sandbox' ? SANDBOX_SAMPLE : EMBED_SAMPLE);
    openCodeDialog({ title: b.type === 'sandbox' ? 'Код песочницы' : 'Код вставки', code: was, theme: !!b.theme, apply: (next) => { if (next !== was || !text) void applyEmbedCode(p, b, next); } });
  }

  /** Код применён: где он был, там и остаётся — файл новым файлом в assets/, код — в данных */
  async function applyEmbedCode(p: Path, b: Block & { src?: string; code?: string }, next: string): Promise<void> {
    try {
      if (b.src && typeof b.code !== 'string') {
        const blob = new Blob([next], { type: 'text/html' });
        const name = decodeURIComponent(b.src.split('/').pop()!.split('?')[0]).replace(/\.html?$/i, '') || 'embed';
        const url = ed.mode === 'project' ? (await projectStorage.uploadAsset(deckKey, blob, `${name}.htm`)).url : await blobToDataUrl(blob);
        ed.commit((d) => setAt(d, [...p, 'src'], url), { rebuild: true });
      } else {
        ed.commit((d) => setAt(d, [...p, 'code'], next), { rebuild: true });
      }
    } catch (e) {
      return ed.toast(`Не удалось применить код: ${(e as Error).message}`, 4000, true);
    }
    await embedPoster(p, 'Код применён');
  }

  async function embedPoster(p: Path | undefined, done = 'Заставка обновлена'): Promise<void> {
    if (!p) return;
    ed.toast(`${done === 'Заставка обновлена' ? 'Снимаю' : `${done} — снимаю`} заставку…`, 0);
    const ok = await ed.embedPoster(p);
    ed.toast(ok ? done : `${done}, но заставку снять не удалось`, 2500, !ok);
  }

  // Двойной щелчок по живой вставке — её код
  view.stage.addEventListener('dblclick', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.slide.on :is([data-type="embed"], [data-type="sandbox"])[data-block]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    try { void editEmbedCode(JSON.parse(el.dataset.block!) as Path); } catch { /* путь не прочитан */ }
  }, true);

  // ---------------- экспорт ----------------
  const EXPORTS: [string, string, string, string][] = [
    ['clean', 'play', 'HTML для показа', 'Один файл для просмотра в браузере'],
    ['edit', 'pencil', 'HTML с правкой', 'Файл, в котором можно править текст'],
    ['pptx', 'layers', 'PowerPoint', 'Файл PPTX: тексты, фигуры, таблицы и диаграммы правятся в PowerPoint'],
    ['pdf', 'notes', 'PDF', 'Один слайд на странице'],
  ];
  /** Качество файла: запоминается для следующих экспортов */
  const QUALITIES: [ExportQuality, string, string][] = [
    ['compact', 'Компактное', 'Файл в разы меньше: картинки сжаты, GIF в HTML — в WebP. Для почты и мессенджеров'],
    ['normal', 'Обычное', 'Картинки как есть, сложная графика в PowerPoint — в двойной чёткости'],
    ['high', 'Высокое', 'Сложная графика в PowerPoint — в тройной чёткости: для экранов 4K и печати. HTML — как «Обычное»'],
  ];
  const QUALITY_KEY = 'htmlpptx-export-quality';
  let quality: ExportQuality = 'normal';
  try { const q = localStorage.getItem(QUALITY_KEY); if (QUALITIES.some(([k]) => k === q)) quality = q as ExportQuality; } catch { /* нет доступа */ }
  function exportMenu(): void {
    const seg = QUALITIES.map(([k, t]) => `<button type="button" role="radio" data-q="${k}" aria-checked="${k === quality}">${esc(t)}</button>`).join('');
    const hint = () => QUALITIES.find(([k]) => k === quality)![2];
    const html = `<div class="st-xq"><span class="st-xq-l">Качество</span><div class="st-xq-seg" role="radiogroup" aria-label="Качество файла">${seg}</div><small class="st-xq-hint">${esc(hint())}</small></div>`
      + EXPORTS.map(([k, ic, t, d]) => `<button type="button" class="st-xopt" data-x="${k}">${icon(ic)}<span><b>${esc(t)}</b><small>${esc(d)}</small></span></button>`).join('');
    const pop = showPopover(document.querySelector<HTMLElement>('.st-top [data-cmd="file.export"]')!, html, (b) => {
      const q = b.dataset.q as ExportQuality | undefined;
      if (q) {
        return {
          keep: true,
          run: () => {
            quality = q;
            try { localStorage.setItem(QUALITY_KEY, q); } catch { /* нет доступа */ }
            pop.querySelectorAll<HTMLElement>('[data-q]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.q === q)));
            pop.querySelector('.st-xq-hint')!.textContent = hint();
          },
        };
      }
      const m = b.dataset.x;
      return m ? { run: () => void runExport(m) } : null;
    }, 'st-exportpop');
  }
  let exporting = false;
  const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
  function download(blob: Blob, name: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function runExport(mode: string): Promise<void> {
    if (exporting) return;
    await ed.settle();
    if (mode === 'pdf') {
      const u = new URL(location.href);
      u.searchParams.delete('studio');
      u.searchParams.set('print', '');
      u.hash = '#1';
      window.open(u.toString(), `htmlpptx-print-${deckKey}`);
      return;
    }
    exporting = true;
    ed.toast('Подготовка файла…', 60000);
    if (mode === 'pptx') {
      try {
        const { exportPptx } = await import('./pptx');
        const blob = await exportPptx(deck, (i, n) => ed.toast(i < n ? `PowerPoint: слайд ${i + 1} из ${n}…` : 'PowerPoint: сохранение…', 60000), quality);
        download(blob, `${deckKey}.pptx`);
        ed.toast(`Файл готов: ${deckKey}.pptx, ${sizeText(blob.size)}`, 3000);
      } catch (e) {
        ed.toast(`Экспорт не удался: ${(e as Error).message}`, 6000, true);
      } finally {
        exporting = false;
      }
      return;
    }
    try {
      if (quality === 'compact') ed.toast('Сжимаю картинки…', 60000);
      const blob = await projectStorage.exportHtml(deckKey, mode === 'clean', quality === 'compact');
      // Имя — как у папки презентации (и у yarn build): латиница открывается везде
      const name = `${deckKey}${mode === 'clean' ? '' : '-edit'}.html`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const mb = blob.size / 1024 / 1024;
      // Видео и модели внутри одного файла: большой файл неудобно отправлять
      if (mb > 20) ed.toast(`Файл готов: ${name}, ${Math.round(mb)} МБ. Большую часть занимают видео и 3D-модели — для отправки удобнее ссылка на YouTube или облако.`, 8000);
      else ed.toast(`Файл готов: ${name}, ${sizeText(blob.size)}`, 3000);
    } catch (e) {
      ed.toast(`Экспорт не удался: ${(e as Error).message}`, 6000, true);
    } finally {
      exporting = false;
    }
  }

  // ---------------- меню ----------------
  /** Скрыть слайд или вернуть его в показ */
  function toggleHidden(i: number): void {
    ed.commit((d) => {
      const s = d.slides[i];
      if (!s) return;
      if (s.hidden) delete s.hidden;
      else s.hidden = true;
    }, { rebuild: false });
  }
  function newSlideMenu(anchor: HTMLElement): void {
    showMenu(anchor, SLIDE_PRESETS.map((p, k) => ({
      label: p.name, icon: ['text', 'grid', 'image', 'frame'][k] ?? 'slide-add', run: () => ed.addSlide(index, k),
    })));
  }
  function slideMenu(i: number): MenuEntry[] {
    const n = count();
    const clip = takeClip();
    const part = i === index ? targetEntrance() : null;
    return [
      // Правый щелчок по части слайда с красивым появлением: его можно забрать себе
      ...(part ? [{ label: 'Сохранить появление как эффект…', icon: 'sparkle', run: () => askEffectName(part) }, null] : []),
      { label: 'Копировать слайд', icon: 'copy', hint: 'Ctrl+C', run: () => copy(false) },
      { label: 'Вставить', icon: 'plus', hint: 'Ctrl+V', disabled: !clip, run: () => clip && pasteClip(clip) },
      null,
      ...(i === index && canExplode(deck.slides[i]) ? [{ label: 'Разобрать на объекты', icon: 'ungroup', run: () => run('slide.explode') }, null] : []),
      // Закреплённые объекты правым щелчком не достать: открепить их можно отсюда
      ...(i === index && lockedOn(i).length ? [
        { label: 'Открепить все объекты', icon: 'unlock', run: () => setLocked(lockedOn(i), false) },
        { label: 'Область выделения', icon: 'layers', hint: 'Alt+F10', run: () => toggleLayers(true) },
        null,
      ] : []),
      { label: 'Новый слайд после этого', icon: 'slide-add', hint: 'Ctrl+M', run: () => ed.addSlide(i, 0) },
      { label: 'Дублировать слайд', icon: 'copy', hint: 'Ctrl+D', run: () => ed.duplicateSlide(i) },
      null,
      { label: 'Переместить выше', icon: 'up', hint: 'Alt+↑', disabled: i === 0, run: () => ed.moveSlide(i, i - 1) },
      { label: 'Переместить ниже', icon: 'back', hint: 'Alt+↓', disabled: i === n - 1, run: () => ed.moveSlide(i, i + 1) },
      null,
      { label: 'Показ с этого слайда', icon: 'play', run: () => void openShow(i) },
      null,
      { label: deck.slides[i]?.hidden ? 'Показать слайд' : 'Скрыть слайд', icon: deck.slides[i]?.hidden ? 'eye' : 'eye-off', run: () => toggleHidden(i) },
      { label: 'Удалить слайд', icon: 'trash', danger: true, disabled: n <= 1, hint: 'Delete', run: () => ed.deleteSlide(i) },
    ];
  }
  function objectMenu(): MenuEntry[] {
    const sel = ed.selection;
    if (!sel) return slideMenu(index);
    if (!sel.free) {
      return [
        { label: 'Сделать свободным', icon: 'move', run: () => run('obj.free') },
        { label: 'Разгруппировать', icon: 'ungroup', hint: 'Ctrl+Shift+G', disabled: !cmds['obj.ungroup'].enabled!(), run: () => run('obj.ungroup') },
        ...(sel.hasParent ? [{ label: 'Выделить внешний блок', icon: 'up', run: () => run('obj.parent') }] : []),
        ...(selectedEntrance() ? [{ label: 'Сохранить появление как эффект…', icon: 'sparkle', run: () => askEffectName() }] : []),
        null,
        { label: 'Удалить блок', icon: 'trash', danger: true, hint: 'Delete', run: () => run('obj.del') },
      ];
    }
    const clip = takeClip();
    return [
      { label: 'Копировать', icon: 'copy', hint: 'Ctrl+C', run: () => copy(false) },
      { label: 'Вырезать', icon: 'eraser', hint: 'Ctrl+X', run: () => copy(true) },
      { label: 'Вставить', icon: 'plus', hint: 'Ctrl+V', disabled: !clip, run: () => clip && pasteClip(clip) },
      { label: 'Копировать оформление', icon: 'brush', hint: 'Ctrl+Shift+C', disabled: multi(), run: () => run('format.copy') },
      { label: 'Вставить оформление', icon: 'brush', hint: 'Ctrl+Shift+V', disabled: !formatClip, run: () => run('format.paste') },
      null,
      { label: 'Дублировать', icon: 'copy', hint: 'Ctrl+D', run: () => run('obj.dup') },
      { label: 'Сохранить как шаблон…', icon: 'sparkle', run: () => run('obj.template') },
      // Только если у объекта есть появление, которое переносится на другие
      ...(!multi() && selectedEntrance() ? [{ label: 'Сохранить появление как эффект…', icon: 'sparkle', run: () => askEffectName() }] : []),
      ...(multi() ? [
        { label: 'Сгруппировать', icon: 'group', hint: 'Ctrl+G', run: () => run('obj.group') },
        { label: 'Появляться по очереди', icon: 'sparkle', run: () => sequence() },
        { label: ed.blockEditor.isLocked ? 'Открепить' : 'Закрепить', icon: ed.blockEditor.isLocked ? 'unlock' : 'lock', run: () => run('obj.lock') },
      ] : [
        { label: 'Разгруппировать', icon: 'ungroup', hint: 'Ctrl+Shift+G', disabled: !cmds['obj.ungroup'].enabled!(), run: () => run('obj.ungroup') },
        { label: 'На передний план', icon: 'front', run: () => run('obj.front') },
        { label: 'На задний план', icon: 'back', run: () => run('obj.back') },
        ...(hasFree() ? [{ label: ed.blockEditor.isLocked ? 'Открепить' : 'Закрепить', icon: ed.blockEditor.isLocked ? 'unlock' : 'lock', run: () => run('obj.lock') }] : []),
        null,
        { label: 'По центру слайда', icon: 'obj-center', run: () => align('center', 'middle') },
      ]),
      null,
      { label: multi() ? 'Удалить выделенные' : 'Удалить', icon: 'trash', danger: true, hint: 'Delete', run: () => run('obj.del') },
    ];
  }

  // ---------------- копирование и вставка ----------------
  const isTyping = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || !!a.closest('.cm-editor'));
  };
  const pasted = new Map<string, number>();

  /** Что нужно для вставки в другую презентацию: её стили, определения, эффекты, изолированные стили */
  function carry(items: unknown[]): Pick<Clip, 'css' | 'defs' | 'effects' | 'scoped'> {
    const d = deck as Deck & { css?: string; defs?: string };
    const text = JSON.stringify(items);
    const scoped = Object.fromEntries(Object.entries(deck.scoped ?? {}).filter(([ns]) => text.includes(`"${ns}"`)));
    return {
      css: typeof d.css === 'string' && d.css.trim() ? d.css : undefined,
      defs: typeof d.defs === 'string' && d.defs.trim() ? d.defs : undefined,
      effects: deck.effects && /"ufx-/.test(text) ? deck.effects : undefined,
      scoped: Object.keys(scoped).length ? scoped : undefined,
    };
  }

  /** Что скопировать: выделенные объекты или текущий слайд. */
  function makeClip(): { clip: Clip; text: string } | null {
    const sel = ed.selection;
    if (sel) {
      const paths = sel.group.length ? sel.group : [sel.free ?? sel.block];
      const items = paths.map((p) => {
        const b = JSON.parse(JSON.stringify(getAt(deck, p))) as Block & { place?: unknown; cols?: unknown; rows?: unknown };
        if (!sel.free) {
          // Блок раскладки становится свободным объектом того же размера
          delete b.cols;
          delete b.rows;
          const el = [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === JSON.stringify(p));
          if (el) {
            const r = el.getBoundingClientRect();
            const a = ed.toSlide(r.left, r.top);
            const z = ed.toSlide(r.right, r.bottom);
            b.place = { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(z.x - a.x), h: Math.round(z.y - a.y) };
          }
        }
        return b;
      });
      const text = items.map((b) => [b.text, b.title, ...(Array.isArray(b.texts) ? b.texts : [])].filter((x) => typeof x === 'string').join('\n')).filter(Boolean).join('\n\n');
      return { clip: putClip({ deck: deckKey, kind: 'objects', items, slide: index, ...carry(items) }), text };
    }
    const s = deck.slides[index];
    const items = [JSON.parse(JSON.stringify(s))];
    return { clip: putClip({ deck: deckKey, kind: 'slides', items, slide: index, ...carry(items) }), text: slideLabel(s, index) };
  }

  function copy(cut: boolean, data?: DataTransfer | null): boolean {
    const made = makeClip();
    if (!made) return false;
    data?.setData(CLIP_TYPE, made.clip.id);
    data?.setData('text/plain', made.text);
    const n = made.clip.items.length;
    if (cut) {
      if (made.clip.kind === 'slides') ed.deleteSlide(index);
      else ed.blockEditor.remove();
    } else {
      ed.toast(made.clip.kind === 'slides' ? 'Слайд скопирован' : n > 1 ? `Скопировано объектов: ${n}` : 'Скопировано', 1400);
    }
    return true;
  }

  function uniqueSlideId(base: string): string {
    const ids = new Set(deck.slides.map((s) => s.id));
    const stem = (base || 'slide').replace(/-\d+$/, '');
    if (!ids.has(stem)) return stem;
    for (let n = 2; ; n++) if (!ids.has(`${stem}-${n}`)) return `${stem}-${n}`;
  }

  /** Из другой презентации: файлы копируются, стили и определения — изолированно (cross-paste.ts) */
  async function pasteForeign(clip: Clip): Promise<void> {
    ed.toast('Переношу из другой презентации…', 0);
    const upload = async (blob: Blob, name: string) => (ed.mode === 'project'
      ? (await projectStorage.uploadAsset(deckKey, blob, name)).url
      : await blobToDataUrl(blob));
    let res;
    try {
      res = await crossPaste(clip, clip.items, deck, upload);
    } catch (e) {
      ed.toast(`Не удалось вставить: ${(e as Error).message}`, 5000, true);
      return;
    }
    const files = res.files ? ` Файлов скопировано: ${res.files}.` : '';
    if (clip.kind === 'slides') {
      const copies = (res.items as Deck['slides']).map((s) => ({ ...s, id: uniqueSlideId(typeof s.id === 'string' ? s.id : 'slide') }));
      const at = index + 1;
      if (ed.commit((d) => { res.apply(d); d.slides.splice(at, 0, ...copies); })) {
        go(at);
        ed.toast(`Вставлено из другой презентации: ${copies.length > 1 ? `${copies.length} слайда` : 'слайд'}.${files} Вернуть: Ctrl+Z`, 3500);
      }
      return;
    }
    const i = index;
    const blocks = (res.items as Block[]).map((b) => { delete b.locked; return b; });
    let from = 0;
    if (!ed.commit((d) => {
      res.apply(d);
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      from = s.free.length;
      // Имя объекта на слайде одно: копия рядом с оригиналом его не получает
      const used = new Set(s.free.map((x) => x.id));
      blocks.forEach((b) => { if (used.has(b.id)) delete b.id; });
      s.free.push(...blocks);
    }, { rebuild: true })) return;
    ed.selectMany(i, blocks.map((_b, k) => from + k));
    ed.toast(`Вставлено из другой презентации.${files} Вернуть: Ctrl+Z`, 3000);
  }

  function pasteClip(clip: Clip): void {
    if (clip.deck !== deckKey) {
      void pasteForeign(clip);
      return;
    }
    if (clip.kind === 'slides') {
      const copies = clip.items.map((raw) => {
        const s = JSON.parse(JSON.stringify(raw)) as Deck['slides'][number];
        s.id = uniqueSlideId(typeof s.id === 'string' ? s.id : 'slide');
        return s;
      });
      const at = index + 1;
      if (ed.commit((d) => d.slides.splice(at, 0, ...copies))) go(at);
      return;
    }
    // На тот же слайд — со сдвигом, чтобы копия не легла ровно поверх; на другой — на то же место
    const key = `${clip.id}:${index}`;
    const times = (pasted.get(key) ?? 0) + (clip.slide === index ? 1 : 0);
    pasted.set(key, times);
    const i = index;
    const blocks = clip.items.map((raw) => {
      const b = JSON.parse(JSON.stringify(raw)) as Block;
      // Копия закреплённого объекта вставляется откреплённой: её сразу можно двигать
      delete b.locked;
      const pl = placeOf(b);
      const { h, ...rest } = { ...pl, x: pl.x + times * 24, y: pl.y + times * 24 };
      b.place = h ? { ...rest, h } : rest;
      return b;
    });
    let from = 0;
    if (!ed.commit((d) => {
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      from = s.free.length;
      // Имя объекта на слайде одно: копия рядом с оригиналом его не получает
      const used = new Set(s.free.map((x) => x.id));
      blocks.forEach((b) => { if (used.has(b.id)) delete b.id; });
      s.free.push(...blocks);
    }, { rebuild: true })) return;
    ed.selectMany(i, blocks.map((_b, k) => from + k));
  }

  function pasteText(text: string): void {
    const t = text.replace(/\r/g, '').trim().slice(0, 5000);
    if (!t) return;
    const i = index;
    let at = -1;
    if (ed.commit((d) => {
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      s.free.push({ type: 'text', text: t, place: { x: 340, y: 300, w: 600 } });
      at = s.free.length - 1;
    }, { rebuild: true })) ed.selectFree(i, at);
  }

  document.addEventListener('copy', (e) => {
    if (isTyping() || getSelection()?.toString()) return;
    if (copy(false, e.clipboardData)) e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (isTyping()) return;
    if (copy(true, e.clipboardData)) e.preventDefault();
  });
  document.addEventListener('paste', (e) => {
    if (isTyping() || !e.clipboardData) return;
    const data = e.clipboardData;
    const clip = takeClip(data.getData(CLIP_TYPE) || '__none__');
    if (clip) {
      e.preventDefault();
      return pasteClip(clip);
    }
    const file = [...data.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void ed.insertImageFile(file);
      return;
    }
    const text = data.getData('text/plain');
    if (text.trim()) {
      e.preventDefault();
      pasteText(text);
    }
  });
  // Картинка, брошенная мимо слайда (на серое поле), тоже встаёт на слайд
  canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files') && !view.stage.contains(e.target as Node)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  canvas.addEventListener('drop', (e) => {
    if (view.stage.contains(e.target as Node)) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    // Файл шрифта — свой шрифт презентации
    const font = files.find((x) => /\.(woff2?|ttf|otf)$/i.test(x.name));
    if (font) {
      e.preventDefault();
      void ed.addFontFile(font);
      return;
    }
    // HTML-файл (анимация, интерактив) — живой вставкой на слайд
    const html = files.find((x) => /\.html?$/i.test(x.name) || x.type === 'text/html');
    if (html) {
      e.preventDefault();
      void ed.insertEmbedFile(html);
      return;
    }
    const f = files.find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    void ed.insertImageFile(f);
  });

  // ---------------- библиотека блоков ----------------
  function openLibrary(): void {
    const anchor = [...document.querySelectorAll<HTMLElement>('.st-ribbon [data-cmd="insert.blocks"]')].find((b) => b.offsetParent) ?? $('st-slides');
    showLibrary(anchor, deck, insertPreset, {
      list: listTemplates(),
      pick: (t) => void insertTemplate(t),
      remove: (t) => { removeTemplate(t.id); ed.toast(`Шаблон «${t.name}» удалён`, 1800); },
    });
  }

  // ---------------- мои шаблоны ----------------
  /** Выделенные объекты → шаблон: объекты, их стили и анимации, картинки */
  async function makeTemplate(name: string): Promise<void> {
    const paths = selPaths();
    if (!paths.length) return;
    const els = paths.map((p) => view.stage.querySelector<HTMLElement>(`.slide.on > [data-free='${JSON.stringify(p)}']`));
    const boxes = paths.map((p, k) => {
      const pl = placeOf(getAt(deck, p));
      return { pl, h: pl.h ?? (els[k] ? measure(p)?.h ?? 0 : 0) };
    });
    const x0 = Math.min(...boxes.map((b) => b.pl.x));
    const y0 = Math.min(...boxes.map((b) => b.pl.y));
    const x1 = Math.max(...boxes.map((b) => b.pl.x + b.pl.w));
    const y1 = Math.max(...boxes.map((b) => b.pl.y + b.h));
    const items = paths.map((p, k) => {
      const b = JSON.parse(JSON.stringify(getAt(deck, p))) as Block;
      const { pl } = boxes[k];
      b.place = { ...pl, x: Math.round(pl.x - x0), y: Math.round(pl.y - y0) };
      return b;
    });
    ed.toast('Сохраняю шаблон…', 0);
    // Картинки и вставки — содержимым: шаблон работает и в другой презентации
    const assets: Record<string, string> = {};
    for (const url of assetUrls(items)) {
      try {
        const blob = await (await fetch(url)).blob();
        if (blob.size > 4 * 1024 * 1024) continue;
        assets[url] = await blobToDataUrl(blob);
      } catch { /* файл недоступен — останется ссылкой */ }
    }
    let preview: string | undefined;
    try {
      preview = await templatePreview(els.filter((e): e is HTMLElement => !!e), { x0, y0, w: x1 - x0, h: y1 - y0 });
    } catch { /* без картинки в галерее */ }
    const d = deck as Deck & { css?: string; defs?: string };
    const t: Template = {
      id: Math.random().toString(36).slice(2, 10), name, created: Date.now(),
      w: Math.round(x1 - x0), h: Math.round(y1 - y0), items,
      css: pickCss(d.css, items) || undefined, defs: pickDefs(d.defs, items) || undefined,
      assets: Object.keys(assets).length ? assets : undefined, preview,
    };
    if (!addTemplate(t)) return ed.toast('Не хватает места в хранилище браузера: удалите ненужные шаблоны', 4500, true);
    ed.toast(`Шаблон «${name}» сохранён — он в «Блоках», раздел «Мои шаблоны»`, 3000);
  }

  /** Картинка шаблона для галереи: слайд только с этими объектами, обрезанный по ним */
  async function templatePreview(els: HTMLElement[], r: { x0: number; y0: number; w: number; h: number }): Promise<string> {
    const slide = view.stage.querySelector<HTMLElement>(':scope > .slide.on');
    if (!slide || !els.length) throw new Error('нет слайда');
    const { toPng } = await import('html-to-image');
    const k = Math.min(1, 480 / Math.max(r.w, r.h * 1.8));
    const keep = new Set<Node>(els);
    const full = await toPng(slide, {
      pixelRatio: k, cacheBust: false, skipFonts: true,
      style: { transform: 'none', animation: 'none' },
      filter: (n) => n.parentElement !== slide || keep.has(n),
    });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = full; });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * k));
    c.height = Math.max(1, Math.round(r.h * k));
    c.getContext('2d')!.drawImage(img, r.x0 * k, r.y0 * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  /** Вставить шаблон: файлы копируются в эту презентацию, стили добавляются, объекты — в центр */
  async function insertTemplate(t: Template): Promise<void> {
    const i = index;
    const map = new Map<string, string>();
    const entries = Object.entries(t.assets ?? {});
    if (entries.length) ed.toast('Копирую файлы шаблона…', 0);
    for (const [url, data] of entries) {
      try {
        const blob = await (await fetch(data)).blob();
        const name = decodeURIComponent(url.split('/').pop()!.split('?')[0]);
        map.set(url, ed.mode === 'project' ? (await projectStorage.uploadAsset(deckKey, blob, name)).url : data);
      } catch { /* останется прежний адрес */ }
    }
    const shift = ((deck.slides[i].free ?? []).length % 5) * 20;
    const dx = Math.round((W - t.w) / 2) + shift;
    const dy = Math.max(0, Math.round((H - t.h) / 2)) + shift;
    const items = replaceUrls(t.items, map).map((b) => {
      const pl = placeOf(b);
      return { ...b, place: { ...pl, x: pl.x + dx, y: pl.y + dy } };
    });
    let from = 0;
    if (!ed.commit((d) => {
      deckWithTemplate(d, t);
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      from = s.free.length;
      s.free.push(...items);
    }, { rebuild: true })) return;
    ed.toast(`Вставлен шаблон «${t.name}»`, 1600);
    if (items.length === 1) ed.selectFree(i, from);
    else ed.selectMany(i, items.map((_b, k) => from + k));
  }

  /** Спросить имя и сохранить */
  function askTemplateName(): void {
    if (!selPaths().length) return ed.toast('Выделите объекты на слайде', 2000);
    const anchor = selectedEl() ?? $('st-canvas');
    const first = getAt(deck, selPaths()[0]) as Block;
    const guess = [first.title, first.text, ...(Array.isArray(first.texts) ? first.texts : [])]
      .find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    const suggestion = (guess ?? blockName(first.type)).replace(/\{[\w#-]+\|([^}]*)\}|[*_`]/g, '$1').slice(0, 40);
    askName(anchor, 'Сохранить как шаблон', 'Объекты сохранятся вместе с анимацией, стилями и картинками и появятся в «Блоках» → «Мои шаблоны».', suggestion, (name) => void makeTemplate(name));
  }

  /** Небольшое окно с названием: Enter или «Сохранить» — сохранить, Esc — отмена */
  function askName(anchor: HTMLElement, title: string, note: string, suggestion: string, save: (name: string) => void): void {
    const pop = showPopover(anchor, `<form class="st-tpl-form"><div class="st-plabel">${esc(title)}</div>
<input type="text" name="n" maxlength="60" value="${esc(suggestion)}" aria-label="Название">
<p class="st-tpl-note">${esc(note)}</p>
<div class="st-tpl-acts"><button type="button" class="btn ghost small" data-a="cancel">Отмена</button><button type="button" class="btn primary small" data-a="save">Сохранить</button></div></form>`, (b) => {
      if (b.dataset.a === 'cancel') return { run: () => {} };
      if (b.dataset.a === 'save') return { run: () => done() };
      return null;
    }, 'st-tpl-pop');
    const input = pop.querySelector<HTMLInputElement>('input')!;
    const done = () => save(input.value.trim() || suggestion);
    pop.querySelector('form')!.addEventListener('submit', (e) => { e.preventDefault(); closeMenu(); done(); });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  // ---------------- мои эффекты появления ----------------
  /** Появление выделенного объекта, если его можно сохранить как эффект */
  function selectedEntrance(): ReturnType<typeof findEntrance> {
    const sel = ed.selection;
    if (!sel || sel.group.length > 1) return null;
    // Свободный объект — целиком (с его обёрткой), блок раскладки — сам блок
    const el = sel.free ? view.stage.querySelector<HTMLElement>(`.slide.on > [data-free='${JSON.stringify(sel.free)}']`) : selectedEl();
    return el ? findEntrance(el) : null;
  }
  /**
   * Появление части слайда под курсором (правый щелчок мимо объектов): заголовок, подпись,
   * карточка встроенного шаблона. Ищется от элемента под курсором вверх до слайда.
   */
  let ctxTarget: Element | null = null;
  function targetEntrance(): { found: NonNullable<ReturnType<typeof findEntrance>>; el: HTMLElement } | null {
    const slide = view.stage.querySelector<HTMLElement>(':scope > .slide.on');
    for (let el = ctxTarget as HTMLElement | null; el && slide && el !== slide && slide.contains(el); el = el.parentElement) {
      const found = findEntrance(el);
      if (found) return { found, el };
    }
    return null;
  }
  function askEffectName(from?: { found: NonNullable<ReturnType<typeof findEntrance>>; el: HTMLElement }): void {
    const found = from?.found ?? selectedEntrance();
    if (!found) return ed.toast('У этого объекта нет появления, которое можно перенести на другие', 2500);
    const anchor = from?.el ?? selectedEl() ?? $('st-canvas');
    askName(anchor, 'Сохранить появление как эффект', 'Движение объекта появится на вкладке «Анимация» → «Мои эффекты», его можно дать любому объекту.', 'Эффект из импорта', (name) => {
      const id = `ufx-${Math.random().toString(36).slice(2, 9)}`;
      const css = found.keyframes.cssText.replace(/^@(-webkit-)?keyframes\s+[^\s{]+/, `@keyframes ${id}`);
      if (!addEffect({ id, name, css, ms: found.ms, ease: found.ease, created: Date.now() })) {
        return ed.toast('Не хватает места в хранилище браузера', 4000, true);
      }
      ed.toast(`Эффект «${name}» сохранён — вкладка «Анимация» → «Мои эффекты»`, 3000);
    });
  }
  function insertPreset(p: Preset): void {
    const i = index;
    const n = (deck.slides[i].free ?? []).length;
    const shift = (n % 5) * 20;
    const block = { ...p.make(), place: { x: Math.round((W - p.w) / 2) + shift, y: Math.round((H - (p.h ?? 160)) / 2) + shift, w: p.w, ...(p.h ? { h: p.h } : {}) } };
    let at = -1;
    if (!ed.commit((d) => {
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      s.free.push(block);
      at = s.free.length - 1;
    }, { rebuild: true, merge: `lib:${i}` })) return;
    // Высота по содержимому известна только после отрисовки: ставим блок по центру точно
    const path: Path = ['slides', i, 'free', at];
    const size = !p.h ? measure(path) : null;
    if (size) {
      const y = Math.max(0, Math.round((H - size.h) / 2) + shift);
      ed.commit((d) => setAt(d, [...path, 'place', 'y'], y), { rebuild: true, merge: `lib:${i}` });
    }
    ed.selectFree(i, at);
    // Живая вставка из галереи сразу получает заставку (миниатюры, PPTX)
    if (block.type === 'embed' || block.type === 'sandbox') void ed.embedPoster(path);
  }

  // ---------------- код ----------------
  let code: CodeView | null = null;
  let codeOpen = false;
  async function toggleCode(force?: boolean): Promise<void> {
    codeOpen = force ?? !codeOpen;
    const box = $('st-code');
    if (codeOpen && !code) {
      // Редактор кода тяжёлый: загружается при первом открытии
      const m = await import('./code');
      code = new m.CodeView(box, { deck: () => deck, index: () => index, editor: () => ed, stage: () => view.stage, deckKey });
    }
    box.hidden = !codeOpen;
    $('st-sc').hidden = !codeOpen;
    document.querySelector('.st-work')!.classList.toggle('with-code', codeOpen);
    if (codeOpen) {
      code!.update(true);
      code!.focus();
    } else {
      code?.apply();
    }
    layout();
    queueState();
  }

  // ---------------- команды ----------------
  const hasFree = () => !!ed.selection?.free;
  const multi = () => (ed.selection?.group.length ?? 0) > 1;
  const single = () => hasFree() && !multi();
  const content = () => (deck.slides[index]?.template ?? 'content') === 'content';
  const cmds: Record<string, Command> = {
    undo: { run: () => ed.undo(), enabled: () => ed.canUndo },
    redo: { run: () => ed.redo(), enabled: () => ed.canRedo },
    'slide.new': { run: () => newSlideMenu(document.querySelector<HTMLElement>('[data-cmd="slide.new"]')!) },
    'slide.dup': { run: () => ed.duplicateSlide(index) },
    'slide.del': { run: () => ed.deleteSlide(index), enabled: () => count() > 1 },
    'insert.text': { run: () => ed.addBlock('text') },
    'insert.blocks': { run: () => openLibrary() },
    'view.code': { run: () => void toggleCode(), active: () => codeOpen },
    'view.ruler': { run: () => toggleAid('ruler'), active: () => lay.ruler },
    'view.grid': { run: () => toggleAid('grid'), active: () => lay.grid },
    'view.guides': { run: () => toggleAid('guides'), active: () => lay.guides },
    'view.lite': { run: () => { lay.lite = !lay.lite; applyLayout(); queueState(); ed.toast(lay.lite ? 'Облегчённый режим: слайд без движения, редактор легче' : 'Облегчённый режим выключен', 2500); }, active: () => lay.lite },
    'view.guides-reset': { run: () => { aids!.resetGuides(); if (!lay.guides) toggleAid('guides', true); } },
    'view.grid-step': {
      run: () => showMenu(document.querySelector<HTMLElement>('.st-ribbon [data-cmd="view.grid-step"]')!, GRID_STEPS.map((st) => ({
        label: `${st} px`,
        checked: lay.step === st,
        run: () => { lay.step = st; aids!.state.step = st; aids!.apply(); applyLayout(); if (!lay.grid) toggleAid('grid', true); },
      }))),
    },
    'view.slides': { run: () => togglePanel('left'), active: () => lay.left },
    'view.props': { run: () => togglePanel('right'), active: () => lay.right },
    'insert.image': { run: () => ed.addBlock('image') },
    'obj.front': { run: () => ed.blockEditor.reorder(1), enabled: single },
    'obj.back': { run: () => ed.blockEditor.reorder(-1), enabled: single },
    'dist.h': { run: () => distribute('h'), enabled: () => (ed.selection?.group.length ?? 0) > 2 },
    'dist.v': { run: () => distribute('v'), enabled: () => (ed.selection?.group.length ?? 0) > 2 },
    'anim.sequence': { run: () => sequence(), enabled: multi },
    'obj.select-all': { run: selectAll },
    'obj.dup': { run: () => ed.blockEditor.duplicate(), enabled: hasFree },
    'obj.del': { run: () => ed.blockEditor.remove(), enabled: () => !!ed.selection },
    'obj.group': {
      run: () => { const sel = ed.selection; if (sel && sel.group.length > 1) groupObjects({ deck, stage: view.stage, editor: ed }, index, sel.group); },
      enabled: multi,
    },
    'slide.explode': { run: () => { ed.clearSelection(); explodeSlide({ deck, stage: view.stage, editor: ed }, index); }, enabled: () => canExplode(deck.slides[index]) },
    'obj.ungroup': {
      run: () => {
        const sel = ed.selection;
        if (sel) ungroup({ deck, stage: view.stage, editor: ed }, index, sel);
        // Ничего не выделено — разбирается сам слайд шаблона
        else if (canExplode(deck.slides[index])) run('slide.explode');
      },
      enabled: () => {
        const sel = ed.selection;
        if (!sel) return canExplode(deck.slides[index]);
        if (sel.group.length > 1) return false;
        const el = [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === JSON.stringify(sel.block)) ?? null;
        return canUngroup(sel.type, el);
      },
    },
    'obj.free': { run: () => ed.blockEditor.detach(), enabled: () => !!ed.selection && !hasFree() },
    'obj.lock': {
      run: () => { const on = !ed.blockEditor.isLocked; setLocked(selPaths().map((p) => Number(p[3])), on); },
      enabled: hasFree,
      active: () => hasFree() && ed.blockEditor.isLocked,
    },
    'view.layers': { run: () => toggleLayers(), active: () => lay.layers },
    'obj.attach': { run: () => ed.blockEditor.attach(), enabled: () => single() && content() },
    'obj.parent': { run: () => ed.blockEditor.selectParent(), enabled: () => !!ed.selection?.hasParent },
    'design.accent-reset': { run: () => ed.setAccent(null), enabled: () => !!deck.theme?.accent || !!deck.theme?.accent2 },
    'design.accent-flow': { run: () => ed.setAccentFlow(!deck.theme?.accentFlow), enabled: () => !!deck.theme?.accent2, active: () => !!deck.theme?.accentFlow },
    'design.accent2-off': { run: () => ed.setAccent(null, 'accent2'), enabled: () => !!deck.theme?.accent2 },
    'edit.find': { run: () => find?.show() },
    'ui.own': { run: () => { setUiAccent(uiAccent() ? null : uiColor.value); queueState(); }, active: () => !!uiAccent() },
    'design.theme': { run: () => toggleTheme() },
    'show.start': { run: () => void openShow(0) },
    'show.hide': { run: () => toggleHidden(index), active: () => deck.slides[index]?.hidden === true },
    'show.current': { run: () => void openShow(index) },
    'show.presenter': { run: () => void openShow(index, true) },
    'file.export': { run: () => exportMenu() },
    'model.snapshot': { run: () => void modelSnapshot(), enabled: () => ed.selection?.type === 'model' },
    'embed.code': { run: () => void editEmbedCode(), enabled: () => ed.selection?.type === 'embed' || ed.selection?.type === 'sandbox' },
    'embed.poster': { run: () => void embedPoster(ed.selection?.block), enabled: () => ed.selection?.type === 'embed' || ed.selection?.type === 'sandbox' },
    'image.crop': { run: () => { ed.toggleImageCrop(); syncUi(); }, enabled: () => ed.imageCrop.can, active: () => ed.imageCrop.on },
    'format.painter': { run: () => (painter ? stopPainter() : startPainter(false)), enabled: () => !!painter || singleSel(), active: () => !!painter },
    'format.copy': { run: copyFormat, enabled: singleSel },
    'obj.template': { run: askTemplateName, enabled: () => selPaths().length > 0 },
    'format.paste': { run: pasteFormat, enabled: () => !!formatClip && !!ed.selection },
    'show.preview': { run: preview },
    'view.notes': { run: () => setNotes(!notesOpen), active: () => notesOpen },
    'view.zoom-in': { run: () => stepZoom(1) },
    'view.zoom-out': { run: () => stepZoom(-1) },
    'view.fit': { run: () => setZoom('fit'), active: () => zoom === 'fit' },
    'view.zoom-menu': {
      run: () => showMenu($('st-zoom'), [
        { label: 'Вписать в окно', icon: 'fullscreen', run: () => setZoom('fit') },
        null,
        ...[0.5, 0.75, 1, 1.5, 2].map((z) => ({ label: `${Math.round(z * 100)}%`, run: () => setZoom(z) })),
      ]),
    },
  };
  const animHost: AnimHost = { deck, editor: ed, index: () => index, selPaths, sequence, preview };
  Object.assign(cmds, animCommands(animHost));
  bindDelayField(animHost);
  Object.assign(cmds, toolsCommands({ deck, deckKey, editor: ed, go }));
  Object.assign(cmds, contextCommands({ deck, editor: ed, stage: () => view.stage, run: (c) => run(c) }));
  const grips = tableGrips({ deck, editor: ed, stage: () => view.stage });
  cmds['tab.shape'] = { run: () => setTab('shape') };
  cmds['tab.anim'] = { run: () => { setTab('anim'); if (!lay.ribbon) toggleRibbon(true); } };
  cmds['tab.table'] = { run: () => setTab('table') };
  cmds['tab.image'] = { run: () => setTab('image') };
  for (const k of ['left', 'center', 'right', 'top', 'middle', 'bottom']) cmds[`align.${k}`] = { run: () => align(k), enabled: hasFree };
  SLIDE_PRESETS.forEach((_p, k) => { cmds[`slide.preset.${k}`] = { run: () => ed.addSlide(index, k) }; });

  // ---------------- палитра команд (Ctrl+K) ----------------
  const pickColor = (id: string) => () => { const inp = $<HTMLInputElement>(id); reveal('view'); inp.click(); };
  function reveal(t: string): void {
    setTab(t);
    if (!lay.ribbon) toggleRibbon(true);
  }
  const palette = new CommandPalette({
    run,
    enabled: (c) => { const x = cmds[c]; return !!x && (!x.enabled || x.enabled()); },
    active: (c) => !!cmds[c]?.active?.(),
    reveal,
    count,
    slideLabel: (i) => slideLabel(deck.slides[i], i),
    go,
    extra: () => [
      { id: 'design.theme', label: currentTheme() === 'dark' ? 'Светлая тема' : 'Тёмная тема', path: 'Верхняя строка', words: 'тема оформления ночная интерфейс', key: '', ico: icon('moon'), run: () => run('design.theme'), enabled: () => true },
      { id: 'app.home', label: 'Все презентации', path: 'Верхняя строка', words: 'открыть список главная другая', key: '', ico: icon('grid'), run: () => { location.href = './?all'; }, enabled: () => true },
      { id: 'design.accent', label: 'Акцентный цвет', path: 'Вид · Оформление', words: 'цвет презентации', key: '', ico: icon('fill'), run: pickColor('st-accent'), enabled: () => true },
      { id: 'design.accent2', label: 'Второй цвет градиента', path: 'Вид · Оформление', words: 'градиент акцент', key: '', ico: icon('fill'), run: pickColor('st-accent2'), enabled: () => true },
      { id: 'ui.color', label: 'Цвет интерфейса', path: 'Вид · Интерфейс', words: 'свой цвет программы', key: '', ico: icon('fill'), run: pickColor('st-uiac'), enabled: () => true },
      { id: 'edit.replace', label: 'Заменить', path: 'Главная · Правка', words: 'найти и заменить текст', key: 'Ctrl+H', ico: icon('search'), run: () => find?.show(true), enabled: () => true },
    ],
  }, $('st-pal'));

  function run(cmd: string): void {
    // Команда во время просмотра: просмотр заканчивается, выделение возвращается
    if (cmd !== 'show.preview') endPreview();
    const c = cmds[cmd];
    if (!c || (c.enabled && !c.enabled())) return;
    c.run();
  }

  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-top [data-cmd], .st-ribbon [data-cmd], .st-foot [data-cmd]');
    if (b) run(b.dataset.cmd!);
  });

  // ---------------- вкладки ленты ----------------
  let tab = 'home';
  function setTab(name: string): void {
    tab = name;
    document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll<HTMLElement>('.st-rpanel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    fitRibbon();
  }

  /**
   * Лента в узком окне, как в PowerPoint: группы справа налево сначала теряют подписи
   * маленьких кнопок, потом и больших — остаются значки с подсказками.
   */
  function fitRibbon(): void {
    const panel = document.querySelector<HTMLElement>('.st-rpanel:not([hidden])');
    if (!panel) return;
    const groups = [...panel.querySelectorAll<HTMLElement>('.st-rgroup')];
    groups.forEach((g) => g.classList.remove('min', 'min2'));
    const over = () => panel.scrollWidth > panel.clientWidth + 1;
    for (const level of ['min', 'min2']) {
      for (let i = groups.length - 1; i >= 0 && over(); i--) groups[i].classList.add(level);
    }
  }
  new ResizeObserver(() => fitRibbon()).observe($('st-ribbon'));
  document.querySelector('.st-tabs')!.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (t) {
      setTab(t.dataset.tab!);
      if (!lay.ribbon) toggleRibbon(true);
    }
  });
  document.querySelector('.st-tabs')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]')];
    const i = tabs.findIndex((t) => t.dataset.tab === tab);
    const next = tabs[(i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab!);
    next.focus();
  });

  // ---------------- шапка ----------------
  const title = $<HTMLInputElement>('st-title');
  title.addEventListener('change', () => {
    const v = title.value.trim();
    if (!v) { title.value = deck.title; return; }
    ed.commit((d) => { d.title = v; }, { rebuild: false, merge: 'title' });
    document.title = `${v} — Slideria`;
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') title.value = deck.title;
      title.blur();
    }
  });
  $('st-status').addEventListener('click', () => ed.retrySave());
  $('st-theme').addEventListener('click', () => toggleTheme());
  const accent = $<HTMLInputElement>('st-accent');
  // Пока тянут палитру — только показ; правка и сохранение — когда отпустили
  accent.addEventListener('input', () => ed.previewAccent(accent.value));
  accent.addEventListener('change', () => ed.setAccent(accent.value));
  accent.addEventListener('blur', () => ed.endAccentPreview());
  const accent2 = $<HTMLInputElement>('st-accent2');
  accent2.addEventListener('input', () => ed.previewAccent(accent2.value, 'accent2'));
  accent2.addEventListener('change', () => ed.setAccent(accent2.value, 'accent2'));
  accent2.addEventListener('blur', () => ed.endAccentPreview());
  // Цвет интерфейса: свой (запоминается на компьютере) или как у презентации. Выбор цвета сразу включает «Свой цвет»
  const uiColor = $<HTMLInputElement>('st-uiac');
  uiColor.value = (uiAccent() ?? '#475569').toLowerCase();
  let uiFrame = 0;
  uiColor.addEventListener('input', () => {
    if (uiFrame) return;
    uiFrame = requestAnimationFrame(() => { uiFrame = 0; setUiAccent(uiColor.value); queueState(); });
  });
  onThemeChange(() => { slides.update(); queueState(); });

  // ---------------- раскладка окна: панели тянутся, лента сворачивается ----------------
  const LAYOUT_KEY = 'htmlpptx-studio-layout';
  const DEFAULTS = { lw: 212, rw: 292, nh: 128, cw: 44, ribbon: true, left: true, right: true, ruler: false, grid: false, guides: false, step: 40, layers: false, lite: false };
  const LIMITS = { lw: [120, 380], rw: [220, 520], nh: [64, 420], cw: [22, 70] } as const;
  let lay = { ...DEFAULTS };
  try { lay = { ...lay, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }; } catch { /* раскладки ещё нет */ }
  const app = document.querySelector<HTMLElement>('.studio-app')!;
  function applyLayout(save = true): void {
    for (const k of ['lw', 'rw', 'nh', 'cw'] as const) lay[k] = Math.round(Math.max(LIMITS[k][0], Math.min(LIMITS[k][1], lay[k])));
    app.style.setProperty('--lw', `${lay.lw}px`);
    app.style.setProperty('--rw', `${lay.rw}px`);
    app.style.setProperty('--nh', `${lay.nh}px`);
    app.style.setProperty('--cw', `${lay.cw}%`);
    app.classList.toggle('ribbon-min', !lay.ribbon);
    app.classList.toggle('no-left', !lay.left);
    app.classList.toggle('no-right', !lay.right);
    $('st-slides').hidden = !lay.left;
    $('st-props').hidden = !lay.right;
    $('st-sl').hidden = !lay.left;
    $('st-sr').hidden = !lay.right;
    $('st-rt').setAttribute('aria-expanded', String(lay.ribbon));
    $('st-rt').title = lay.ribbon ? 'Свернуть ленту (Ctrl+F1)' : 'Развернуть ленту (Ctrl+F1)';
    applyLite();
    if (save) try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(lay)); } catch { /* нет доступа */ }
    layout();
  }
  /** Граница панели: тянуть мышью, стрелки ±8 px, двойной клик — как было. */
  function splitter(el: HTMLElement, key: 'lw' | 'rw' | 'nh' | 'cw', value: (e: PointerEvent) => number): void {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      app.classList.add('resizing');
      const move = (ev: PointerEvent) => { lay[key] = value(ev); applyLayout(false); };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        app.classList.remove('resizing');
        applyLayout();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => { lay[key] = DEFAULTS[key]; applyLayout(); });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -8, ArrowUp: -8, ArrowRight: 8, ArrowDown: 8 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      // Правая панель и заметки растут в обратную сторону
      lay[key] += key === 'rw' || key === 'nh' ? -d : key === 'cw' ? d / 8 : d;
      applyLayout();
    });
  }
  const bodyRect = () => $('st-body').getBoundingClientRect();
  splitter($('st-sl'), 'lw', (e) => e.clientX - bodyRect().left);
  splitter($('st-sr'), 'rw', (e) => bodyRect().right - e.clientX);
  splitter($('st-sn'), 'nh', (e) => document.querySelector('.st-main')!.getBoundingClientRect().bottom - e.clientY);
  splitter($('st-sc'), 'cw', (e) => {
    const r = document.querySelector('.st-work')!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 100;
  });
  const toggleRibbon = (on = !lay.ribbon) => { lay.ribbon = on; applyLayout(); };
  /** Скрыть или показать боковую панель: место отдаётся слайду */
  function togglePanel(side: 'left' | 'right', on = !lay[side]): void {
    lay[side] = on;
    applyLayout();
    queueState();
  }
  $('st-rt').addEventListener('click', () => toggleRibbon());

  // ---------------- закрепление и область выделения ----------------
  /** Номера закреплённых объектов слайда */
  function lockedOn(i: number): number[] {
    return ((deck.slides[i]?.free ?? []) as Block[]).map((b, k) => (b.locked === true ? k : -1)).filter((k) => k >= 0);
  }
  function setLocked(indexes: number[], on: boolean): void {
    const i = index;
    if (!indexes.length) return;
    if (ed.commit((d) => indexes.forEach((k) => {
      const b = d.slides[i].free?.[k] as Block | undefined;
      if (!b) return;
      if (on) b.locked = true;
      else delete b.locked;
    }), { rebuild: true })) {
      ed.toast(on
        ? (indexes.length > 1 ? `Закреплено объектов: ${indexes.length}` : 'Закреплено: объект не выделяется мышью. Открепить — Alt+F10')
        : (indexes.length > 1 ? `Откреплено объектов: ${indexes.length}` : 'Откреплено'), 2600);
    }
  }
  layers = new LayersPane($('st-layers'), {
    deck: () => deck, index: () => index, editor: () => ed, stage: () => view.stage,
    lock: (k, on) => setLocked(k, on),
    close: () => toggleLayers(false),
  });
  function toggleLayers(on = !lay.layers): void {
    lay.layers = on;
    $('st-layers').hidden = !on;
    applyLayout();
    layers?.update();
    queueState();
  }
  $('st-layers').hidden = !lay.layers;
  applyLayout(false);

  // ---------------- линейка, сетка, направляющие ----------------
  aids = new ViewAids({
    canvas, paper, stage: () => view.stage, deckKey,
    selected: () => selectedEl(),
    changed: () => { lay.guides = aids!.state.guides; applyLayout(); queueState(); },
  }, { ruler: lay.ruler, grid: lay.grid, guides: lay.guides, step: GRID_STEPS.includes(lay.step) ? lay.step : 40 });
  setSnapLines(() => aids!.snapLines());

  // ---------------- выделение рамкой ----------------
  setupMarquee({
    canvas,
    stage: () => view.stage,
    index: () => index,
    selected: () => selPaths().map((p) => Number(p[3])),
    select: (ks) => {
      if (!ks.length) ed.clearSelection();
      else if (ks.length === 1) ed.selectFree(index, ks[0]);
      else ed.selectMany(index, ks);
    },
    busy: () => !!painter || document.body.classList.contains('st-previewing'),
  });
  function toggleAid(k: 'ruler' | 'grid' | 'guides', on = !lay[k]): void {
    lay[k] = on;
    aids!.state[k] = on;
    aids!.apply();
    applyLayout();
    queueState();
  }

  // ---------------- заметки ----------------
  let notesOpen = true;
  try { notesOpen = localStorage.getItem(NOTES_KEY) !== '0'; } catch { /* нет доступа */ }
  function setNotes(on: boolean): void {
    notesOpen = on;
    $('st-notes').hidden = !on;
    try { localStorage.setItem(NOTES_KEY, on ? '1' : '0'); } catch { /* нет доступа */ }
    layout();
    queueState();
  }
  function syncNotes(): void {
    const n = deck.slides[index]?.notes;
    if (document.activeElement !== notesText || notesText.dataset.slide !== String(index)) notesText.value = typeof n === 'string' ? n : '';
    notesText.dataset.slide = String(index);
  }
  notesText.addEventListener('input', () => {
    const i = Number(notesText.dataset.slide);
    const v = notesText.value;
    ed.commit((d) => {
      if (v.trim()) d.slides[i].notes = v;
      else delete d.slides[i].notes;
      // Заметки просмотрели и поправили здесь — отметка «дописано на показе» снимается
      delete d.slides[i].notesEdited;
    }, { merge: `notes:${i}`, hold: true, rebuild: false });
  });
  // Набор заметок — один шаг отмены на заход в поле
  notesText.addEventListener('blur', () => ed.endMerge());
  notesText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') notesText.blur();
  });

  // ---------------- состояние интерфейса ----------------
  const inspector = new Inspector($('st-props'), {
    deck: () => deck,
    index: () => index,
    editor: () => ed,
    run,
    measure,
    stage: () => view.stage,
  });

  // ---------------- путь к выделенному ----------------
  let crumbList: Crumb[] = [];
  const selectedEl = (): HTMLElement | null => {
    const sel = ed.selection;
    if (!sel || sel.group.length > 1) return null;
    return [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === JSON.stringify(sel.block)) ?? null;
  };
  function drawCrumbs(hover: Element | null = null): void {
    const box = $('st-crumbs');
    const multi = (ed.selection?.group.length ?? 0) > 1;
    const target = hover ?? selectedEl();
    crumbList = crumbs(target, `Слайд ${index + 1}`);
    if (!hover && multi) crumbList.push({ label: `Выделено: ${ed.selection!.group.length}` });
    box.classList.toggle('hover', !!hover);
    box.innerHTML = crumbList.map((c, k) => {
      const last = k === crumbList.length - 1;
      const btn = !hover && (c.el || c.field || k === 0) && !last;
      return (k ? '<i aria-hidden="true">›</i>' : '') + (btn ? `<button type="button" data-k="${k}">${esc(c.label)}</button>` : `<span${last ? ' class="cur"' : ''}>${esc(c.label)}</span>`);
    }).join('');
  }
  $('st-crumbs').addEventListener('click', (e) => {
    const k = (e.target as Element).closest<HTMLElement>('[data-k]')?.dataset.k;
    if (k === undefined) return;
    const c = crumbList[Number(k)];
    if (c.el) ed.selectBlock(c.el);
    else if (c.field) ed.editField(c.field);
    else ed.clearSelection();
  });
  // «Отменить» и «Повторить»: в подсказке — какое действие отменится или вернётся
  document.addEventListener('mouseover', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-rb[data-cmd="undo"], .st-rb[data-cmd="redo"]');
    if (!b || b.contains(e.relatedTarget as Node)) return;
    const undo = b.dataset.cmd === 'undo';
    const what = ed.stepLabel(undo ? 'past' : 'future');
    b.title = `${undo ? 'Отменить' : 'Повторить'}${what ? `: ${what}` : ''} (${undo ? 'Ctrl+Z' : 'Ctrl+Y'})`;
  });
  view.stage.addEventListener('mouseover', (e) => drawCrumbs((e.target as Element).closest('.slide') ? e.target as Element : null));
  view.stage.addEventListener('mouseleave', () => drawCrumbs());

  /** Контекстная вкладка ленты: появляется с выделением фигуры или таблицы и сразу открывается. */
  let ctxTab: ContextTab | null = null;
  let ctxKey = '';
  function syncContextTab(): void {
    const next = contextTab(deck, ed);
    document.querySelectorAll<HTMLElement>('.st-tabs .ctx').forEach((t) => { t.hidden = t.dataset.tab !== next; });
    // Вкладка открывается, когда выделили другой объект, — и не мешает, пока правят тот же
    const sel = ed.selection;
    const key = next && sel ? JSON.stringify(sel.group.length > 1 ? sel.group : sel.block) : '';
    if (next !== ctxTab || key !== ctxKey) {
      if (next) setTab(next);
      else if (tab === 'shape' || tab === 'table' || tab === 'image') setTab('home');
      ctxTab = next;
      ctxKey = key;
    }
  }

  function syncUi(): void {
    find?.refresh();
    // Образцы цветов в панелях — в цветах открытого слайда (у него могут быть свои)
    const own = slideAccent(deck.slides[index]?.theme);
    const root = document.querySelector('.studio-app');
    if (own) root?.setAttribute('data-accent', own);
    else root?.removeAttribute('data-accent');
    syncContextTab();
    syncSwatches(deck, ed);
    syncAnimTab(animHost);
    aids?.redraw();
    grips.sync();
    code?.syncSelection();
    layers?.update();
    document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
      const c = cmds[b.dataset.cmd!];
      if (!c) return;
      b.disabled = !!c.enabled && !c.enabled();
      if (c.active) b.classList.toggle('active', c.active());
    });
    const st = ed.statusInfo;
    const status = $('st-status');
    status.textContent = st.text;
    status.className = `st-status ${st.cls}`;
    if (document.activeElement !== title) title.value = deck.title ?? '';
    const a = deck.theme?.accent;
    const av = typeof a === 'string' && HEX_RE.test(a) ? a : DEFAULT_ACCENT;
    if (document.activeElement !== accent && HEX_RE.test(av)) accent.value = av.toLowerCase();
    const a2 = deck.theme?.accent2;
    const a2v = typeof a2 === 'string' && HEX_RE.test(a2) ? a2 : av;
    if (document.activeElement !== accent2 && HEX_RE.test(a2v)) accent2.value = a2v.toLowerCase();
    accent2.closest('label')!.classList.toggle('on', !!a2);
    $('st-pos').textContent = `Слайд ${index + 1} из ${count()} · ${slideLabel(deck.slides[index], index)}`;
    syncNotes();
    inspector.sync();
    drawCrumbs();
  }

  // ---------------- мышь на холсте ----------------
  canvas.addEventListener('scroll', () => ed.reposition(), { passive: true });
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  // Клик по серому полю вокруг слайда снимает выделение
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target === canvas || e.target === paper) ed.clearSelection();
  });
  canvas.addEventListener('contextmenu', (e) => {
    if ((e.target as Element).closest('[contenteditable="true"]')) return;
    e.preventDefault();
    ctxTarget = e.target as Element;
    const freeHost = (e.target as Element).closest('[data-free]');
    const path = freeHost ? readPath(freeHost, 'data-free') : null;
    // Правый клик по объекту из выделенной группы не сбрасывает группу
    const inSel = path && (ed.selection?.group ?? []).some((p) => JSON.stringify(p) === JSON.stringify(path));
    if (path && !inSel) ed.selectFree(Number(path[1]), Number(path[3]));
    // Правый щелчок по ячейке таблицы: сначала строки и столбцы этой ячейки, как в PowerPoint
    const tbl = (e.target as Element).closest<HTMLElement>('td[data-edit], th[data-edit]')?.closest<HTMLElement>('[data-type="table"][data-block]');
    if (tbl && !freeHost) ed.selectBlock(tbl);
    const table = tbl ? tableMenu() : [];
    showMenu({ x: e.clientX, y: e.clientY }, freeHost || ed.selection ? [...table, ...(table.length ? [null] : []), ...objectMenu()] : slideMenu(index));
    ctxTarget = null;
  });
  new ResizeObserver(() => { if (zoom === 'fit') layout(); else ed.reposition(); }).observe(canvas);

  // ---------------- найти и заменить ----------------
  find = new FindBar({
    deck: () => deck, editor: () => ed, index: () => index, go, stage: () => view.stage,
    showNotes: () => { if (!notesOpen) setNotes(true); },
  }, document.querySelector<HTMLElement>('.st-view')!);

  // ---------------- клавиатура ----------------
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    const typing = el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '');
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // Ctrl+K — палитра команд (при правке текста Ctrl+K — ссылка: его перехватывает сам текст)
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
      e.preventDefault();
      return palette.focus();
    }
    // Ctrl+F — найти, Ctrl+H — найти и заменить по всей презентации (вместо поиска браузера)
    if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyF' || e.code === 'KeyH')) {
      e.preventDefault();
      return find?.show(e.code === 'KeyH');
    }
    if (painter && e.key === 'Escape') {
      e.preventDefault();
      return stopPainter();
    }
    if (mod && e.shiftKey && !typing && (e.code === 'KeyC' || e.code === 'KeyV')) {
      e.preventDefault();
      return run(e.code === 'KeyC' ? 'format.copy' : 'format.paste');
    }
    if (document.body.classList.contains('st-previewing') && e.key === 'Escape') {
      e.preventDefault();
      return endPreview();
    }
    if (mod && (k === 's' || k === 'ы')) {
      e.preventDefault();
      void ed.save();
      return;
    }
    if (mod && (e.key === '`' || e.key === 'ё' || e.code === 'Backquote')) {
      e.preventDefault();
      return void toggleCode();
    }
    // Ctrl+Shift+1/2/3 — скрыть или показать слайды, свойства, заметки
    if (mod && e.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      e.preventDefault();
      if (e.code === 'Digit1') return togglePanel('left');
      if (e.code === 'Digit2') return togglePanel('right');
      return setNotes(!notesOpen);
    }
    // Как в PowerPoint: Shift+F9 — сетка, Alt+F9 — направляющие
    if (e.key === 'F9' && (e.shiftKey || e.altKey) && !mod) {
      e.preventDefault();
      return toggleAid(e.shiftKey ? 'grid' : 'guides');
    }
    // Как в PowerPoint: Alt+F10 — область выделения
    if (e.key === 'F10' && e.altKey && !mod) {
      e.preventDefault();
      return toggleLayers();
    }
    if (mod && e.key === 'F1') {
      e.preventDefault();
      return toggleRibbon();
    }
    if (e.key === 'F5') {
      e.preventDefault();
      return run(e.altKey ? 'show.presenter' : e.shiftKey ? 'show.current' : 'show.start');
    }
    if (typing) return;
    if (ed.handleKey(e)) return;
    if (mod && (k === 'g' || k === 'п')) {
      e.preventDefault();
      return run(e.shiftKey ? 'obj.ungroup' : 'obj.group');
    }
    if (mod && !e.shiftKey && (k === 'a' || k === 'ф')) {
      e.preventDefault();
      return selectAll();
    }
    if (mod && !e.shiftKey && (k === 'm' || k === 'ь')) {
      e.preventDefault();
      return ed.addSlide(index, 0);
    }
    if (mod && (k === 'd' || k === 'в') && !ed.selection) {
      e.preventDefault();
      return ed.duplicateSlide(index);
    }
    if (mod || e.altKey) return;
    if (ed.selection) return;
    const nav: Record<string, () => void> = {
      PageDown: () => go(index + 1), ArrowDown: () => go(index + 1), ArrowRight: () => go(index + 1),
      PageUp: () => go(index - 1), ArrowUp: () => go(index - 1), ArrowLeft: () => go(index - 1),
      Home: () => go(0), End: () => go(count() - 1),
    };
    const letters: Record<string, () => void> = { t: () => toggleTheme(), 'е': () => toggleTheme() };
    const fn = nav[e.key] ?? letters[k];
    if (fn) {
      e.preventDefault();
      closeMenu();
      closeLibrary();
      fn();
    }
  });
  addEventListener('hashchange', () => go(hashIndex()));

  // ---------------- старт ----------------
  ed.toggle(true);
  setNotes(notesOpen);
  slides.update();
  history.replaceState(null, '', `#${index + 1}`);
  syncUi();
  requestAnimationFrame(layout);
  document.fonts?.ready.then(() => layout());
}

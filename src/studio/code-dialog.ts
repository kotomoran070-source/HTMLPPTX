import { icon } from '../components/icons';
import { withTheme } from '../components/html/html';
import { esc } from '../engine/html';

/**
 * Редактор кода живой вставки: слева HTML/CSS/JS, справа — он же в работе.
 * Предпросмотр — та же изолированная рамка, что на слайде (только скрипты, без доступа к студии).
 * Ctrl+Enter — применить, Esc — закрыть, Tab — отступ.
 */
export interface CodeDialog {
  title: string;
  code: string;
  /** Цвета темы внутри вставки: предпросмотр — с ними же */
  theme: boolean;
  /** Применить: код уходит в слайд */
  apply(code: string): void;
  /** Своё превью вместо рамки: разметка по коду (диаграмма из текста), со стилями студии */
  render?(code: string): string;
  /** Переменные темы для превью (style), подсказка в шапке, шпаргалка под текстом */
  vars?: string;
  about?: string;
  cheat?: string;
}

export function openCodeDialog(o: CodeDialog): void {
  const box = document.createElement('div');
  box.className = 'st-cd-bd';
  box.innerHTML = `<div class="st-cd" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
  <header class="st-cd-top">${icon(o.render ? 'mindmap' : 'terminal')}<b>${esc(o.title)}</b><span>${esc(o.about ?? 'HTML, CSS и JavaScript работают в изолированной рамке. Цвета темы — var(--ac), var(--ac2), var(--tx)…')}</span></header>
  <div class="st-cd-body">
    <div class="st-cd-left"><textarea class="st-cd-src" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="${o.render ? 'soft' : 'off'}" aria-label="Код"></textarea>${o.cheat ? `<div class="st-cd-cheat">${o.cheat}</div>` : ''}</div>
    <div class="st-cd-prev">${o.render ? `<div class="st-cd-live"${o.vars ? ` style="${esc(o.vars)}"` : ''}></div>` : '<iframe sandbox="allow-scripts" title="Предпросмотр"></iframe>'}<small>Предпросмотр</small></div>
  </div>
  <footer class="st-cd-bot">
    ${o.render ? '' : `<button type="button" class="btn ghost" data-a="file">${icon('upload')}Из файла…</button>`}
    <span class="st-cd-hint">Ctrl+Enter — применить</span>
    <button type="button" class="btn ghost" data-a="cancel">Отмена</button>
    <button type="button" class="btn primary" data-a="ok">Применить</button>
  </footer>
</div>`;
  document.body.append(box);
  const src = box.querySelector<HTMLTextAreaElement>('.st-cd-src')!;
  const frame = box.querySelector<HTMLIFrameElement>('iframe');
  const live = box.querySelector<HTMLElement>('.st-cd-live');
  src.value = o.code;

  let timer = 0;
  const run = () => {
    if (live && o.render) live.innerHTML = o.render(src.value);
    else if (frame) frame.srcdoc = o.theme ? withTheme(src.value) : src.value;
  };
  run();
  src.addEventListener('input', () => {
    clearTimeout(timer);
    // Своё превью — почти сразу: рисуется без рамки и скриптов
    timer = window.setTimeout(run, live ? 150 : 500);
  });

  const close = () => {
    clearTimeout(timer);
    removeEventListener('keydown', onKey, true);
    box.remove();
  };
  const ok = () => {
    const code = src.value;
    close();
    o.apply(code);
  };
  const onKey = (e: KeyboardEvent) => {
    // Клавиши студии (Delete, стрелки, Ctrl+Z) в окне не срабатывают
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); }
    else if (e.key === 'Tab' && e.target === src && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  };
  addEventListener('keydown', onKey, true);

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.html,.htm,text/html';
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    src.value = await f.text();
    run();
  };
  box.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'ok') ok();
    else if (a === 'cancel') close();
    else if (a === 'file') file.click();
    // Щелчок мимо окна закрывает его, только если код не меняли: правки случайно не теряются
    else if (e.target === box && src.value === o.code) close();
  });
  src.focus();
  src.setSelectionRange(0, 0);
}

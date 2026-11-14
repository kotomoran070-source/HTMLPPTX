import { icon } from '../components/icons';
import { withTheme } from '../components/html/html';
import { esc } from '../engine/html';
import { leave } from '../engine/motion';
import type { HtmlEditor } from './code-editor';

/**
 * Редактор кода живой вставки: слева HTML/CSS/JS, справа — он же в работе.
 * Предпросмотр — та же изолированная рамка, что на слайде (только скрипты, без доступа к студии).
 * Код вставки — в редакторе кода, как «Код слайда» (code-editor.ts): подсветка, поиск и замена (Ctrl+F, Ctrl+H);
 * текст для своего превью (диаграмма, тест из текста) — в простом поле.
 * Ctrl+Enter — применить, Esc — закрыть (сначала — поиск, если открыт), Tab — отступ.
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
  /** Подпись главной кнопки (без неё — «Применить») */
  okLabel?: string;
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
    <span class="st-cd-hint">Ctrl+Enter — ${esc((o.okLabel ?? 'Применить').toLowerCase())}</span>
    <button type="button" class="btn ghost" data-a="cancel">Отмена</button>
    <button type="button" class="btn primary" data-a="ok">${esc(o.okLabel ?? 'Применить')}</button>
  </footer>
</div>`;
  document.body.append(box);
  const src = box.querySelector<HTMLTextAreaElement>('.st-cd-src')!;
  const frame = box.querySelector<HTMLIFrameElement>('iframe');
  const live = box.querySelector<HTMLElement>('.st-cd-live');
  src.value = o.code;
  /** Редактор кода — когда загрузится; до того (и для текста своего превью) — простое поле */
  let cm: HtmlEditor | null = null;
  let closed = false;
  const get = () => cm?.value() ?? src.value;
  const set = (v: string) => { if (cm) cm.set(v); else src.value = v; };

  let timer = 0;
  const run = () => {
    if (live && o.render) live.innerHTML = o.render(get());
    else if (frame) frame.srcdoc = o.theme ? withTheme(get()) : get();
  };
  run();
  const changed = () => {
    clearTimeout(timer);
    // Своё превью — почти сразу: рисуется без рамки и скриптов
    timer = window.setTimeout(run, live ? 150 : 500);
  };
  src.addEventListener('input', changed);
  if (!o.render) {
    void import('./code-editor').then(({ htmlEditor }) => {
      if (closed) return;
      const host = document.createElement('div');
      host.className = 'st-cd-cm';
      src.replaceWith(host);
      cm = htmlEditor(host, { doc: src.value, label: 'Код', change: changed, submit: () => ok() });
      cm.focus();
    });
  }

  const close = () => {
    closed = true;
    clearTimeout(timer);
    removeEventListener('keydown', onKey, true);
    // Редактор — после того как окно погаснет
    const ed = cm;
    if (ed) setTimeout(() => ed.destroy(), 400);
    // Окно гаснет, подложка растворяется (engine/motion.ts)
    leave(box, { box: '.st-cd' });
  };
  const ok = () => {
    if (closed) return;
    const code = get();
    close();
    o.apply(code);
  };
  // Клавиши студии (Delete, стрелки, Ctrl+Z, Ctrl+F) в окне не срабатывают. Внутри окна клавиши сначала получает
  // редактор кода (поиск, отступы, Esc — закрыть поиск), потом окно; вне окна — сразу окно
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); }
    else if (e.key === 'Tab' && e.target === src && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  };
  const onKey = (e: KeyboardEvent) => { if (!box.contains(e.target as Node)) keys(e); };
  box.addEventListener('keydown', keys);
  addEventListener('keydown', onKey, true);

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.html,.htm,text/html';
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    set(await f.text());
    run();
  };
  box.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'ok') ok();
    else if (a === 'cancel') close();
    else if (a === 'file') file.click();
    // Щелчок мимо окна закрывает его, только если код не меняли: правки случайно не теряются
    else if (e.target === box && get() === o.code) close();
  });
  src.focus();
  src.setSelectionRange(0, 0);
}

import { defineBlock } from '../../engine/component';
import { esc, styleAttr } from '../../engine/html';
import { icon } from '../icons';
import { withTheme } from '../html/html';
import type { Block } from '../../types';
import { highlight } from './highlight';
import './sandbox.css';

export interface SandboxProps extends Block {
  /** Код: HTML-документ с CSS и JavaScript */
  code?: string;
  /** Имя в заголовке редактора */
  title?: string;
  /** Цвета темы внутри результата: var(--ac), var(--ac2)… */
  theme?: boolean;
  /** Кегль кода, px (по умолчанию 15) */
  size?: number;
  /** Доля редактора по ширине, % (по умолчанию 56) */
  split?: number;
  /** Консоль под результатом: console.log и ошибки (по умолчанию есть) */
  console?: boolean;
  /** Заставка результата: для миниатюр, PPTX и PDF */
  poster?: string;
}

/** Код изменили в одном окне показа — второе повторяет (см. show.ts, presenter.ts) */
export const CODE_EVENT = 'slideria:code';
export const SET_CODE_EVENT = 'slideria:set-code';

const lineNumbers = (code: string) => Array.from({ length: code.split('\n').length }, (_x, i) => i + 1).join('\n');

/**
 * Мост консоли: console.log, предупреждения и ошибки документа уходят в консоль песочницы.
 * Одной строкой перед кодом — номера строк в ошибках совпадают с редактором.
 */
const bridge = (token: string) => `<script>(function(){var T=${JSON.stringify(token)};function s(k,a){try{parent.postMessage({sbx:T,k:k,t:Array.prototype.map.call(a,function(x){if(typeof x==='string')return x;try{return JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}}['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){s(k,arguments);return o.apply(console,arguments)}});addEventListener('error',function(e){s('error',[e.message+(e.lineno?' — строка '+e.lineno:'')])});addEventListener('unhandledrejection',function(e){s('error',[String(e.reason)])})})()</script>`;

/**
 * Песочница: редактор кода и результат рядом. При показе код можно править прямо на слайде —
 * результат обновляется на лету, console.log виден в консоли. Правки при показе не сохраняются
 * в презентацию («↺» возвращает исходный код); окна показа и докладчика видят одно и то же.
 * Код работает в изолированной рамке — без доступа к презентации и файлам.
 */
defineBlock<SandboxProps>('sandbox', {
  render(p) {
    const code = typeof p.code === 'string' ? p.code : '';
    const size = Number(p.size) > 0 ? Math.min(40, Math.max(9, Number(p.size))) : 15;
    const split = Number(p.split) > 0 ? Math.min(80, Math.max(20, Number(p.split))) : 56;
    const out = p.poster
      ? `<img class="sbx-poster" src="${esc(p.poster)}" alt="">`
      : `<div class="sbx-ph">${icon('play')}<span>Результат — при показе</span></div>`;
    return `<div class="sbx"${styleAttr(`--sbx-fs:${size}px;--sbx-split:${split}%`, p.style)}>`
      + `<div class="sbx-code"><div class="sbx-bar"><span class="sbx-dots"><i></i><i></i><i></i></span><b>${esc(p.title ?? 'index.html')}</b>`
      + `<span class="sbx-tools"><button type="button" data-sbx="smaller" title="Мельче" aria-label="Мельче">A−</button><button type="button" data-sbx="bigger" title="Крупнее" aria-label="Крупнее">A+</button>`
      + `<button type="button" data-sbx="reset" title="Вернуть исходный код" aria-label="Вернуть исходный код">${icon('reset')}</button>`
      + `<button type="button" class="sbx-run" data-sbx="run" title="Запустить (Ctrl+Enter)">${icon('play')}<span>Запустить</span></button></span></div>`
      + `<div class="sbx-ed"><pre class="sbx-gut" aria-hidden="true">${lineNumbers(code)}</pre><div class="sbx-scroll"><pre class="sbx-hl"><code>${highlight(code)}\n</code></pre></div></div></div>`
      + `<div class="sbx-res"><div class="sbx-bar"><b>Результат</b><span class="sbx-live"><i></i>live</span></div>`
      + `<div class="sbx-out">${out}</div>`
      + (p.console === false ? '' : `<div class="sbx-con" aria-live="polite"><span class="sbx-con-ph">console.log(…) — здесь</span></div>`)
      + `</div></div>`;
  },
  mount(el, p, ctx) {
    // Корень блока — сама песочница
    const ed = el.querySelector<HTMLElement>('.sbx-ed');
    const scroll = el.querySelector<HTMLElement>('.sbx-scroll');
    const hl = el.querySelector<HTMLElement>('.sbx-hl code');
    const gut = el.querySelector<HTMLElement>('.sbx-gut');
    const out = el.querySelector<HTMLElement>('.sbx-out');
    const con = el.querySelector<HTMLElement>('.sbx-con');
    const box = el;
    if (!ed || !scroll || !hl || !gut || !out) return;
    const original = typeof p.code === 'string' ? p.code : '';

    // Поле ввода поверх подсветки: текст прозрачный, виден курсор и выделение
    const ta = document.createElement('textarea');
    ta.className = 'sbx-in';
    ta.spellcheck = false;
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('aria-label', 'Код песочницы');
    ta.value = original;
    scroll.append(ta);

    const paint = () => {
      hl.innerHTML = `${highlight(ta.value)}\n`;
      gut.textContent = lineNumbers(ta.value);
    };
    const follow = () => {
      hl.parentElement!.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      gut.style.transform = `translateY(${-ta.scrollTop}px)`;
    };
    ta.addEventListener('scroll', follow);

    // ---- результат ----
    let frame: HTMLIFrameElement | null = null;
    let token = '';
    let lines = 0;
    const log = (k: string, t: string) => {
      if (!con) return;
      if (!lines) con.textContent = '';
      lines++;
      const row = document.createElement('div');
      row.className = `sbx-ln ${k}`;
      row.textContent = t;
      con.append(row);
      // Последние строки: консоль не растёт бесконечно
      while (con.childElementCount > 60) con.firstElementChild!.remove();
      con.scrollTop = con.scrollHeight;
    };
    const run = () => {
      clearTimeout(timer);
      frame?.remove();
      token = Math.random().toString(36).slice(2);
      lines = 0;
      if (con) con.innerHTML = '<span class="sbx-con-ph">console.log(…) — здесь</span>';
      const f = document.createElement('iframe');
      f.className = 'sbx-frame';
      // Только скрипты: без доступа к странице показа, формам и переходам
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('title', 'Результат');
      f.srcdoc = bridge(token) + (p.theme ? withTheme(ta.value) : ta.value);
      f.addEventListener('load', () => f.classList.add('on'), { once: true });
      out.append(f);
      frame = f;
      box.classList.add('running');
    };
    const onMsg = (e: MessageEvent) => {
      if (!frame || e.source !== frame.contentWindow || e.data?.sbx !== token) return;
      log(String(e.data.k), String(e.data.t));
    };
    addEventListener('message', onMsg);

    // Правка: подсветка сразу, запуск — когда пауза в наборе; второе окно показа получает код
    let timer = 0;
    let sendTimer = 0;
    const changed = (share: boolean) => {
      paint();
      clearTimeout(timer);
      timer = window.setTimeout(run, 700);
      box.classList.toggle('edited', ta.value !== original);
      if (!share) return;
      clearTimeout(sendTimer);
      sendTimer = window.setTimeout(() => el.dispatchEvent(new CustomEvent(CODE_EVENT, { bubbles: true, detail: { code: ta.value } })), 150);
    };
    ta.addEventListener('input', () => changed(true));

    // Клавиши кода не листают слайды и не включают инструменты показа
    const insert = (s: string) => document.execCommand('insertText', false, s);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); insert('  '); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        // Новая строка с тем же отступом
        e.preventDefault();
        const before = ta.value.slice(0, ta.selectionStart);
        insert(`\n${/[^\n]*$/.exec(before)![0].match(/^[ \t]*/)![0]}`);
      }
    });
    ['keyup', 'keypress'].forEach((t) => ta.addEventListener(t, (e) => e.stopPropagation()));

    // ---- кнопки ----
    let fs = parseFloat(getComputedStyle(box).getPropertyValue('--sbx-fs')) || 15;
    const onClick = (e: Event) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-sbx]')?.dataset.sbx;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (a === 'run') run();
      else if (a === 'reset') {
        ta.value = original;
        changed(true);
        run();
      } else {
        fs = Math.min(32, Math.max(10, fs + (a === 'bigger' ? 1 : -1)));
        box.style.setProperty('--sbx-fs', `${fs}px`);
      }
    };
    box.addEventListener('click', onClick);

    // Код из второго окна показа (докладчик ↔ зал)
    const onSet = (e: Event) => {
      const code = (e as CustomEvent<{ code: string }>).detail?.code;
      if (typeof code !== 'string' || code === ta.value) return;
      const at = ta.selectionStart;
      ta.value = code;
      ta.setSelectionRange(Math.min(at, code.length), Math.min(at, code.length));
      changed(false);
    };
    el.addEventListener(SET_CODE_EVENT, onSet);

    // Результат работает, только пока слайд открыт и сцена не на паузе (экономный режим пульта)
    let offTimer = 0;
    const sync = () => {
      if (ctx.slide.classList.contains('on') && !ctx.stage.classList.contains('paused')) {
        clearTimeout(offTimer);
        if (!frame) run();
      } else {
        clearTimeout(offTimer);
        offTimer = window.setTimeout(() => { frame?.remove(); frame = null; box.classList.remove('running'); }, 800);
      }
    };
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    mo.observe(ctx.stage, { attributes: true, attributeFilter: ['class'] });
    sync();

    return () => {
      mo.disconnect();
      clearTimeout(timer);
      clearTimeout(sendTimer);
      clearTimeout(offTimer);
      removeEventListener('message', onMsg);
      box.removeEventListener('click', onClick);
      el.removeEventListener(SET_CODE_EVENT, onSet);
      frame?.remove();
      ta.remove();
    };
  },
});

import { esc } from './html';
import './import-ui.css';

/** Ответ /__htmlpptx/import (см. plugins/import.ts) */
interface ImportResult {
  name: string;
  source: 'htmlpptx' | 'design' | 'html' | 'live';
  theme?: ThemeReport;
  warnings: string[];
  mode: 'create' | 'merge' | 'replace';
  changed: boolean;
  slides: number;
  added: string[];
  removed: string[];
  edited: string[];
  other: string[];
  conflicts: { path: string; kind: 'both-changed' | 'deleted-in-file' | 'deleted-in-project' }[];
  newAssets: string[];
  backup?: string;
}

/** Привязка цветов к теме (plugins/theme-bind.ts) */
export interface ThemeReport {
  bound: number;
  kept: Record<string, number>;
  darkSlides: number[];
  accent?: string;
}

export interface ImportUiOptions {
  /** Открытая сейчас презентация (на странице показа) */
  current?: string;
  /** Записать несохранённые правки редактора до импорта */
  beforeImport?: () => Promise<void> | void;
}

const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/i;

interface Req { html: string; raw: string; file: string; deck?: string; dry: boolean; theme: boolean; live: boolean }

async function request(o: Req): Promise<ImportResult> {
  const q = new URLSearchParams({ file: o.file });
  if (o.deck) q.set('deck', o.deck);
  if (o.dry) q.set('dry', '1');
  if (!o.theme) q.set('theme', '0');
  if (o.live) q.set('live', '1');
  // Снимок после скриптов и исходный файл (он нужен живым слайдам) — вместе
  const json = o.html !== o.raw;
  let res: Response;
  try {
    res = await fetch(`/__htmlpptx/import?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': json ? 'application/json' : 'text/html' },
      body: json ? JSON.stringify({ html: o.html, raw: o.raw }) : o.html,
    });
  } catch {
    throw new Error('нет связи с yarn dev — сервер остановлен?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
  return data as ImportResult;
}

/** HTML со скриптами (кроме сборки проекта и экспорта Claude Design): снимок после их работы. */
function needsSnapshot(html: string): boolean {
  return /<script\b/i.test(html) && !/id="htmlpptx-deck"/.test(html) && !/class="deck-slide"/.test(html);
}

/**
 * Открывает файл в изолированной рамке (только скрипты, без доступа к странице), ждёт,
 * пока скрипты нарисуют слайды, и возвращает получившуюся разметку. Холсты (canvas)
 * превращаются в картинки. null — не получилось (тогда импортируется исходный файл).
 */
export function snapshot(html: string, size = { w: 1440, h: 900 }): Promise<string | null> {
  const token = Math.random().toString(36).slice(2);
  const probe = `<script>(function(){function shot(){try{document.querySelectorAll('script').forEach(function(s){s.remove()});document.querySelectorAll('canvas').forEach(function(c){try{var i=document.createElement('img');i.src=c.toDataURL('image/png');i.setAttribute('style',c.getAttribute('style')||'');i.className=c.className;if(c.width)i.width=c.width;if(c.height)i.height=c.height;c.replaceWith(i)}catch(e){}});`
    + `parent.postMessage({htmlpptxSnapshot:${JSON.stringify(token)},html:'<!doctype html>'+document.documentElement.outerHTML},'*')}catch(e){parent.postMessage({htmlpptxSnapshot:${JSON.stringify(token)},html:null},'*')}}`
    + `if(document.readyState==='complete')setTimeout(shot,1500);else addEventListener('load',function(){setTimeout(shot,1500)})})()<\/script>`;
  const doc = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${probe}</body>`) : html + probe;
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = `position:fixed;left:-20000px;top:0;width:${size.w}px;height:${size.h}px;border:0;visibility:hidden`;
    const done = (v: string | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMsg);
      f.remove();
      resolve(v);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || e.data?.htmlpptxSnapshot !== token) return;
      done(typeof e.data.html === 'string' ? e.data.html : null);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    addEventListener('message', onMsg);
    f.srcdoc = doc;
    document.body.appendChild(f);
  });
}

const isHtml = (f: File) => /\.html?$/i.test(f.name) || f.type === 'text/html';

/** Перетаскивают файл, похожий на HTML (имя при dragover недоступно, только тип). */
function draggingHtml(e: DragEvent): boolean {
  const items = e.dataTransfer?.items;
  if (!items) return false;
  return [...items].some((i) => i.kind === 'file' && i.type === 'text/html');
}

function list(title: string, items: string[]): string {
  return items.length ? `<div class="imp-row"><b>${esc(title)}</b><span>${items.map(esc).join(', ')}</span></div>` : '';
}

/** Как filesSummary() в plugins/import.ts */
function files_(list: string[]): string {
  if (list.length <= 6) return list.map((f) => f.replace('./assets/', '')).join(', ');
  const embeds = list.filter((f) => f.endsWith('.htm')).length;
  const images = list.length - embeds;
  return [images && `картинок: ${images}`, embeds && `живых вставок: ${embeds}`].filter(Boolean).join(', ');
}

/** Отчёт о привязке цветов: сколько привязано, какие остались своими. */
export function themeHtml(t: ThemeReport): string {
  const kept = Object.entries(t.kept).sort((a, b) => b[1] - a[1]);
  const sw = (c: string, n: number) => `<span class="imp-sw" title="${c}: ${n}"><i style="background:${c}"></i>${c}</span>`;
  let s = list('Цвета → тема', [t.bound || kept.length
    ? `привязано: ${t.bound}`
    : 'все цвета уже заданы через тему']);
  if (t.accent) s += list('Акцент макета', [`${t.accent} — записан в theme.accent`]);
  if (kept.length) {
    s += `<div class="imp-row"><b>Остаются своими</b><span>${kept.slice(0, 12).map(([c, n]) => sw(c, n)).join(' ')}${kept.length > 12 ? ' …' : ''}`
      + `<br><small class="mu">Не меняются в тёмной теме.</small></span></div>`;
  }
  if (t.darkSlides.length) s += list('Тёмные слайды', [`${t.darkSlides.join(', ')} — остаются тёмными в обеих темах`]);
  return s;
}

function warningsHtml(w: string[]): string {
  if (!w.length) return '';
  const shown = w.slice(0, 12);
  return `<div class="imp-conf"><b>Стоит поправить в исходном файле:</b><ul>${shown.map((x) => `<li>${esc(x)}</li>`).join('')}`
    + `${w.length > shown.length ? `<li>…и ещё ${w.length - shown.length}</li>` : ''}</ul></div>`;
}

function summary(r: ImportResult): string {
  const where = `presentations/${esc(r.name)}/deck.yaml`;
  const files = files_(r.newAssets);
  if (r.mode === 'create') {
    const from = r.source === 'design' ? ' из экспорта Claude Design' : r.source === 'html' ? ' из HTML' : r.source === 'live' ? ', живыми слайдами' : '';
    return `<p>Будет создана новая презентация <code>${where}</code>${from}: ${r.slides} слайдов.</p>`
      + (r.source === 'design' ? '<p class="mu">Элементы слайдов станут свободными объектами.</p>' : '')
      + (r.source === 'html' ? '' : '')
      + (files ? list('Файлы в assets/', [files]) : '')
      + (r.theme ? themeHtml(r.theme) : '')
      + warningsHtml(r.warnings);
  }
  if (!r.changed) return `<p>Изменений нет: <code>${where}</code> уже содержит все правки из файла.</p>`;
  let s = `<p>Правки из файла будут перенесены в <code>${where}</code>${r.mode === 'merge' ? '. Изменения в проекте после сборки сохранятся.' : '.'}</p>`;
  if (r.mode === 'replace') {
    s += r.source === 'design'
      ? '<p class="imp-warn">Презентация с таким именем будет заменена. Чтобы сохранить обе, укажите другое имя.</p>'
      : '<p class="imp-warn">Данные проекта будут полностью заменены данными файла.</p>';
  }
  s += list('Изменены', r.edited) + list('Добавлены', r.added) + list('Удалены', r.removed) + list('Также', r.other)
    + (files ? list('Новые файлы', [files]) : '');
  if (r.conflicts.length) {
    const why = { 'both-changed': '', 'deleted-in-file': ' — в файле удалено, в проекте изменено: оставлено', 'deleted-in-project': ' — в проекте удалено, в файле изменено: восстановлено' };
    s += `<div class="imp-conf"><b>Изменено и в проекте, и в файле (будет взята версия файла):</b><ul>`
      + r.conflicts.map((c) => `<li>${esc(c.path)}${why[c.kind]}</li>`).join('') + `</ul></div>`;
  }
  if (r.theme) s += themeHtml(r.theme);
  s += warningsHtml(r.warnings ?? []);
  s += '<p class="mu">Предыдущая версия сохранится в папке .backup.</p>';
  return s;
}

/**
 * Импорт HTML-файла презентации в yarn dev: перетащите файл на страницу (или выберите кнопкой),
 * посмотрите, что изменится, и подтвердите.
 */
export function setupImport(o: ImportUiOptions = {}): { pick: () => void } {
  let busy = false;
  const zone = document.createElement('div');
  zone.className = 'imp-zone';
  zone.innerHTML = '<div>Отпустите HTML-файл, чтобы импортировать правки в проект</div>';
  document.body.append(zone);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.html,.htm,text/html';
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void open(f);
  });

  let depth = 0;
  addEventListener('dragenter', (e) => {
    if (!draggingHtml(e) || busy) return;
    depth++;
    zone.classList.add('on');
  });
  addEventListener('dragleave', (e) => {
    if (!draggingHtml(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('on');
  });
  addEventListener('dragover', (e) => {
    if (!draggingHtml(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = busy ? 'none' : 'copy';
  });
  addEventListener('drop', (e) => {
    depth = 0;
    zone.classList.remove('on');
    const f = [...(e.dataTransfer?.files ?? [])].find(isHtml);
    if (!f) return;
    e.preventDefault();
    if (!busy) void open(f);
  });

  async function open(file: File): Promise<void> {
    busy = true;
    const raw = await file.text();
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp" role="dialog" aria-modal="true" aria-labelledby="imp-h">
      <h2 id="imp-h">Импорт «${esc(file.name)}»</h2>
      <div class="imp-body"><p class="mu">Проверяю файл…</p></div>
      <label class="imp-name" hidden>Презентация <input spellcheck="false" autocomplete="off"><small class="mu">новое имя — отдельная презентация</small></label>
      <fieldset class="imp-mode" hidden><legend>Слайды</legend>
        <label><input type="radio" name="imp-mode" value="edit" checked><span><b>Редактируемые</b><small>Текст и изображения можно править. Скрипты файла отключаются.</small></span></label>
        <label><input type="radio" name="imp-mode" value="live"><span><b>Живые</b><small>Как в исходном файле, со скриптами. Без правки на месте.</small></span></label>
      </fieldset>
      <label class="imp-check" hidden><input type="checkbox" checked> Привязать цвета к теме</label>
      <div class="imp-actions"><button type="button" class="btn ghost" data-a="cancel">Отмена</button><button type="button" class="btn primary" data-a="ok" disabled>Импортировать</button></div>
    </div>`;
    document.body.append(box);
    const body = box.querySelector<HTMLElement>('.imp-body')!;
    const nameRow = box.querySelector<HTMLElement>('.imp-name')!;
    const nameIn = nameRow.querySelector('input')!;
    const themeRow = box.querySelector<HTMLElement>('.imp-check')!;
    const themeIn = themeRow.querySelector('input')!;
    themeIn.addEventListener('change', () => void preview(nameIn.value.trim() || undefined));
    const modeRow = box.querySelector<HTMLElement>('.imp-mode')!;
    const modeIn = (v: string) => modeRow.querySelector<HTMLInputElement>(`input[value="${v}"]`)!;
    const isLive = () => modeIn('live').checked;
    modeRow.addEventListener('change', () => void preview(nameIn.value.trim() || undefined));
    /** Формат не распознан: такой файл открывается только живыми слайдами */
    let liveOnly = false;
    const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
    let last: ImportResult | null = null;
    let seq = 0;
    // Свой HTML со скриптами (например, артефакт): сначала даём скриптам нарисовать слайды
    let html = raw;
    let snapped = false;
    if (needsSnapshot(raw)) {
      body.innerHTML = '<p class="mu">Запускаю скрипты файла, чтобы взять готовые слайды…</p>';
      const shot = await snapshot(raw);
      if (shot) {
        html = shot;
        snapped = true;
      }
    }

    const close = () => {
      box.remove();
      removeEventListener('keydown', onKey, true);
      busy = false;
    };
    const onKey = (e: KeyboardEvent) => {
      // Клавиши показа и редактора не должны срабатывать под окном
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Enter' && !ok.disabled && e.target !== cancel) { e.preventDefault(); void run(); }
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    cancel.onclick = close;
    box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });

    const preview = async (deck?: string) => {
      const my = ++seq;
      ok.disabled = true;
      try {
        let r: ImportResult;
        try {
          r = await request({ html, raw, file: file.name, deck, dry: true, theme: themeIn.checked, live: isLive() });
        } catch (e) {
          // Незнакомый формат: пробуем живыми слайдами — они открывают любой HTML
          if (isLive() || !/не распознан/.test((e as Error).message)) throw e;
          r = await request({ html, raw, file: file.name, deck, dry: true, theme: false, live: true });
          liveOnly = true;
          modeIn('live').checked = true;
          modeIn('edit').disabled = true;
        }
        if (my !== seq) return;
        last = r;
        body.innerHTML = summary(r) + (liveOnly
          ? '<p class="imp-warn">Формат файла не распознан: слайды будут показаны как есть, без правки на месте.</p>'
          : r.source === 'live'
            ? ''
            : snapped
              ? '<p class="mu">Слайды сохранены в том виде, как их отрисовали скрипты файла.</p>'
              : '');
        if (nameRow.hidden) {
          nameRow.hidden = false;
          nameIn.value = r.name;
        }
        // Режим и привязка цветов имеют смысл для чужой вёрстки, не для файлов этого проекта
        modeRow.hidden = r.source === 'htmlpptx';
        themeRow.hidden = r.source === 'htmlpptx' || r.source === 'live';
        ok.disabled = !r.changed;
        ok.textContent = r.mode === 'create' ? 'Создать' : 'Импортировать';
      } catch (e) {
        if (my !== seq) return;
        last = null;
        body.innerHTML = `<p class="imp-err">${esc((e as Error).message)}</p>`;
      }
    };

    let timer = 0;
    nameIn.addEventListener('input', () => {
      clearTimeout(timer);
      const v = nameIn.value.trim();
      ok.disabled = true;
      if (!NAME_RE.test(v)) {
        seq++;
        body.innerHTML = '<p class="imp-err">Имя презентации: латиница, цифры, дефис</p>';
        return;
      }
      timer = window.setTimeout(() => void preview(v), 250);
    });

    const run = async () => {
      if (!last) return;
      ok.disabled = cancel.disabled = nameIn.disabled = themeIn.disabled = true;
      modeRow.querySelectorAll('input').forEach((x) => { x.disabled = true; });
      ok.textContent = 'Импорт…';
      try {
        await o.beforeImport?.();
        const r = await request({ html, raw, file: file.name, deck: nameIn.value.trim() || last.name, dry: false, theme: themeIn.checked, live: isLive() });
        body.innerHTML = `<p class="imp-ok">${r.mode === 'create' ? 'Презентация создана' : 'Правки перенесены в проект'}. Открываю…</p>`;
        const url = new URL(location.href);
        url.search = `?deck=${encodeURIComponent(r.name)}`;
        if (r.name !== o.current) url.hash = '';
        if (url.href === location.href) location.reload();
        else location.href = url.href;
      } catch (e) {
        body.innerHTML = `<p class="imp-err">Не удалось импортировать: ${esc((e as Error).message)}</p>`;
        cancel.disabled = nameIn.disabled = themeIn.disabled = false;
        modeRow.querySelectorAll('input').forEach((x) => { x.disabled = x.value === 'edit' && liveOnly; });
        ok.textContent = 'Повторить';
        ok.disabled = false;
      }
    };
    ok.onclick = () => void run();

    await preview();
    ok.focus();
  }

  return { pick: () => input.click() };
}

/**
 * «Цвета → тема» для презентации в проекте: предпросмотр, подтверждение, запись.
 * После записи страница перезагружается с новыми данными.
 */
export async function bindThemeDialog(deck: string, beforeWrite?: () => Promise<void> | void): Promise<void> {
  const call = async (dry: boolean) => {
    const res = await fetch(`/__htmlpptx/bind-theme?deck=${encodeURIComponent(deck)}${dry ? '&dry=1' : ''}`, { method: 'POST' })
      .catch(() => { throw new Error('нет связи с yarn dev — сервер остановлен?'); });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
    return data as { changed: boolean; theme: ThemeReport };
  };
  const box = document.createElement('div');
  box.className = 'imp-bd';
  box.innerHTML = `<div class="imp" role="dialog" aria-modal="true" aria-labelledby="bt-h">
    <h2 id="bt-h">Привязать цвета к теме</h2>
    <div class="imp-body"><p class="mu">Проверяю цвета…</p></div>
    <div class="imp-actions"><button type="button" class="btn ghost" data-a="cancel">Отмена</button><button type="button" class="btn primary" data-a="ok" disabled>Привязать</button></div>
  </div>`;
  document.body.append(box);
  const body = box.querySelector<HTMLElement>('.imp-body')!;
  const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
  const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
  const close = () => {
    box.remove();
    removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); ok.click(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  cancel.onclick = close;
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  try {
    const r = await call(true);
    body.innerHTML = r.changed
      ? '<p>Цвета, совпадающие с цветами темы, будут привязаны к ней.</p>'
        + themeHtml(r.theme) + '<p class="mu">Предыдущая версия сохранится в папке .backup.</p>'
      : '<p>Цвета уже привязаны к теме.</p>' + (Object.keys(r.theme.kept).length ? themeHtml(r.theme) : '');
    ok.disabled = !r.changed;
    ok.focus();
  } catch (e) {
    body.innerHTML = `<p class="imp-err">${esc((e as Error).message)}</p>`;
  }
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    ok.textContent = 'Привязываю…';
    try {
      await beforeWrite?.();
      await call(false);
      body.innerHTML = '<p class="imp-ok">Готово. Обновляю страницу…</p>';
      location.reload();
    } catch (e) {
      body.innerHTML = `<p class="imp-err">Не удалось: ${esc((e as Error).message)}</p>`;
      cancel.disabled = false;
    }
  };
}

import { esc } from './html';
import './import-ui.css';

/** Ответ /__htmlpptx/import (см. plugins/import.ts) */
interface ImportResult {
  name: string;
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

export interface ImportUiOptions {
  /** Открытая сейчас презентация (на странице показа) */
  current?: string;
  /** Записать несохранённые правки редактора до импорта */
  beforeImport?: () => Promise<void> | void;
}

const NAME_RE = /^[a-z0-9][a-z0-9-_]*$/i;

async function request(html: string, file: string, deck: string | undefined, dry: boolean): Promise<ImportResult> {
  const q = new URLSearchParams({ file });
  if (deck) q.set('deck', deck);
  if (dry) q.set('dry', '1');
  let res: Response;
  try {
    res = await fetch(`/__htmlpptx/import?${q}`, { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: html });
  } catch {
    throw new Error('нет связи с yarn dev — сервер остановлен?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
  return data as ImportResult;
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

function summary(r: ImportResult): string {
  const where = `presentations/${esc(r.name)}/deck.yaml`;
  if (r.mode === 'create') {
    return `<p>Будет создана новая презентация <code>${where}</code>: ${r.slides} слайдов.</p>`
      + list('Картинки', r.newAssets.map((a) => a.replace('./assets/', '')));
  }
  if (!r.changed) return `<p>Изменений нет: <code>${where}</code> уже содержит все правки из файла.</p>`;
  let s = `<p>Правки из файла будут перенесены в <code>${where}</code>${r.mode === 'merge' ? '. Изменения, сделанные в проекте после сборки файла, сохранятся.' : '.'}</p>`;
  if (r.mode === 'replace') s += '<p class="imp-warn">В файле нет исходной версии этой презентации: данные файла заменят данные проекта целиком.</p>';
  s += list('Изменены', r.edited) + list('Добавлены', r.added) + list('Удалены', r.removed) + list('Также', r.other)
    + list('Новые картинки', r.newAssets.map((a) => a.replace('./assets/', '')));
  if (r.conflicts.length) {
    const why = { 'both-changed': '', 'deleted-in-file': ' — в файле удалено, в проекте изменено: оставлено', 'deleted-in-project': ' — в проекте удалено, в файле изменено: восстановлено' };
    s += `<div class="imp-conf"><b>Изменено и в проекте, и в файле — будет взята версия из файла:</b><ul>`
      + r.conflicts.map((c) => `<li>${esc(c.path)}${why[c.kind]}</li>`).join('') + `</ul></div>`;
  }
  s += '<p class="mu">Прежняя версия deck.yaml сохранится в папке .backup рядом с ней.</p>';
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
    const html = await file.text();
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp" role="dialog" aria-modal="true" aria-labelledby="imp-h">
      <h2 id="imp-h">Импорт «${esc(file.name)}»</h2>
      <div class="imp-body"><p class="mu">Проверяю файл…</p></div>
      <label class="imp-name" hidden>Презентация <input spellcheck="false" autocomplete="off"><small class="mu">другое имя — импортировать как отдельную презентацию</small></label>
      <div class="imp-actions"><button type="button" class="btn ghost" data-a="cancel">Отмена</button><button type="button" class="btn primary" data-a="ok" disabled>Импортировать</button></div>
    </div>`;
    document.body.append(box);
    const body = box.querySelector<HTMLElement>('.imp-body')!;
    const nameRow = box.querySelector<HTMLElement>('.imp-name')!;
    const nameIn = nameRow.querySelector('input')!;
    const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
    const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
    let last: ImportResult | null = null;
    let seq = 0;

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
        const r = await request(html, file.name, deck, true);
        if (my !== seq) return;
        last = r;
        body.innerHTML = summary(r);
        if (nameRow.hidden) {
          nameRow.hidden = false;
          nameIn.value = r.name;
        }
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
      ok.disabled = cancel.disabled = nameIn.disabled = true;
      ok.textContent = 'Импорт…';
      try {
        await o.beforeImport?.();
        const r = await request(html, file.name, nameIn.value.trim() || last.name, false);
        body.innerHTML = `<p class="imp-ok">${r.mode === 'create' ? 'Презентация создана' : 'Правки перенесены в проект'}. Открываю…</p>`;
        const url = new URL(location.href);
        url.search = `?deck=${encodeURIComponent(r.name)}`;
        if (r.name !== o.current) url.hash = '';
        if (url.href === location.href) location.reload();
        else location.href = url.href;
      } catch (e) {
        body.innerHTML = `<p class="imp-err">Не удалось импортировать: ${esc((e as Error).message)}</p>`;
        cancel.disabled = nameIn.disabled = false;
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

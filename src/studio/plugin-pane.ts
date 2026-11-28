/**
 * Панель плагина рядом со слайдом (docs/PLUGINS.md) — в той же колонке, что «Порядок» анимаций, по одной за раз.
 * Код плагина живёт в рамке без своего адреса (sandbox без allow-same-origin): странице студии, её командам
 * и хранилищам он недоступен; сеть закрыта политикой безопасности, а с разрешением «Сеть» открыта только к его
 * адресам. Со студией панель говорит сообщениями — объект slideria в рамке (BOOT ниже); ответы получает только
 * своя страница плагина: ушла рамка на другой адрес — панель закрывается.
 */
import fontUrl from '../fonts/Onest.woff2?url';
import { icon } from '../components/icons';
import { outline } from '../engine/ops';
import { permissionsOf, type PluginManifest } from '../engine/plugin-manifest';
import { currentTheme, onThemeChange } from '../engine/theme';
import type { Deck } from '../types';

export interface PluginRef { id: string; manifest: PluginManifest; granted: string[] }

export interface PaneHost {
  deck: Deck;
  /** Номер текущего слайда (с 0) и номера выделенных объектов на нём (с 0) */
  index(): number;
  selection(): number[];
  /** Правка операциями от имени плагина: одним шагом отмены, с записью в журнал (plugins.ts) */
  apply(p: PluginRef, ops: unknown[], label?: string): Promise<{ changes: string[] }>;
  /** Файл плагина: текст или данные (base64) */
  file(id: string, rel: string): Promise<{ text: string } | { data: string; type: string }>;
  /** Настройки плагина: прочитать все или записать одну */
  data(id: string, set?: { key: string; value: unknown }): Promise<Record<string, unknown>>;
  /** Файлы презентации: начало адреса её папки и список (пути — как в deck.yaml) */
  assets(): Promise<{ base: string; files: { path: string; size: number }[] }>;
  /** Новый файл в assets/ презентации: такой же уже есть — его путь, имя занято — с номером */
  addFile(name: string, data: Blob): Promise<{ path: string }>;
  toast(text: string, err?: boolean): void;
  /** Панель открылась или закрылась — кнопка на ленте горит */
  changed(): void;
}

/** Цвета студии, которые получает панель: она выглядит как часть программы в обеих темах */
const TOKENS = ['--bg', '--surf', '--alt', '--isl', '--tx', '--tx2', '--mu', '--bd', '--bd2', '--ac', '--acs', '--acb', '--ach', '--on-ac', '--hov', '--danger'];

/** Шрифт студии — данными: свой адрес рамке недоступен, а системный шрифт выглядел бы чужим */
let fontData: Promise<string> | null = null;
const font = () => (fontData ??= fetch(fontUrl).then((r) => r.blob()).then((b) => new Promise<string>((done) => {
  const fr = new FileReader();
  fr.onload = () => done(String(fr.result));
  fr.onerror = () => done('');
  fr.readAsDataURL(b);
})).catch(() => ''));

const tokens = (): Record<string, string> => {
  const cs = getComputedStyle(document.querySelector('.studio-app') ?? document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(t).trim()]).filter(([, v]) => v));
};
const rootCss = (t: Record<string, string>, theme: string) => `:root{color-scheme:${theme};${Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';')}}`;

/**
 * Начало документа панели: политика безопасности (до кода плагина — её не ослабить), шрифт и цвета студии,
 * простое оформление стандартных полей и кнопок, объект slideria
 */
const BOOT = `(() => {
  const wait = new Map(); const subs = {}; let n = 0;
  const call = (m, ...a) => new Promise((ok, no) => { const id = ++n; wait.set(id, [ok, no]); parent.postMessage({ sl: 1, id, m, a }, '*'); });
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !d || d.sl !== 1) return;
    if (d.id) { const w = wait.get(d.id); if (!w) return; wait.delete(d.id); return d.ok ? w[0](d.r) : w[1](new Error(d.e)); }
    if (d.ev === 'theme') document.getElementById('sl-theme').textContent = d.d.css;
    (subs[d.ev] || []).slice().forEach((f) => { try { f(d.d.data ?? d.d); } catch (err) { console.error(err); } });
  });
  window.slideria = Object.freeze({
    outline: () => call('outline'),
    deck: () => call('deck'),
    selection: () => call('selection'),
    apply: (ops, o) => call('apply', Array.isArray(ops) ? ops : [ops], o || {}),
    toast: (text) => call('toast', String(text)),
    file: (path) => call('file', String(path)),
    files: Object.freeze({ list: () => call('files.list'), read: (path) => call('files.read', String(path)), add: (name, data) => call('files.add', String(name), data) }),
    storage: Object.freeze({ get: (key) => call('data.get', key), set: (key, value) => call('data.set', String(key), value) }),
    on: (ev, f) => { (subs[ev] = subs[ev] || []).push(f); return () => { subs[ev] = subs[ev].filter((x) => x !== f); }; },
    close: () => call('close'),
  });
})();`;

const BASE_CSS = `html,body{margin:0}
body{padding:12px 14px 16px;font:13px/1.45 "SL Text",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tx);background:var(--isl,var(--surf))}
h1,h2,h3{margin:0 0 8px;font-weight:600;font-size:14px}p{margin:0 0 8px}small,.muted{color:var(--mu)}
button,input,select,textarea{font:inherit;color:inherit}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:0 12px;border:1px solid var(--bd);border-radius:8px;background:var(--surf);cursor:pointer}
button:hover{border-color:var(--bd2,var(--bd));background:var(--hov,var(--surf))}
button.primary{border-color:transparent;background:var(--ac);color:var(--on-ac,#fff)}
button:disabled{opacity:.5;cursor:default}
input:not([type=checkbox]):not([type=radio]),select,textarea{box-sizing:border-box;width:100%;min-height:30px;padding:4px 8px;border:1px solid var(--bd);border-radius:8px;background:var(--bg,var(--surf))}
input:focus,select:focus,textarea:focus{outline:2px solid var(--acb,var(--ac));outline-offset:-1px}
input[type=checkbox],input[type=radio]{accent-color:var(--ac)}
label{display:flex;align-items:center;gap:8px}
a{color:var(--ac)}`;

/**
 * Политика безопасности панели: сеть — только адреса из разрешения «Сеть» (выданного). Обработка медиа —
 * в самой панели: WebAssembly и потоки из своего кода (blob:) сеть не открывают — у них та же политика
 */
function policy(m: PluginManifest, granted: string[]): string {
  const hosts = m.network.filter((h) => granted.includes(`net:${h}`)).map((h) => `https://${h}`).join(' ');
  return [
    "default-src 'none'", "script-src 'unsafe-inline' 'wasm-unsafe-eval'", 'worker-src blob:', "style-src 'unsafe-inline'", 'font-src data:',
    `img-src data: blob:${hosts ? ` ${hosts}` : ''}`, `media-src data: blob:${hosts ? ` ${hosts}` : ''}`,
    `connect-src ${hosts || "'none'"}`, "form-action 'none'", "base-uri 'none'",
  ].join('; ');
}

const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');

/** Все строки данных через f */
const mapStr = (v: unknown, f: (s: string) => string): unknown => typeof v === 'string' ? f(v)
  : Array.isArray(v) ? v.map((x) => mapStr(x, f))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStr(x, f)])) : v;
/** Путь в assets/ презентации (./assets/… или assets/…) без «..» — хвост после assets/, иначе null */
function assetRest(s: string): string | null {
  const m = /^(?:\.\/)?assets\/(\S+)$/.exec(s);
  if (!m || m[1].includes('\\')) return null;
  const parts = m[1].split('/');
  return parts.length <= 6 && parts.every((x) => x && x !== '.' && x !== '..') ? m[1] : null;
}
/** Файлы с кодом плагин не добавляет: код в презентации — только через блок, со своим разрешением */
const CODE_FILE = /\.(?:html?|wasm|wad|js|mjs)$/i;
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export class PluginPane {
  private frame: HTMLIFrameElement | null = null;
  private cur: PluginRef | null = null;
  private loads = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Что уже сообщили панели: слайд и выделение — только при смене */
  private sent = '';
  /** Начало адреса папки презентации: в студии данные держат адреса файлов, плагину отдаются пути */
  private base: Promise<string> | null = null;

  constructor(private root: HTMLElement, private h: PaneHost) {
    root.innerHTML = `<header class="st-lyr-head"><b class="st-pp-name"></b>
  <button type="button" class="st-lyr-x" data-a="close" title="Закрыть" aria-label="Закрыть панель плагина">${icon('close')}</button>
</header><div class="st-pp-body"></div>`;
    root.querySelector('[data-a="close"]')!.addEventListener('click', () => this.close());
    addEventListener('message', (e) => this.onMessage(e));
    // Открылась область анимации — эта панель уступает ей место (одна колонка на двоих)
    document.addEventListener('st-sidepane', (e) => { if ((e as CustomEvent).detail !== 'plugin') this.close(); });
    onThemeChange(() => this.post('theme', { css: rootCss(tokens(), currentTheme()) }));
  }

  /** Какой плагин открыт */
  get open(): string | null { return this.cur?.id ?? null; }

  async show(p: PluginRef): Promise<void> {
    if (!p.manifest.panel) return;
    if (this.cur?.id === p.id) return;
    this.close();
    document.dispatchEvent(new CustomEvent('st-sidepane', { detail: 'plugin' }));
    this.cur = p;
    this.loads = 0;
    this.sent = '';
    this.base = null;
    const nameEl = this.root.querySelector<HTMLElement>('.st-pp-name')!;
    nameEl.innerHTML = `<span class="st-pp-i">${icon(p.manifest.icon)}</span>`;
    nameEl.append(p.manifest.name);
    this.root.setAttribute('aria-label', p.manifest.name);
    this.root.hidden = false;
    this.layout();
    const body = this.root.querySelector<HTMLElement>('.st-pp-body')!;
    body.textContent = '';
    try {
      const doc = await this.compose(p);
      if (this.cur !== p) return;
      const f = document.createElement('iframe');
      f.className = 'st-pp-frame';
      f.title = p.manifest.name;
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.name = `slideria-plugin-${p.id}`;
      // Первая загрузка — своя страница; вторая — рамка ушла на другой адрес: данные ей больше не отдаются
      f.addEventListener('load', () => {
        if (++this.loads > 1 && this.cur === p) {
          this.close();
          this.h.toast(`Панель плагина «${p.manifest.name}» закрыта: переход на другую страницу`, true);
        }
      });
      f.srcdoc = doc;
      body.append(f);
      this.frame = f;
    } catch (e) {
      body.innerHTML = `<p class="st-pp-err"></p>`;
      body.querySelector('p')!.textContent = `Не удалось открыть панель: ${(e as Error).message}`;
    }
    this.h.changed();
  }

  close(): void {
    if (!this.cur) return;
    this.cur = null;
    this.frame?.remove();
    this.frame = null;
    this.root.hidden = true;
    this.layout();
    this.h.changed();
  }

  /** Колонка справа от слайда — ширина панели плагина (область анимации свою ширину ставит сама) */
  private layout(): void {
    const body = this.root.parentElement;
    if (!body) return;
    body.style.setProperty('--apr', this.cur ? `${this.cur.manifest.panel?.width ?? 320}px` : '0px');
  }

  /** Слайд, выделение или правка: событие в панель. Слайд и выделение — только при смене */
  notify(changed = false): void {
    if (!this.cur || !this.frame) return;
    const sel = this.h.selection();
    const key = `${this.h.index()}|${sel.join(',')}`;
    if (key !== this.sent) {
      const was = this.sent.split('|')[0];
      this.sent = key;
      if (was !== String(this.h.index())) this.post('slide', { data: this.h.index() + 1 });
      this.post('selection', { data: this.selection() });
    }
    if (changed) this.post('change', { data: null });
  }

  private selection() {
    return { slide: this.h.index() + 1, objects: this.h.selection().map((k) => k + 1) };
  }

  private post(ev: string, d: unknown): void {
    this.frame?.contentWindow?.postMessage({ sl: 1, ev, d }, '*');
  }

  /** Документ панели: начало (политика, шрифт, цвета, slideria), затем страница плагина со встроенными файлами */
  private async compose(p: PluginRef): Promise<string> {
    const page = await this.h.file(p.id, p.manifest.panel!.file);
    if (!('text' in page)) throw new Error('панель — не HTML');
    let html = page.text;
    // Свои файлы плагина — внутрь страницы: у рамки нет адреса, по которому их можно было бы загрузить
    const local = (u: string) => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
    const jobs: Promise<void>[] = [];
    const swaps = new Map<string, string>();
    const add = (full: string, make: () => Promise<string>) => { jobs.push(make().then((x) => { swaps.set(full, x); })); };
    for (const m of html.matchAll(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi)) {
      if (!local(m[2])) continue;
      add(m[0], async () => {
        const f = await this.h.file(p.id, m[2].replace(/^\.\//, ''));
        return `<script${m[1]}${m[3]}>${scriptSafe('text' in f ? f.text : '')}</script>`;
      });
    }
    for (const m of html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)) {
      const href = /\bhref=["']([^"']+)["']/i.exec(m[0])?.[1];
      if (!href || !local(href)) continue;
      add(m[0], async () => {
        const f = await this.h.file(p.id, href.replace(/^\.\//, ''));
        return `<style>${'text' in f ? f.text.replace(/<\/style/gi, '<\\/style') : ''}</style>`;
      });
    }
    for (const m of html.matchAll(/\bsrc=["']([^"']+\.(?:png|jpe?g|gif|webp|svg))["']/gi)) {
      if (!local(m[1])) continue;
      add(m[0], async () => {
        const f = await this.h.file(p.id, m[1].replace(/^\.\//, ''));
        const url = 'data' in f ? `data:${f.type};base64,${f.data}` : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.text)}`;
        return `src="${attr(url)}"`;
      });
    }
    await Promise.all(jobs);
    for (const [from, to] of swaps) html = html.split(from).join(to);
    const fontSrc = await font();
    const head = `<!doctype html><html lang="ru"><head><meta charset="utf-8">`
      + `<meta http-equiv="Content-Security-Policy" content="${attr(policy(p.manifest, p.granted))}">`
      + `<style>${fontSrc ? `@font-face{font-family:"SL Text";src:url(${fontSrc}) format("woff2");font-weight:100 900}` : ''}${BASE_CSS}</style>`
      + `<style id="sl-theme">${rootCss(tokens(), currentTheme())}</style>`
      + `<script>${BOOT}</script></head>`;
    return head + html;
  }

  /** Запросы панели: только от своей страницы (рамка без адреса — origin «null») */
  private onMessage(e: MessageEvent): void {
    const p = this.cur;
    const d = e.data as { sl?: number; id?: number; m?: string; a?: unknown[] } | null;
    if (!p || !this.frame || e.source !== this.frame.contentWindow || e.origin !== 'null' || this.loads > 1) return;
    if (!d || d.sl !== 1 || typeof d.id !== 'number' || typeof d.m !== 'string') return;
    const reply = (ok: boolean, r: unknown) => {
      if (this.cur !== p) return;
      this.frame?.contentWindow?.postMessage(ok ? { sl: 1, id: d.id, ok, r } : { sl: 1, id: d.id, ok, e: String(r) }, '*');
    };
    const a = Array.isArray(d.a) ? d.a : [];
    // Правки — по очереди: следующая начинается от результата предыдущей
    this.queue = this.queue.then(() => this.handle(p, d.m!, a)).then((r) => reply(true, r), (err) => reply(false, (err as Error).message ?? err));
  }

  private folder(): Promise<string> {
    return (this.base ??= this.h.assets().then((r) => r.base, (e: unknown) => { this.base = null; throw e; }));
  }

  private async handle(p: PluginRef, m: string, a: unknown[]): Promise<unknown> {
    const files = () => {
      if (!p.manifest.files || !p.granted.includes('files')) throw new Error('Плагину не разрешены файлы презентации (files в plugin.json)');
    };
    switch (m) {
      case 'outline': return outline(this.h.deck);
      case 'deck': {
        // Пути — как в deck.yaml: адреса сервера (с папками компьютера) плагину ни к чему
        const base = await this.folder();
        return mapStr(JSON.parse(JSON.stringify(this.h.deck)), (s) => (s.startsWith(base) ? './' + s.slice(base.length) : s));
      }
      case 'selection': return this.selection();
      case 'apply': {
        if (!p.manifest.edit || !p.granted.includes('edit')) throw new Error('Плагину не разрешено править презентацию (edit в plugin.json)');
        const o = (a[1] ?? {}) as { label?: unknown };
        const base = await this.folder();
        // Пути файлов из плагина — адресами, как у остальных данных студии: новый файл виден на слайде сразу
        const ops = mapStr(Array.isArray(a[0]) ? a[0] : [a[0]], (s) => { const rest = assetRest(s); return rest !== null && s.startsWith('./') ? base + 'assets/' + rest : s; }) as unknown[];
        return this.h.apply(p, ops, typeof o.label === 'string' ? o.label.slice(0, 80) : undefined);
      }
      case 'files.list': {
        files();
        return (await this.h.assets()).files;
      }
      case 'files.read': {
        files();
        const rest = assetRest(String(a[0] ?? ''));
        if (rest === null) throw new Error('Путь — файл в assets/ презентации, например ./assets/video.mp4');
        const r = await fetch((await this.folder()) + 'assets/' + rest.split('/').map(encodeURIComponent).join('/'));
        if (!r.ok) throw new Error(`Файл не найден: ./assets/${rest}`);
        return r.blob();
      }
      case 'files.add': {
        files();
        const name = String(a[0] ?? '').split(/[\\/]/).pop() ?? '';
        if (!name) throw new Error('Нужно имя файла, например clip.mp4');
        if (CODE_FILE.test(name)) throw new Error('Файлы с кодом (.html, .js, .wasm) плагин в презентацию не добавляет');
        const d = a[1];
        const blob = d instanceof Blob ? d : d instanceof ArrayBuffer || ArrayBuffer.isView(d) ? new Blob([d as BlobPart]) : typeof d === 'string' ? new Blob([d]) : null;
        if (!blob) throw new Error('Данные файла — Blob, ArrayBuffer, массив байтов или строка');
        return { path: (await this.h.addFile(name, blob)).path };
      }
      case 'toast': this.h.toast(`${p.manifest.name}: ${String(a[0] ?? '').slice(0, 200)}`); return null;
      case 'file': {
        const f = await this.h.file(p.id, String(a[0] ?? ''));
        return 'text' in f ? f.text : `data:${f.type};base64,${f.data}`;
      }
      case 'data.get': {
        const all = await this.h.data(p.id);
        return a[0] === undefined ? all : all[String(a[0])] ?? null;
      }
      case 'data.set': await this.h.data(p.id, { key: String(a[0] ?? ''), value: a[1] ?? null }); return null;
      case 'close': queueMicrotask(() => this.close()); return null;
      default: throw new Error(`Нет такой команды: ${m}`);
    }
  }
}

/** Что плагину будет можно — строками для окна «Включить?» и раздела «Плагины» */
export function permissionRows(m: PluginManifest): { icon: string; title: string; sub?: string }[] {
  const rows: { icon: string; title: string; sub?: string }[] = [];
  const perms = permissionsOf(m);
  if (perms.includes('edit')) rows.push({ icon: 'pencil', title: 'Править презентацию' });
  if (perms.includes('files')) rows.push({ icon: 'clip', title: 'Читать и добавлять файлы презентации' });
  if (perms.includes('panel')) rows.push({ icon: 'layers', title: 'Показывать панель рядом со слайдом' });
  if (m.network.length) rows.push({ icon: 'globe', title: 'Обращаться к сайтам', sub: m.network.join(', ') });
  return rows;
}

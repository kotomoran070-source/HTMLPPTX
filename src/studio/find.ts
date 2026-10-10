/**
 * «Найти и заменить» по всей презентации (Ctrl+F, Ctrl+H). Два режима:
 *   текст — то, что видит зритель: тексты слайдов, название и, по желанию, заметки. Адреса, цвета,
 *     код, стили и разметка вёрстки не трогаются, как и адрес внутри ссылки в тексте;
 *   код (кнопка </>, Ctrl+Shift+F) — YAML всех слайдов, как во вкладке «Код», и стили презентации:
 *     совпадение открывается в коде. Только поиск: заменяют в самом редакторе кода (Ctrl+H).
 * Пока поле поиска в фокусе, под ним — список всех совпадений: щелчок ведёт к нужному месту.
 * «Заменить все» — одна правка: Ctrl+Z откатывает всё.
 */
import { stringify } from 'yaml';
import { icon } from '../components/icons';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Deck, SlideData } from '../types';

export interface FindHost {
  deck(): Deck;
  editor(): Editor;
  index(): number;
  go(i: number): void;
  stage(): HTMLElement;
  /** Открыть заметки (совпадение в заметках) */
  showNotes(): void;
  /** Показать совпадение в коде: вкладка YAML слайда или CSS, выделение from–to (фокус остаётся в поиске) */
  showCode(mode: 'slide' | 'css', from: number, to: number): void;
}

/** Код слайда — ровно как во вкладке «Код»: позиции совпадений в нём те же */
export function slideYaml(s: SlideData | undefined): string {
  return s ? stringify(s, { lineWidth: 0 }) : '';
}

/** Поля, где не текст для зрителя: адреса, цвета, код, оформление, служебное */
const SKIP = new Set([
  'id', 'type', 'template', 'kind', 'variant', 'src', 'srcDark', 'poster', 'href', 'url', 'action', 'actionUrl', 'link',
  'style', 'css', 'html', 'code', 'files', 'place', 'styles', 'theme', 'fill', 'stroke', 'color', 'bg', 'backdrop',
  'transition', 'enter', 'emphasis', 'icon', 'font', 'fonts', 'align', 'valign', 'gradient', 'strokeGradient', 'live',
  'selector', 'ns', 'vars', 'look', 'filter', 'frame', 'fit', 'dash', 'mode', 'format', 'unit', 'colors', 'brand',
]);
/** Строки, которые не текст, даже в текстовом поле: адреса, пути, цвета, формулы */
const NOT_TEXT = /^(?:https?:|mailto:|tel:|data:|\.{0,2}\/|#[0-9a-f]{3,8}$|=)/i;
/** Совпадение в заметках — значком, без слов */
const NOTES = icon('notes', 'ic st-find-nt');
/** Сколько строк в списке совпадений: дальше — «и ещё N» */
const LIST_MAX = 200;

/**
 * Совпадение: в тексте — путь строки в данных; в коде — путь ['slides', i] (YAML слайда) или ['css'],
 * позиции — в этом коде
 */
interface Hit { path: Path; start: number; end: number; slide: number; notes: boolean; code?: 'slide' | 'css' }

/** Места, где совпадение не ищется: адрес ссылки «[текст](адрес)» и цвет «{#RRGGBB|» */
function guarded(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of s.matchAll(/\]\(([^)]*)\)/g)) out.push([m.index! + 2, m.index! + 2 + m[1].length]);
  for (const m of s.matchAll(/\{#[0-9a-f]{3,8}\|/gi)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

function pattern(q: string, matchCase: boolean, word: boolean): RegExp {
  // Пробел запроса совпадает и с неразрывным (на слайде он ставится после коротких слов: «в доме»)
  const body = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ \\u00a0]');
  return new RegExp(word ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `g${matchCase ? '' : 'i'}u`);
}

/** Все текстовые строки презентации с путями: название, слайды по порядку, заметки — если нужно */
export function texts(deck: Deck, notes: boolean): { path: Path; slide: number; notes: boolean }[] {
  const out: { path: Path; slide: number; notes: boolean }[] = [];
  const walk = (v: unknown, path: Path, slide: number) => {
    if (typeof v === 'string') {
      if (v.trim() && !NOT_TEXT.test(v.trim())) out.push({ path, slide, notes: false });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], slide));
    else if (v && typeof v === 'object') {
      // label слайда — служебное название в списке слайдов («Слайд 10»), его зритель не видит; label блока — видимая подпись
      const top = path.length === 2;
      for (const [k, x] of Object.entries(v)) if (!SKIP.has(k) && k !== 'notes' && !(top && k === 'label')) walk(x, [...path, k], slide);
    }
  };
  deck.slides.forEach((s, i) => {
    walk(s, ['slides', i], i);
    if (notes && typeof s.notes === 'string') out.push({ path: ['slides', i, 'notes'], slide: i, notes: true });
  });
  if (typeof deck.title === 'string') out.push({ path: ['title'], slide: 0, notes: false });
  return out;
}

/** Код презентации для поиска: YAML каждого слайда, затем стили */
export function codes(deck: Deck): { path: Path; slide: number; kind: 'slide' | 'css'; text: string }[] {
  const out: { path: Path; slide: number; kind: 'slide' | 'css'; text: string }[] = deck.slides.map((s, i) => ({ path: ['slides', i], slide: i, kind: 'slide' as const, text: slideYaml(s) }));
  const css = (deck as { css?: unknown }).css;
  if (typeof css === 'string' && css) out.push({ path: ['css'], slide: -1, kind: 'css', text: css });
  return out;
}

/** Строка после замен (с конца к началу, чтобы позиции не сдвигались) */
function spliced(text: string, list: Hit[], to: string): string {
  for (const h of [...list].sort((x, y) => y.start - x.start)) text = text.slice(0, h.start) + to + text.slice(h.end);
  return text;
}

export class FindBar {
  private el: HTMLElement;
  private q: HTMLInputElement;
  private r: HTMLInputElement;
  private list: HTMLElement;
  private hits: Hit[] = [];
  private cur = -1;
  private opts = { matchCase: false, word: false, notes: true, code: false };
  /** Код, в котором искали (позиции совпадений — в нём): путь → текст */
  private src = new Map<string, string>();

  constructor(private host: FindHost, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'st-find';
    this.el.setAttribute('role', 'search');
    this.el.dataset.edKeep = '';
    this.el.hidden = true;
    const t = (a: string, l: string, body: string, pressed?: boolean) =>
      `<button type="button" class="st-find-b" data-fa="${a}" title="${l}" aria-label="${l}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${body}</button>`;
    this.el.innerHTML = `<div class="st-find-row">
      <input class="st-find-q" type="search" placeholder="Найти в презентации" aria-label="Найти" spellcheck="false" aria-controls="st-find-list">
      <span class="st-find-n" aria-live="polite"></span>
      ${t('prev', 'Предыдущее (Shift+Enter)', icon('up'))}${t('next', 'Следующее (Enter)', icon('up', 'ic st-find-down'))}
      ${t('case', 'Учитывать регистр', '<b>Aa</b>', false)}${t('word', 'Только слово целиком', '<b>ab</b>', false)}${t('notes', 'Искать и в заметках', icon('notes'), true)}
      ${t('code', 'Искать в коде: YAML слайдов и стили (Ctrl+Shift+F)', icon('code'), false)}
      ${t('rep', 'Заменить (Ctrl+H)', icon('reset'), false)}${t('close', 'Закрыть (Esc)', icon('close'))}
    </div>
    <div class="st-find-row st-find-rep" hidden>
      <input class="st-find-r" type="text" placeholder="Заменить на" aria-label="Заменить на" spellcheck="false">
      <button type="button" class="btn ghost small" data-fa="one">Заменить</button>
      <button type="button" class="btn ghost small" data-fa="all">Заменить все</button>
    </div>
    <div class="st-find-ctx"></div>
    <div class="st-find-list" id="st-find-list" role="listbox" aria-label="Совпадения"></div>`;
    parent.appendChild(this.el);
    this.q = this.el.querySelector('.st-find-q')!;
    this.r = this.el.querySelector('.st-find-r')!;
    this.list = this.el.querySelector('.st-find-list')!;

    this.q.addEventListener('input', () => { this.search(); this.jump(0, true); });
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.target === this.r) {
          if (e.ctrlKey || e.metaKey) this.replaceAll(); else this.replaceOne();
        } else this.step(e.shiftKey ? -1 : 1);
      }
      // Стрелки в поле поиска — по списку совпадений
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target === this.q) {
        e.preventDefault();
        this.step(e.key === 'ArrowDown' ? 1 : -1);
      }
      // Ctrl+F / Ctrl+H внутри панели — переключить замену, не открывать браузерный поиск; Ctrl+Shift+F — текст или код
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'а')) {
        e.preventDefault();
        if (e.shiftKey) this.setCode(!this.opts.code);
        this.q.select();
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'h' || k === 'р')) { e.preventDefault(); this.toggleReplace(); }
    });
    // Кнопки и строки списка не уводят фокус из поля: список остаётся открытым, печатать можно дальше
    this.el.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest('button') && document.activeElement && this.el.contains(document.activeElement)) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('.st-find-it');
      if (item) { this.jump(Number(item.dataset.k)); return; }
      const a = (e.target as Element).closest<HTMLElement>('[data-fa]')?.dataset.fa;
      if (!a) return;
      if (a === 'prev' || a === 'next') this.step(a === 'next' ? 1 : -1);
      else if (a === 'close') this.close();
      else if (a === 'rep') this.toggleReplace();
      else if (a === 'one') this.replaceOne();
      else if (a === 'all') this.replaceAll();
      else if (a === 'code') { this.setCode(!this.opts.code); this.q.focus(); }
      else if (a === 'case' || a === 'word' || a === 'notes') {
        const key = a === 'case' ? 'matchCase' : a;
        this.opts[key] = !this.opts[key];
        this.el.querySelector(`[data-fa="${a}"]`)!.setAttribute('aria-pressed', String(this.opts[key]));
        this.search();
        this.jump(0, true);
        this.q.focus();
      }
    });
  }

  get open(): boolean { return !this.el.hidden; }
  private get replacing(): boolean { return !this.el.querySelector<HTMLElement>('.st-find-rep')!.hidden; }

  /** Открыть: выделенный фрагмент сразу становится запросом; code — сразу в коде (Ctrl+Shift+F) */
  show(replace = false, code?: boolean): void {
    const picked = String(getSelection() ?? '').trim();
    if (picked && picked.length < 80 && !picked.includes('\n')) this.q.value = picked;
    this.el.hidden = false;
    // Замена — только в тексте
    if (replace) code = false;
    if (code !== undefined && code !== this.opts.code) this.setCode(code, false);
    this.showReplace(replace || this.replacing);
    this.search();
    this.jump(this.nearest(), true);
    (replace && this.q.value ? this.r : this.q).focus();
    this.q.select();
  }

  close(): void {
    // Фокус не остаётся на скрытой панели: иначе Ctrl+Z и другие клавиши студии до неё не дойдут
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.el.hidden = true;
    this.paint();
    this.counts();
  }

  /** Текст или код */
  private setCode(on: boolean, rerun = true): void {
    this.opts.code = on;
    this.el.classList.toggle('code', on);
    this.el.querySelector('[data-fa="code"]')!.setAttribute('aria-pressed', String(on));
    this.q.placeholder = on ? 'Найти в коде презентации' : 'Найти в презентации';
    if (!rerun) return;
    this.search();
    this.jump(this.nearest(), true);
  }

  /** Замена — в тексте: из режима кода Ctrl+H переходит к тексту */
  private toggleReplace(): void {
    if (this.opts.code) {
      this.setCode(false);
      this.showReplace(true);
    } else this.showReplace(!this.replacing);
  }

  private showReplace(on: boolean): void {
    this.el.querySelector<HTMLElement>('.st-find-rep')!.hidden = !on;
    this.el.querySelector('[data-fa="rep"]')!.setAttribute('aria-pressed', String(on));
  }

  /** Данные презентации поменялись (правка, отмена) — совпадения пересчитываются */
  refresh(): void {
    if (!this.open) return;
    const was = this.hits[this.cur];
    const at = this.cur;
    this.search();
    // То же совпадение, если оно осталось; иначе — на том же месте списка
    const same = was ? this.hits.findIndex((h) => h.start === was.start && JSON.stringify(h.path) === JSON.stringify(was.path)) : -1;
    this.cur = this.hits.length ? (same >= 0 ? same : Math.min(Math.max(at, 0), this.hits.length - 1)) : -1;
    this.status();
    this.mark();
    this.paint();
  }

  private search(): void {
    this.hits = [];
    this.src.clear();
    const q = this.q.value;
    if (q) {
      const re = pattern(q, this.opts.matchCase, this.opts.word);
      const deck = this.host.deck();
      if (this.opts.code) {
        for (const c of codes(deck)) {
          this.src.set(JSON.stringify(c.path), c.text);
          for (const m of c.text.matchAll(re)) {
            if (m[0]) this.hits.push({ path: c.path, start: m.index!, end: m.index! + m[0].length, slide: c.slide, notes: false, code: c.kind });
          }
        }
      } else {
        for (const t of texts(deck, this.opts.notes)) {
          const s = getAt(deck, t.path) as string;
          const guard = t.notes ? [] : guarded(s);
          for (const m of s.matchAll(re)) {
            const start = m.index!;
            const end = start + m[0].length;
            if (end > start && !guard.some(([a, b]) => start < b && end > a)) this.hits.push({ path: t.path, start, end, slide: t.slide, notes: t.notes });
          }
        }
      }
    }
    this.cur = this.hits.length ? 0 : -1;
    this.status();
    this.drawList();
    this.counts();
  }

  /** Строка, в которой совпадение: текст или строка кода */
  private source(h: Hit): string {
    return h.code ? this.src.get(JSON.stringify(h.path)) ?? '' : getAt(this.host.deck(), h.path) as string;
  }

  /** Где совпадение (коротко: «С.4», «CSS», «Назв.») и его окружение — кусок строки с выделенным найденным */
  private describe(h: Hit): { where: string; html: string } {
    const s = this.source(h);
    let a = Math.max(0, h.start - 28);
    let b = Math.min(s.length, h.end + 28);
    let where: string;
    if (h.code) {
      // В коде — только своя строка, без отступа
      const ls = s.lastIndexOf('\n', h.start - 1) + 1;
      const le = s.indexOf('\n', h.end);
      a = Math.max(ls + (/^\s*/.exec(s.slice(ls))![0].length), h.start - 40);
      b = Math.min(le < 0 ? s.length : le, h.end + 40);
      where = h.code === 'css' ? 'CSS' : `С.${h.slide + 1}`;
    } else where = h.path[0] === 'title' ? 'Назв.' : `С.${h.slide + 1}`;
    const cut = (x: number, y: number) => esc(s.slice(x, y).replace(/\s+/g, ' '));
    return { where, html: `${a > 0 && !h.code ? '…' : ''}${cut(a, h.start)}<mark>${cut(h.start, h.end)}</mark>${cut(h.end, b)}${b < s.length && !h.code ? '…' : ''}` };
  }

  /** Список совпадений под полем: виден, пока поиск в фокусе. Метка места — у первого совпадения подряд */
  private drawList(): void {
    const shown = this.hits.slice(0, LIST_MAX);
    let last = '';
    this.list.innerHTML = shown.map((h, k) => {
      const d = this.describe(h);
      const where = d.where === last ? '' : d.where;
      last = d.where;
      return `<button type="button" class="st-find-it" role="option" data-k="${k}" aria-selected="false" title="${d.where}"><b>${where}</b>${h.notes ? NOTES : ''}<span>${d.html}</span></button>`;
    }).join('') + (this.hits.length > LIST_MAX ? `<div class="st-find-more">и ещё ${this.hits.length - LIST_MAX} — уточните запрос</div>` : '');
    this.mark();
  }

  /** Текущее совпадение в списке */
  private mark(): void {
    this.list.querySelectorAll<HTMLElement>('.st-find-it').forEach((el) => {
      const on = Number(el.dataset.k) === this.cur;
      el.setAttribute('aria-selected', String(on));
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  /** Счётчик совпадений на миниатюрах в списке слайдов: сразу видно, где искомое встречается */
  private counts(): void {
    const per = new Map<number, number>();
    if (this.open) for (const h of this.hits) if (h.path[0] === 'slides') per.set(h.slide, (per.get(h.slide) ?? 0) + 1);
    document.querySelectorAll<HTMLElement>('.st-thumb[data-i]').forEach((el) => {
      const n = per.get(Number(el.dataset.i));
      if (n) el.dataset.hits = n > 99 ? '99+' : String(n);
      else delete el.dataset.hits;
    });
  }

  /** Первое совпадение с открытого слайда и дальше: поиск начинается там, где вы сейчас */
  private nearest(): number {
    const i = this.hits.findIndex((h) => h.slide >= this.host.index());
    return i < 0 ? 0 : i;
  }

  private step(d: number): void {
    if (!this.hits.length) return;
    this.jump((this.cur + d + this.hits.length) % this.hits.length);
  }

  private jump(i: number, soft = false): void {
    if (!this.hits.length) { this.cur = -1; this.status(); this.paint(); return; }
    this.cur = soft ? this.nearestFrom(i) : i;
    const h = this.hits[this.cur];
    if (h.slide >= 0 && h.slide !== this.host.index()) this.host.go(h.slide);
    if (h.notes) this.host.showNotes();
    this.status();
    this.mark();
    if (h.code) {
      this.host.showCode(h.code, h.start, h.end);
      this.paint();
      return;
    }
    // Слайд отрисован — выделить блок с совпадением и подсветить найденное
    requestAnimationFrame(() => {
      if (!h.notes) this.select(h.path);
      this.paint();
    });
  }

  private nearestFrom(i: number): number {
    return i === 0 ? this.nearest() : i;
  }

  /** Блок, в котором совпадение: самый длинный путь, у которого есть блок на слайде */
  private select(path: Path): void {
    const slide = this.host.stage().querySelector('.slide.on');
    if (!slide) return;
    for (let n = path.length; n > 2; n--) {
      const key = JSON.stringify(path.slice(0, n));
      const el = [...slide.querySelectorAll<HTMLElement>('[data-block]')].find((x) => x.getAttribute('data-block') === key);
      if (el) {
        this.host.editor().selectBlock(el.parentElement?.hasAttribute('data-free') ? el.parentElement : el);
        return;
      }
    }
  }

  private status(): void {
    const n = this.el.querySelector<HTMLElement>('.st-find-n')!;
    const ctx = this.el.querySelector<HTMLElement>('.st-find-ctx')!;
    if (!this.q.value) { n.textContent = ''; ctx.textContent = ''; return; }
    if (!this.hits.length) { n.textContent = 'Нет'; ctx.textContent = ''; n.classList.add('none'); return; }
    n.classList.remove('none');
    n.textContent = `${this.cur + 1} из ${this.hits.length}`;
    const h = this.hits[this.cur];
    const d = this.describe(h);
    ctx.innerHTML = `<b>${d.where}</b>${h.notes ? NOTES : ''} ${d.html}`;
  }

  /** Подсветка найденного на открытом слайде (CSS Custom Highlight API, где он есть); в коде — выделение в редакторе */
  private paint(): void {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !H) return;
    reg.delete('st-find');
    if (!this.open || !this.q.value || !this.hits.length || this.opts.code) return;
    const slide = this.host.stage().querySelector('.slide.on');
    if (!slide) return;
    const re = pattern(this.q.value, this.opts.matchCase, this.opts.word);
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      for (const m of t.matchAll(re)) {
        const r = document.createRange();
        r.setStart(n, m.index!);
        r.setEnd(n, m.index! + m[0].length);
        ranges.push(r);
      }
    }
    if (ranges.length) reg.set('st-find', new H(...ranges));
  }

  private replaceOne(): void {
    const h = this.hits[this.cur];
    if (!h || h.code) return;
    const to = this.r.value;
    this.host.editor().commit((d) => {
      const s = getAt(d, h.path) as string;
      setAt(d, h.path, s.slice(0, h.start) + to + s.slice(h.end));
    }, { rebuild: true });
    const at = this.cur;
    this.search();
    this.jump(Math.min(at, this.hits.length - 1));
  }

  private replaceAll(): void {
    if (!this.hits.length || this.opts.code) return;
    const to = this.r.value;
    const n = this.hits.length;
    // Одна правка: по строкам, с конца к началу, чтобы позиции не сдвигались
    const byPath = new Map<string, Hit[]>();
    for (const h of this.hits) {
      const k = JSON.stringify(h.path);
      byPath.set(k, [...(byPath.get(k) ?? []), h]);
    }
    this.host.editor().commit((d) => {
      for (const list of byPath.values()) setAt(d, list[0].path, spliced(getAt(d, list[0].path) as string, list, to));
    }, { rebuild: true });
    this.host.editor().toast(`Заменено: ${n}. Отменить — Ctrl+Z`, 3000);
    this.search();
    this.status();
    this.paint();
  }
}

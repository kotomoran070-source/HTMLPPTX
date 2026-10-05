/**
 * «Найти и заменить» по всей презентации (Ctrl+F, Ctrl+H): тексты слайдов, название и, по желанию,
 * заметки. Ищется только то, что видит зритель: адреса, цвета, код, стили и разметка вёрстки не
 * трогаются, как и адрес внутри ссылки в тексте. «Заменить все» — одна правка: Ctrl+Z откатывает всё.
 */
import { icon } from '../components/icons';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Deck } from '../types';

export interface FindHost {
  deck(): Deck;
  editor(): Editor;
  index(): number;
  go(i: number): void;
  stage(): HTMLElement;
  /** Открыть заметки (совпадение в заметках) */
  showNotes(): void;
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

interface Hit { path: Path; start: number; end: number; slide: number; notes: boolean }

/** Места, где совпадение не ищется: адрес ссылки «[текст](адрес)» и цвет «{#RRGGBB|» */
function guarded(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of s.matchAll(/\]\(([^)]*)\)/g)) out.push([m.index! + 2, m.index! + 2 + m[1].length]);
  for (const m of s.matchAll(/\{#[0-9a-f]{3,8}\|/gi)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

function pattern(q: string, matchCase: boolean, word: boolean): RegExp {
  const body = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(word ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, `g${matchCase ? '' : 'i'}u`);
}

/** Все текстовые строки презентации с путями: название, слайды по порядку, заметки — если нужно */
function texts(deck: Deck, notes: boolean): { path: Path; slide: number; notes: boolean }[] {
  const out: { path: Path; slide: number; notes: boolean }[] = [];
  const walk = (v: unknown, path: Path, slide: number) => {
    if (typeof v === 'string') {
      if (v.trim() && !NOT_TEXT.test(v.trim())) out.push({ path, slide, notes: false });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], slide));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (!SKIP.has(k) && k !== 'notes') walk(x, [...path, k], slide);
    }
  };
  deck.slides.forEach((s, i) => {
    walk(s, ['slides', i], i);
    if (notes && typeof s.notes === 'string') out.push({ path: ['slides', i, 'notes'], slide: i, notes: true });
  });
  if (typeof deck.title === 'string') out.push({ path: ['title'], slide: 0, notes: false });
  return out;
}

export class FindBar {
  private el: HTMLElement;
  private q: HTMLInputElement;
  private r: HTMLInputElement;
  private hits: Hit[] = [];
  private cur = -1;
  private opts = { matchCase: false, word: false, notes: true };

  constructor(private host: FindHost, parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'st-find';
    this.el.setAttribute('role', 'search');
    this.el.dataset.edKeep = '';
    this.el.hidden = true;
    const t = (a: string, l: string, body: string, pressed?: boolean) =>
      `<button type="button" class="st-find-b" data-fa="${a}" title="${l}" aria-label="${l}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${body}</button>`;
    this.el.innerHTML = `<div class="st-find-row">
      <input class="st-find-q" type="search" placeholder="Найти в презентации" aria-label="Найти" spellcheck="false">
      <span class="st-find-n" aria-live="polite"></span>
      ${t('prev', 'Предыдущее (Shift+Enter)', icon('up'))}${t('next', 'Следующее (Enter)', icon('up', 'ic st-find-down'))}
      ${t('case', 'Учитывать регистр', '<b>Aa</b>', false)}${t('word', 'Только слово целиком', '<b>ab</b>', false)}${t('notes', 'Искать и в заметках', icon('notes'), true)}
      ${t('rep', 'Заменить (Ctrl+H)', icon('reset'), false)}${t('close', 'Закрыть (Esc)', icon('close'))}
    </div>
    <div class="st-find-row st-find-rep" hidden>
      <input class="st-find-r" type="text" placeholder="Заменить на" aria-label="Заменить на" spellcheck="false">
      <button type="button" class="btn ghost small" data-fa="one">Заменить</button>
      <button type="button" class="btn ghost small" data-fa="all">Заменить все</button>
    </div>
    <div class="st-find-ctx"></div>`;
    parent.appendChild(this.el);
    this.q = this.el.querySelector('.st-find-q')!;
    this.r = this.el.querySelector('.st-find-r')!;

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
      // Ctrl+F / Ctrl+H внутри панели — переключить замену, не открывать браузерный поиск
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'а')) { e.preventDefault(); this.q.select(); }
      if ((e.ctrlKey || e.metaKey) && (k === 'h' || k === 'р')) { e.preventDefault(); this.showReplace(!this.replacing); }
    });
    this.el.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-fa]')?.dataset.fa;
      if (!a) return;
      if (a === 'prev' || a === 'next') this.step(a === 'next' ? 1 : -1);
      else if (a === 'close') this.close();
      else if (a === 'rep') this.showReplace(!this.replacing);
      else if (a === 'one') this.replaceOne();
      else if (a === 'all') this.replaceAll();
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

  /** Открыть: выделенный в тексте фрагмент сразу становится запросом */
  show(replace = false): void {
    const picked = String(getSelection() ?? '').trim();
    if (picked && picked.length < 80 && !picked.includes('\n')) this.q.value = picked;
    this.el.hidden = false;
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
  }

  private showReplace(on: boolean): void {
    this.el.querySelector<HTMLElement>('.st-find-rep')!.hidden = !on;
    this.el.querySelector('[data-fa="rep"]')!.setAttribute('aria-pressed', String(on));
  }

  /** Данные презентации поменялись (правка, отмена) — совпадения пересчитываются */
  refresh(): void {
    if (!this.open) return;
    const was = this.hits[this.cur];
    this.search();
    const i = was ? this.hits.findIndex((h) => h.slide >= was.slide && JSON.stringify(h.path) >= JSON.stringify(was.path)) : 0;
    this.cur = this.hits.length ? Math.max(0, i) : -1;
    this.status();
    this.paint();
  }

  private search(): void {
    this.hits = [];
    const q = this.q.value;
    if (q) {
      const re = pattern(q, this.opts.matchCase, this.opts.word);
      const deck = this.host.deck();
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
    this.cur = this.hits.length ? 0 : -1;
    this.status();
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
    if (h.slide !== this.host.index()) this.host.go(h.slide);
    if (h.notes) this.host.showNotes();
    this.status();
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
    const s = getAt(this.host.deck(), h.path) as string;
    const a = Math.max(0, h.start - 28);
    const b = Math.min(s.length, h.end + 28);
    const where = h.path[0] === 'title' ? 'Название' : `Слайд ${h.slide + 1}${h.notes ? ' · заметки' : ''}`;
    ctx.innerHTML = `<b>${where}</b> ${a > 0 ? '…' : ''}${esc(s.slice(a, h.start))}<mark>${esc(s.slice(h.start, h.end))}</mark>${esc(s.slice(h.end, b))}${b < s.length ? '…' : ''}`;
  }

  /** Подсветка найденного на открытом слайде (CSS Custom Highlight API, где он есть) */
  private paint(): void {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !H) return;
    reg.delete('st-find');
    if (!this.open || !this.q.value || !this.hits.length) return;
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
    if (!h) return;
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
    if (!this.hits.length) return;
    const to = this.r.value;
    const n = this.hits.length;
    // Одна правка: с конца строки к началу, чтобы позиции не сдвигались
    const byPath = new Map<string, Hit[]>();
    for (const h of this.hits) {
      const k = JSON.stringify(h.path);
      byPath.set(k, [...(byPath.get(k) ?? []), h]);
    }
    this.host.editor().commit((d) => {
      for (const list of byPath.values()) {
        let s = getAt(d, list[0].path) as string;
        for (const h of [...list].sort((x, y) => y.start - x.start)) s = s.slice(0, h.start) + to + s.slice(h.end);
        setAt(d, list[0].path, s);
      }
    }, { rebuild: true });
    this.host.editor().toast(`Заменено: ${n}. Отменить — Ctrl+Z`, 3000);
    this.search();
    this.status();
    this.paint();
  }
}

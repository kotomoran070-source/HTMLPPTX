/**
 * Палитра команд в верхней строке (Ctrl+K), как поиск в заголовке Office: ввёл «pdf», «сетка»,
 * «новый слайд» — Enter. Список собирается из самой ленты (подпись, подсказка, горячая клавиша,
 * вкладка и группа): новая кнопка на ленте сразу находится и здесь, ничего не дублируется.
 */
import { icon } from '../components/icons';

export interface PaletteHost {
  run(cmd: string): void;
  /** Команда сейчас доступна (нет — строка видна, но приглушена) */
  enabled(cmd: string): boolean;
  /** Переключатель сейчас включён (сетка, линейка, панель) */
  active(cmd: string): boolean;
  /** Показать вкладку команды — для команд с меню (меню открывается у кнопки на ленте) */
  reveal(tab: string): void;
  count(): number;
  slideLabel(i: number): string;
  go(i: number): void;
  /** Дополнительные пункты, которых нет на ленте */
  extra(): Entry[];
}

export interface Entry {
  id: string;
  label: string;
  /** Где на ленте: «Вид · Интерфейс» */
  path: string;
  /** Для поиска: подсказка кнопки, синонимы */
  words: string;
  key: string;
  ico: string;
  run: () => void;
  enabled: () => boolean;
  active?: () => boolean;
}

const RECENT = 'slideria-palette-recent';
/** Набрано не в той раскладке: «yjdsq» → «новый» */
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const swap = (s: string, from: string, to: string) => [...s].map((c) => { const i = from.indexOf(c); return i < 0 ? c : to[i]; }).join('');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class CommandPalette {
  readonly box: HTMLElement;
  private q: HTMLInputElement;
  private list: HTMLElement;
  private shown: Entry[] = [];
  private at = 0;

  constructor(private host: PaletteHost, slot: HTMLElement) {
    this.box = slot;
    slot.innerHTML = `<label class="st-pal-field">${icon('search')}<input type="text" class="st-pal-q" placeholder="Найти команду" aria-label="Найти команду" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="st-pal-list"><kbd>Ctrl+K</kbd></label>
<div class="st-pal-list" id="st-pal-list" role="listbox" aria-label="Команды" hidden></div>`;
    this.q = slot.querySelector('input')!;
    this.list = slot.querySelector('.st-pal-list')!;
    this.q.addEventListener('focus', () => this.open());
    this.q.addEventListener('input', () => this.render());
    this.q.addEventListener('keydown', (e) => this.key(e));
    this.q.addEventListener('blur', () => setTimeout(() => { if (!this.box.contains(document.activeElement)) this.close(false); }, 0));
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const o = (e.target as Element).closest<HTMLElement>('[data-i]');
      if (o) this.choose(Number(o.dataset.i));
    });
    this.list.addEventListener('pointermove', (e) => {
      const o = (e.target as Element).closest<HTMLElement>('[data-i]');
      if (o) this.mark(Number(o.dataset.i), false);
    });
  }

  focus(): void {
    this.q.focus();
    this.q.select();
  }

  private get isOpen(): boolean { return !this.list.hidden; }

  private open(): void {
    this.box.classList.add('on');
    this.list.hidden = false;
    this.q.setAttribute('aria-expanded', 'true');
    this.render();
  }

  private close(blur: boolean): void {
    this.box.classList.remove('on');
    this.list.hidden = true;
    this.q.setAttribute('aria-expanded', 'false');
    this.q.value = '';
    if (blur) this.q.blur();
  }

  /** Все кнопки ленты и верхней строки с командами — по порядку вкладок */
  private entries(): Entry[] {
    const tabs = new Map([...document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]')].map((t) => [t.dataset.tab!, t]));
    const out: Entry[] = [];
    const seen = new Set<string>();
    const add = (b: HTMLElement, path: string, tab: string) => {
      const cmd = b.dataset.cmd!;
      if (seen.has(cmd) || cmd.startsWith('tab.')) return;
      seen.add(cmd);
      const title = b.getAttribute('title') ?? '';
      const key = /\(([^()]*(?:Ctrl|Alt|Shift|F\d)[^()]*)\)\s*$/.exec(title)?.[1] ?? '';
      const label = (b.querySelector('span')?.textContent || b.getAttribute('aria-label') || title.replace(/\s*\(.*\)$/, '')).trim();
      if (!label) return;
      const ic = b.querySelector('svg.ic')?.outerHTML ?? '';
      const menu = b.hasAttribute('aria-haspopup');
      out.push({
        id: cmd, label, path, words: title, key, ico: ic,
        run: () => { if (menu && tab) this.host.reveal(tab); this.host.run(cmd); },
        enabled: () => this.host.enabled(cmd),
        active: () => this.host.active(cmd),
      });
    };
    document.querySelectorAll<HTMLElement>('.st-top [data-cmd]').forEach((b) => add(b, '', ''));
    for (const panel of document.querySelectorAll<HTMLElement>('.st-rpanel')) {
      const tab = panel.dataset.panel!;
      const t = tabs.get(tab);
      // Вкладка «Фигура», «Таблица», «Рисунок» — только когда выделено подходящее
      if (t?.hidden) continue;
      for (const g of panel.querySelectorAll<HTMLElement>('.st-rgroup')) {
        const path = `${t?.textContent?.trim() ?? ''} · ${g.getAttribute('aria-label') ?? ''}`;
        g.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => add(b, path, tab));
      }
    }
    return [...out, ...this.host.extra()];
  }

  private recent(): string[] {
    try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]; } catch { return []; }
  }

  private remember(id: string): void {
    const list = [id, ...this.recent().filter((x) => x !== id)].slice(0, 5);
    try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch { /* нет доступа */ }
  }

  /** Совпадение: все слова запроса есть в названии, пути или подсказке; в начале названия — выше */
  private match(all: Entry[], q: string): Entry[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const score = (e: Entry, ws: string[]) => {
      const label = e.label.toLowerCase();
      const hay = `${label} ${e.path.toLowerCase()} ${e.words.toLowerCase()}`;
      if (!ws.every((w) => hay.includes(w))) return -1;
      return (label.startsWith(ws[0]) ? 4 : 0) + (ws.every((w) => label.includes(w)) ? 2 : 0) + (e.enabled() ? 1 : 0);
    };
    let hits = all.map((e) => ({ e, s: score(e, words) })).filter((x) => x.s >= 0);
    // Ничего — возможно, набрано в другой раскладке
    if (!hits.length) {
      const alt = words.map((w) => (/[a-z]/.test(w) ? swap(w, EN, RU) : swap(w, RU, EN)));
      hits = all.map((e) => ({ e, s: score(e, alt) })).filter((x) => x.s >= 0);
    }
    return hits.sort((a, b) => b.s - a.s).map((x) => x.e);
  }

  private render(): void {
    const q = this.q.value.trim();
    const all = this.entries();
    let list: Entry[];
    // Номер слайда: «12», «слайд 12»
    const n = /^(?:слайд\s*|#)?(\d{1,4})$/i.exec(q);
    const jump: Entry[] = n && Number(n[1]) >= 1 && Number(n[1]) <= this.host.count() ? [{
      id: 'go', label: `Перейти к слайду ${n[1]}`, path: this.host.slideLabel(Number(n[1]) - 1), words: '', key: '', ico: icon('next'),
      run: () => this.host.go(Number(n[1]) - 1), enabled: () => true,
    }] : [];
    if (q) list = [...jump, ...this.match(all, q)];
    else {
      // Без запроса: недавние сверху, затем всё доступное сейчас
      const rec = this.recent().map((id) => all.find((e) => e.id === id)).filter((e): e is Entry => !!e && e.enabled());
      list = [...rec, ...all.filter((e) => e.enabled() && !rec.includes(e))];
    }
    this.shown = list.slice(0, 60);
    this.list.innerHTML = this.shown.length
      ? this.shown.map((e, i) => {
        const on = !!e.active?.();
        return `<div class="st-pal-o${e.enabled() ? '' : ' off'}${on ? ' act' : ''}" role="option" data-i="${i}" aria-disabled="${!e.enabled()}">${e.ico}<span class="st-pal-l">${esc(e.label)}</span>${on ? '<span class="st-pal-on">вкл.</span>' : ''}${e.path ? `<small>${esc(e.path)}</small>` : '<small></small>'}${e.key ? `<kbd>${esc(e.key)}</kbd>` : ''}</div>`;
      }).join('')
      : `<div class="st-pal-none">Нет команды «${esc(q)}»</div>`;
    this.mark(this.shown.findIndex((e) => e.enabled()), true);
  }

  private mark(i: number, scroll: boolean): void {
    this.list.querySelector('.on')?.classList.remove('on');
    this.at = i;
    const o = this.list.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!o) return;
    o.classList.add('on');
    if (scroll) o.scrollIntoView({ block: 'nearest' });
  }

  private choose(i: number): void {
    const e = this.shown[i];
    if (!e || !e.enabled()) return;
    this.close(true);
    if (e.id !== 'go') this.remember(e.id);
    e.run();
  }

  private key(e: KeyboardEvent): void {
    // Клавиши поиска не уходят в студию (Delete, стрелки, Ctrl+Z)
    e.stopPropagation();
    if (!this.isOpen) this.open();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.shown.length;
      if (!n) return;
      let i = this.at;
      // Приглушённые (недоступные сейчас) пропускаются
      for (let k = 0; k < n; k++) {
        i = (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        if (this.shown[i].enabled()) break;
      }
      this.mark(i, true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.choose(this.at);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close(true);
    }
  }
}

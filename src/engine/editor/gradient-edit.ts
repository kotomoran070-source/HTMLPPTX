/**
 * Настройка градиента — одна для заливки и контура фигур, градиента акцента темы и цветов слайда.
 * Полоса градиента с бегунками точек под ней, как в PowerPoint: щелчок по полосе — новая точка
 * (цвет — каким полоса там и была), бегунок тянется вбок, утянули вниз (или Delete) — точка убрана.
 * У выбранной точки — цвета (темы и постоянные) и свой цвет. Начало и конец — всегда по краям.
 */
import { icon } from '../../components/icons';
import { esc } from '../html';
import type { GradientStop } from '../gradients';

/** Градиент в панели: начало, точки между (место 1–99 %), конец, направление */
export interface GradValue {
  from: string;
  to: string;
  mid: GradientStop[];
  angle?: number;
  type?: 'linear' | 'radial';
}

export interface GradPanel {
  /** Цвет точки → CSS (роль темы или #RRGGBB) */
  css(c: string): string;
  /** Цвет точки → #rrggbb для поля выбора цвета и для цвета новой точки */
  hex(c: string): string;
  /** Образцы цвета точки: подпись группы и [значение, css, имя] */
  swatches: { label: string; items: [string, string, string][] }[];
  /** Строка направлений (у градиента акцента её нет: направление задают сами элементы слайда) */
  direction?: boolean;
  /** Готовые градиенты над полосой; g: null — «без градиента» */
  presets?: { name: string; g: GradValue | null; css: string; on?: boolean }[];
  /** Готовые — круглыми плашками с цветами полосами (как «Палитры»), а не плитками градиента */
  round?: boolean;
  /** Пока тянут бегунок или палитру — только показ */
  preview(g: GradValue): void;
  /** Отпустили, выбрали цвет или готовый — записать (null — без градиента) */
  commit(g: GradValue | null): void;
  /** Выбрали готовый (номер в presets); без своего — записывается его градиент */
  choose?(k: number): void;
  /** Наведение на готовый — примерка (null — вернуть как было) */
  tryPreset?(k: number | null): void;
}

/** Не больше шести точек: начало, конец и четыре между */
const MAX_MID = 4;
const DIRS: [number, string][] = [[0, '↑'], [45, '↗'], [90, '→'], [135, '↘'], [180, '↓'], [225, '↙'], [270, '←'], [315, '↖']];

const mixHex = (a: string, b: string, k: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

/**
 * Разметка панели и привязка к всплывающему окну: html — внутрь окна, pick — кнопки окна
 * (готовые, направление, образцы цвета), bind — полоса, бегунки и свой цвет
 */
export function gradientPanel(o: GradPanel, start: GradValue) {
  const g: GradValue = { ...start, mid: start.mid.map((m) => ({ ...m })) };
  /** Выбранная точка: 0 — начало, 1…n — между, n+1 — конец */
  let sel = 0;
  let pop: HTMLElement | null = null;
  const stops = () => [{ c: g.from, at: 0 }, ...g.mid, { c: g.to, at: 100 }];
  const strip = () => `linear-gradient(90deg, ${stops().map((s) => `${o.css(s.c)} ${s.at}%`).join(', ')})`;
  const setColor = (i: number, c: string) => {
    const n = g.mid.length + 1;
    if (i === 0) g.from = c;
    else if (i === n) g.to = c;
    else g.mid[i - 1].c = c;
  };

  const swatchRows = () => o.swatches.map((grp) => `<div class="st-plabel">${esc(grp.label)}</div><div class="st-pgrid st-gsw">${grp.items.map(([v, css, name]) =>
    `<button type="button" class="st-psw" data-gcolor="${esc(v)}" style="--c:${css}" title="${esc(name)}" aria-label="${esc(name)}"></button>`).join('')}</div>`).join('');

  const html = (o.presets?.length ? `<div class="st-plabel">Готовые</div><div class="st-gpre${o.round ? ' round' : ''}">${o.presets.map((p, k) => o.round
    ? `<button type="button" class="st-gpal${p.on ? ' on' : ''}" data-gpre="${k}" title="${esc(p.name)}" aria-label="${esc(p.name)}"><i style="background:${p.css}"></i></button>`
    : `<button type="button" class="st-psw${p.on ? ' on' : ''}" data-gpre="${k}" style="--c:${p.css}" title="${esc(p.name)}" aria-label="${esc(p.name)}"></button>`).join('')}</div>` : '')
    + `<div class="st-plabel">Точки градиента</div>`
    + `<div class="st-gbar deck-colors"><div class="st-gstrip" title="Щелчок — новая точка"></div><div class="st-gmarks"></div></div>`
    + `<p class="st-ghint">Щелчок по полосе — новая точка. Бегунок тянется вбок, вниз — убрать</p>`
    + `<div class="st-gpoint"><span class="st-gname"></span><label class="st-gcol" title="Свой цвет точки"><input type="color" data-gc aria-label="Цвет точки"><span>Свой…</span></label>`
    + `<button type="button" class="st-gdel" data-gdel="1" title="Убрать точку (Delete)" aria-label="Убрать точку">${icon('trash')}</button></div>`
    + swatchRows()
    + (o.direction ? `<div class="st-plabel">Направление</div><div class="st-pseg st-gdir">${DIRS.map(([a, l]) => `<button type="button" data-ang="${a}" title="${a}°">${l}</button>`).join('')}<button type="button" data-ang="radial" title="От центра">◎</button><button type="button" data-gflip="1" title="Перевернуть: начало и конец местами">⇄</button></div>`
      : `<div class="st-pseg st-gdir"><button type="button" data-gflip="1" title="Перевернуть: начало и конец местами">⇄ Перевернуть</button></div>`);

  /** Бегунок в фокусе (Delete убирает точку) — и после перерисовки бегунков */
  let markFocus = false;
  const paint = () => {
    if (!pop) return;
    const list = stops();
    sel = Math.min(sel, list.length - 1);
    pop.querySelector<HTMLElement>('.st-gstrip')!.style.background = strip();
    const marks = pop.querySelector<HTMLElement>('.st-gmarks')!;
    markFocus ||= marks.contains(document.activeElement);
    marks.innerHTML = list.map((s, i) =>
      `<button type="button" class="st-gmark${i === sel ? ' on' : ''}${i === 0 || i === list.length - 1 ? ' end' : ''}" data-gi="${i}" style="left:${s.at}%;--c:${o.css(s.c)}" aria-label="${i === 0 ? 'Начало' : i === list.length - 1 ? 'Конец' : `Точка ${s.at} %`}" title="${i === 0 ? 'Начало' : i === list.length - 1 ? 'Конец' : `${s.at} %`}"></button>`).join('');
    if (markFocus) marks.querySelector<HTMLElement>('.st-gmark.on')?.focus({ preventScroll: true });
    markFocus = false;
    const cur = list[sel];
    pop.querySelector<HTMLElement>('.st-gname')!.textContent = sel === 0 ? 'Начало' : sel === list.length - 1 ? 'Конец' : `Точка · ${cur.at} %`;
    const inp = pop.querySelector<HTMLInputElement>('[data-gc]')!;
    if (document.activeElement !== inp) inp.value = o.hex(cur.c).toLowerCase();
    pop.querySelector<HTMLElement>('[data-gdel]')!.hidden = sel === 0 || sel === list.length - 1;
    pop.querySelectorAll<HTMLElement>('[data-gcolor]').forEach((b) => b.classList.toggle('on', b.dataset.gcolor?.toLowerCase() === cur.c.toLowerCase()));
    pop.querySelectorAll<HTMLElement>('[data-ang]').forEach((b) => b.classList.toggle('on', b.dataset.ang === (g.type === 'radial' ? 'radial' : String(g.angle ?? 135))));
  };
  const copy = (): GradValue => ({ ...g, mid: g.mid.map((m) => ({ ...m })) });
  /** Показ на слайде — не чаще раза за кадр: пока тянут, событий больше, чем кадров */
  let frame = 0;
  const live = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; o.preview(copy()); });
  };
  const done = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    paint();
    o.commit(copy());
  };
  /** Пока тянут бегунок: полоса и бегунки — на месте, без перерисовки панели */
  const nudge = () => {
    if (!pop) return;
    pop.querySelector<HTMLElement>('.st-gstrip')!.style.background = strip();
    const list = stops();
    pop.querySelectorAll<HTMLElement>('.st-gmark').forEach((m, i) => {
      if (!list[i]) return;
      m.style.left = `${list[i].at}%`;
      m.style.setProperty('--c', o.css(list[i].c));
      m.classList.toggle('on', i === sel);
    });
    pop.querySelector<HTMLElement>('.st-gname')!.textContent = sel === 0 ? 'Начало' : sel === list.length - 1 ? 'Конец' : `Точка · ${list[sel].at} %`;
  };
  const drop = (i: number) => {
    if (i <= 0 || i > g.mid.length) return;
    g.mid.splice(i - 1, 1);
    sel = Math.max(0, i - 1);
    done();
  };

  /** Кнопки окна: готовые, направление, переворот, образцы цвета, «убрать точку» */
  const pick = (b: HTMLElement): { run(): void; keep?: boolean } | null => {
    if (b.dataset.gpre !== undefined) {
      const p = o.presets?.[Number(b.dataset.gpre)];
      return p ? { run: () => (o.choose ? o.choose(Number(b.dataset.gpre)) : o.commit(p.g)) } : null;
    }
    if (b.dataset.gcolor) return { keep: true, run: () => { setColor(sel, b.dataset.gcolor!); done(); } };
    if (b.dataset.gdel) return { keep: true, run: () => drop(sel) };
    if (b.dataset.gflip) {
      return { keep: true, run: () => {
        [g.from, g.to] = [g.to, g.from];
        g.mid = g.mid.map((m) => ({ c: m.c, at: 100 - m.at })).reverse();
        sel = stops().length - 1 - sel;
        done();
      } };
    }
    const a = b.dataset.ang;
    if (a) return { keep: true, run: () => { if (a === 'radial') g.type = 'radial'; else { delete g.type; g.angle = Number(a); } done(); } };
    if (b.dataset.gi !== undefined) return { keep: true, run: () => {} };
    return null;
  };

  const bind = (el: HTMLElement) => {
    pop = el;
    const bar = el.querySelector<HTMLElement>('.st-gbar')!;
    const at = (x: number) => {
      const r = bar.getBoundingClientRect();
      return Math.max(1, Math.min(99, Math.round(((x - r.left) / r.width) * 100)));
    };
    // Щелчок по полосе — новая точка цвета полосы в этом месте
    // Фокус остаётся где был: у текста в правке щелчок по полосе или бегунку не заканчивает правку
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    el.querySelector<HTMLElement>('.st-gstrip')!.addEventListener('pointerdown', (e) => {
      if (g.mid.length >= MAX_MID) {
        el.querySelector<HTMLElement>('.st-ghint')!.textContent = 'Не больше шести точек — уберите одну, чтобы добавить новую';
        return;
      }
      const p = at(e.clientX);
      const list = stops();
      const k = list.findIndex((s) => s.at >= p);
      const a = list[k - 1];
      const b = list[k];
      const c = mixHex(o.hex(a.c), o.hex(b.c), (p - a.at) / Math.max(1, b.at - a.at));
      g.mid.push({ c, at: p });
      g.mid.sort((x, y) => x.at - y.at);
      sel = g.mid.findIndex((m) => m.at === p && m.c === c) + 1;
      markFocus = true;
      done();
    });
    // Бегунок: выбрать; точку между — тянуть вбок, вниз — убрать
    el.querySelector<HTMLElement>('.st-gmarks')!.addEventListener('pointerdown', (e) => {
      const m = (e.target as Element).closest<HTMLElement>('.st-gmark');
      if (!m) return;
      sel = Number(m.dataset.gi);
      markFocus = true;
      paint();
      if (m.classList.contains('end')) return;
      e.preventDefault();
      const stop = g.mid[sel - 1];
      const y0 = e.clientY;
      let gone = false;
      let moved = false;
      const move = (ev: PointerEvent) => {
        moved = true;
        markFocus = true;
        stop.at = at(ev.clientX);
        gone = ev.clientY - y0 > 28 && g.mid.length > 0;
        g.mid.sort((x, y) => x.at - y.at);
        sel = g.mid.indexOf(stop) + 1;
        nudge();
        live();
        el.querySelectorAll('.st-gmark').forEach((x, i) => x.classList.toggle('gone', gone && i === sel));
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        markFocus = true;
        if (gone) drop(sel);
        else if (moved) done();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
    // Delete в окне — только про точки: выделенная фигура или слайд под окном не удаляются
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation();
      if ((e.target as Element).closest('.st-gmark')) drop(sel);
    });
    const inp = el.querySelector<HTMLInputElement>('[data-gc]')!;
    inp.addEventListener('input', () => { setColor(sel, inp.value.toUpperCase()); nudge(); live(); });
    inp.addEventListener('change', () => { setColor(sel, inp.value.toUpperCase()); done(); });
    if (o.tryPreset) {
      el.addEventListener('pointerover', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-gpre]');
        if (b) o.tryPreset!(Number(b.dataset.gpre));
      });
      el.querySelector('.st-gpre')?.addEventListener('pointerleave', () => o.tryPreset!(null));
    }
    paint();
  };
  /** Окно не из showPopover (палитра текста): щелчки по кнопкам панели — сюда; true — окно закрыть */
  const click = (e: Event): boolean | null => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    const a = b ? pick(b) : null;
    if (!a) return null;
    a.run();
    return !a.keep;
  };
  return { html, pick, bind, click };
}

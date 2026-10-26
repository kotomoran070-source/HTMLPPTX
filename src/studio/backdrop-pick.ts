/**
 * Выбор анимированного фона: лента плиток листается вбок (колесом, перетаскиванием, стрелками
 * по краям), наведение примеряет фон живьём на открытом слайде. Одна лента — у слайда (панель
 * свойств) и у темы («Дизайн» → «Фон анимации»).
 */
import { icon } from '../components/icons';
import { backdropStill, previewBackdrop } from '../components/backdrop/backdrop';
import { BACKDROPS, backdropName, isBackdrop, type BackdropKind } from '../engine/backdrops';
import { esc } from '../engine/html';
import { onSlidesLook, onThemeChange } from '../engine/theme';

/**
 * Плитки: cur — выбранное значение ('' — по умолчанию). theme — фон темы для слайда:
 * тогда первая плитка «Как в теме», вторая — «Без фона» (none)
 */
export function backdropStrip(cur: string, theme?: string | null): string {
  const t = isBackdrop(theme) ? theme : null;
  const opts: [value: string, name: string, look: string][] = [
    ...(t ? [['', `Как в теме · ${backdropName(t)}`, t] as [string, string, string], ['none', 'Без фона', ''] as [string, string, string]] : [['', 'Без фона', ''] as [string, string, string]]),
    ...BACKDROPS.map(([k, n]) => [k, n, k] as [string, string, string]),
  ];
  const [prev, next] = railNav();
  return `<div class="st-bdpick">${prev}`
    + `<div class="st-bdstrip" role="radiogroup" aria-label="Анимация фона">${opts.map(([v, n, look]) =>
      `<button type="button" role="radio" aria-checked="${v === cur}" data-backdrop="${v}" title="${esc(n)}"><i class="${look ? `backdrop bd-${look}` : ''}"${look ? ` data-bd="${look}"` : ''}></i><span>${esc(n)}</span></button>`).join('')}</div>`
    + `${next}</div>`;
}

/** Стрелки листания по краям ленты */
export const railNav = () => ['-1', '1'].map((d) =>
  `<button type="button" class="st-bdnav" data-nav="${d}" aria-label="${d === '-1' ? 'Листать влево' : 'Листать вправо'}" tabindex="-1">${icon(d === '-1' ? 'prev' : 'next')}</button>`);

/**
 * Лента, что листается вбок: колесом, перетаскиванием, стрелками по краям (они гаснут у концов).
 * root — обёртка со стрелками [data-nav], strip — сама прокручиваемая лента
 */
export function bindRail(root: HTMLElement, strip: HTMLElement): void {
  if (strip.dataset.bound) return;
  strip.dataset.bound = '1';
  const ends = () => {
    root.querySelector(':scope > [data-nav="-1"]')?.classList.toggle('off', strip.scrollLeft < 4);
    root.querySelector(':scope > [data-nav="1"]')?.classList.toggle('off', strip.scrollLeft > strip.scrollWidth - strip.clientWidth - 4);
  };
  strip.addEventListener('scroll', ends, { passive: true });
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY;
  }, { passive: false });
  root.querySelectorAll<HTMLElement>(':scope > [data-nav]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    strip.scrollBy({ left: Number(b.dataset.nav) * strip.clientWidth * 0.8, behavior: 'smooth' });
  }));
  // Выбранная плитка — на виду
  const cur = strip.querySelector<HTMLElement>('[aria-checked="true"], .on');
  if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2 - strip.offsetLeft);
  ends();
  requestAnimationFrame(ends);
}

/** Лента в контейнере: прокрутка вбок и живая примерка на слайде */
export function bindBackdropStrip(root: HTMLElement, stage: () => HTMLElement, theme?: string | null): void {
  const strip = root.querySelector<HTMLElement>('.st-bdstrip');
  if (!strip || strip.dataset.bound) return;
  bindRail(strip.parentElement!, strip);
  strip.addEventListener('pointerover', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-backdrop]');
    if (!b) return;
    const v = b.dataset.backdrop!;
    const kind: BackdropKind | 'none' = isBackdrop(v) ? v : v === 'none' || !isBackdrop(theme) ? 'none' : theme;
    previewBackdrop(stage(), kind);
  });
  strip.addEventListener('pointerleave', () => previewBackdrop(stage(), null));
  strip.addEventListener('click', () => previewBackdrop(stage(), null));
  fillStills(strip, stage().querySelector<HTMLElement>('.slide.on'));
  // Сменилась тема или вид слайдов — кадры в новых цветах; лента ушла со страницы — отписка
  const again = () => requestAnimationFrame(() => {
    if (!strip.isConnected) return offs.forEach((f) => f());
    fillStills(strip, stage().querySelector<HTMLElement>('.slide.on'));
  });
  const offs = [onThemeChange(again), onSlidesLook(again)];
}

/** Кадр плитки, точек: 16:9, с запасом под экраны с высокой плотностью */
const STILL_W = 240;
const STILL_H = 135;

/**
 * Плитки — настоящим кадром фона (та же сцена, что на слайде) на фоне открытого слайда и в его цветах.
 * Пока кадр не готов (или без WebGL) — статичный CSS того же вида. Кадры рисуются по нескольку за кадр
 * экрана: лента открывается сразу; нарисованные запоминаются
 */
function fillStills(strip: HTMLElement, slide: HTMLElement | null): void {
  if (!slide) return;
  const bg = getComputedStyle(slide).getPropertyValue('--bg').trim();
  const tiles = [...strip.querySelectorAll<HTMLElement>('button > i')];
  if (bg) tiles.forEach((i) => { i.style.backgroundColor = bg; });
  const todo = tiles.filter((i) => isBackdrop(i.dataset.bd));
  const step = () => {
    if (!strip.isConnected) return;
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 14) {
      const i = todo.shift()!;
      const url = backdropStill(i.dataset.bd as BackdropKind, slide, STILL_W, STILL_H);
      if (!url) continue;
      i.className = 'bd-still';
      i.style.backgroundImage = `url("${url}")`;
    }
    if (todo.length) requestAnimationFrame(step);
  };
  step();
}

// ---------------- прозрачность и скорость ----------------

export type TuneKey = 'backdropOpacity' | 'backdropSpeed' | 'bgOpacity';
/**
 * Ползунок: пределы — в его значениях; side — значение поля → положение ползунка и обратно (у прозрачности
 * ползунок показывает прозрачность, 0 % — фон виден полностью, а пишется непрозрачность, как в CSS)
 */
interface Tune { label: string; min: number; max: number; step: number; fmt(s: number): string; side?(v: number): number }
const CLEAR: Tune = { label: 'Прозрачность', min: 0, max: 0.9, step: 0.05, fmt: (s) => `${Math.round(s * 100)} %`, side: (v) => Math.round((1 - v) * 100) / 100 };
const TUNE: Record<TuneKey, Tune> = {
  backdropOpacity: CLEAR,
  bgOpacity: CLEAR,
  backdropSpeed: { label: 'Скорость', min: 0.25, max: 3, step: 0.25, fmt: (s) => `${String(s).replace('.', ',')}×` },
};
/** Значение поля ↔ положение ползунка (у прозрачности переход взаимно обратный) */
const flip = (t: Tune, v: number) => (t.side ? t.side(v) : v);

/**
 * Компактные ползунки под лентой фона: подпись, ползунок, значение. touch — галка «Отвечает на мышь»
 * (только у фонов, которые на неё отвечают; undefined — галки нет)
 */
export function tuneHtml(values: Partial<Record<TuneKey, number>>, touch?: boolean): string {
  return `<div class="st-tune">${(Object.keys(values) as TuneKey[]).map((k) => {
    const t = TUNE[k];
    const v = flip(t, values[k] ?? 1);
    return `<label><span>${t.label}</span><input type="range" data-tune="${k}" min="${t.min}" max="${t.max}" step="${t.step}" value="${v}"><output>${t.fmt(v)}</output></label>`;
  }).join('')}${touch === undefined ? '' : `<label class="st-p-check" title="Фон реагирует на мышь и щелчки"><input type="checkbox" data-tune="backdropTouch"${touch ? ' checked' : ''}><span>Отвечает на мышь и щелчки</span></label>`}</div>`;
}

/**
 * Ползунки: пока тянут — фон открытого слайда меняется сразу (без перестройки), отпустили —
 * значение записывается (1 — по умолчанию — убирает поле)
 */
export function bindTune(root: HTMLElement, stage: () => HTMLElement, commit: (key: TuneKey, v: number | undefined) => void, touch?: (on: boolean) => void): void {
  root.querySelectorAll<HTMLInputElement>('input[data-tune]').forEach((inp) => {
    if (inp.dataset.bound) return;
    inp.dataset.bound = '1';
    if (inp.type === 'checkbox') {
      inp.addEventListener('change', () => touch?.(inp.checked));
      return;
    }
    const key = inp.dataset.tune as TuneKey;
    const out = inp.parentElement?.querySelector('output');
    inp.addEventListener('input', () => {
      const v = flip(TUNE[key], Number(inp.value));
      if (out) out.textContent = TUNE[key].fmt(Number(inp.value));
      const slide = stage().querySelector<HTMLElement>(':scope > .slide.on');
      if (!slide) return;
      if (key === 'bgOpacity') {
        const bg = slide.querySelector<HTMLElement>(':scope > .canvas-bg');
        if (bg) bg.style.opacity = String(v);
      } else {
        slide.querySelectorAll<HTMLElement>(':scope > .backdrop').forEach((b) => {
          if (key === 'backdropOpacity') b.style.setProperty('--bd-op', String(v));
          else b.dataset.speed = String(v);
        });
      }
    });
    inp.addEventListener('change', () => {
      const v = flip(TUNE[key], Number(inp.value));
      commit(key, Math.abs(v - 1) < 1e-6 ? undefined : v);
    });
  });
}

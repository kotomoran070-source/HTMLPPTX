/**
 * Панель «Цвет» — цветокоррекция картинки, как в DaVinci Resolve: баланс белого и экспозиция,
 * цветовые круги теней, полутонов и светов, кривые, HSL по цветам, 3D LUT (.cube), карта
 * градиента в цвета бренда, виньетка и зерно. Предпросмотр «до / после», гистограмма и
 * вектороскоп, готовые образы на самой картинке.
 *
 * Исходный файл не меняется: результат запекается в новый файл в assets/, а в данных картинки
 * остаются путь к исходнику и параметры (grade) — по ним правят заново или сбрасывают.
 */
import { icon } from '../../components/icons';
import { DEFAULT_ACCENT, HEX_RE } from '../../engine/accent';
import { cssKey } from '../../engine/deck-css';
import { getAt, type Path } from '../../engine/data';
import type { Editor } from '../../engine/editor/editor';
import { esc } from '../../engine/html';
import type { Block, Deck } from '../../types';
import { parseCube, type Lut } from './cube';
import { GradeGL, wheelColor } from './gl';
import { BANDS, brandStops, compact, curveTable as tableOf, isNeutral, LOOKS, type Band, type CurvePoint, type Grade, type Wheel } from './grade';
import './color.css';

export interface ColorHost {
  deck: Deck;
  editor: Editor;
}

/** Поле с картинкой: у блока image — src, у плитки — image */
export const imageKey = (b: Block): 'src' | 'image' => (b.type === 'image' ? 'src' : 'image');
const GIF = /^data:image\/gif[;,]|\.gif(?:[?#]|$)/i;
const SVG = /^data:image\/svg|\.svg(?:[?#]|$)/i;

/** Можно ли править цвет картинки: есть файл, не анимированный GIF */
export function gradable(b: Block | undefined): boolean {
  if (!b || (b.type !== 'image' && b.type !== 'tile')) return false;
  const v = b[imageKey(b)];
  return typeof v === 'string' && !!v && !GIF.test(v);
}

/** Исходная картинка блока: до цветокоррекции */
const originalOf = (b: Block): string => {
  const g = b.grade as Grade | undefined;
  return typeof g?.src === 'string' && g.src ? g.src : String(b[imageKey(b)]);
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('картинка не загрузилась'));
    img.src = url;
  });
}

/** Картинка → источник для видеокарты; SVG — растром не меньше 1600 px по ширине */
async function source(url: string): Promise<{ src: TexImageSource; w: number; h: number; alpha: boolean }> {
  const img = await loadImage(url);
  let w = img.naturalWidth || 1600;
  let h = img.naturalHeight || 900;
  if (SVG.test(url)) {
    const k = Math.max(1, 1600 / w);
    w = Math.round(w * k);
    h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return { src: c, w, h, alpha: true };
  }
  // Прозрачность — по уменьшенной копии: JPEG для фото, PNG для картинок с прозрачными местами
  const c = document.createElement('canvas');
  const k = Math.min(1, 256 / Math.max(w, h));
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let alpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
  return { src: img, w, h, alpha };
}

/** Имя готового файла: от исходного, с отпечатком параметров */
function bakedName(original: string, g: Grade, alpha: boolean): string {
  let base = 'image';
  try { base = decodeURIComponent(original.split(/[?#]/)[0].split('/').pop() ?? 'image'); } catch { /* имя как есть */ }
  if (original.startsWith('data:')) base = 'image';
  const stem = base.replace(/\.[a-z0-9]+$/i, '').replace(/-cg-[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'image';
  return `${stem}-cg-${cssKey(JSON.stringify(compact({ ...g, src: undefined })))}.${alpha ? 'png' : 'jpg'}`;
}

/** Все картинки презентации, которые можно перекрасить (фото: без SVG и GIF) */
function photos(deck: Deck): Path[] {
  const out: Path[] = [];
  const walk = (v: unknown, p: Path): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...p, i])); return; }
    if (!v || typeof v !== 'object') return;
    const b = v as Block;
    if ((b.type === 'image' || b.type === 'tile') && gradable(b) && !SVG.test(originalOf(b))) out.push(p);
    for (const [k, x] of Object.entries(b)) if (k !== 'grade' && x && typeof x === 'object') walk(x, [...p, k]);
  };
  walk(deck.slides, ['slides']);
  return out;
}

const SLIDERS: [key: keyof Grade, label: string, min: number, max: number, step: number, cls?: string][] = [
  ['temp', 'Температура', -100, 100, 1, 'temp'],
  ['tint', 'Оттенок', -100, 100, 1, 'tint'],
  ['exposure', 'Экспозиция', -3, 3, 0.05],
  ['contrast', 'Контраст', -100, 100, 1],
  ['highlights', 'Света', -100, 100, 1],
  ['shadows', 'Тени', -100, 100, 1],
  ['saturation', 'Насыщенность', -100, 100, 1],
  ['vibrance', 'Красочность', -100, 100, 1],
  ['vignette', 'Виньетка', -100, 100, 1],
  ['grain', 'Зерно', 0, 100, 1],
];
const BAND_NAMES: Record<Band, [string, string]> = {
  red: ['Красный', '#EF4444'], orange: ['Оранжевый', '#F97316'], yellow: ['Жёлтый', '#EAB308'], green: ['Зелёный', '#22C55E'],
  aqua: ['Голубой', '#06B6D4'], blue: ['Синий', '#3B82F6'], purple: ['Фиолетовый', '#8B5CF6'], magenta: ['Пурпурный', '#EC4899'],
};
const WHEELS: [key: 'lift' | 'gamma' | 'gain', label: string][] = [['lift', 'Тени'], ['gamma', 'Полутона'], ['gain', 'Света']];
const TABS: [id: string, label: string][] = [['basic', 'Основное'], ['wheels', 'Круги'], ['curves', 'Кривые'], ['hsl', 'HSL'], ['lut', 'LUT'], ['brand', 'Бренд']];
const CHANNELS: ['all' | 'r' | 'g' | 'b', string, string][] = [['all', 'Все', '#E5E7EB'], ['r', 'R', '#F87171'], ['g', 'G', '#4ADE80'], ['b', 'B', '#60A5FA']];

const fmt = (v: number, step: number) => (step < 1 ? v.toFixed(2).replace('-0.00', '0.00') : String(Math.round(v)));

let open = false;

/** Открыть панель «Цвет» для картинки по пути блока */
export async function openColor(h: ColorHost, path: Path): Promise<void> {
  if (open) return;
  const { deck, editor: ed } = h;
  const block = getAt(deck, path) as Block | undefined;
  if (!block || !gradable(block)) {
    ed.toast('Цвет меняется у неподвижных картинок: выделите фото или картинку', 3500, true);
    return;
  }
  let gl: GradeGL;
  try {
    gl = new GradeGL();
  } catch {
    ed.toast('Цветокоррекции нужна видеокарта с WebGL2', 4000, true);
    return;
  }
  const original = originalOf(block);
  let pic: Awaited<ReturnType<typeof source>>;
  try {
    pic = await source(original);
  } catch (e) {
    gl.dispose();
    ed.toast(`Не удалось открыть картинку: ${(e as Error).message}`, 4000, true);
    return;
  }
  open = true;
  gl.setImage(pic.src, pic.w, pic.h);
  const theme = deck.theme ?? {};
  const accent = typeof theme.accent === 'string' && HEX_RE.test(theme.accent) ? theme.accent : DEFAULT_ACCENT;
  const accent2 = typeof theme.accent2 === 'string' && HEX_RE.test(theme.accent2) ? theme.accent2 : null;
  const brand = brandStops(accent, accent2);
  let g: Grade = structuredClone(compact((block.grade as Grade | undefined) ?? {}));
  delete g.src;
  let lut: Lut | null = null;
  if (g.lut) {
    try {
      lut = parseCube(await (await fetch(g.lut)).text());
      gl.setLut(lut);
    } catch {
      ed.toast(`LUT «${g.lutName ?? 'файл'}» не найден — коррекция без него`, 3500, true);
      delete g.lut;
    }
  }
  const history: Grade[] = [];
  let split = -1;
  let tab = 'basic';
  let band: Band = 'red';
  let channel: 'all' | 'r' | 'g' | 'b' = 'all';

  const name = (() => { try { return decodeURIComponent(original.split(/[?#]/)[0].split('/').pop() ?? ''); } catch { return ''; } })();
  const back = document.createElement('div');
  back.className = 'cg-back';
  back.innerHTML = `<div class="cg" role="dialog" aria-label="Цветокоррекция">
  <header class="cg-head"><b>Цвет</b><span class="cg-file">${original.startsWith('data:') ? '' : esc(name)}</span>
    <span class="cg-sp"></span>
    <button type="button" class="cg-btn" data-a="split" title="До и после: тяните границу по картинке (\\)">${icon('columns')}<span>До / после</span></button>
    <button type="button" class="cg-x" data-a="cancel" title="Закрыть без изменений (Esc)" aria-label="Закрыть">${icon('close')}</button>
  </header>
  <div class="cg-main">
    <div class="cg-view">
      <div class="cg-stage"><div class="cg-frame"><i class="cg-line" hidden></i></div></div>
      <div class="cg-scopes"><canvas class="cg-hist" title="Гистограмма: яркость и каналы"></canvas><canvas class="cg-vec" title="Вектороскоп: оттенки и насыщенность"></canvas></div>
    </div>
    <div class="cg-side">
      <nav class="cg-tabs" role="tablist">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}">${l}</button>`).join('')}</nav>
      <div class="cg-pane" data-pane="basic">${SLIDERS.map(([k, l, min, max, step, cls]) => `<label class="cg-sl${cls ? ` ${cls}` : ''}" data-k="${k}" title="Двойной щелчок — сбросить"><span>${l}</span><input type="range" min="${min}" max="${max}" step="${step}" data-k="${k}"><output></output></label>`).join('')}</div>
      <div class="cg-pane" data-pane="wheels" hidden><div class="cg-wheels">${WHEELS.map(([k, l]) => `<div class="cg-wheel" data-w="${k}"><div class="cg-wc"><canvas width="132" height="132"></canvas><i class="cg-puck"></i></div><b>${l}</b><input type="range" min="-1" max="1" step="0.01" data-m="${k}" title="Яркость: ${l.toLowerCase()}" aria-label="Яркость: ${l.toLowerCase()}"></div>`).join('')}</div><p class="cg-note">Тяните точку к цвету — оттенок в тенях, полутонах или светах. Двойной щелчок — сброс</p></div>
      <div class="cg-pane" data-pane="curves" hidden><div class="cg-chans">${CHANNELS.map(([k, l, c]) => `<button type="button" data-ch="${k}" style="--c:${c}">${l}</button>`).join('')}</div><canvas class="cg-curve" width="320" height="320"></canvas><p class="cg-note">Щелчок — точка, тяните её. Двойной щелчок по точке — убрать</p></div>
      <div class="cg-pane" data-pane="hsl" hidden><div class="cg-bands">${BANDS.map((b) => `<button type="button" data-b="${b}" title="${BAND_NAMES[b][0]}" style="--c:${BAND_NAMES[b][1]}"><i></i></button>`).join('')}</div>
        <b class="cg-bandname"></b>${['Оттенок', 'Насыщенность', 'Яркость'].map((l, i) => `<label class="cg-sl" title="Двойной щелчок — сбросить"><span>${l}</span><input type="range" min="-100" max="100" step="1" data-h="${i}"><output></output></label>`).join('')}</div>
      <div class="cg-pane" data-pane="lut" hidden><button type="button" class="cg-btn wide" data-a="lut">${icon('upload')}<span>Загрузить .cube</span></button><p class="cg-lutname"></p>
        <label class="cg-sl" title="Двойной щелчок — сбросить"><span>Сила</span><input type="range" min="0" max="100" step="1" data-lut="mix"><output></output></label>
        <button type="button" class="cg-link" data-a="lut-off">Убрать LUT</button><p class="cg-note">3D LUT из DaVinci Resolve, Premiere, Photoshop и с сайтов LUT. Хранится в папке презентации</p></div>
      <div class="cg-pane" data-pane="brand" hidden><div class="cg-stops">${['Тени', 'Середина', 'Света'].map((l, i) => `<label><input type="color" data-d="${i}"><span>${l}</span></label>`).join('')}</div>
        <label class="cg-sl" title="Двойной щелчок — сбросить"><span>Сила</span><input type="range" min="0" max="100" step="1" data-duo="mix"><output></output></label>
        <button type="button" class="cg-link" data-a="brand">Цвета презентации</button><p class="cg-note">Тёмные места — в первый цвет, светлые — в последний: снимки разных съёмок выглядят как одна серия</p></div>
    </div>
  </div>
  <div class="cg-looks">${LOOKS.map((l) => `<button type="button" class="cg-look" data-look="${l.id}" title="${esc(l.name)}"><canvas></canvas><span>${esc(l.name)}</span></button>`).join('')}</div>
  <footer class="cg-foot">
    <button type="button" class="cg-btn" data-a="reset">${icon('reset')}<span>Сбросить</span></button>
    <button type="button" class="cg-btn" data-a="all" title="Та же коррекция для всех фото презентации — одна серия">${icon('layers')}<span>Ко всем картинкам</span></button>
    <span class="cg-sp"></span>
    <button type="button" class="cg-btn" data-a="cancel">Отмена</button>
    <button type="button" class="cg-btn primary" data-a="done">Готово</button>
  </footer>
</div>`;
  document.body.appendChild(back);
  const $ = <T extends Element>(s: string) => back.querySelector<T>(s)!;
  const frame = $<HTMLElement>('.cg-frame');
  frame.prepend(gl.canvas);
  gl.canvas.classList.add('cg-canvas');

  // ---------- предпросмотр ----------
  let frameReq = 0;
  let scopeTimer = 0;
  const fit = () => {
    const stage = $<HTMLElement>('.cg-stage').getBoundingClientRect();
    const k = Math.min(stage.width / pic.w, stage.height / pic.h);
    frame.style.width = `${Math.floor(pic.w * k)}px`;
    frame.style.height = `${Math.floor(pic.h * k)}px`;
  };
  const draw = () => {
    frameReq = 0;
    const r = frame.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    gl.draw(g, Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr)), split);
  };
  const render = () => {
    if (!frameReq) frameReq = requestAnimationFrame(draw);
    clearTimeout(scopeTimer);
    scopeTimer = window.setTimeout(scopes, 90);
  };

  // ---------- гистограмма и вектороскоп ----------
  const hist = $<HTMLCanvasElement>('.cg-hist');
  const vec = $<HTMLCanvasElement>('.cg-vec');
  let lastPx: Uint8Array | null = null;
  const scopes = () => {
    const w = 240;
    const hh = Math.max(1, Math.round(w * pic.h / pic.w));
    const px = gl.read(g, w, hh);
    lastPx = px;
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < px.length; i += 4) {
      bins[0][px[i]]++;
      bins[1][px[i + 1]]++;
      bins[2][px[i + 2]]++;
      bins[3][Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [hist, vec]) {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const x = hist.getContext('2d')!;
    const W = hist.width;
    const H = hist.height;
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    const peak = Math.max(1, ...bins.slice(0, 3).map((b) => Math.max(...b.slice(2, 254))));
    [['rgba(248,113,113,.55)', 0], ['rgba(74,222,128,.55)', 1], ['rgba(96,165,250,.55)', 2], ['rgba(229,231,235,.28)', 3]].forEach(([col, k]) => {
      x.fillStyle = col as string;
      x.beginPath();
      x.moveTo(0, H);
      for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, bins[k as number][i] / peak) * H * 0.95);
      x.lineTo(W, H);
      x.fill();
    });
    x.globalCompositeOperation = 'source-over';
    // Вектороскоп: каждый пиксель — точка по цветоразностям (оттенок — угол, насыщенность — радиус)
    const v = vec.getContext('2d')!;
    const S = Math.min(vec.width, vec.height);
    const cx = vec.width / 2;
    const cy = vec.height / 2;
    v.clearRect(0, 0, vec.width, vec.height);
    v.strokeStyle = 'rgba(255,255,255,.12)';
    v.lineWidth = 1;
    v.beginPath();
    v.arc(cx, cy, S * 0.45, 0, Math.PI * 2);
    v.moveTo(cx - S * 0.45, cy);
    v.lineTo(cx + S * 0.45, cy);
    v.moveTo(cx, cy - S * 0.45);
    v.lineTo(cx, cy + S * 0.45);
    v.stroke();
    // Линия тона кожи (Resolve: ~123° от оси Cb)
    v.strokeStyle = 'rgba(251,191,36,.35)';
    v.beginPath();
    v.moveTo(cx, cy);
    v.lineTo(cx + Math.cos(-2.15) * S * 0.45, cy + Math.sin(-2.15) * S * 0.45);
    v.stroke();
    const img = v.getImageData(0, 0, vec.width, vec.height);
    const d = img.data;
    for (let i = 0; i < px.length; i += 8) {
      const r = px[i] / 255;
      const gg = px[i + 1] / 255;
      const b = px[i + 2] / 255;
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const cb = (b - y) / 1.8556;
      const cr = (r - y) / 1.5748;
      const X = Math.round(cx + cb * S * 0.9);
      const Y = Math.round(cy - cr * S * 0.9);
      if (X < 0 || Y < 0 || X >= vec.width || Y >= vec.height) continue;
      const o = (Y * vec.width + X) * 4;
      d[o] = Math.min(255, d[o] + 18 + px[i] * 0.12);
      d[o + 1] = Math.min(255, d[o + 1] + 18 + px[i + 1] * 0.12);
      d[o + 2] = Math.min(255, d[o + 2] + 18 + px[i + 2] * 0.12);
      d[o + 3] = Math.min(255, d[o + 3] + 60);
    }
    v.putImageData(img, 0, 0);
    if (tab === 'curves') drawCurve();
  };

  // ---------- состояние в панели ----------
  const remember = () => {
    history.push(structuredClone(g));
    if (history.length > 80) history.shift();
  };
  const sync = () => {
    back.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((inp) => {
      const k = inp.dataset.k as keyof Grade;
      const v = Number(g[k] ?? 0);
      if (document.activeElement !== inp) inp.value = String(v);
      inp.nextElementSibling!.textContent = fmt(v, Number(inp.step));
      inp.closest('label')!.classList.toggle('on', Math.abs(v) > 1e-4);
    });
    back.querySelectorAll<HTMLElement>('.cg-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    back.querySelectorAll<HTMLElement>('.cg-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    // Отметки у вкладок, где что-то изменено
    const changed: Record<string, boolean> = {
      basic: SLIDERS.some(([k]) => Math.abs(Number(g[k] ?? 0)) > 1e-4),
      wheels: WHEELS.some(([k]) => !!g[k]?.some((v) => Math.abs(v) > 1e-4)),
      curves: !isNeutral({ curves: g.curves }),
      hsl: !isNeutral({ hsl: g.hsl }),
      lut: !!g.lut,
      brand: !!g.duo && (g.duoMix ?? 0) > 0,
    };
    back.querySelectorAll<HTMLElement>('.cg-tabs [data-tab]').forEach((b) => b.classList.toggle('dot', !!changed[b.dataset.tab!]));
    for (const [k] of WHEELS) {
      const w = g[k] ?? [0, 0, 0];
      const el = back.querySelector<HTMLElement>(`.cg-wheel[data-w="${k}"]`)!;
      const puck = el.querySelector<HTMLElement>('.cg-puck')!;
      puck.style.left = `${50 + w[0] * 42}%`;
      puck.style.top = `${50 - w[1] * 42}%`;
      const m = el.querySelector<HTMLInputElement>('input')!;
      if (document.activeElement !== m) m.value = String(w[2] ?? 0);
    }
    back.querySelectorAll<HTMLElement>('.cg-chans [data-ch]').forEach((b) => b.classList.toggle('on', b.dataset.ch === channel));
    back.querySelectorAll<HTMLElement>('.cg-bands [data-b]').forEach((b) => {
      b.classList.toggle('on', b.dataset.b === band);
      b.classList.toggle('dot', !!g.hsl?.[b.dataset.b as Band]?.some((v) => Math.abs(v) > 1e-4));
    });
    $<HTMLElement>('.cg-bandname').textContent = BAND_NAMES[band][0];
    const hb = g.hsl?.[band] ?? [0, 0, 0];
    back.querySelectorAll<HTMLInputElement>('input[data-h]').forEach((inp) => {
      const v = Math.round(hb[Number(inp.dataset.h)] * 100);
      if (document.activeElement !== inp) inp.value = String(v);
      inp.nextElementSibling!.textContent = String(v);
    });
    const lm = $<HTMLInputElement>('input[data-lut]');
    lm.value = String(Math.round((g.lutMix ?? 1) * 100));
    lm.nextElementSibling!.textContent = lm.value;
    $<HTMLElement>('.cg-lutname').textContent = g.lut ? (g.lutName ?? 'LUT') : 'Без LUT';
    lm.closest('label')!.classList.toggle('off', !g.lut);
    const stops = g.duo ?? brand;
    back.querySelectorAll<HTMLInputElement>('input[data-d]').forEach((inp) => { inp.value = stops[Number(inp.dataset.d)].toLowerCase(); });
    const dm = $<HTMLInputElement>('input[data-duo]');
    dm.value = String(Math.round((g.duo ? g.duoMix ?? 0 : 0) * 100));
    dm.nextElementSibling!.textContent = dm.value;
    $<HTMLElement>('[data-a="split"]').classList.toggle('on', split >= 0);
    const line = $<HTMLElement>('.cg-line');
    line.hidden = split < 0;
    line.style.left = `${split * 100}%`;
    back.querySelectorAll<HTMLElement>('.cg-look').forEach((b) => b.classList.toggle('on', JSON.stringify(compact(lookGrade(b.dataset.look!))) === JSON.stringify(compact({ ...g, lut: undefined, lutName: undefined, lutMix: undefined }))));
    if (tab === 'curves') drawCurve();
  };
  const changed = () => {
    sync();
    render();
  };

  // ---------- регуляторы ----------
  back.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('input[type="range"]')) remember();
  });
  back.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.k) (g as Record<string, unknown>)[t.dataset.k] = Number(t.value);
    else if (t.dataset.m) {
      const k = t.dataset.m as 'lift' | 'gamma' | 'gain';
      const w = [...(g[k] ?? [0, 0, 0])] as Wheel;
      w[2] = Number(t.value);
      g[k] = w;
    } else if (t.dataset.h) {
      const hsl = { ...(g.hsl ?? {}) };
      const b = [...(hsl[band] ?? [0, 0, 0])] as [number, number, number];
      b[Number(t.dataset.h)] = Number(t.value) / 100;
      hsl[band] = b;
      g.hsl = hsl;
    } else if (t.dataset.lut) g.lutMix = Number(t.value) / 100;
    else if (t.dataset.duo) {
      if (!g.duo) g.duo = [...brand];
      g.duoMix = Number(t.value) / 100;
    } else if (t.dataset.d) {
      const d = [...(g.duo ?? brand)] as [string, string, string];
      d[Number(t.dataset.d)] = t.value.toUpperCase();
      g.duo = d;
      if (!g.duoMix) g.duoMix = 1;
    } else return;
    changed();
  });
  // Двойной щелчок по ползунку — ноль
  back.addEventListener('dblclick', (e) => {
    const l = (e.target as Element).closest<HTMLElement>('.cg-sl');
    const inp = l?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!inp) return;
    remember();
    inp.value = inp.dataset.lut || inp.dataset.duo ? (inp.dataset.lut ? '100' : '0') : '0';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ---------- цветовые круги ----------
  back.querySelectorAll<HTMLElement>('.cg-wheel').forEach((el) => {
    const c = el.querySelector('canvas')!;
    const x = c.getContext('2d')!;
    const im = x.createImageData(c.width, c.height);
    const R = c.width / 2;
    for (let py = 0; py < c.height; py++) {
      for (let px = 0; px < c.width; px++) {
        const dx = (px + 0.5 - R) / R;
        const dy = -(py + 0.5 - R) / R;
        const r = Math.hypot(dx, dy);
        const o = (py * c.width + px) * 4;
        if (r > 1) continue;
        const off = wheelColor([dx, dy, 0]);
        const base = 0.42;
        im.data[o] = Math.round(Math.min(1, base + off[0] * 0.9) * 255);
        im.data[o + 1] = Math.round(Math.min(1, base + off[1] * 0.9) * 255);
        im.data[o + 2] = Math.round(Math.min(1, base + off[2] * 0.9) * 255);
        im.data[o + 3] = Math.round(255 * Math.min(1, (1 - r) * R));
      }
    }
    x.putImageData(im, 0, 0);
    const k = el.dataset.w as 'lift' | 'gamma' | 'gain';
    const set = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      let dx = ((e.clientX - r.left) / r.width - 0.5) / 0.42;
      let dy = -((e.clientY - r.top) / r.height - 0.5) / 0.42;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      // Точнее у центра: тонкие сдвиги — основная работа колористов
      const ease = (v: number) => Math.sign(v) * Math.abs(v) ** 1.35;
      const w = [...(g[k] ?? [0, 0, 0])] as Wheel;
      w[0] = ease(dx);
      w[1] = ease(dy);
      g[k] = w;
      changed();
    };
    c.addEventListener('pointerdown', (e) => {
      remember();
      c.setPointerCapture(e.pointerId);
      set(e);
      const move = (ev: PointerEvent) => set(ev);
      const up = () => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); };
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', up);
    });
    c.addEventListener('dblclick', () => {
      remember();
      delete g[k];
      changed();
    });
  });

  // ---------- кривые ----------
  const cv = $<HTMLCanvasElement>('.cg-curve');
  const pointsOf = (): CurvePoint[] => [...(g.curves?.[channel] ?? [[0, 0], [1, 1]])].sort((a, b) => a[0] - b[0]);
  const setPoints = (p: CurvePoint[]) => { g.curves = { ...(g.curves ?? {}), [channel]: p }; };
  function drawCurve(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const x = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    x.clearRect(0, 0, W, H);
    // Гистограмма канала — подсказка, где тени и света картинки
    if (lastPx) {
      const bins = new Uint32Array(256);
      const ci = { all: -1, r: 0, g: 1, b: 2 }[channel];
      for (let i = 0; i < lastPx.length; i += 4) bins[ci < 0 ? Math.round(0.2126 * lastPx[i] + 0.7152 * lastPx[i + 1] + 0.0722 * lastPx[i + 2]) : lastPx[i + ci]]++;
      const peak = Math.max(1, ...bins.slice(2, 254));
      x.fillStyle = 'rgba(255,255,255,.07)';
      x.beginPath();
      x.moveTo(0, H);
      for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, bins[i] / peak) * H * 0.9);
      x.lineTo(W, H);
      x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.1)';
    x.lineWidth = 1;
    x.beginPath();
    for (let i = 1; i < 4; i++) {
      x.moveTo((W * i) / 4, 0); x.lineTo((W * i) / 4, H);
      x.moveTo(0, (H * i) / 4); x.lineTo(W, (H * i) / 4);
    }
    x.moveTo(0, H); x.lineTo(W, 0);
    x.stroke();
    const col = CHANNELS.find((c) => c[0] === channel)![2];
    const t = curveTableFor(pointsOf());
    x.strokeStyle = col;
    x.lineWidth = 2 * dpr;
    x.beginPath();
    for (let i = 0; i < 256; i++) {
      const X = (i / 255) * W;
      const Y = H - t[i] * H;
      if (i) x.lineTo(X, Y); else x.moveTo(X, Y);
    }
    x.stroke();
    x.fillStyle = '#0B0D12';
    x.strokeStyle = col;
    for (const [px, py] of pointsOf()) {
      x.beginPath();
      x.arc(px * W, H - py * H, 5 * dpr, 0, Math.PI * 2);
      x.fill();
      x.stroke();
    }
  }
  const curveTableFor = (p: CurvePoint[]) => {
    const keep = g.curves;
    g.curves = { ...(g.curves ?? {}), [channel]: p };
    const t = tableOf(g.curves[channel]);
    g.curves = keep;
    return t;
  };
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect();
    const at = (ev: PointerEvent): CurvePoint => [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height))];
    const p = pointsOf();
    const [mx, my] = at(e);
    let i = p.findIndex(([x, y]) => Math.hypot((x - mx) * r.width, (y - my) * r.height) < 10);
    remember();
    if (i < 0) {
      p.push([mx, my]);
      p.sort((a, b) => a[0] - b[0]);
      i = p.findIndex(([x, y]) => x === mx && y === my);
    }
    const edge = i === 0 || i === p.length - 1;
    cv.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const [x, y] = at(ev);
      // Крайние точки ходят только по высоте; остальные — не заходят за соседей
      const lo = i > 0 ? p[i - 1][0] + 0.01 : 0;
      const hi = i < p.length - 1 ? p[i + 1][0] - 0.01 : 1;
      p[i] = [edge ? p[i][0] : Math.max(lo, Math.min(hi, x)), y];
      setPoints([...p]);
      changed();
    };
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    setPoints([...p]);
    changed();
  });
  cv.addEventListener('dblclick', (e) => {
    const r = cv.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width;
    const my = 1 - (e.clientY - r.top) / r.height;
    const p = pointsOf();
    const i = p.findIndex(([x, y]) => Math.hypot((x - mx) * r.width, (y - my) * r.height) < 10);
    if (i <= 0 || i >= p.length - 1) return;
    remember();
    p.splice(i, 1);
    setPoints(p);
    changed();
  });

  // ---------- образы: плитки на самой картинке ----------
  function lookGrade(id: string): Grade {
    const l = LOOKS.find((x) => x.id === id);
    if (!l) return {};
    const out = structuredClone(l.grade);
    if (l.brand) out.duo = [...brand];
    return out;
  }
  const looks = () => {
    const tw = 128;
    const th = Math.max(1, Math.round(tw * Math.min(0.75, pic.h / pic.w)));
    back.querySelectorAll<HTMLElement>('.cg-look').forEach((b) => {
      const c = b.querySelector('canvas')!;
      const src = gl.canvasOf(lookGrade(b.dataset.look!), tw * 2, th * 2);
      c.width = tw * 2;
      c.height = th * 2;
      c.getContext('2d')!.drawImage(src, 0, 0);
    });
  };

  // ---------- до / после ----------
  frame.addEventListener('pointerdown', (e) => {
    if (split < 0) return;
    const r = frame.getBoundingClientRect();
    const set = (ev: PointerEvent) => { split = Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width)); changed(); };
    frame.setPointerCapture(e.pointerId);
    set(e);
    const move = (ev: PointerEvent) => set(ev);
    const up = () => { frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', up); };
    frame.addEventListener('pointermove', move);
    frame.addEventListener('pointerup', up);
  });

  // ---------- закрытие и запекание ----------
  const close = () => {
    open = false;
    cancelAnimationFrame(frameReq);
    clearTimeout(scopeTimer);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    back.remove();
    gl.dispose();
  };
  /** Файл — в assets/ (в файле без проекта — внутрь данных) */
  const store = async (blob: Blob, fileName: string) => ed.storeAsset(blob, fileName);
  const commitOne = async () => {
    if (isNeutral(g)) {
      ed.commit((d) => {
        const b = getAt(d, path) as Block;
        b[imageKey(b)] = original;
        delete b.grade;
      }, { rebuild: true });
      close();
      return;
    }
    ed.toast('Цвет применяется…', 0);
    try {
      const blob = await gl.bake(g, pic.alpha);
      const url = await store(blob, bakedName(original, g, pic.alpha));
      const grade = { ...compact(g), src: original };
      ed.commit((d) => {
        const b = getAt(d, path) as Block;
        b[imageKey(b)] = url;
        b.grade = grade;
      }, { rebuild: true });
      ed.toast('Цвет применён. Исходный файл не изменён — «Сбросить» в панели вернёт его', 3500);
      close();
    } catch (e) {
      ed.toast(`Не удалось применить цвет: ${(e as Error).message}`, 5000, true);
    }
  };
  const applyAll = async () => {
    const paths = photos(deck);
    if (!paths.length) return;
    const neutral = isNeutral(g);
    const done: { path: Path; url: string; grade?: Grade }[] = [];
    try {
      for (let i = 0; i < paths.length; i++) {
        ed.toast(`Картинки: ${i + 1} из ${paths.length}…`, 0);
        const b = getAt(deck, paths[i]) as Block;
        const orig = originalOf(b);
        if (neutral) { done.push({ path: paths[i], url: orig }); continue; }
        const p = await source(orig);
        gl.setImage(p.src, p.w, p.h);
        const url = await store(await gl.bake(g, p.alpha), bakedName(orig, g, p.alpha));
        done.push({ path: paths[i], url, grade: { ...compact(g), src: orig } });
      }
    } catch (e) {
      ed.toast(`Не удалось перекрасить картинки: ${(e as Error).message}`, 5000, true);
      gl.setImage(pic.src, pic.w, pic.h);
      return;
    }
    ed.commit((d) => {
      for (const it of done) {
        const b = getAt(d, it.path) as Block;
        b[imageKey(b)] = it.url;
        if (it.grade) b.grade = it.grade;
        else delete b.grade;
      }
    }, { rebuild: true });
    ed.toast(neutral ? `Исходный цвет у ${done.length} картинок` : `Одна коррекция у ${done.length} картинок — вернуть: Ctrl+Z`, 3500);
    close();
  };

  back.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === back) { close(); return; }
    const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
    const tb = t.closest<HTMLElement>('.cg-tabs [data-tab]')?.dataset.tab;
    const ch = t.closest<HTMLElement>('[data-ch]')?.dataset.ch;
    const bd = t.closest<HTMLElement>('[data-b]')?.dataset.b;
    const look = t.closest<HTMLElement>('[data-look]')?.dataset.look;
    if (tb) { tab = tb; sync(); if (tab === 'curves') requestAnimationFrame(drawCurve); return; }
    if (ch) { channel = ch as typeof channel; sync(); return; }
    if (bd) { band = bd as Band; sync(); return; }
    if (look) {
      remember();
      const keepLut = g.lut ? { lut: g.lut, lutName: g.lutName, lutMix: g.lutMix } : {};
      g = { ...lookGrade(look), ...keepLut };
      changed();
      return;
    }
    switch (a) {
      case 'cancel': close(); break;
      case 'done': void commitOne(); break;
      case 'all': void applyAll(); break;
      case 'reset': remember(); g = {}; lut = null; gl.setLut(null); changed(); break;
      case 'split': split = split < 0 ? 0.5 : -1; changed(); break;
      case 'brand': remember(); g.duo = [...brand]; if (!g.duoMix) g.duoMix = 1; changed(); break;
      case 'lut-off': remember(); delete g.lut; delete g.lutName; delete g.lutMix; lut = null; gl.setLut(null); changed(); break;
      case 'lut': {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.cube';
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (!f) return;
          try {
            const parsed = parseCube(await f.text());
            remember();
            lut = parsed;
            gl.setLut(parsed);
            g.lut = await store(f, f.name.replace(/[^\p{L}\p{N}._-]+/gu, '-'));
            g.lutName = parsed.title || f.name.replace(/\.cube$/i, '');
            g.lutMix = 1;
            changed();
          } catch (e) {
            ed.toast(`Не похоже на LUT .cube: ${(e as Error).message}`, 4500, true);
          }
        };
        inp.click();
        break;
      }
    }
  });
  const onKey = (e: KeyboardEvent) => {
    if (!back.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.stopPropagation();
      const prev = history.pop();
      if (prev) { g = prev; changed(); }
      return;
    }
    if (e.key === '\\') { split = split < 0 ? 0.5 : -1; changed(); e.preventDefault(); }
    // Клавиши редактора (Delete, стрелки) не трогают слайд, пока панель открыта
    if (!(e.target as Element)?.closest?.('input')) e.stopPropagation();
  };
  const onResize = () => { fit(); render(); };
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);
  fit();
  sync();
  draw();
  scopes();
  requestAnimationFrame(looks);
}

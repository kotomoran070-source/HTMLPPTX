/**
 * Блоки с постоянным движением: бегущая строка и текст по окружности. Движение идёт, пока слайд
 * открыт (в правке — тоже, наведение останавливает строку, чтобы править пункт); в миниатюрах,
 * PDF и при «меньше движения» — неподвижный вид, строка с начала.
 */
import { defineBlock } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { logoImg } from '../templates/content';
import './motion.css';

// ---------------- бегущая строка ----------------

interface MarqueeProps extends Block {
  /** Фразы; путь к картинке (./assets/logo.png) — логотип */
  items: string[];
  /** Вид: '' — текст через точку, chips — плашками, outline — каждый второй пункт контуром */
  variant?: string;
  /** Скорость: slow, fast; без неё — обычная */
  speed?: string;
  /** Направление: right — вправо; без него — влево */
  dir?: string;
  /** Размер текста, px */
  size?: number;
}

/** Картинка, а не фраза: файл картинки или встроенная картинка (в собранном файле) */
const isImg = (s: string) => s.startsWith('data:image/') || /\.(png|jpe?g|webp|svg|gif|avif)(\?.*)?$/i.test(s);
const PX_PER_S: Record<string, number> = { slow: 45, '': 90, fast: 160 };
const VARIANTS = new Set(['chips', 'outline']);

/**
 * Бегущая строка: пункты без конца прокручиваются вбок. Дорожка — две одинаковые половины, сдвиг на половину
 * незаметен; пункты повторяются, пока половина не станет шире слайда с запасом. Скорость постоянная:
 * время прохода — от примерной ширины текста
 */
defineBlock<MarqueeProps>('marquee', {
  render(p) {
    // Пустые пункты пропускаются; k — номер в данных (для правки на месте)
    const items = asArray(p.items).map((s, k) => ({ s: typeof s === 'string' ? s.trim() : '', k })).filter((x) => x.s);
    const size = Math.max(12, Math.min(160, Number(p.size) || 28));
    const variant = VARIANTS.has(String(p.variant)) ? String(p.variant) : '';
    const list = items.length ? items : [{ s: 'Бегущая строка', k: -1 }];
    // Примерная ширина прохода в px: буквы жирного шрифта, картинки ~3:1, промежутки
    const pad = variant === 'chips' ? 2.4 : 1.2;
    const est = list.reduce((w, { s }) => w + (isImg(s) ? 4.2 : [...s].length * 0.6 + pad) * size, 0);
    // Запас вдвое: дорожка не кончается, даже если шрифт шире, чем думали
    const reps = Math.max(1, Math.ceil(2600 / Math.max(1, est)));
    const one = (live: boolean) => list.map(({ s, k }, n) => {
      const img = isImg(s);
      const ed = live && k >= 0 && !img ? ea(p.items, k) : '';
      return `<span class="mq-item${variant === 'outline' && n % 2 ? ' mq-ol' : ''}"${ed}>${img ? `<img src="${esc(s)}" alt="">` : t(s)}</span>${variant ? '' : '<i class="mq-dot"></i>'}`;
    }).join('');
    const run = (live: boolean) => `<div class="mq-run"${live ? '' : ' aria-hidden="true"'}>${one(live)}${one(false).repeat(reps - 1)}</div>`;
    const dur = Math.max(4, Math.round((est * reps) / (PX_PER_S[String(p.speed ?? '')] ?? PX_PER_S[''])));
    return `<div class="marquee r${variant ? ` mq-${variant}` : ''}${p.dir === 'right' ? ' mq-right' : ''}" style="--mq-size:${size}px;--mq-dur:${dur}s${p.style ? `;${p.style}` : ''}">`
      + `<div class="mq-track">${run(true)}${run(false)}</div></div>`;
  },
});

// ---------------- текст по окружности ----------------

interface RingProps extends Block {
  /** Текст по кругу; разделитель «•» на стыке добавляется сам */
  text: string;
  /** В центре: знак, слово, число */
  center?: string;
  /** В центре — логотип презентации */
  logo?: boolean;
  /** Вид: '' — текст акцентом, badge — печать (залитый круг) */
  variant?: string;
  /** Вращение: '' — по часовой, reverse — против, none — нет */
  spin?: string;
}

/** Последний знак — уже разделитель: «•», «·», «★», «✦», «—», «/», «|», «*» */
const SEP = /[•·★✦✶—/|*]\s*$/;

/**
 * Текст по окружности: буквы равномерно по кругу (каждая повёрнута к центру), круг медленно вращается.
 * Размер букв подбирается по длине текста; круг вписан в рамку объекта (единицы cqmin)
 */
defineBlock<RingProps>('ring', {
  render(p, ctx) {
    const raw = String(p.text ?? '').replace(/\s+/g, ' ').trim() || 'Текст по кругу';
    const text = SEP.test(raw) ? `${raw} ` : `${raw} • `;
    const chars = [...text];
    const n = chars.length;
    // Длина окружности по буквам — около 260 cqmin: столько места на букву, буква чуть уже своего места
    const fs = Math.min(13, Math.max(3.2, 260 / n / 0.78));
    const letters = chars.map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    const spin = p.spin === 'none' ? '' : p.spin === 'reverse' ? ' ct-turn ct-rev' : ' ct-turn';
    const core = p.logo && ctx.logo
      ? `<span class="ct-logo">${logoImg(ctx.logo, ctx.logoDark, ctx.logoTint)}</span>`
      : p.center ? `<b${ea(p, 'center')}>${t(p.center)}</b>` : '';
    return `<div class="circ-text r${p.variant === 'badge' ? ' ct-badge' : ''}${spin}" style="--n:${n};--ct-fs:${fs.toFixed(2)}cqmin${p.style ? `;${p.style}` : ''}">`
      // Буквы по одной на месте не правятся: текст — в «Свойствах»
      + `<div class="ct-disc"><div class="ct-text" role="img" aria-label="${esc(raw)}">${letters}</div>`
      + (core ? `<div class="ct-core">${core}</div>` : '') + `</div></div>`;
  },
});

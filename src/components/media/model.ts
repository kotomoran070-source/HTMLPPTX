import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { icon } from '../icons';
import './media.css';

interface ModelProps extends Block {
  /** 3D-модель: ./assets/device.glb */
  src?: string;
  /** Снимок модели: миниатюры, печать, PDF и окно докладчика */
  poster?: string;
  /** Медленно вращается сама (по умолчанию нет: модель поворачивают мышью) */
  rotate?: boolean;
  /** Вращать мышью во время показа (по умолчанию да) */
  controls?: boolean;
  /** Яркость, 0.5–2 (по умолчанию 1) */
  exposure?: number;
  caption?: string;
}

let lib: Promise<unknown> | null = null;
/** Библиотека грузится один раз и только там, где модель на экране */
function loadViewer(): Promise<unknown> {
  if (!__HAS_MODEL__) return Promise.reject(new Error('3D-модели не включены в сборку'));
  lib ??= import('@google/model-viewer/dist/model-viewer.min.js').then((m) => {
    // Сжатые модели (EXT_meshopt_compression — так жмёт glTF-Transform): расшифровщик уже внутри
    // библиотеки, но включается, только когда задан адрес «загрузчика». Пустой скрипт вместо адреса
    // в интернете — модель открывается и без сети
    const V = (m as { ModelViewerElement?: { meshoptDecoderLocation?: string } }).ModelViewerElement;
    if (V && !V.meshoptDecoderLocation) V.meshoptDecoderLocation = 'data:text/javascript,';
    return m;
  });
  return lib;
}

const editing = () => document.body.classList.contains('editing');
const presenter = () => document.body.classList.contains('presenter');

/** 3D-модель (glTF/GLB): вращается сама и мышью. Без WebGL и при печати — снимок. */
defineBlock<ModelProps>('model', {
  render(p) {
    const src = typeof p.src === 'string' ? p.src.trim() : '';
    const poster = typeof p.poster === 'string' && p.poster ? p.poster : '';
    const cap = p.caption ? `<figcaption class="mu"${ea(p, 'caption')}>${t(p.caption)}</figcaption>` : '';
    const box = src
      ? `<div class="model3d-box" data-model="${esc(src)}">${poster ? `<img class="model3d-poster" src="${esc(poster)}" alt="">` : `<span class="model3d-ph">${icon('layers')}</span>`}</div>`
      : `<div class="model3d-box model3d-empty">${icon('layers')}<b>3D-модель</b><small>Перетащите файл GLB на слайд</small></div>`;
    return `<figure class="model3d r"${styleAttr(p.style)}>${box}${cap}</figure>`;
  },

  mount(el, p, ctx) {
    const box = el.querySelector<HTMLElement>('[data-model]');
    // В окне докладчика — только снимок: модель уже крутится у зрителей
    if (!box || presenter()) return;
    let mv: HTMLElement | null = null;
    let timer = 0;
    const on = () => {
      clearTimeout(timer);
      if (mv) return;
      void loadViewer().then(() => {
        if (mv || !ctx.slide.classList.contains('on')) return;
        const m = document.createElement('model-viewer');
        m.setAttribute('src', box.dataset.model!);
        // Сама не крутится, пока не попросят (rotate: true): модель поворачивают мышью
        if (p.rotate === true && !ctx.reducedMotion) m.setAttribute('auto-rotate', '');
        m.setAttribute('rotation-per-second', '14deg');
        m.setAttribute('auto-rotate-delay', '0');
        if (p.controls !== false && !editing()) m.setAttribute('camera-controls', '');
        m.setAttribute('disable-zoom', '');
        m.setAttribute('interaction-prompt', 'none');
        m.setAttribute('shadow-intensity', '0.8');
        m.setAttribute('environment-image', 'neutral');
        const ex = Number(p.exposure);
        if (ex >= 0.2 && ex <= 3) m.setAttribute('exposure', String(ex));
        m.setAttribute('touch-action', 'pan-y');
        m.className = 'model3d-viewer';
        // Без встроенной полосы загрузки: до загрузки виден снимок
        m.innerHTML = '<div slot="progress-bar"></div>';
        m.addEventListener('load', () => box.classList.add('ready'), { once: true });
        // Не открылась — в редакторе сказать почему, а не оставлять пустой блок (в показе — снимок)
        m.addEventListener('error', (e) => {
          if (!editing() || box.querySelector('.model3d-err')) return;
          const why = String((e as unknown as CustomEvent<{ sourceError?: unknown }>).detail?.sourceError ?? '');
          const msg = /draco/i.test(why) ? 'Модель сжата Draco: для неё нужен интернет. Сожмите без Draco — например, glTF-Transform с --compress meshopt'
            : /ktx2|basis/i.test(why) ? 'Текстуры в формате KTX2: для них нужен интернет. Сожмите текстуры в WebP'
              : 'Модель не открылась: файл повреждён или в неподдерживаемом формате';
          box.insertAdjacentHTML('beforeend', `<p class="model3d-err">${esc(msg)}</p>`);
        });
        box.appendChild(m);
        mv = m;
      }).catch(() => { /* остаётся снимок */ });
    };
    // Ушли со слайда — модель выгружается: видеокарта свободна для других слайдов
    const off = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        mv?.remove();
        mv = null;
        box.classList.remove('ready');
      }, 1200);
    };
    const sync = () => (ctx.slide.classList.contains('on') ? on() : off());
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      mo.disconnect();
      clearTimeout(timer);
      mv?.remove();
    };
  },
});

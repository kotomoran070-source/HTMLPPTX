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
  /** Начальный ракурс: поворот и наклон камеры, например "-30deg 70deg" (как camera-orbit у model-viewer) */
  orbit?: string;
  /** Анимация из файла модели, например Dance (true — первая по списку); играет по кругу */
  animation?: string | boolean;
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

/**
 * Поворот модели докладчиком — у зрителей. Окно докладчика сообщает о повороте событием
 * CAMERA (его пересылает presenter.ts), окно показа получает CAMERA_SET (от show.ts).
 */
export const CAMERA = 'htmlpptx:camera';
export const CAMERA_SET = 'htmlpptx:camera-set';
export interface CameraState { key: string; orbit: string; target: string; fov: number }

interface Viewer extends HTMLElement {
  getCameraOrbit(): { toString(): string };
  getCameraTarget(): { toString(): string };
  getFieldOfView(): number;
  cameraOrbit: string;
  cameraTarget: string;
  fieldOfView: string;
}

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
    // В окне докладчика — живая модель только на текущем слайде и если повтор для зрителей включён
    // (body.pres-live); иначе снимок: вторая отрисовка 3D не нужна
    const live = presenter() && document.body.classList.contains('pres-live') && !!el.closest('#cur');
    if (!box || (presenter() && !live)) return;
    // Какая это модель: одинаково в обоих окнах (номер слайда и путь блока)
    const key = `${ctx.slide.dataset.index ?? ''}:${el.closest('[data-block]')?.getAttribute('data-block') ?? ''}`;
    let mv: HTMLElement | null = null;
    let timer = 0;
    const orbit0 = typeof p.orbit === 'string' && /^-?\d+(\.\d+)?deg\s+-?\d+(\.\d+)?deg(\s+(auto|\d+(\.\d+)?%))?$/.test(p.orbit.trim()) ? p.orbit.trim() : 'auto auto auto';
    // Кнопка «Исходный вид»: появляется, когда модель повернули или приблизили
    let home: HTMLButtonElement | null = null;
    let flip = false;
    let sendNow: (() => void) | null = null;
    const reset = () => {
      if (!mv) return;
      const v = mv as Viewer;
      // Пробел в конце: то же значение, что уже стоит, model-viewer иначе не применит заново
      flip = !flip;
      v.cameraOrbit = orbit0 + (flip ? ' ' : '');
      v.cameraTarget = 'auto auto auto' + (flip ? ' ' : '');
      v.fieldOfView = flip ? 'auto ' : 'auto';
      home?.classList.remove('on');
      settleSend();
    };
    let settle: number[] = [];
    const settleSend = () => {
      settle.forEach(clearTimeout);
      if (sendNow) settle = [150, 400, 800, 1400].map((ms) => window.setTimeout(sendNow!, ms));
    };
    const frozen = () => ctx.stage.classList.contains('paused');
    const on = () => {
      clearTimeout(timer);
      if (mv) return;
      void loadViewer().then(() => {
        if (mv || !ctx.slide.classList.contains('on')) return;
        const m = document.createElement('model-viewer');
        m.setAttribute('src', box.dataset.model!);
        // Сама не крутится, пока не попросят (rotate: true): модель поворачивают мышью
        if (p.rotate === true && !ctx.reducedMotion && !frozen()) m.setAttribute('auto-rotate', '');
        m.setAttribute('rotation-per-second', '14deg');
        m.setAttribute('auto-rotate-delay', '0');
        const controls = p.controls !== false && !editing();
        if (controls) m.setAttribute('camera-controls', '');
        // Приблизить и отдалить — колесом или щипком. Без предела model-viewer не отпускает камеру
        // дальше исходного вида: разрешаем примерно в 2,5 раза дальше (и дальше заданного в orbit)
        if (!controls) m.setAttribute('disable-zoom', '');
        else {
          const r = Number(/(\d+(?:\.\d+)?)%$/.exec(orbit0)?.[1]) || 100;
          m.setAttribute('max-camera-orbit', `auto auto ${Math.round(Math.max(250, r * 1.5))}%`);
        }
        m.setAttribute('interaction-prompt', 'none');
        m.setAttribute('shadow-intensity', '0.8');
        m.setAttribute('environment-image', 'neutral');
        // Ракурс: только углы в градусах (и необязательное расстояние) — без произвольных строк
        if (orbit0 !== 'auto auto auto') m.setAttribute('camera-orbit', orbit0);
        const ex = Number(p.exposure);
        if (ex >= 0.2 && ex <= 3) m.setAttribute('exposure', String(ex));
        if (p.animation && !ctx.reducedMotion) {
          if (!frozen()) m.setAttribute('autoplay', '');
          if (typeof p.animation === 'string' && p.animation.trim()) m.setAttribute('animation-name', p.animation.trim());
        }
        m.setAttribute('touch-action', 'pan-y');
        m.className = 'model3d-viewer';
        // Без встроенной полосы загрузки: до загрузки виден снимок. Своя метка панорамирования —
        // пропускает мышь: встроенная лежит в центре модели, и нажатие там не начинало поворот
        m.innerHTML = '<div slot="progress-bar"></div><div slot="pan-target" style="pointer-events:none"></div>';
        m.addEventListener('load', () => box.classList.add('ready'), { once: true });
        if (controls) {
          m.addEventListener('camera-change', (e) => {
            if ((e as CustomEvent<{ source?: string }>).detail?.source === 'user-interaction') home?.classList.add('on');
          });
          // Двойной щелчок или двойное касание — исходный вид
          let down: { x: number; y: number; t: number } | null = null;
          let tap: { x: number; y: number; t: number } | null = null;
          let fingers = 0;
          m.addEventListener('pointerdown', (e) => {
            fingers++;
            down = fingers === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
          });
          const up = (e: PointerEvent) => {
            fingers = Math.max(0, fingers - 1);
            const d = down;
            down = null;
            if (!d || e.type !== 'pointerup' || e.timeStamp - d.t > 300 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { tap = null; return; }
            if (tap && e.timeStamp - tap.t < 400 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 40) {
              tap = null;
              reset();
            } else tap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
          };
          m.addEventListener('pointerup', up);
          m.addEventListener('pointercancel', up);
          if (!home) {
            home = document.createElement('button');
            home.type = 'button';
            home.className = 'model3d-home';
            home.title = 'Исходный вид (двойной щелчок по модели)';
            home.setAttribute('aria-label', 'Исходный вид');
            home.innerHTML = icon('reset');
            home.addEventListener('click', (e) => { e.stopPropagation(); reset(); });
            box.appendChild(home);
          }
        }
        // Не открылась — в редакторе сказать почему, а не оставлять пустой блок (в показе — снимок)
        m.addEventListener('error', (e) => {
          if (!editing() || box.querySelector('.model3d-err')) return;
          const why = String((e as unknown as CustomEvent<{ sourceError?: unknown }>).detail?.sourceError ?? '');
          const msg = /draco/i.test(why) ? 'Модель сжата Draco: для неё нужен интернет. Сожмите без Draco — например, glTF-Transform с --compress meshopt'
            : /ktx2|basis/i.test(why) ? 'Текстуры в формате KTX2: для них нужен интернет. Сожмите текстуры в WebP'
              : 'Модель не открылась: файл повреждён или в неподдерживаемом формате';
          box.insertAdjacentHTML('beforeend', `<p class="model3d-err">${esc(msg)}</p>`);
        });
        if (live) {
          // Докладчик повернул модель — поворот уходит зрителям (не чаще кадра);
          // сама она больше не крутится, иначе окна разойдутся
          let raf = 0;
          const send = () => {
            if (mv !== m) return;
            const v = m as Viewer;
            const detail: CameraState = { key, orbit: v.getCameraOrbit().toString(), target: v.getCameraTarget().toString(), fov: v.getFieldOfView() };
            window.dispatchEvent(new CustomEvent(CAMERA, { detail }));
          };
          sendNow = send;
          m.addEventListener('camera-change', (e) => {
            if ((e as CustomEvent<{ source?: string }>).detail?.source !== 'user-interaction') return;
            m.removeAttribute('auto-rotate');
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; send(); });
          });
          // Отпустили — модель ещё доезжает по инерции: итоговое положение досылается, пока не встанет
          m.addEventListener('pointerup', settleSend);
          m.addEventListener('keyup', settleSend);
          m.addEventListener('wheel', settleSend, { passive: true });
        }
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
        sendNow = null;
        home?.classList.remove('on');
        box.classList.remove('ready');
      }, 1200);
    };
    const sync = () => (ctx.slide.classList.contains('on') ? on() : off());
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    sync();
    // Пауза сцены: модель не крутится и не играет анимацию — видеокарта отдыхает; сняли паузу — как было
    let wasFrozen = frozen();
    const pauseMo = new MutationObserver(() => {
      const f = frozen();
      if (f === wasFrozen) return;
      wasFrozen = f;
      const v = mv as (HTMLElement & { play?: () => void; pause?: () => void }) | null;
      if (!v) return;
      if (f) {
        v.removeAttribute('auto-rotate');
        v.pause?.();
      } else {
        if (p.rotate === true && !ctx.reducedMotion) v.setAttribute('auto-rotate', '');
        if (p.animation && !ctx.reducedMotion) v.play?.();
      }
    });
    pauseMo.observe(ctx.stage, { attributes: true, attributeFilter: ['class'] });
    // Окно показа: поворот от докладчика (модель плавно доворачивается к нему сама)
    const follow = (e: Event) => {
      const c = (e as CustomEvent<CameraState>).detail;
      if (!mv || c?.key !== key) return;
      const v = mv as Viewer;
      mv.removeAttribute('auto-rotate');
      v.cameraOrbit = c.orbit;
      v.cameraTarget = c.target;
      v.fieldOfView = `${c.fov}deg`;
    };
    if (!presenter()) window.addEventListener(CAMERA_SET, follow);
    return () => {
      settle.forEach(clearTimeout);
      home?.remove();
      window.removeEventListener(CAMERA_SET, follow);
      mo.disconnect();
      pauseMo.disconnect();
      clearTimeout(timer);
      mv?.remove();
    };
  },
});

/**
 * Цветокоррекция видео на лету: поверх ролика — холст, на который каждый кадр рисуется через тот
 * же шейдер, что и у картинок (gl.ts). Файл ролика не меняется: в данных только параметры grade.
 * Без WebGL2 ролик показывается как есть.
 */
import { parseCube } from './cube';
import { GradeGL } from './gl';
import type { Grade } from './grade';

/** Наибольшая сторона кадра на холсте: больше слайду не нужно */
const MAX = 1920;

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** Включить коррекцию у ролика; вернёт функцию, которая её снимает */
export function gradeVideo(video: HTMLVideoElement, g: Grade): () => void {
  const v = video as FrameVideo;
  const canvas = document.createElement('canvas');
  canvas.className = 'video-grade';
  canvas.setAttribute('aria-hidden', 'true');
  let gl: GradeGL;
  try {
    gl = new GradeGL(canvas);
  } catch {
    return () => {};
  }
  canvas.style.objectFit = getComputedStyle(video).objectFit || 'contain';
  video.after(canvas);
  // Родные кнопки плеера рисуются поверх самого ролика — под холстом их не видно, а во весь экран
  // браузер разворачивает ролик без коррекции. Поэтому у перекрашенного ролика — свои кнопки
  const native = video.controls;
  const unbar = native ? playerBar(video, canvas) : null;
  let dead = false;
  let ready = !g.lut;
  if (g.lut) {
    fetch(g.lut).then((r) => r.text()).then((t) => {
      if (dead) return;
      gl.setLut(parseCube(t));
      ready = true;
      paint();
    }).catch(() => { ready = true; paint(); });
  }
  // До запуска у ролика с обложкой видна обложка: холст показывается с первым кадром
  let shown = !video.poster;
  // Кадр не загрузился (ещё не декодирован) — холст прячется, и попытка повторяется чуть позже
  let retry = 0;
  let tries = 0;
  const paint = () => {
    if (dead || !ready || !shown || video.readyState < 2 || !video.videoWidth) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.min(1, MAX / Math.max(vw, vh));
    let ok = false;
    try {
      ok = gl.setFrame(video, vw, vh);
      if (ok) gl.draw(g, Math.round(vw * k), Math.round(vh * k));
    } catch { /* кадр ещё не готов */ }
    canvas.classList.toggle('on', ok);
    clearTimeout(retry);
    if (ok) tries = 0;
    else if (tries++ < 30) retry = window.setTimeout(paint, 100);
  };
  let req = 0;
  const loop = () => {
    req = 0;
    paint();
    if (!video.paused && !video.ended) next();
  };
  const next = () => {
    if (req || dead) return;
    req = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
  };
  const onPlay = () => { shown = true; next(); };
  const events: [string, () => void][] = [['playing', onPlay], ['play', onPlay], ['seeked', () => { shown = true; paint(); }], ['loadeddata', paint], ['canplay', paint]];
  for (const [e, f] of events) video.addEventListener(e, f);
  paint();
  if (!video.paused) onPlay();
  // Первый кадр остановленного ролика — когда браузер его покажет (раньше текстура бывает пустой)
  else if (shown) next();
  return () => {
    dead = true;
    clearTimeout(retry);
    for (const [e, f] of events) video.removeEventListener(e, f);
    if (req) (v.cancelVideoFrameCallback ? v.cancelVideoFrameCallback(req) : cancelAnimationFrame(req));
    gl.dispose();
    canvas.remove();
    unbar?.();
    video.controls = native;
  };
}

const SVG = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const PLAY = SVG('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>');
const PAUSE = SVG('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>');
const SOUND = SVG('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
const MUTED = SVG('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
const MORE = SVG('<circle cx="12" cy="5.5" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="18.5" r="1.9" fill="currentColor"/>');
const SPEEDS: [number, string][] = [[0.25, '0,25'], [0.5, '0,5'], [0.75, '0,75'], [1, 'Обычная'], [1.25, '1,25'], [1.5, '1,5'], [1.75, '1,75'], [2, '2']];
const DOWNLOAD = SVG('<path d="M12 4v10m-4.5-4.5L12 14l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
const SPEED = SVG('<path d="M12 3a9 9 0 1 1-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2.2 2.6"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/>');
const PIP = SVG('<rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="11.5" y="11.5" width="7" height="5" rx=".5" fill="currentColor"/>');
const BACK = SVG('<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
const CHECK = SVG('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>');
const FULL = SVG('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');

const clock = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');

/**
 * Свои кнопки плеера поверх перекрашенного кадра — в точности как у Chrome: пуск и время слева,
 * звук, во весь экран и ⋮ (скорость) справа, полоса времени во всю ширину снизу
 */
function playerBar(video: HTMLVideoElement, canvas: HTMLCanvasElement): () => void {
  const box = video.parentElement!;
  video.controls = false;
  const bar = document.createElement('div');
  bar.className = 'video-bar';
  bar.innerHTML = `<div class="video-row"><button type="button" data-v="play" class="video-play" aria-label="Смотреть"></button><span class="video-time"></span><span class="video-sp"></span>`
    + `<button type="button" data-v="mute" aria-label="Звук"></button><button type="button" data-v="full" aria-label="Во весь экран">${FULL}</button>`
    + `<button type="button" data-v="more" aria-label="Ещё" aria-haspopup="true">${MORE}</button></div>`
    + `<div class="video-seek" role="slider" aria-label="Перемотка" tabindex="0"><i></i></div>`
    + `<div class="video-menu" hidden></div>`;
  box.appendChild(bar);
  const play = bar.querySelector<HTMLElement>('[data-v="play"]')!;
  const mute = bar.querySelector<HTMLElement>('[data-v="mute"]')!;
  const time = bar.querySelector<HTMLElement>('.video-time')!;
  const seek = bar.querySelector<HTMLElement>('.video-seek')!;
  const fill = seek.querySelector<HTMLElement>('i')!;
  const menu = bar.querySelector<HTMLElement>('.video-menu')!;
  /** Меню ⋮ как у Chrome: скачать, скорость (своим списком), картинка в картинке */
  const canPip = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && 'captureStream' in canvas;
  const showMenu = (page: 'main' | 'speed') => {
    const src = video.currentSrc || video.src;
    const name = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() || 'video').replace(/^data:.*/, 'video');
    menu.innerHTML = page === 'main'
      ? `<a data-v="download" href="${src.replace(/"/g, '%22')}" download="${name.replace(/"/g, '')}">${DOWNLOAD}<span>Скачать</span></a>`
        + `<button type="button" data-v="speeds">${SPEED}<span>Скорость воспроизведения</span></button>`
        + (canPip ? `<button type="button" data-v="pip">${PIP}<span>Картинка в картинке</span></button>` : '')
      : `<button type="button" data-v="back" class="video-menu-h">${BACK}<span>Скорость воспроизведения</span></button>`
        + SPEEDS.map(([s, l]) => `<button type="button" data-speed="${s}" class="video-speed">${s === video.playbackRate ? CHECK : '<i></i>'}<span>${l}</span></button>`).join('');
    // В невысоком ролике меню прокручивается, а не уходит за край
    menu.style.maxHeight = `${Math.max(120, box.clientHeight - 72)}px`;
    menu.hidden = false;
  };
  // Картинка в картинке — из холста: окно тоже с коррекцией; пауза в окне — пауза ролика
  let pipVideo: HTMLVideoElement | null = null;
  const pip = async () => {
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
      const pv = document.createElement('video');
      pv.muted = true;
      pv.srcObject = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
      await pv.play();
      pv.addEventListener('pause', () => { if (document.pictureInPictureElement === pv) video.pause(); });
      pv.addEventListener('play', () => { void video.play().catch(() => {}); });
      pv.addEventListener('leavepictureinpicture', () => { (pv.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop()); pipVideo = null; });
      pipVideo = pv;
      await pv.requestPictureInPicture();
    } catch { /* браузер не дал открыть окно */ }
  };
  // Как у Chrome: при просмотре кнопки прячутся, если мышь не двигалась пару секунд
  let idle = 0;
  const wake = () => {
    box.classList.add('video-ui');
    clearTimeout(idle);
    idle = window.setTimeout(() => { if (menu.hidden) box.classList.remove('video-ui'); }, 2500);
  };
  box.addEventListener('pointermove', wake);
  const sync = () => {
    play.innerHTML = video.paused ? PLAY : PAUSE;
    play.setAttribute('aria-label', video.paused ? 'Смотреть' : 'Пауза');
    mute.innerHTML = video.muted ? MUTED : SOUND;
    mute.setAttribute('aria-label', video.muted ? 'Включить звук' : 'Без звука');
    time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
    fill.style.width = `${video.duration ? (video.currentTime / video.duration) * 100 : 0}%`;
    box.classList.toggle('video-paused', video.paused);
  };
  const events = ['play', 'pause', 'timeupdate', 'volumechange', 'loadedmetadata', 'durationchange'];
  for (const e of events) video.addEventListener(e, sync);
  const toggle = () => { if (video.paused) void video.play().catch(() => {}); else video.pause(); };
  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
    if (v === 'play') toggle();
    else if (v === 'mute') video.muted = !video.muted;
    else if (v === 'more') {
      if (menu.hidden) showMenu('main');
      else menu.hidden = true;
    } else if (v === 'speeds') showMenu('speed');
    else if (v === 'back') showMenu('main');
    else if (v === 'pip') { menu.hidden = true; void pip(); }
    else if (v === 'download') menu.hidden = true;
    else if ((e.target as Element).closest('[data-speed]')) {
      video.playbackRate = Number((e.target as Element).closest<HTMLElement>('[data-speed]')!.dataset.speed);
      menu.hidden = true;
    }
    else if (v === 'full') {
      if (document.fullscreenElement === box) void document.exitFullscreen();
      else void box.requestFullscreen?.().catch(() => {});
    }
  });
  // Щелчок по кадру — пуск и пауза, как у родного плеера
  const onBox = (e: MouseEvent) => {
    if (bar.contains(e.target as Node)) return;
    if (!menu.hidden) { menu.hidden = true; return; }
    toggle();
  };
  box.addEventListener('click', onBox);
  seek.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    seek.setPointerCapture(e.pointerId);
    const to = (ev: PointerEvent) => {
      const r = seek.getBoundingClientRect();
      if (video.duration) video.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * video.duration;
      sync();
    };
    to(e);
    const up = () => { seek.removeEventListener('pointermove', to); seek.removeEventListener('pointerup', up); };
    seek.addEventListener('pointermove', to);
    seek.addEventListener('pointerup', up);
  });
  seek.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    video.currentTime = Math.max(0, video.currentTime + (e.key === 'ArrowRight' ? 5 : -5));
  });
  sync();
  return () => {
    for (const e of events) video.removeEventListener(e, sync);
    box.removeEventListener('click', onBox);
    box.removeEventListener('pointermove', wake);
    clearTimeout(idle);
    box.classList.remove('video-paused', 'video-ui');
    if (document.fullscreenElement === box) void document.exitFullscreen();
    if (pipVideo && document.pictureInPictureElement === pipVideo) void document.exitPictureInPicture();
    bar.remove();
  };
}

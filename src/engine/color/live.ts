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
  const unbar = native ? playerBar(video) : null;
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
const FULL = SVG('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');

const clock = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');

/** Свои кнопки плеера поверх перекрашенного кадра: пуск, время, перемотка, звук, во весь экран */
function playerBar(video: HTMLVideoElement): () => void {
  const box = video.parentElement!;
  video.controls = false;
  const bar = document.createElement('div');
  bar.className = 'video-bar';
  bar.innerHTML = `<button type="button" data-v="play" aria-label="Смотреть"></button><span class="video-time"></span>`
    + `<div class="video-seek" role="slider" aria-label="Перемотка" tabindex="0"><i></i></div>`
    + `<button type="button" data-v="mute" aria-label="Звук"></button><button type="button" data-v="full" aria-label="Во весь экран" title="Во весь экран">${FULL}</button>`;
  box.appendChild(bar);
  const play = bar.querySelector<HTMLElement>('[data-v="play"]')!;
  const mute = bar.querySelector<HTMLElement>('[data-v="mute"]')!;
  const time = bar.querySelector<HTMLElement>('.video-time')!;
  const seek = bar.querySelector<HTMLElement>('.video-seek')!;
  const fill = seek.querySelector<HTMLElement>('i')!;
  const sync = () => {
    play.innerHTML = video.paused ? PLAY : PAUSE;
    play.title = video.paused ? 'Смотреть' : 'Пауза';
    mute.innerHTML = video.muted ? MUTED : SOUND;
    mute.title = video.muted ? 'Включить звук' : 'Без звука';
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
    else if (v === 'full') {
      if (document.fullscreenElement === box) void document.exitFullscreen();
      else void box.requestFullscreen?.().catch(() => {});
    }
  });
  // Щелчок по кадру — пуск и пауза, как у родного плеера
  const onBox = (e: MouseEvent) => { if (!bar.contains(e.target as Node)) toggle(); };
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
    box.classList.remove('video-paused');
    if (document.fullscreenElement === box) void document.exitFullscreen();
    bar.remove();
  };
}

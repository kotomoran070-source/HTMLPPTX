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
  if (video.controls) canvas.classList.add('has-controls');
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
  };
}

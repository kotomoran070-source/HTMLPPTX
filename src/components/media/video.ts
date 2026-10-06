import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { isNeutral, type Grade } from '../../engine/color/grade';
import { icon } from '../icons';
import './media.css';

interface VideoProps extends Block {
  /** Файл ./assets/clip.mp4 (MP4, WebM) или ссылка на YouTube / Vimeo */
  src?: string;
  /** Обложка до запуска и при печати */
  poster?: string;
  /** Запускать при открытии слайда (по умолчанию да) */
  autoplay?: boolean;
  /** Без звука (по умолчанию — если запускается сам) */
  muted?: boolean;
  /** По кругу */
  loop?: boolean;
  /** Кнопки плеера при наведении (по умолчанию да) */
  controls?: boolean;
  /** cover — заполнить рамку, contain — целиком (по умолчанию) */
  fit?: 'cover' | 'contain';
  caption?: string;
  /** Цветокоррекция на лету (панель «Цвет» в студии): файл не меняется */
  grade?: Grade;
}

const YOUTUBE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i;

/** Ролик с YouTube или Vimeo: адрес плеера и обложка. */
export function videoEmbed(src: string, o: { autoplay: boolean; muted: boolean; loop: boolean; controls: boolean }): { url: string; thumb?: string; service: string; watch: string } | null {
  const b = (v: boolean) => (v ? 1 : 0);
  const yt = YOUTUBE.exec(src);
  if (yt) {
    const id = yt[1];
    return {
      service: 'YouTube',
      watch: `https://www.youtube.com/watch?v=${id}`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube-nocookie.com/embed/${id}?autoplay=${b(o.autoplay)}&mute=${b(o.muted)}&loop=${b(o.loop)}&playlist=${id}&controls=${b(o.controls)}&rel=0&playsinline=1&modestbranding=1`,
    };
  }
  const vm = VIMEO.exec(src);
  if (vm) {
    return { service: 'Vimeo', watch: `https://vimeo.com/${vm[1]}`, url: `https://player.vimeo.com/video/${vm[1]}?autoplay=${b(o.autoplay)}&muted=${b(o.muted)}&loop=${b(o.loop)}&controls=${b(o.controls)}&dnt=1` };
  }
  return null;
}

const opts = (p: VideoProps) => {
  const autoplay = p.autoplay !== false;
  return { autoplay, muted: p.muted ?? autoplay, loop: !!p.loop, controls: p.controls !== false };
};

/** В редакторе ролики не запускаются сами; в окне докладчика всегда без звука (звук — у зрителей). */
const editing = () => document.body.classList.contains('editing');
const presenter = () => document.body.classList.contains('presenter');

/** Видео: файл из папки презентации или ролик YouTube / Vimeo. Запускается при открытии слайда. */
defineBlock<VideoProps>('video', {
  render(p) {
    const src = typeof p.src === 'string' ? p.src.trim() : '';
    const o = opts(p);
    const cap = p.caption ? `<figcaption class="mu"${ea(p, 'caption')}>${t(p.caption)}</figcaption>` : '';
    const poster = typeof p.poster === 'string' && p.poster ? p.poster : '';
    let box: string;
    const embed = src ? videoEmbed(src, o) : null;
    if (!src) {
      box = `<div class="video-box video-empty">${icon('play')}<b>Видео</b><small>Перетащите MP4 на слайд или укажите ссылку</small></div>`;
    } else if (embed) {
      const cover = poster || embed.thumb;
      box = `<div class="video-box video-embed" data-embed="${esc(embed.url)}" data-watch="${esc(embed.watch)}" data-service="${esc(embed.service)}">`
        + (cover ? `<img class="video-cover" src="${esc(cover)}" alt="" loading="lazy">` : '')
        + `<span class="video-badge">${icon('play')}${esc(embed.service)}</span></div>`;
    } else {
      box = `<div class="video-box"><video src="${esc(src)}" preload="metadata" playsinline`
        + `${o.muted ? ' muted' : ''}${o.loop ? ' loop' : ''}${o.controls ? ' controls' : ''}${poster ? ` poster="${esc(poster)}"` : ''}`
        + `${p.fit === 'cover' ? ' style="object-fit:cover"' : ''}></video></div>`;
    }
    return `<figure class="video r"${styleAttr(p.style)}>${box}${cap}</figure>`;
  },

  mount(el, p, ctx) {
    const o = opts(p);
    const video = el.querySelector('video');
    const embed = el.querySelector<HTMLElement>('.video-embed');
    let frame: HTMLIFrameElement | null = null;
    let timer = 0;
    // Цветокоррекция — только у открытого слайда: у браузера мало контекстов WebGL
    const graded = !!video && !!p.grade && typeof p.grade === 'object' && !isNeutral(p.grade);
    let ungrade: (() => void) | null = null;
    let grading = false;
    const grade = () => {
      if (!graded || grading) return;
      grading = true;
      void import('../../engine/color/live').then((m) => {
        if (grading && !ungrade) ungrade = m.gradeVideo(video!, p.grade!);
      });
    };
    const ungradeNow = () => {
      grading = false;
      ungrade?.();
      ungrade = null;
    };
    const on = () => {
      clearTimeout(timer);
      grade();
      if (video) {
        if (presenter()) video.muted = true;
        if (o.autoplay && !editing()) {
          video.currentTime = 0;
          void video.play().catch(() => { /* браузер не дал запустить со звуком: остаётся кнопка плеера */ });
        }
      } else if (embed && !frame && !editing() && location.protocol === 'file:') {
        // Файл с диска: у страницы нет адреса, и YouTube не показывает встроенный плеер (ошибка 153).
        // Вместо сломанного плеера — обложка и переход к ролику на сайте сервиса
        if (!embed.querySelector('.video-out')) {
          embed.insertAdjacentHTML('beforeend', `<a class="video-out" href="${esc(embed.dataset.watch ?? '')}" target="_blank" rel="noopener">${icon('play')}Смотреть на ${esc(embed.dataset.service ?? 'сайте')}</a>`);
        }
      } else if (embed && !frame && !editing()) {
        const f = document.createElement('iframe');
        // Плеер узнаёт, на каком сайте он встроен: без этого YouTube отвечает ошибкой 153
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        const url = presenter() ? embed.dataset.embed!.replace(/([?&])(mute|muted)=0/, '$1$2=1') : embed.dataset.embed!;
        f.src = url;
        f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
        f.setAttribute('allowfullscreen', '');
        f.title = 'Видео';
        embed.appendChild(f);
        frame = f;
      }
    };
    const off = () => {
      video?.pause();
      // Плеер YouTube останавливается только вместе с рамкой
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        frame?.remove();
        frame = null;
        ungradeNow();
      }, 400);
    };
    const sync = () => (ctx.slide.classList.contains('on') ? on() : off());
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    sync();
    return () => {
      mo.disconnect();
      clearTimeout(timer);
      video?.pause();
      frame?.remove();
      ungradeNow();
    };
  },
});

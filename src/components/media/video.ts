import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
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
}

const YOUTUBE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i;

/** Ролик с YouTube или Vimeo: адрес плеера и обложка. */
export function videoEmbed(src: string, o: { autoplay: boolean; muted: boolean; loop: boolean; controls: boolean }): { url: string; thumb?: string; service: string } | null {
  const b = (v: boolean) => (v ? 1 : 0);
  const yt = YOUTUBE.exec(src);
  if (yt) {
    const id = yt[1];
    return {
      service: 'YouTube',
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube-nocookie.com/embed/${id}?autoplay=${b(o.autoplay)}&mute=${b(o.muted)}&loop=${b(o.loop)}&playlist=${id}&controls=${b(o.controls)}&rel=0&playsinline=1&modestbranding=1`,
    };
  }
  const vm = VIMEO.exec(src);
  if (vm) {
    return { service: 'Vimeo', url: `https://player.vimeo.com/video/${vm[1]}?autoplay=${b(o.autoplay)}&muted=${b(o.muted)}&loop=${b(o.loop)}&controls=${b(o.controls)}&dnt=1` };
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
      box = `<div class="video-box video-embed" data-embed="${esc(embed.url)}">`
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
    const on = () => {
      clearTimeout(timer);
      if (video) {
        if (presenter()) video.muted = true;
        if (o.autoplay && !editing()) {
          video.currentTime = 0;
          void video.play().catch(() => { /* браузер не дал запустить со звуком: остаётся кнопка плеера */ });
        }
      } else if (embed && !frame && !editing()) {
        const f = document.createElement('iframe');
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
    };
  },
});

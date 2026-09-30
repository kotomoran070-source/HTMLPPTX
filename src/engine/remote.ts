/**
 * Пульт с телефона. Телефон и компьютер с показом — в одной сети; показ открыт через сервер
 * (yarn present или yarn dev --host). Окно показа выводит QR, телефон открывает по нему
 * страницу-пульт. Сообщения — те же, что у окна докладчика (sync.ts), но идут через сервер.
 */
import { icon } from '../components/icons';
import { qrSvg } from '../components/qr';
import type { Deck } from '../types';
import { applyAccent } from './accent';
import { staticSlide } from './deck-view';
import { esc } from './html';
import { slideLabel } from './render';
import { RELAY, Sync } from './sync';
import './remote.css';

/** Код комнаты этого окна показа: переживает перезагрузку, телефон остаётся подключённым */
export function remoteRoom(deckKey: string, create = false): string | null {
  const key = `slideria-remote-${deckKey}`;
  try {
    let v = sessionStorage.getItem(key);
    if (!v && create) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
      sessionStorage.setItem(key, v);
    }
    return v;
  } catch {
    return create ? Math.random().toString(36).slice(2, 14) : null;
  }
}

// ------------------------------------------------------------------ окно с QR на экране

export interface RemoteDialog {
  deckKey: string;
  sync: Sync;
  /** Телефон подключился — окно закрывается само */
  onPhone(cb: () => void): void;
}

export async function openRemoteDialog(o: RemoteDialog): Promise<void> {
  document.querySelector('.rmd-bd')?.remove();
  const box = document.createElement('div');
  box.className = 'rmd-bd';
  box.innerHTML = `<div class="rmd" role="dialog" aria-modal="true" aria-label="Пульт с телефона"><button class="ibtn small rmd-x" type="button" aria-label="Закрыть">${icon('close')}</button><div class="rmd-body"><p class="mu">Подключаю пульт…</p></div></div>`;
  document.body.append(box);
  const body = box.querySelector<HTMLElement>('.rmd-body')!;
  const close = () => {
    removeEventListener('keydown', onKey, true);
    box.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  addEventListener('keydown', onKey, true);
  box.addEventListener('click', (e) => {
    if (e.target === box || (e.target as Element).closest('.rmd-x')) close();
  });

  // Файл, открытый с диска: серверу, через который пойдут команды, взяться неоткуда
  const help = (title: string, text: string) => {
    body.innerHTML = `<h2>${esc(title)}</h2><p>${text}</p>`
      + '<p class="mu">Телефон и этот компьютер должны быть в одной Wi-Fi-сети (или раздайте интернет с телефона).</p>';
  };
  if (location.protocol === 'file:') {
    return help('Пульт работает через сервер показа',
      `Запустите показ командой <code>yarn present ${esc(o.deckKey)}</code> — она соберёт презентацию и раздаст её в сети. Откроется показ; нажмите <b>R</b>, и здесь появится QR для телефона.`);
  }
  let info: { urls?: string[]; localOnly?: boolean };
  try {
    const r = await fetch(`${RELAY}info`);
    if (!r.ok) throw new Error(String(r.status));
    info = await r.json();
  } catch {
    return help('Сервер показа не отвечает', `Запустите показ командой <code>yarn present ${esc(o.deckKey)}</code> и откройте его заново.`);
  }
  if (info.localOnly) {
    return help('Сервер виден только этому компьютеру',
      `Перезапустите его так, чтобы телефон мог подключиться: <code>yarn dev --host</code> или <code>yarn present ${esc(o.deckKey)}</code>.`);
  }
  const urls = info.urls ?? [];
  if (!urls.length) return help('Компьютер не в сети', 'Подключитесь к Wi-Fi, в котором будет телефон, и нажмите R ещё раз.');

  const room = remoteRoom(o.deckKey, true)!;
  o.sync.relay(room);
  const link = (base: string) => `${base}${location.pathname}?deck=${encodeURIComponent(o.deckKey)}&remote=${room}`;
  const main = link(urls[0]);
  body.innerHTML = `<h2>${icon('phone')} Пульт с телефона</h2>
    <p class="mu">Наведите камеру телефона на код. Телефон должен быть в той же сети, что и этот компьютер.</p>
    <div class="rmd-qr">${qrSvg(main, undefined, 'QR-код пульта')}</div>
    <p class="rmd-url"><code>${esc(main)}</code></p>
    ${urls.length > 1 ? `<details class="rmd-more"><summary>Не открывается? Другие адреса этого компьютера</summary>${urls.slice(1).map((u) => `<code>${esc(link(u))}</code>`).join('')}</details>` : ''}
    <p class="rmd-state" role="status"><i></i><span>Жду телефон…</span></p>`;
  o.onPhone(() => {
    const st = body.querySelector<HTMLElement>('.rmd-state');
    if (!st || !box.isConnected) return;
    st.classList.add('on');
    st.querySelector('span')!.textContent = 'Телефон подключён';
    setTimeout(close, 1400);
  });
}

// ------------------------------------------------------------------ страница-пульт на телефоне

export function startRemote(deck: Deck, deckKey: string, room: string): void {
  document.body.className = 'remote-page';
  // Миниатюра — в теме экрана зала (приходит с положением показа), цвета — как у презентации
  document.documentElement.setAttribute('data-theme', 'dark');
  applyAccent(deck.theme?.accent, deck.theme?.accent2, true);
  document.title = `Пульт · ${deck.title}`;
  const n = deck.slides.length;
  document.body.innerHTML = `<div class="rm">
  <header class="rm-top"><span class="rm-dot" title="Связь с показом"></span><b class="rm-n"></b><button type="button" class="rm-time" title="Сбросить таймер">00:00</button>
    <button type="button" class="rm-btn rm-black" aria-pressed="false" title="Чёрный экран">Экран</button></header>
  <div class="rm-cur" aria-label="Текущий слайд. Ведите пальцем — указка на экране"></div>
  <p class="rm-hint">Ведите пальцем по слайду — на экране указка</p>
  <div class="rm-next"></div>
  <div class="rm-notes"></div>
  <footer class="rm-nav"><button type="button" class="rm-prev" aria-label="Назад">${icon('prev')}</button><button type="button" class="rm-go">Далее ${icon('next')}</button></footer>
</div>`;
  const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
  const dot = $('.rm-dot');
  const cur = $('.rm-cur');
  let index = 0;
  let black = false;
  let got = false;

  const sync = new Sync(deckKey, 'r-' + Math.random().toString(36).slice(2, 10));
  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* нет вибрации */ } };

  const render = () => {
    $('.rm-n').textContent = `${index + 1} / ${n}`;
    cur.replaceChildren(staticSlide(deck, index));
    const next = deck.slides[index + 1];
    $('.rm-next').innerHTML = next ? `<small>Далее</small><span>${esc(slideLabel(next, index + 1))}</span>` : '<small>Это последний слайд</small>';
    const notes = deck.slides[index]?.notes;
    $('.rm-notes').innerHTML = typeof notes === 'string' && notes.trim()
      ? esc(notes.trim()).replace(/\n/g, '<br>')
      : '<span class="rm-empty">Заметок к слайду нет</span>';
    $('.rm-prev').toggleAttribute('disabled', index <= 0);
    $('.rm-go').toggleAttribute('disabled', index >= n - 1);
    $('.rm-black').setAttribute('aria-pressed', String(black));
  };
  const go = (i: number) => {
    const k = Math.max(0, Math.min(n - 1, i));
    if (k === index) return;
    index = k;
    buzz();
    render();
    sync.send({ type: 'goto', index: k });
  };

  sync.on((m) => {
    if (m.type === 'state') {
      got = true;
      dot.classList.add('on');
      black = m.black;
      if (document.documentElement.getAttribute('data-theme') !== m.theme) {
        document.documentElement.setAttribute('data-theme', m.theme);
        render();
      }
      if (m.index !== index) { index = m.index; render(); } else $('.rm-black').setAttribute('aria-pressed', String(black));
    } else if (m.type === 'goto' && m.index !== index) {
      index = m.index;
      render();
    } else if (m.type === 'black') {
      black = m.value;
      render();
    }
  });
  // Показ отвечает на hello своим положением; пока ответа нет — спрашиваем снова
  const hello = () => sync.send({ type: 'hello' });
  sync.relay(room, (ok) => {
    dot.classList.toggle('off', !ok);
    if (ok) hello();
  });
  const again = setInterval(() => { if (got) clearInterval(again); else hello(); }, 3000);

  $('.rm-prev').addEventListener('click', () => go(index - 1));
  $('.rm-go').addEventListener('click', () => go(index + 1));
  $('.rm-black').addEventListener('click', () => {
    black = !black;
    buzz();
    render();
    sync.send({ type: 'black', value: black });
  });

  // Таймер доклада
  let t0 = Date.now();
  const clock = $('.rm-time');
  const tick = () => {
    const s = Math.floor((Date.now() - t0) / 1000);
    clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  setInterval(tick, 1000);
  clock.addEventListener('click', () => { t0 = Date.now(); tick(); });

  // Указка: палец на миниатюре — точка на экране зала
  let raf = 0;
  let pt: { x: number; y: number } | null = null;
  const at = (e: PointerEvent) => {
    const r = (cur.firstElementChild as HTMLElement ?? cur).getBoundingClientRect();
    return { x: Math.max(0, Math.min(1280, ((e.clientX - r.left) / r.width) * 1280)), y: Math.max(0, Math.min(720, ((e.clientY - r.top) / r.height) * 720)) };
  };
  const flush = () => {
    raf = 0;
    if (pt) sync.send({ type: 'ink', ink: { op: 'laser', x: Math.round(pt.x), y: Math.round(pt.y) } });
  };
  cur.addEventListener('pointerdown', (e) => {
    cur.setPointerCapture(e.pointerId);
    cur.classList.add('pointing');
    pt = at(e);
    flush();
  });
  cur.addEventListener('pointermove', (e) => {
    if (!cur.classList.contains('pointing')) return;
    pt = at(e);
    // Не чаще кадра: сеть не забивается сообщениями
    if (!raf) raf = requestAnimationFrame(flush);
  });
  const up = () => {
    if (!cur.classList.contains('pointing')) return;
    cur.classList.remove('pointing');
    pt = null;
    sync.send({ type: 'ink', ink: { op: 'laser-off' } });
  };
  cur.addEventListener('pointerup', up);
  cur.addEventListener('pointercancel', up);

  // Свайп по заметкам и подписи — листать
  let sx = 0;
  let sy = 0;
  const zone = $('.rm');
  zone.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  zone.addEventListener('touchend', (e) => {
    if ((e.target as Element).closest('.rm-cur, button')) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  });

  // Телефон не гаснет посреди доклада (браузер разрешает это только на https и localhost)
  const wake = () => {
    (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {});
  };
  wake();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { wake(); hello(); }
  });
  render();
}

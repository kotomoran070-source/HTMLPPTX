/**
 * Пульт с телефона. Телефон и компьютер с показом — в одной сети; показ открыт через сервер
 * (yarn present или yarn dev --host). Окно показа выводит QR, телефон открывает по нему
 * режим докладчика этого окна; сообщения те же (sync.ts), но идут через сервер.
 */
import { icon } from '../components/icons';
import { qrSvg } from '../components/qr';
import { esc } from './html';
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
  // Телефон открывает режим докладчика этого окна показа: живой слайд, заметки, указка, перо
  const link = (base: string) => `${base}${location.pathname}?deck=${encodeURIComponent(o.deckKey)}&view=presenter&main=${encodeURIComponent(o.sync.self)}&remote=${room}`;
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

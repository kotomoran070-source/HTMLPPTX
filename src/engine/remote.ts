/**
 * Пульт с телефона. Телефон и компьютер с показом — в одной сети; показ открыт через сервер
 * (yarn present, yarn dev --host или приложение). Окно выводит одноразовый QR: телефон получает
 * по нему пропуск и открывает режим докладчика этого окна; сообщения те же (sync.ts), но идут
 * через сервер. Подключённые телефоны видны в этом же окне, там же их отключают.
 */
import { icon } from '../components/icons';
import { qrSvg } from '../components/qr';
import { esc } from './html';
import { RELAY } from './sync';
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
  /** Комната окна показа (окно показа при этом начинает её слушать); null — показ не ответил */
  room(): string | null | Promise<string | null>;
  /** id окна показа, которым будет управлять телефон */
  main: string;
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
  let info: { urls?: string[]; localOnly?: boolean; app?: boolean; firewall?: boolean };
  try {
    const r = await fetch(`${RELAY}info?deck=${encodeURIComponent(o.deckKey)}`);
    if (!r.ok) throw new Error(String(r.status));
    info = await r.json();
  } catch {
    return help('Сервер показа не отвечает', `Запустите показ командой <code>yarn present ${esc(o.deckKey)}</code> и откройте его заново.`);
  }
  if (info.localOnly && info.app) {
    return help('Не удалось открыть доступ для телефона',
      'Порты пульта 5180–5199 заняты другими программами. Закройте лишнее и нажмите R ещё раз; подробности — в меню «Справка» → «Журнал работы».');
  }
  if (info.localOnly) {
    return help('Сервер виден только этому компьютеру',
      `Перезапустите его так, чтобы телефон мог подключиться: <code>yarn dev --host</code> или <code>yarn present ${esc(o.deckKey)}</code>.`);
  }
  const urls = info.urls ?? [];
  if (!urls.length) return help('Компьютер не в сети', 'Подключитесь к Wi-Fi, в котором будет телефон, и нажмите R ещё раз.');

  const room = await o.room();
  if (!room) return help('Окно показа не отвечает', 'Пульт подключается к окну показа: откройте его (или верните на экран) и нажмите кнопку ещё раз.');
  // Телефон открывает режим докладчика этого окна показа: живой слайд, заметки, указка, перо
  const next = `${location.pathname}?deck=${encodeURIComponent(o.deckKey)}&view=presenter&main=${encodeURIComponent(o.main)}&remote=${room}`;
  // Код одноразовый: по нему подключается один телефон и получает пропуск, дальше код не действует
  let ticket = '';
  try {
    const r = await fetch(`${RELAY}open?room=${room}`, { method: 'POST', body: JSON.stringify({ next }) });
    ticket = ((await r.json()) as { ticket?: string }).ticket ?? '';
  } catch { /* ниже — объяснение */ }
  if (!ticket) return help('Сервер показа не отвечает', 'Не удалось получить код для телефона. Нажмите R ещё раз.');
  const qrHtml = (t: string) => {
    const link = (base: string) => `${base}${RELAY}pair?t=${t}`;
    return `<div class="rmd-qr">${qrSvg(link(urls[0]), undefined, 'QR-код пульта')}</div>
      <p class="rmd-note">Код одноразовый: подключает один телефон. Каждое открытие этого окна — новый код.</p>
      ${urls.length > 1 ? `<details class="rmd-more"><summary>Не открывается? Другие адреса этого компьютера</summary>${urls.slice(1).map((u) => `<code>${esc(link(u))}</code>`).join('')}</details>` : ''}`;
  };
  body.innerHTML = `<h2>${icon('phone')} Пульт с телефона</h2>
    <div class="rmd-pair"><p class="mu">Наведите камеру телефона на код. Телефон должен быть в той же сети, что и этот компьютер.</p>${qrHtml(ticket)}</div>
    <p class="rmd-state" role="status"><i></i><span>Жду телефон…</span></p>
    <div class="rmd-devs" hidden></div>
    ${info.firewall ? `<p class="rmd-fw"><button type="button" class="rmd-fw-btn">Телефон не открывает страницу? Разрешить в брандмауэре</button></p>` : ''}`;

  // Подключённые телефоны: кто и когда; «Отключить» — пропуск гаснет, телефон теряет заметки и слайды
  const devs = body.querySelector<HTMLElement>('.rmd-devs')!;
  const pair = body.querySelector<HTMLElement>('.rmd-pair')!;
  const st = body.querySelector<HTMLElement>('.rmd-state')!;
  let known = -1;
  const time = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const refresh = async () => {
    let list: { id: string; name: string; ip: string; since: number; online: boolean }[] = [];
    try { list = ((await (await fetch(`${RELAY}devices?room=${room}`)).json()) as { devices?: typeof list }).devices ?? []; } catch { return; }
    if (!box.isConnected) return;
    devs.hidden = !list.length;
    devs.innerHTML = list.length
      ? `<b>Подключено</b>${list.map((d) => `<div class="rmd-dev"><i class="${d.online ? 'on' : ''}" title="${d.online ? 'На связи' : 'Сейчас не на связи'}"></i><span>${esc(d.name)}<small>${esc(d.ip.replace(/^.*\./, '…'))} · с ${time(d.since)}</small></span><button type="button" class="btn ghost small" data-off="${esc(d.id)}">Отключить</button></div>`).join('')}`
        + (list.length > 1 ? '<button type="button" class="btn ghost small rmd-all" data-off="">Отключить все</button>' : '')
      : '';
    // Новый телефон подключился: код использован и убирается. Ещё телефон — новый код при новом открытии окна
    if (known >= 0 && list.length > known) {
      st.classList.add('on');
      st.querySelector('span')!.textContent = `Подключён: ${list[list.length - 1].name}`;
      pair.hidden = true;
    }
    known = list.length;
  };
  devs.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-off]');
    if (!b) return;
    b.disabled = true;
    await fetch(`${RELAY}revoke?room=${room}${b.dataset.off ? `&id=${encodeURIComponent(b.dataset.off)}` : ''}`, { method: 'POST' }).catch(() => {});
    void refresh();
  });
  void refresh();
  const poll = window.setInterval(() => { if (box.isConnected) void refresh(); else clearInterval(poll); }, 1500);
  // Приложение под Windows: Windows спрашивает про сеть сама, а если там нажали «Отмена»
  // или сеть «общественная» — эта кнопка добавляет правило (запрос администратора от Slideria)
  body.querySelector<HTMLButtonElement>('.rmd-fw-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const line = btn.parentElement!;
    btn.disabled = true;
    btn.textContent = 'Подтвердите запрос Windows…';
    let state = 'error';
    try {
      const r = await fetch('/__htmlpptx/firewall', { method: 'POST' });
      state = ((await r.json()) as { state?: string }).state ?? 'error';
    } catch { /* сервер не ответил */ }
    line.textContent = state === 'fixed' ? 'Готово: пульт разрешён в локальной сети. Откройте ссылку на телефоне ещё раз.'
      : state === 'declined' ? 'Разрешение не дано. Без него телефон может не подключиться — нажмите R ещё раз, чтобы повторить.'
      : 'Не получилось изменить правила брандмауэра — подробности в меню «Справка» → «Журнал работы».';
  });
  // Телефон на связи — окно остаётся: здесь же видно, кто подключён, и здесь его отключают
  o.onPhone(() => { if (box.isConnected) void refresh(); });
}

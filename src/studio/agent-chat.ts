// Чат «Агент» — панель справа, на месте «Свойств» (✦ в шапке, «Агент» в строке состояния, Ctrl+J): Claude правит
// открытую презентацию по просьбе (server/agent.ts, docs/AGENT.md). Пишешь задачу, прикладываешь картинки (скрепка,
// Ctrl+V, перетаскивание), открытый слайд уходит в контекст (плашка «Слайд 5», её можно убрать). Видны шаги агента
// и ответ по мере написания, «Стоп» (Esc). Под ответом — карточка правки: «Показать» и «Вернуть»; Ctrl+Z отменяет
// весь ответ одним шагом (Editor.agentAnswer). Разговоры — у каждой презентации свои, под значком часов.
import { icon } from '../components/icons';
import { staticSlide } from '../engine/deck-view';
import { clock } from '../engine/editor/editor';
import { plural } from '../engine/editor/font-picker';
import { esc } from '../engine/html';
import { api, canRevert, revertEntries, slideOf, type IntegrationsHost, type JournalEntry } from './integrations';
import './agent-chat.css';

export interface ChatHost extends IntegrationsHost {
  /** Закрыть панель (Ctrl+J, ×) */
  close(): void;
}

interface Model { id: string; name: string; note: string }
interface Status { connected: boolean; store: 'app' | 'env' | 'memory'; secure: boolean; models: Model[] }
interface ImageRef { file: string; name: string; type: string; size: number; url?: string }
interface Step { key?: string; text: string; state: 'run' | 'ok' | 'err' }
type Stop = 'end' | 'stopped' | 'refusal' | 'max' | 'error';
interface UserItem { role: 'user'; t: string; text: string; images?: ImageRef[]; slide?: number }
interface AnswerItem {
  role: 'assistant'; t: string; model: string; text: string; steps: Step[]; edits: JournalEntry[]; ms: number; stop: Stop; error?: string;
  /** Только пока идёт ответ и сразу после */
  live?: boolean; thinking?: boolean; code?: string; reverted?: boolean;
}
type Item = UserItem | AnswerItem;
interface Pending { name: string; type: string; data: string; url: string; size: number }
type AgentEvent =
  | { type: 'chat'; id: string; title: string }
  | { type: 'think' }
  | { type: 'step'; key: string; text: string; state: 'run' | 'ok' | 'err' }
  | { type: 'text'; delta: string }
  | { type: 'edit'; entry: JournalEntry; slides: number[] }
  | { type: 'done'; stop: Stop; ms: number }
  | { type: 'error'; code: string; message: string };

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 6;
const MODEL_KEY = 'slideria-agent-model';
const chatKey = (deck: string) => `slideria-agent-chat:${deck}`;
const KEYS_URL = 'https://platform.claude.com/settings/keys';
const EXAMPLES: [string, string][] = [
  ['image', 'Сделай слайд из этого скриншота'],
  ['slide', 'Сократи текст на этом слайде вдвое'],
  ['plus', 'Добавь в конец слайд с тремя выводами'],
];

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* нет доступа */ } },
};
const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1).replace('.', ',')} МБ`);
const steps = (n: number) => `${n} ${plural(n, 'шаг', 'шага', 'шагов')}`;
const edits = (n: number) => `${n} ${plural(n, 'правка', 'правки', 'правок')}`;
const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} с` : `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с`);

/** Ответ агента — простая разметка: абзацы, списки, **жирный**, `код` */
export function md(src: string): string {
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  return src.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

export function mountChat(root: HTMLElement, h: ChatHost) {
  let status: Status | null = null;
  let chatId = store.get(chatKey(h.deckKey));
  let items: Item[] = [];
  let model = store.get(MODEL_KEY) ?? 'claude-opus-5-5';
  let pending: Pending[] = [];
  let withSlide = true;
  let view: 'chat' | 'history' = 'chat';
  let run: { ac: AbortController; item: AnswerItem; t0: number; pulls: Promise<void> } | null = null;
  let keyError = '';
  /** Картинки прошлых сообщений: файл разговора → адрес blob: */
  const images = new Map<string, string>();

  root.innerHTML = `
<div class="ac-h">
  <span class="ac-t">${icon('agent')}Агент</span>
  <button type="button" class="ac-model" aria-haspopup="menu" aria-expanded="false" title="Модель Claude"></button>
  <span class="ac-sp"></span>
  <button type="button" class="ac-ib" data-a="new" title="Новый разговор" aria-label="Новый разговор">${icon('plus')}</button>
  <button type="button" class="ac-ib" data-a="history" title="Прошлые разговоры" aria-label="Прошлые разговоры" aria-pressed="false">${icon('clock')}</button>
  <button type="button" class="ac-ib" data-a="close" title="Закрыть (Ctrl+J)" aria-label="Закрыть">${icon('close')}</button>
</div>
<div class="ac-body" role="log" aria-label="Разговор с агентом"></div>
<div class="ac-comp">
  <div class="ac-chips"></div>
  <textarea class="ac-ta" rows="1" aria-label="Задача для агента"></textarea>
  <div class="ac-row">
    <button type="button" class="ac-ib" data-a="attach" title="Картинка: PNG, JPG, WebP, GIF — или перетащите, или Ctrl+V" aria-label="Приложить картинку">${icon('clip')}</button>
    <span class="ac-ctx" hidden></span>
    <span class="ac-sp"></span>
    <button type="button" class="ac-send" data-a="send" aria-label="Отправить"></button>
  </div>
  <input type="file" class="ac-file" accept="${TYPES.join(',')}" multiple hidden>
</div>
<div class="ac-drop" hidden><div>${icon('image')}<b>Отпустите — картинка уйдёт агенту</b><span>PNG, JPG, WebP, GIF · до 5 МБ</span></div></div>
<div class="ac-menu" role="menu" hidden></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const body = $('.ac-body');
  const ta = $<HTMLTextAreaElement>('.ac-ta');
  const send = $<HTMLButtonElement>('.ac-send');
  const menu = $('.ac-menu');
  const modelBtn = $<HTMLButtonElement>('.ac-model');
  const file = $<HTMLInputElement>('.ac-file');

  // ---------------- отрисовка ----------------

  const modelName = () => status?.models.find((m) => m.id === model)?.name ?? 'Claude';
  function paintHead(): void {
    modelBtn.innerHTML = `${esc(modelName())}${icon('chev-down')}`;
    modelBtn.hidden = !status?.connected;
    $('[data-a="history"]').setAttribute('aria-pressed', String(view === 'history'));
    for (const a of ['new', 'history']) ($(`[data-a="${a}"]`) as HTMLButtonElement).hidden = !status?.connected;
  }

  function paintComposer(): void {
    const ready = !!status?.connected;
    ta.disabled = !ready;
    ta.placeholder = ready ? 'Напишите задачу…' : 'Сначала подключите Claude';
    ($('[data-a="attach"]') as HTMLButtonElement).disabled = !ready;
    const ctx = $('.ac-ctx');
    ctx.hidden = !ready || !withSlide;
    ctx.innerHTML = `${icon('slide')}<span>Слайд ${h.index() + 1}</span><button type="button" data-a="noslide" title="Не прикладывать слайд" aria-label="Не прикладывать слайд">${icon('close')}</button>`;
    ctx.title = 'Открытый слайд уйдёт агенту вместе с сообщением';
    $('.ac-chips').innerHTML = pending.map((p, i) => `<span class="ac-chip"><span class="pv"><img src="${p.url}" alt=""></span><span class="nm">${esc(p.name)}</span><button type="button" data-rm="${i}" title="Убрать" aria-label="Убрать картинку">${icon('close')}</button></span>`).join('');
    $('.ac-chips').hidden = !pending.length;
    if (run) {
      send.innerHTML = icon('stop');
      send.className = 'ac-send stop';
      send.title = 'Остановить (Esc)';
      send.setAttribute('aria-label', 'Остановить');
      send.disabled = false;
    } else {
      send.innerHTML = icon('send');
      send.className = 'ac-send';
      send.title = 'Отправить (Enter)';
      send.setAttribute('aria-label', 'Отправить');
      send.disabled = !ready || (!ta.value.trim() && !pending.length);
    }
  }

  function setupHtml(): string {
    const where = status?.store === 'memory'
      ? 'Режим разработки: ключ хранится до перезапуска сервера (или задайте переменную ANTHROPIC_API_KEY).'
      : status?.secure === false
        ? 'В системе нет хранилища паролей (GNOME Keyring или KWallet): ключ хранится на этом компьютере зашифрованным, но слабее обычного.'
        : 'Ключ хранится на этом компьютере в зашифрованном виде.';
    const note = `${where} Содержимое презентации уходит в Anthropic, только когда вы пишете агенту.`;
    return `<div class="ac-empty">
      <div class="ac-hero"><span class="bi">${icon('agent')}</span><h3>Агент правит презентацию по вашей просьбе</h3>
        <p>Пишите задачу, прикладывайте картинки. Каждую правку видно на слайде, её можно вернуть.</p></div>
      <form class="ac-key">
        <label class="l" for="ac-key-in">${icon('key')}Подключите Claude</label>
        <div class="ac-in"><input id="ac-key-in" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" aria-describedby="ac-key-note"><button type="submit" class="ac-btn p">Подключить</button></div>
        ${keyError ? `<p class="ac-kerr" role="alert">${esc(keyError)}</p>` : ''}
        <p class="ac-note" id="ac-key-note">${icon('lock')}<span>${esc(note)} <a href="${KEYS_URL}" target="_blank" rel="noopener">Где взять ключ</a></span></p>
      </form>
      ${examplesHtml(true)}
      <p class="ac-alt">${icon('plug')}<span>Есть подписка Claude? Подключите Claude Desktop или Claude Code в один щелчок: <button type="button" class="ac-link" data-a="int">Файл → Интеграции</button></span></p>
    </div>`;
  }

  function examplesHtml(off = false): string {
    return `<div class="ac-sug${off ? ' off' : ''}"><div class="cap">Например</div>${EXAMPLES.map(([ic, t]) => `<button type="button" class="it" data-sug="${esc(t)}"${off ? ' disabled' : ''}>${icon(ic)}<span>${esc(t)}</span></button>`).join('')}</div>`;
  }

  function emptyHtml(): string {
    return `<div class="ac-empty">
      <div class="ac-hero"><span class="bi">${icon('agent')}</span><h3>Что поменять в презентации?</h3>
        <p>Пишите задачу, прикладывайте картинки — открытый слайд агент видит сам. Каждую правку видно на слайде, её можно вернуть.</p></div>
      ${examplesHtml()}
    </div>`;
  }

  function userHtml(it: UserItem): string {
    const pics = (it.images ?? []).map((im) => `<figure class="ac-att"><img alt="${esc(im.name)}" ${im.url ? `src="${im.url}"` : `data-file="${esc(im.file)}"`}><figcaption>${esc(im.name)} · ${size(im.size)}</figcaption></figure>`).join('');
    return `<div class="ac-u">${pics}${it.text ? `<div class="ac-bub">${esc(it.text)}</div>` : ''}</div>`;
  }

  /** Слайды правок ответа — номерами сейчас (по id: слайд найдётся и после перестановок) */
  function editedSlides(list: JournalEntry[]): number[] {
    const out = new Set<number>();
    for (const e of list) for (const c of e.changes) { const i = slideOf(h.deck, c); if (i >= 0) out.add(i + 1); }
    return [...out].sort((a, b) => a - b);
  }

  function cardHtml(it: AnswerItem, k: number): string {
    if (!it.edits.length) return '';
    const slides = editedSlides(it.edits);
    const n = it.edits.reduce((s, e) => s + e.changes.length, 0);
    const where = slides.length === 1 ? `Слайд ${slides[0]}` : slides.length ? `Слайды ${slides.slice(0, 4).join(', ')}${slides.length > 4 ? '…' : ''}` : 'Презентация';
    const labels = it.edits.flatMap((e) => e.changes.map((c) => c.label));
    const sub = labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` и ещё ${labels.length - 2}` : '');
    const can = it.edits.every(canRevert);
    return `<div class="ac-card" data-k="${k}"><span class="ac-th" data-th="${slides[0] ?? 1}"></span>
      <span class="ac-m"><b>${where} · ${edits(n)}</b><span title="${esc(labels.join('\n'))}">${esc(sub)}</span></span>
      <span class="ac-acts"><button type="button" class="ac-btn" data-a="show" data-k="${k}">${icon('eye')}Показать</button>${it.live
    ? '' : it.reverted ? '<span class="ac-done">Возвращено</span>' : can ? `<button type="button" class="ac-btn q" data-a="revert" data-k="${k}" title="Вернуть как было до этого ответа — что поправили после, останется. Ctrl+Z — обратно">${icon('undo')}Вернуть</button>` : '<span class="ac-done" title="Точек этих правок уже нет (старше 30 дней)">точек нет</span>'}</span></div>`;
  }

  function stepsHtml(it: AnswerItem, k: number): string {
    if (it.live) {
      const list = it.steps.map((s) => `<span class="ac-s ${s.state}">${s.state === 'run' ? '<i class="ac-spin"></i>' : icon(s.state === 'ok' ? 'check' : 'close')}${esc(s.text)}</span>`);
      if (!it.text && !it.steps.some((s) => s.state === 'run')) list.push(`<span class="ac-s run"><i class="ac-spin"></i>${it.thinking || !it.steps.length ? 'Думаю…' : 'Продолжаю…'}</span>`);
      return list.length ? `<div class="ac-steps">${list.join('')}</div>` : '';
    }
    if (!it.steps.length) return '';
    const bad = it.steps.some((s) => s.state === 'err');
    return `<div class="ac-steps"><button type="button" class="ac-sum" data-a="steps" data-k="${k}" aria-expanded="false">${icon(bad ? 'close' : 'check')}${steps(it.steps.length)} · ${secs(it.ms)}${icon('next')}</button>
      <div class="ac-slist" hidden>${it.steps.map((s) => `<span class="ac-s ${s.state}">${icon(s.state === 'err' ? 'close' : 'check')}${esc(s.text)}</span>`).join('')}</div></div>`;
  }

  function answerHtml(it: AnswerItem, k: number): string {
    const note = it.stop === 'stopped' ? '<p class="ac-stopped">Остановлено</p>' : '';
    const err = it.error
      ? `<div class="ac-err" role="alert"><span>${esc(it.error)}</span>${it.code === 'key' ? '<button type="button" class="ac-btn" data-a="rekey">Подключить заново</button>' : it.code && it.code !== 'other' && k === items.length - 1 ? '<button type="button" class="ac-btn" data-a="retry">Повторить</button>' : ''}</div>`
      : '';
    return `<div class="ac-a${it.live ? ' live' : ''}" data-k="${k}">${stepsHtml(it, k)}${it.text ? `<div class="ac-txt">${md(it.text)}${it.live ? '<span class="ac-caret"></span>' : ''}</div>` : ''}${cardHtml(it, k)}${note}${err}</div>`;
  }

  function paintBody(): void {
    if (!status) {
      body.innerHTML = '<div class="ac-wait"><i class="ac-spin"></i></div>';
      return;
    }
    if (!status.connected) {
      body.innerHTML = setupHtml();
      return;
    }
    if (view === 'history') {
      body.innerHTML = '<div class="ac-wait"><i class="ac-spin"></i></div>';
      void paintHistory();
      return;
    }
    if (!items.length) {
      body.innerHTML = emptyHtml();
      return;
    }
    body.innerHTML = `<div class="ac-log">${items.map((it, k) => (it.role === 'user' ? userHtml(it) : answerHtml(it, k))).join('')}</div>`;
    fillThumbs(body);
    loadImages();
    body.scrollTop = body.scrollHeight;
  }

  /** Эскизы слайдов в карточках правок — как слайды сейчас */
  function fillThumbs(scope: HTMLElement): void {
    for (const th of scope.querySelectorAll<HTMLElement>('[data-th]')) {
      const i = Number(th.dataset.th) - 1;
      if (i >= 0 && i < h.deck.slides.length) th.replaceChildren(staticSlide(h.deck, i, 104));
    }
  }

  /** Картинки прошлых сообщений — с сервера по одной */
  function loadImages(): void {
    if (!chatId) return;
    for (const img of body.querySelectorAll<HTMLImageElement>('img[data-file]')) {
      const f = img.dataset.file!;
      const have = images.get(f);
      if (have) { img.src = have; continue; }
      void fetch(`/__htmlpptx/chat-image?deck=${encodeURIComponent(h.deckKey)}&id=${encodeURIComponent(chatId)}&file=${encodeURIComponent(f)}`, { method: 'POST' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => { if (!b) return; const u = URL.createObjectURL(b); images.set(f, u); img.src = u; })
        .catch(() => { /* картинку не прочитать — подпись остаётся */ });
    }
  }

  /** Ответ, который пишется: перерисовать только его (не чаще кадра) */
  let frame = 0;
  function paintLive(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!run || view !== 'chat') return;
      const k = items.indexOf(run.item);
      const el = body.querySelector<HTMLElement>(`.ac-a[data-k="${k}"]`);
      if (!el) return paintBody();
      const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
      el.outerHTML = answerHtml(run.item, k);
      const fresh = body.querySelector<HTMLElement>(`.ac-a[data-k="${k}"]`);
      if (fresh) fillThumbs(fresh);
      if (stick) body.scrollTop = body.scrollHeight;
    });
  }

  async function paintHistory(): Promise<void> {
    let list: { id: string; title: string; updated: string; messages: number }[] = [];
    try { list = await api(`chat-list?deck=${encodeURIComponent(h.deckKey)}`); } catch { /* пусто */ }
    if (view !== 'history') return;
    body.innerHTML = `<div class="ac-hist"><div class="cap">Разговоры в этой презентации</div>${list.length ? list.map((c) => `<div class="ac-hi${c.id === chatId ? ' on' : ''}">
      <button type="button" class="ac-hopen" data-chat="${esc(c.id)}"><b>${esc(c.title)}</b><span>${esc(clock(Date.parse(c.updated)))} · ${c.messages} ${plural(c.messages, 'сообщение', 'сообщения', 'сообщений')}</span></button>
      <button type="button" class="ac-ib" data-del="${esc(c.id)}" title="Удалить разговор" aria-label="Удалить разговор «${esc(c.title)}»">${icon('trash')}</button></div>`).join('')
      : '<p class="ac-none">Разговоров пока нет</p>'}</div>`;
  }

  function paint(): void {
    paintHead();
    paintBody();
    paintComposer();
  }

  // ---------------- данные ----------------

  async function loadStatus(): Promise<void> {
    try { status = await api<Status>('chat-status'); } catch { status = { connected: false, store: 'memory', secure: true, models: [] }; }
    if (status.models.length && !status.models.some((m) => m.id === model)) model = status.models[0].id;
  }

  async function openChat(id: string | null): Promise<void> {
    chatId = id;
    store.set(chatKey(h.deckKey), id);
    items = [];
    view = 'chat';
    if (id) {
      try {
        const c = await api<{ id: string; model: string; view: Item[] }>(`chat-read?deck=${encodeURIComponent(h.deckKey)}&id=${encodeURIComponent(id)}`);
        items = c.view;
      } catch {
        chatId = null;
        store.set(chatKey(h.deckKey), null);
      }
    }
    paint();
  }

  // ---------------- сообщение ----------------

  async function submit(): Promise<void> {
    if (run) return stop();
    const text = ta.value.trim();
    if (!status?.connected || (!text && !pending.length)) return;
    const slide = withSlide ? h.index() + 1 : undefined;
    const sent = pending;
    const user: UserItem = { role: 'user', t: new Date().toISOString(), text, images: sent.map((p) => ({ file: '', name: p.name, type: p.type, size: p.size, url: p.url })), ...(slide ? { slide } : {}) };
    const answer: AnswerItem = { role: 'assistant', t: new Date().toISOString(), model, text: '', steps: [], edits: [], ms: 0, stop: 'end', live: true };
    items.push(user, answer);
    pending = [];
    ta.value = '';
    fit();
    withSlide = true;
    view = 'chat';
    const r = run = { ac: new AbortController(), item: answer, t0: Date.now(), pulls: Promise.resolve() };
    paint();
    // Свои правки — сначала в файл: агент читает и правит его
    await h.editor.settle();
    h.editor.agentAnswer(`agent:${r.t0}`);
    try {
      const res = await fetch(`/__htmlpptx/chat-send?deck=${encodeURIComponent(h.deckKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: chatId, text, images: sent.map(({ name, type, data }) => ({ name, type, data })), slide, model }),
        signal: r.ac.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `ошибка ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) onEvent(JSON.parse(line) as AgentEvent);
        }
      }
    } catch (e) {
      if (r.ac.signal.aborted) answer.stop = 'stopped';
      else {
        answer.stop = 'error';
        answer.error = (e as Error).message === 'Failed to fetch' ? 'Нет связи с сервером студии' : (e as Error).message;
      }
    } finally {
      await r.pulls;
      // Последние правки — в окне до того, как ответ перестаёт быть «своим» шагом отмены
      if (answer.edits.length) await h.editor.pull();
      h.editor.agentAnswer(null);
      answer.live = false;
      answer.thinking = false;
      if (!answer.ms) answer.ms = Date.now() - r.t0;
      answer.steps = answer.steps.filter((s) => s.state !== 'run');
      run = null;
      paint();
      if (answer.edits.length) h.editor.toast(`Агент: ${edits(answer.edits.reduce((n, e) => n + e.changes.length, 0))} · Ctrl+Z — отменить весь ответ`, 3500);
      ta.focus();
    }
  }

  function onEvent(e: AgentEvent): void {
    const it = run!.item;
    switch (e.type) {
      case 'chat':
        chatId = e.id;
        store.set(chatKey(h.deckKey), e.id);
        break;
      case 'think':
        it.thinking = true;
        break;
      case 'step': {
        const s = it.steps.find((x) => x.key === e.key);
        if (s) { s.text = e.text; s.state = e.state; } else it.steps.push({ key: e.key, text: e.text, state: e.state });
        it.thinking = false;
        break;
      }
      case 'text':
        it.text += e.delta;
        it.thinking = false;
        break;
      case 'edit': {
        it.edits.push(e.entry);
        // Правка уже в файле — в окно сейчас, по порядку
        const r = run!;
        r.pulls = r.pulls.then(() => h.editor.pull()).then(() => { if (run === r) paintLive(); });
        break;
      }
      case 'error':
        it.stop = 'error';
        it.error = e.message;
        it.code = e.code;
        if (e.code === 'key') void loadStatus().then(paintHead);
        break;
      case 'done':
        if (it.stop !== 'error') it.stop = e.stop;
        it.ms = e.ms;
        break;
    }
    paintLive();
  }

  function stop(): void {
    run?.ac.abort();
  }

  // ---------------- картинки ----------------

  async function addFiles(files: File[]): Promise<void> {
    let warn = '';
    for (const f of files) {
      if (pending.length >= MAX_IMAGES) { warn = `Не больше ${MAX_IMAGES} картинок в сообщении`; break; }
      if (!TYPES.includes(f.type)) { warn = 'Агенту — картинки PNG, JPG, WebP или GIF'; continue; }
      if (f.size > MAX_IMAGE) { warn = `«${f.name}» больше 5 МБ`; continue; }
      const data = await new Promise<string>((ok, fail) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
        r.onerror = () => fail(r.error);
        r.readAsDataURL(f);
      });
      pending.push({ name: f.name || `картинка.${f.type.slice(6)}`, type: f.type, data, url: URL.createObjectURL(f), size: f.size });
    }
    if (warn) h.editor.toast(warn, 3000, true);
    paintComposer();
    ta.focus();
  }

  // ---------------- меню модели ----------------

  function openMenu(): void {
    if (!status) return;
    menu.innerHTML = `${status.models.map((m) => `<button type="button" role="menuitemradio" aria-checked="${m.id === model}" data-model="${esc(m.id)}"><span class="mk">${m.id === model ? icon('check') : ''}</span><span><b>${esc(m.name)}</b><span>${esc(m.note)}</span></span></button>`).join('')}
      <hr>${status.store === 'env'
    ? '<p class="ac-mnote">Ключ — из переменной ANTHROPIC_API_KEY</p>'
    : `<button type="button" role="menuitem" data-a="disconnect"><span class="mk">${icon('key')}</span><span><b>Отключить ключ Claude</b><span>${status.store === 'app' ? 'Ключ удалится с этого компьютера' : 'Ключ забудется'}</span></span></button>`}`;
    const b = modelBtn.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    menu.style.left = `${b.left - r.left}px`;
    menu.style.top = `${b.bottom - r.top + 4}px`;
    menu.hidden = false;
    modelBtn.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus();
  }
  function closeMenu(focus = false): void {
    if (menu.hidden) return;
    menu.hidden = true;
    modelBtn.setAttribute('aria-expanded', 'false');
    if (focus) modelBtn.focus();
  }

  // ---------------- события ----------------

  function fit(): void {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>('[data-a], [data-sug], [data-chat], [data-del], [data-model], [data-rm]');
    if (!t.closest('.ac-menu') && !t.closest('.ac-model')) closeMenu();
    if (t.closest('.ac-model')) return menu.hidden ? openMenu() : closeMenu();
    if (!el) return;
    if (el.dataset.sug) {
      ta.value = el.dataset.sug;
      fit();
      paintComposer();
      ta.focus();
      return;
    }
    if (el.dataset.model) {
      model = el.dataset.model;
      store.set(MODEL_KEY, model);
      closeMenu(true);
      paintHead();
      return;
    }
    if (el.dataset.rm) {
      const p = pending.splice(Number(el.dataset.rm), 1)[0];
      if (p) URL.revokeObjectURL(p.url);
      paintComposer();
      ta.focus();
      return;
    }
    if (el.dataset.chat) return void openChat(el.dataset.chat);
    if (el.dataset.del) {
      const row = el.closest<HTMLElement>('.ac-hi')!;
      if (!row.classList.contains('ask')) {
        row.classList.add('ask');
        el.title = 'Нажмите ещё раз — удалить';
        el.setAttribute('aria-label', 'Нажмите ещё раз, чтобы удалить');
        return;
      }
      const id = el.dataset.del;
      void api(`chat-delete?deck=${encodeURIComponent(h.deckKey)}&id=${encodeURIComponent(id)}`).then(() => {
        if (id === chatId) { chatId = null; items = []; store.set(chatKey(h.deckKey), null); }
        void paintHistory();
      });
      return;
    }
    const k = Number(el.dataset.k);
    switch (el.dataset.a) {
      case 'close': return h.close();
      case 'new':
        if (run) return;
        return void openChat(null).then(() => ta.focus());
      case 'history':
        view = view === 'history' ? 'chat' : 'history';
        return paint();
      case 'send': return void submit();
      case 'attach': return file.click();
      case 'noslide':
        withSlide = false;
        paintComposer();
        return ta.focus();
      case 'int': return h.file.open();
      case 'rekey':
        status = status ? { ...status, connected: false } : status;
        keyError = '';
        return paint();
      case 'retry': {
        const last = [...items].reverse().find((x): x is UserItem => x.role === 'user');
        if (!last || run) return;
        ta.value = last.text;
        return void submit();
      }
      case 'disconnect':
        closeMenu();
        void api<Status>('chat-disconnect').then((s) => { status = s; paint(); });
        return;
      case 'steps': {
        const list = el.nextElementSibling as HTMLElement;
        list.hidden = !list.hidden;
        el.setAttribute('aria-expanded', String(!list.hidden));
        return;
      }
      case 'show': {
        const it = items[k] as AnswerItem;
        const slides = editedSlides(it.edits);
        if (slides.length) h.go(slides[0] - 1);
        return;
      }
      case 'revert': {
        const it = items[k] as AnswerItem;
        el.setAttribute('disabled', '');
        void revertEntries(h, it.edits, 'агента').then(() => { it.reverted = true; paintBody(); }, (err) => {
          el.removeAttribute('disabled');
          h.editor.toast(`Не удалось вернуть: ${(err as Error).message}`, 5000, true);
        });
        return;
      }
    }
  });

  // Ключ: «Подключить» — проверка у Claude, ошибка — под полем
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = root.querySelector<HTMLInputElement>('#ac-key-in');
    const btn = root.querySelector<HTMLButtonElement>('.ac-key button[type="submit"]');
    if (!input || !btn || !input.value.trim()) return input?.focus();
    btn.disabled = true;
    btn.textContent = 'Проверка…';
    void api<Status>('chat-connect', { key: input.value }).then((s) => {
      status = s;
      keyError = '';
      paint();
      ta.focus();
    }, (err) => {
      keyError = (err as Error).message;
      paintBody();
      root.querySelector<HTMLInputElement>('#ac-key-in')?.focus();
    });
  });

  ta.addEventListener('input', () => { fit(); paintComposer(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  });
  file.addEventListener('change', () => {
    void addFiles([...(file.files ?? [])]);
    file.value = '';
  });
  // Esc: меню — закрыть; идёт ответ — «Стоп»
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!menu.hidden) { e.preventDefault(); e.stopPropagation(); return closeMenu(true); }
    if (run) { e.preventDefault(); e.stopPropagation(); stop(); }
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...menu.querySelectorAll<HTMLElement>('button')];
    const i = list.indexOf(document.activeElement as HTMLElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  });

  // Перетаскивание картинок на панель
  const drop = $('.ac-drop');
  let depth = 0;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  root.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !status?.connected) return;
    e.preventDefault();
    depth++;
    drop.hidden = false;
  });
  root.addEventListener('dragover', (e) => { if (hasFiles(e) && status?.connected) e.preventDefault(); });
  root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    drop.hidden = true;
    if (status?.connected) void addFiles([...(e.dataTransfer?.files ?? [])]);
  });

  paint();
  void loadStatus().then(() => openChat(chatId));

  return {
    /** Слайд сменился — плашка «Слайд N» */
    sync(): void { if (!run) paintComposer(); else { const c = root.querySelector('.ac-ctx span'); if (c && withSlide) c.textContent = `Слайд ${h.index() + 1}`; } },
    focus(): void { if (status?.connected) ta.focus(); else root.querySelector<HTMLInputElement>('#ac-key-in')?.focus(); },
    /** Идёт ответ — панель не закрывается молча */
    busy: () => !!run,
  };
}

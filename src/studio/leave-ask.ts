// Окно «Сохранить изменения?» при уходе из студии (Editor.leave): окно программы закрывают, выход из программы,
// «Все презентации». Сохранить (Enter) — точка «Когда закрыли»; Не сохранять — презентация как в точке открытия
// или последнего Ctrl+S, отброшенное — точкой в «Версиях»; Отмена (Esc) — остаться в студии
import { icon } from '../components/icons';
import { staticSlide } from '../engine/deck-view';
import { clock, type LeaveInfo } from '../engine/editor/editor';
import { plural } from '../engine/editor/font-picker';
import { esc } from '../engine/html';
import { leave as fadeOut } from '../engine/motion';
import '../engine/import-ui.css';
import './leave-ask.css';

/** «3», «3 и 5», «3, 5 и 7», «3, 5, 7, 9 и ещё 4» */
function nums(n: number[]): string {
  const head = n.slice(0, 4);
  if (n.length > head.length) return `${head.join(', ')} и ещё ${n.length - head.length}`;
  return head.length > 1 ? `${head.slice(0, -1).join(', ')} и ${head.at(-1)}` : String(head[0]);
}

/** Что поменялось — одной строкой: «Изменены слайды 3, 5 и 7 · добавлен слайд 8 · удалён 1 слайд» */
export function changesText(d: LeaveInfo['diff']): string {
  const parts: string[] = [];
  if (d.changed.length) parts.push(d.changed.length === 1 ? `изменён слайд ${d.changed[0]}` : `изменены слайды ${nums(d.changed)}`);
  if (d.added.length) parts.push(d.added.length === 1 ? `добавлен слайд ${d.added[0]}` : `добавлены слайды ${nums(d.added)}`);
  if (d.removed) parts.push(`${d.removed === 1 ? 'удалён' : 'удалено'} ${d.removed} ${plural(d.removed, 'слайд', 'слайда', 'слайдов')}`);
  if (d.deck) parts.push('изменены настройки презентации');
  if (d.order) parts.push('изменён порядок слайдов');
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function askLeave(info: LeaveInfo, act: (a: 'save' | 'discard') => Promise<void>): Promise<boolean> {
  return new Promise((resolve) => {
    const before = document.activeElement as HTMLElement | null;
    const at = clock(info.since.time);
    const since = info.since.kind === 'open' ? `С открытия в ${at}` : `С точки ${at} (Ctrl+S)`;
    const box = document.createElement('div');
    box.className = 'imp-bd';
    box.innerHTML = `<div class="imp lv" role="alertdialog" aria-modal="true" aria-labelledby="lv-h" aria-describedby="lv-d">
  <div class="lv-head"><span class="lv-icon">${icon('save')}</span><h2 id="lv-h">Сохранить изменения?</h2></div>
  <div class="lv-deck"><div class="lv-thumb"></div><div><b>${esc(info.deck.title || 'Презентация')}</b><span>${esc(changesText(info.diff))}</span><span class="lv-since">${esc(since)}</span></div></div>
  <div class="lv-opts" id="lv-d">
    <p><b>Сохранить</b> — останется как сейчас, в «Версиях» появится точка.</p>
    <p><b>Не сохранять</b> — презентация вернётся к виду на ${esc(at)}. Если передумаете, эти правки можно вернуть из «Версий» в течение 30 дней.</p>
  </div>
  <p class="imp-err lv-err" role="alert" hidden></p>
  <div class="imp-actions"><button type="button" class="btn lv-n lv-cancel" data-a="cancel">Отмена</button><button type="button" class="btn lv-n" data-a="discard">Не сохранять</button><button type="button" class="btn primary" data-a="save">Сохранить<kbd>Enter</kbd></button></div>
</div>`;
    // Миниатюра — первый изменённый или добавленный слайд, как он сейчас
    const first = Math.min(info.diff.changed[0] ?? Infinity, info.diff.added[0] ?? Infinity);
    const index = Number.isFinite(first) ? first - 1 : 0;
    box.querySelector('.lv-thumb')!.append(staticSlide(info.deck, Math.min(index, info.deck.slides.length - 1), 120));
    document.body.append(box);
    const buttons = [...box.querySelectorAll<HTMLButtonElement>('button[data-a]')];
    const err = box.querySelector<HTMLElement>('.lv-err')!;
    let busy = false;

    const close = (ok: boolean) => {
      removeEventListener('keydown', onKey, true);
      fadeOut(box, { box: '.imp' });
      if (!ok) before?.focus?.();
      resolve(ok);
    };
    const choose = async (a: 'save' | 'discard') => {
      if (busy) return;
      busy = true;
      for (const b of buttons) b.disabled = true;
      err.hidden = true;
      try {
        await act(a);
        close(true);
      } catch (e) {
        err.textContent = `Не удалось ${a === 'save' ? 'сохранить' : 'вернуть'}: ${(e as Error).message}`;
        err.hidden = false;
        busy = false;
        for (const b of buttons) b.disabled = false;
        box.querySelector<HTMLButtonElement>('[data-a="save"]')!.focus();
      }
    };
    // Клавиши студии до слайдов не доходят; Tab — по кнопкам окна по кругу
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) close(false);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && box.contains(e.target))) {
        e.preventDefault();
        void choose('save');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    addEventListener('keydown', onKey, true);
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]')?.dataset.a;
      if (a === 'cancel') close(false);
      else if (a === 'save' || a === 'discard') void choose(a);
    });
    box.querySelector<HTMLButtonElement>('[data-a="save"]')!.focus();
  });
}

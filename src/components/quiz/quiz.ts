/**
 * Обучение: тест на слайде и итог.
 * quiz — вопрос с вариантами (один верный — щелчок по варианту; несколько — отметить и «Проверить») или
 * с ответом вводом. Отвечает докладчик (за класс) — в окне показа или докладчика, ответ виден в обоих.
 * В правке, миниатюрах и PDF ответ не раскрыт (автору в правке верные варианты отмечены галочкой).
 * score — итог: баллы, процент, сообщение по уровню, «Пройти заново»
 */
import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import { actionTarget, slideLabel } from '../../engine/render';
import { icon } from '../icons';
import type { Block } from '../../types';
import {
  answerChoice, answerInput, branchOf, isInput, isMulti, levelOf, optionsOf, pointsOf, quizKey, quizzesOf, scoreOf, triesOf, variants,
  type Level, type QuizData, type QuizState,
} from './check';
import { QUIZ_NEXT, QUIZ_NUDGE, quizStore } from './state';
import './quiz.css';

export interface QuizProps extends Block, Omit<QuizData, 'type'> {}
export interface ScoreProps extends Block {
  title?: string;
  /** Сообщения по проценту: [{ min: 80, text: 'Отлично' }, …] (без них — свои по умолчанию) */
  levels?: Level[];
}

const LETTERS = 'ABCDEFGHIJKL';
/** Отвечают при показе и в пробе студии; в правке щелчок выделяет блок */
const live = () => !document.body.classList.contains('editing') || document.body.classList.contains('st-previewing');
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

defineBlock<QuizProps>('quiz', {
  render(p, ctx) {
    const key = quizKey(ctx.deck, p);
    const opts = optionsOf(p);
    const input = isInput(p);
    const multi = isMulti(p);
    // «Вопрос 3 из 10» — среди вопросов видимых слайдов; на скрытом (ветка по ответу) — дополнительный
    const all = quizzesOf(ctx.deck);
    const shown = all.filter((q) => !q.hidden);
    const at = shown.findIndex((q) => q.key === key);
    const pts = pointsOf(p);
    // Куда ведёт выбор варианта (один верный ответ): свой переход или «если верно / неверно» — в PowerPoint это ссылка
    const optGo = (o: { go?: string; correct?: boolean }) => {
      if (multi) return '';
      const a = o.go ?? (o.correct === true ? p.right : p.wrong);
      return typeof a === 'string' ? a.trim() : '';
    };
    const tag = at >= 0 ? `Вопрос ${at + 1} из ${shown.length}` : 'Дополнительный вопрос';
    const hint = [input ? 'ответ вводом' : multi ? 'несколько верных ответов' : '', pts !== 1 ? (pts ? `${pts} ${plural(pts, 'балл', 'балла', 'баллов')}` : 'без баллов') : '']
      .filter(Boolean).join(' · ');
    const body = input
      ? `<div class="qz-in"><input class="qz-field" type="text" placeholder="Ответ" autocomplete="off" spellcheck="false" aria-label="Ответ" data-nospot>`
        + `<button type="button" class="qz-go" data-nospot>Проверить</button></div>`
      : `<div class="qz-opts" role="${multi ? 'group' : 'radiogroup'}">${opts.map((o, k) =>
        `<div class="qz-o${o.correct === true ? ' ok' : ''}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="false" tabindex="0" data-k="${k}" data-nospot${optGo(o) ? ` data-go="${esc(optGo(o))}"` : ''} style="--k:${k}">`
        + `<i class="qz-m" aria-hidden="true"><b>${LETTERS[k] ?? k + 1}</b>${icon('check')}${icon('close')}</i>`
        + `<span class="qz-t"${ea(o, 'text')}>${t(o.text ?? '')}</span></div>`).join('')}</div>`
        + (multi ? `<div class="qz-acts"><button type="button" class="qz-go" data-nospot>Проверить</button></div>` : '');
    const cls = `qz r${p.layout === 'grid' && !input ? ' grid' : ''}${multi ? ' multi' : ''}${input ? ' input' : ''}${p.lock === true ? ' lock' : ''}`;
    // Переходы по ответу — с названиями слайдов для кнопки «Дальше»
    const goes: Record<string, string> = {};
    for (const a of [...opts.map((o) => o.go), p.right, p.wrong]) {
      if (typeof a !== 'string' || !a.trim() || goes[a]) continue;
      const to = actionTarget(a.trim(), ctx.deck, ctx.index);
      if (to && 'slide' in to) goes[a.trim()] = slideLabel(ctx.deck.slides[to.slide], to.slide);
    }
    return `<div class="${cls}" data-qk="${esc(key)}"${Object.keys(goes).length ? ` data-goes="${esc(JSON.stringify(goes))}"` : ''}${styleAttr(p.style)}>`
      + `<div class="qz-top"><span class="qz-tag">${tag}</span>${hint ? `<span class="qz-hint">${hint}</span>` : ''}</div>`
      + `<div class="qz-q"${ea(p, 'question')}>${t(p.question ?? '')}</div>${body}<div class="qz-fb" aria-live="polite"></div></div>`;
  },
  mount(el, p) {
    const key = el.dataset.qk!;
    const opts = [...el.querySelectorAll<HTMLElement>('.qz-o')];
    const field = el.querySelector<HTMLInputElement>('.qz-field');
    const fb = el.querySelector<HTMLElement>('.qz-fb')!;
    const list = optionsOf(p);
    let goes: Record<string, string> = {};
    try { goes = JSON.parse(el.dataset.goes ?? '{}'); } catch { /* нет переходов */ }
    const draw = () => {
      const st = quizStore.get(key);
      el.classList.toggle('done', !!st?.done);
      el.classList.toggle('won', !!st?.done && st.ok);
      el.classList.toggle('lost', !!st?.done && !st.ok);
      opts.forEach((o, k) => {
        const on = !!st?.picked.includes(k);
        o.classList.toggle('picked', on);
        o.classList.toggle('tried', !!st?.tried?.includes(k) && !st.done);
        o.setAttribute('aria-checked', String(on));
      });
      if (field) {
        if (st?.text !== undefined && document.activeElement !== field) field.value = st.text;
        if (!st) field.value = '';
        field.readOnly = !!st?.done;
        // Ответ принят — поле отпускает клавиатуру: стрелки снова листают слайды
        if (st?.done && document.activeElement === field) field.blur();
      }
      fb.innerHTML = feedback(st);
    };
    const feedback = (st: QuizState | undefined): string => {
      if (!st || (!st.done && !st.tries)) return '';
      const redo = `<button type="button" class="qz-redo" data-nospot title="Ответить заново" aria-label="Ответить заново">${icon('reset')}</button>`;
      if (!st.done) {
        const left = triesOf(p) - st.tries;
        // Пояснение к только что выбранному неверному варианту — подсказка к следующей попытке
        const hint = list[st.tried?.[st.tried.length - 1] ?? -1]?.note;
        return `<span class="qz-res no">${icon('close')}Неверно</span><span class="qz-note">${typeof hint === 'string' && hint.trim() ? `${t(hint)}. ` : ''}Попробуйте ещё раз: ${left === 1 ? 'последняя попытка' : `осталось ${left} ${plural(left, 'попытка', 'попытки', 'попыток')}`}</span>${redo}`;
      }
      const pts = pointsOf(p);
      const res = st.ok
        ? `<span class="qz-res ok">${icon('check')}Верно${pts ? ` · +${pts}` : ''}</span>`
        : `<span class="qz-res no">${icon('close')}Неверно</span>`;
      const right = isInput(p) && !st.ok && variants(p).length ? `<span class="qz-ans">Верный ответ: <b>${esc(variants(p)[0])}</b></span>` : '';
      const own = !isInput(p) && st.picked.length === 1 ? list[st.picked[0]]?.note : undefined;
      const note = typeof own === 'string' && own.trim() ? own : typeof p.note === 'string' ? p.note : '';
      // Ответ ведёт на другой слайд — «Дальше: …» (то же делает стрелка вперёд)
      const go = branchOf(p, st);
      const to = go ? goes[go] : undefined;
      const next = to ? `<button type="button" class="qz-next" data-nospot>Дальше: ${esc(to)}${icon('arr-right')}</button>` : '';
      return `${res}${right}${note.trim() ? `<span class="qz-note">${t(note)}</span>` : ''}${next}${redo}`;
    };
    const set = (st: QuizState | null) => quizStore.set(key, st);
    const pick = (k: number) => {
      const st = quizStore.get(key);
      if (st?.done || !list[k]) return;
      if (isMulti(p)) {
        const picked = st?.picked.includes(k) ? st.picked.filter((x) => x !== k) : [...(st?.picked ?? []), k].sort((a, b) => a - b);
        set({ picked, ok: false, done: false, tries: st?.tries ?? 0 });
      } else if (!st?.tried?.includes(k)) set(answerChoice(p, st, [k]));
    };
    const check = () => {
      const st = quizStore.get(key);
      if (st?.done) return;
      if (field) { if (field.value.trim()) set(answerInput(p, st, field.value)); else field.focus(); }
      else if (st?.picked.length) set(answerChoice(p, st, st.picked));
    };
    const onClick = (e: MouseEvent) => {
      // Щелчок, повторённый из окна докладчика (RemoteHover), — не ответ: ответ приходит своим сообщением
      if (!live() || !e.isTrusted) return;
      const t = e.target as Element;
      if (t.closest('.qz-redo')) { set(null); return; }
      if (t.closest('.qz-next')) { window.dispatchEvent(new CustomEvent(QUIZ_NEXT)); return; }
      if (t.closest('.qz-go')) { check(); return; }
      const o = t.closest<HTMLElement>('.qz-o');
      if (o) pick(Number(o.dataset.k));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!live()) return;
      const t = e.target as HTMLElement;
      if (t === field && e.key === 'Enter') { e.preventDefault(); check(); return; }
      // Своя клавиатура: стрелки и пробел здесь не листают слайды
      if (t === field) { e.stopPropagation(); return; }
      const o = t.closest<HTMLElement>('.qz-o');
      if (o && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); pick(Number(o.dataset.k)); }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    const off = quizStore.on((m) => { if (m.key === key || m.key === '*') draw(); });
    // Листают дальше без ответа на вопрос «дальше только после ответа» — тест вздрагивает и напоминает
    let nudged = 0;
    const nudge = () => {
      if (!el.closest('.slide.on') || quizStore.get(key)?.done || p.lock !== true) return;
      el.classList.remove('nudge');
      void el.offsetWidth;
      el.classList.add('nudge');
      if (!fb.querySelector('.qz-wait')) fb.insertAdjacentHTML('afterbegin', '<span class="qz-wait">Сначала ответьте на вопрос</span>');
      clearTimeout(nudged);
      nudged = window.setTimeout(() => { el.classList.remove('nudge'); fb.querySelector('.qz-wait')?.remove(); }, 2600);
    };
    window.addEventListener(QUIZ_NUDGE, nudge);
    draw();
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); window.removeEventListener(QUIZ_NUDGE, nudge); clearTimeout(nudged); off(); };
  },
});

defineBlock<ScoreProps>('score', {
  render(p, ctx) {
    const list = quizzesOf(ctx.deck).map((q) => [q.key, q.points, q.hidden ? 1 : 0]);
    const s = scoreOf(list.map(([key, points, hidden]) => ({ key: key as string, points: points as number, hidden: !!hidden })), () => undefined);
    const levels = Array.isArray(p.levels) ? p.levels : [];
    return `<div class="qs r" data-qs="${esc(JSON.stringify(list))}" data-lv="${esc(JSON.stringify(levels))}"${styleAttr(p.style)}>`
      + `<div class="qs-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="qs-track" cx="60" cy="60" r="52" pathLength="100"/>`
      + `<circle class="qs-arc" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="0 100"/></svg><b class="qs-pct">0 %</b></div>`
      + `<div class="qs-txt"><div class="qs-title"${ea(p, 'title')}>${t(p.title ?? 'Ваш результат')}</div>`
      + `<div class="qs-num"><b class="qs-got">0</b> из <span class="qs-total">${s.total}</span> <span class="qs-unit">${plural(s.total, 'балла', 'баллов', 'баллов')}</span></div>`
      + `<div class="qs-sub">Отвечено <span class="qs-ans">0</span> из <span class="qs-cnt">${s.count}</span></div>`
      + `<div class="qs-lv"></div>`
      + `<button type="button" class="qs-reset" data-nospot>${icon('reset')}<span>Пройти заново</span></button></div></div>`;
  },
  mount(el) {
    let list: { key: string; points: number; hidden: boolean }[] = [];
    let levels: Level[] = [];
    try {
      list = (JSON.parse(el.dataset.qs ?? '[]') as [string, number, number][]).map(([key, points, hidden]) => ({ key, points, hidden: !!hidden }));
      levels = JSON.parse(el.dataset.lv ?? '[]');
    } catch { /* пусто */ }
    const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
    const draw = () => {
      const s = scoreOf(list, (k) => quizStore.get(k));
      const pct = s.total ? Math.round((s.got / s.total) * 100) : 0;
      $('.qs-got').textContent = String(s.got);
      $('.qs-total').textContent = String(s.total);
      $('.qs-unit').textContent = plural(s.total, 'балла', 'баллов', 'баллов');
      $('.qs-ans').textContent = String(s.answered);
      $('.qs-cnt').textContent = String(s.count);
      $('.qs-pct').textContent = `${pct} %`;
      el.querySelector('.qs-arc')?.setAttribute('stroke-dasharray', `${pct} 100`);
      // Сообщение — когда ответили на всё (до этого — сколько осталось)
      const left = s.count - s.answered;
      $('.qs-lv').textContent = !s.answered ? '' : left ? `Осталось ${left} ${plural(left, 'вопрос', 'вопроса', 'вопросов')}` : levelOf(levels, pct);
      el.classList.toggle('full', !!s.count && !left);
      el.dataset.grade = pct >= 70 ? 'hi' : pct >= 50 ? 'mid' : 'lo';
    };
    // «Пройти заново»: стереть все ответы — со вторым щелчком, чтобы случайно не потерять результаты урока
    let armed = 0;
    const btn = $('.qs-reset');
    const onClick = (e: MouseEvent) => {
      if (!live() || !e.isTrusted || !(e.target as Element).closest('.qs-reset')) return;
      if (!armed) {
        btn.classList.add('arm');
        btn.querySelector('span')!.textContent = 'Стереть все ответы?';
        armed = window.setTimeout(() => { armed = 0; btn.classList.remove('arm'); btn.querySelector('span')!.textContent = 'Пройти заново'; }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = 0;
      btn.classList.remove('arm');
      btn.querySelector('span')!.textContent = 'Пройти заново';
      quizStore.reset();
    };
    el.addEventListener('click', onClick);
    const off = quizStore.on(draw);
    draw();
    return () => { el.removeEventListener('click', onClick); off(); clearTimeout(armed); };
  },
});

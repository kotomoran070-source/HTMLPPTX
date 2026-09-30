import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import { controlRange, fmtVar } from '../../engine/formula';
import type { Block } from '../../types';
import './control.css';

export interface ControlProps extends Block {
  /** Имя переменной: его используют формулы других блоков — «=x*2», «{{x}}» */
  name: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Начальное значение */
  value?: number;
  /** Единица после значения: «%», «₽», « шт» */
  unit?: string;
}

/** Событие ползунка: всплывает до сцены, там пересчитываются связанные блоки слайда */
export const VAR_EVENT = 'slideria:var';

/**
 * Ползунок, который управляет слайдом: двигаешь — меняются графики и тексты с формулами.
 * В редакторе ползунок не перехватывает мышь (объект выделяют и двигают как обычно).
 */
defineBlock<ControlProps>('control', {
  render(p, ctx) {
    const name = typeof p.name === 'string' ? p.name : '';
    // При перерисовке во время показа ползунок остаётся там, куда его сдвинули
    const cur = ctx.vars?.[name];
    const r = controlRange(cur === undefined ? p : { ...p, value: cur });
    const k = (r.value - r.min) / (r.max - r.min);
    // Дорожка и бегунок — обычные элементы (их видят PPTX и PDF), поверх — прозрачный input для мыши и клавиш
    return `<div class="ctl"${styleAttr(p.style)}>`
      + `<div class="ctl-top"><span class="ctl-l"${ea(p, 'label')}>${t(p.label ?? name)}</span><b class="ctl-v">${fmtVar(r.value)}${esc(p.unit ?? '')}</b></div>`
      + `<div class="ctl-rail" style="--k:${k.toFixed(4)}"><div class="ctl-track"></div><div class="ctl-fill"></div><div class="ctl-knob"></div>`
      + `<input type="range" class="ctl-in" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.value}" data-var="${esc(name)}" aria-label="${esc(p.label ?? name)}"></div>`
      + `</div>`;
  },
  mount(el, p) {
    const input = el.querySelector<HTMLInputElement>('.ctl-in');
    const rail = el.querySelector<HTMLElement>('.ctl-rail');
    const out = el.querySelector<HTMLElement>('.ctl-v');
    if (!input || !rail || !out || typeof p.name !== 'string' || !p.name) return;
    const r = controlRange(p);
    const paint = () => {
      const v = Number(input.value);
      rail.style.setProperty('--k', ((v - r.min) / (r.max - r.min)).toFixed(4));
      out.textContent = `${fmtVar(v)}${p.unit ?? ''}`;
      return v;
    };
    const onInput = () => el.dispatchEvent(new CustomEvent(VAR_EVENT, { bubbles: true, detail: { name: p.name, value: paint() } }));
    // Значение пришло извне (второе окно показа): ползунок встаёт туда же без нового события
    const onSet = (e: Event) => {
      const d = (e as CustomEvent<{ name: string; value: number }>).detail;
      if (d?.name !== p.name) return;
      input.value = String(d.value);
      paint();
    };
    input.addEventListener('input', onInput);
    el.addEventListener('slideria:set-var', onSet);
    // Стрелки на ползунке, выбранном с клавиатуры (Tab), не листают слайды
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    input.addEventListener('keydown', stop);
    // После мыши фокус снимается: стрелки и пульт снова листают слайды
    const release = () => input.blur();
    input.addEventListener('pointerup', release);
    return () => {
      input.removeEventListener('pointerup', release);
      input.removeEventListener('input', onInput);
      el.removeEventListener('slideria:set-var', onSet);
      input.removeEventListener('keydown', stop);
    };
  },
});

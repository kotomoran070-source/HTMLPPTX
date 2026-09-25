import { defineBlock } from '../../engine/component';
import { asArray, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import './pipeline.css';

interface Step { title: string; sub?: string }
interface PipelineProps extends Block {
  steps: Step[];
  /** Секунд на один шаг подсветки */
  stepSeconds?: number;
}

/** Пайплайн: шаги по очереди подсвечиваются по кругу. */
defineBlock<PipelineProps>('pipeline', {
  render(p) {
    const steps = asArray(p.steps);
    const sec = p.stepSeconds ?? 1;
    const total = Math.max(steps.length + 2, 6) * sec;
    const items = steps.map((s, k) =>
      `<div class="st" style="--k:${k}"><i>${k + 1}</i><b${ea(s, 'title')}>${t(s.title)}</b>${s.sub ? `<span${ea(s, 'sub')}>${t(s.sub)}</span>` : ''}</div>`);
    return `<div class="pipe r"${styleAttr(`grid-template-columns:repeat(${steps.length},1fr)`, `--step:${sec}s`, `--cycle:${total}s`, p.style)}>${items.join('')}</div>`;
  },
});

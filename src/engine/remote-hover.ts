/**
 * Наведение докладчика — у зрителей. Окно докладчика присылает, где его мышь на слайде;
 * здесь элемент под ней получает класс .rhov (все правила :hover продублированы для него)
 * и события мыши, на которые отвечают подсветка связей и эффекты слайдов. Щелчок по ссылке
 * или кнопке не повторяется: страница не должна открыться на проекторе.
 */
const W = 1280;
const H = 720;
const SHEET = 'htmlpptx-rhov';

/** Листы стилей, для которых дубли уже созданы (новые появляются с правками презентации) */
const done = new WeakSet<CSSStyleSheet>();

/** Правила с :hover → те же правила для .rhov; вложенность (@media, стили презентации) сохраняется */
function mirror(rules: CSSRuleList, wrap: string[], out: string[]): void {
  for (const r of rules) {
    if (r instanceof CSSStyleRule) {
      const decl = r.style.cssText;
      if (r.selectorText.includes(':hover') && decl) {
        const sel = r.selectorText.replace(/:hover\b/g, '.rhov');
        out.push(`${wrap.map((w) => `${w}{`).join('')}${sel}{${decl}}${'}'.repeat(wrap.length)}`);
      }
      if (r.cssRules?.length) mirror(r.cssRules, [...wrap, r.selectorText], out);
    } else if (r instanceof CSSMediaRule) {
      mirror(r.cssRules, [...wrap, `@media ${r.conditionText}`], out);
    } else if (r instanceof CSSSupportsRule) {
      mirror(r.cssRules, [...wrap, `@supports ${r.conditionText}`], out);
    }
  }
}

function ensureCss(): void {
  let own = document.getElementById(SHEET) as HTMLStyleElement | null;
  const out: string[] = [];
  for (const sheet of document.styleSheets) {
    if (done.has(sheet) || sheet.ownerNode === own) continue;
    done.add(sheet);
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // чужой сайт (шрифты)
    mirror(rules, [], out);
  }
  if (!out.length) return;
  if (!own) {
    own = document.createElement('style');
    own.id = SHEET;
    document.head.appendChild(own);
  }
  own.textContent += out.join('\n');
}

const fire = (el: Element, type: string, init: MouseEventInit) => el.dispatchEvent(new MouseEvent(type, { view: window, ...init }));

export class RemoteHover {
  /** Элемент под мышью докладчика и его предки до сцены */
  private chain: Element[] = [];

  constructor(private stage: HTMLElement) {}

  private at(x: number, y: number): { el: Element | null; cx: number; cy: number } {
    const r = this.stage.getBoundingClientRect();
    const cx = r.left + (x / W) * r.width;
    const cy = r.top + (y / H) * r.height;
    const hit = document.elementFromPoint(cx, cy);
    return { el: hit && this.stage.contains(hit) && hit.closest('.slide.on') ? hit : null, cx, cy };
  }

  move(x: number, y: number): void {
    ensureCss();
    const { el, cx, cy } = this.at(x, y);
    const chain: Element[] = [];
    for (let e = el; e && e !== this.stage; e = e.parentElement) chain.push(e);
    const was = this.chain[0] ?? null;
    const base = { clientX: cx, clientY: cy };
    if (was !== el) {
      if (was) fire(was, 'mouseout', { ...base, bubbles: true, relatedTarget: el });
      for (const e of this.chain) {
        if (chain.includes(e)) continue;
        e.classList.remove('rhov');
        fire(e, 'mouseleave', { ...base, relatedTarget: el });
      }
      for (const e of [...chain].reverse()) {
        if (this.chain.includes(e)) continue;
        e.classList.add('rhov');
        fire(e, 'mouseenter', { ...base, relatedTarget: was });
      }
      if (el) fire(el, 'mouseover', { ...base, bubbles: true, relatedTarget: was });
      this.chain = chain;
    }
    if (el) fire(el, 'mousemove', { ...base, bubbles: true });
  }

  off(): void {
    const was = this.chain[0];
    if (was) fire(was, 'mouseout', { bubbles: true });
    for (const e of this.chain) {
      e.classList.remove('rhov');
      fire(e, 'mouseleave', {});
    }
    this.chain = [];
  }

  /** Щелчок докладчика по слайду (волна на космическом слайде и т. п.) — не по ссылкам и кнопкам */
  click(x: number, y: number): void {
    const { el, cx, cy } = this.at(x, y);
    if (!el || el.closest('a, button, input, select, textarea, label, summary, [contenteditable], iframe')) return;
    fire(el, 'click', { bubbles: true, clientX: cx, clientY: cy });
  }
}

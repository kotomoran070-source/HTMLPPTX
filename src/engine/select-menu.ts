/**
 * Выпадающие списки в стиле интерфейса вместо системных.
 * Сам <select> остаётся: он хранит значение и шлёт input/change, поэтому
 * код, который с ним работает, не меняется. Подменяется только открытый список.
 *
 * Список раскрывается из самого поля: выбранный пункт встаёт на место поля,
 * остальные разворачиваются вверх и вниз. Подсветка одна и скользит между пунктами.
 */

let current: { select: HTMLSelectElement; close(): void } | null = null;

const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function usable(t: EventTarget | null): t is HTMLSelectElement {
  return t instanceof HTMLSelectElement && !t.multiple && t.size <= 1 && !t.disabled && !t.closest('[data-native-select]');
}

function choose(select: HTMLSelectElement, index: number): void {
  if (select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function open(select: HTMLSelectElement): void {
  current?.close();
  const menu = document.createElement('div');
  menu.className = 'sel-menu';
  menu.setAttribute('role', 'listbox');
  // Клик по списку не считается кликом мимо выделенного объекта в редакторе
  menu.dataset.edKeep = '';
  const label = select.getAttribute('aria-label') ?? select.title;
  if (label) menu.setAttribute('aria-label', label);
  const glide = document.createElement('i');
  glide.className = 'sel-glide';
  menu.append(glide);

  const items: HTMLButtonElement[] = [];
  let group: HTMLOptGroupElement | null = null;
  [...select.options].forEach((o, i) => {
    if (o.hidden) return;
    const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
    if (g && g !== group) {
      const h = document.createElement('div');
      h.className = 'sel-group';
      h.textContent = g.label;
      menu.append(h);
    }
    group = g;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.dataset.i = String(i);
    b.disabled = o.disabled || !!g?.disabled;
    b.setAttribute('aria-selected', String(i === select.selectedIndex));
    b.textContent = o.text;
    // Список шрифтов показывает каждый шрифт им самим
    if (o.style.fontFamily) b.style.fontFamily = o.style.fontFamily;
    menu.append(b);
    items.push(b);
  });
  document.body.append(menu);

  const enabled = () => items.filter((b) => !b.disabled);
  const sel = items.find((b) => b.getAttribute('aria-selected') === 'true' && !b.disabled) ?? enabled()[0];

  // Место: выбранный пункт — на месте поля, текст пунктов — там же, где текст поля
  let dy = 0;
  const place = (first: boolean) => {
    const r = select.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(select).paddingLeft) || 8;
    const shift = (sel ? parseFloat(getComputedStyle(sel).paddingLeft) : 12) + 4 - pad;
    menu.style.minWidth = `${Math.round(r.width + shift + 4)}px`;
    if (first) {
      menu.style.maxHeight = `${Math.min(360, innerHeight - 16)}px`;
      const h = menu.offsetHeight;
      let top = sel ? r.top + (r.height - sel.offsetHeight) / 2 - sel.offsetTop : r.bottom + 4;
      // Вверху тесно — список прокручивается так, чтобы выбранный пункт остался у поля
      if (top < 8) {
        const room = menu.scrollHeight - menu.clientHeight;
        const s = Math.min(room, 8 - top);
        menu.scrollTop = s;
        top += s;
      }
      top = Math.max(8, Math.min(innerHeight - 8 - h, top));
      dy = top - r.top;
    }
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left - shift))}px`;
    menu.style.top = `${r.top + dy}px`;
    return r;
  };
  const field = place(true);

  // Подсветка одна: переезжает к пункту под курсором или выбранному стрелками
  let cur: HTMLButtonElement | null = null;
  const keepFocus = !!select.closest('.edtext');
  const mark = (b: HTMLButtonElement | undefined, scroll = true) => {
    if (!b) return;
    cur?.classList.remove('cur');
    cur = b;
    b.classList.add('cur');
    glide.style.transform = `translateY(${b.offsetTop}px)`;
    glide.style.height = `${b.offsetHeight}px`;
    glide.classList.toggle('on-sel', b.getAttribute('aria-selected') === 'true');
    // Список шрифтов на панели текста не забирает фокус: выделение в тексте остаётся
    if (!keepFocus) b.focus({ preventScroll: true });
    if (scroll) b.scrollIntoView({ block: 'nearest' });
  };
  mark(sel, false);
  void glide.offsetWidth;
  glide.classList.add('ready');

  // Раскрытие из прямоугольника поля
  const m = menu.getBoundingClientRect();
  const fromField = `inset(${Math.max(0, field.top - m.top)}px 0 ${Math.max(0, m.bottom - field.bottom)}px 0 round 8px)`;
  if (!reduced()) {
    menu.animate([{ clipPath: fromField, opacity: 0.7 }, { clipPath: 'inset(0 0 0 0 round 12px)', opacity: 1 }], { duration: 200, easing: EASE });
  }

  let closed = false;
  const close = (refocus = false, to?: HTMLButtonElement) => {
    if (closed) return;
    closed = true;
    select.removeAttribute('data-open');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onClose);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('blur', onClose);
    mo.disconnect();
    if (current?.select === select) current = null;
    if (refocus && !keepFocus) select.focus({ preventScroll: true });
    // Выбранный пункт сворачивается обратно в поле
    if (reduced() || !to || !select.isConnected) return menu.remove();
    menu.style.pointerEvents = 'none';
    const mr = menu.getBoundingClientRect();
    const t = to.getBoundingClientRect();
    menu.animate(
      [{ clipPath: 'inset(0 0 0 0 round 12px)', opacity: 1 }, { clipPath: `inset(${t.top - mr.top}px 0 ${mr.bottom - t.bottom}px 0 round 8px)`, opacity: 0 }],
      { duration: 140, easing: EASE, fill: 'forwards' },
    ).finished.then(() => menu.remove(), () => menu.remove());
  };
  const onClose = () => close();
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== select) close();
  };
  // Панель прокрутилась: список едет за полем, а поле ушло из вида — список закрывается
  const onScroll = (e: Event) => {
    if (menu.contains(e.target as Node)) return;
    if (!select.isConnected) return close();
    const r = place(false);
    if (r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) close();
  };
  const pick = (b: HTMLButtonElement) => {
    close(true, b);
    choose(select, Number(b.dataset.i));
  };
  let typed = '';
  let typedAt = 0;
  const onKey = (e: KeyboardEvent) => {
    const list = enabled();
    const i = cur ? list.indexOf(cur) : -1;
    if (e.key === 'Escape' || e.key === 'Tab') close(e.key === 'Escape', sel);
    else if (e.key === 'ArrowDown') mark(list[Math.min(list.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') mark(list[Math.max(0, i - 1)]);
    else if (e.key === 'Home' || e.key === 'PageUp') mark(list[0]);
    else if (e.key === 'End' || e.key === 'PageDown') mark(list[list.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (i < 0) return;
      pick(list[i]);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Быстрый переход по первым буквам
      typed = (e.timeStamp - typedAt > 700 ? '' : typed) + e.key.toLowerCase();
      typedAt = e.timeStamp;
      mark(list.find((b) => b.textContent!.trim().toLowerCase().startsWith(typed)));
    } else return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
  };
  // Фокус остаётся там, где был (например, в тексте, который правится)
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
    if (b && !b.disabled) pick(b);
  });
  menu.addEventListener('mousemove', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]:not(:disabled)');
    if (b && b !== cur) mark(b, false);
  });

  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  // Поле убрали (панель перестроилась) — список закрывается
  const mo = new MutationObserver(() => { if (!select.isConnected) close(); });
  mo.observe(document.body, { childList: true, subtree: true });
  addEventListener('resize', onClose);
  addEventListener('scroll', onScroll, true);
  addEventListener('blur', onClose);
  select.setAttribute('data-open', '');
  current = { select, close: () => close(false, sel) };
}

/** Подключается один раз на всё приложение */
export function setupSelectMenus(): void {
  if (matchMedia('(pointer: coarse)').matches) return; // на телефоне системный список удобнее
  addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !usable(e.target)) return;
    const select = e.target;
    e.preventDefault();
    if (current?.select === select) {
      current.close();
      return;
    }
    // Поле в тексте, который правится, фокус не забирает — как кнопки панели
    if (!select.closest('.edtext')) select.focus({ preventScroll: true });
    open(select);
  }, true);
  addEventListener('keydown', (e) => {
    if (!usable(e.target) || current) return;
    const openKey = e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'));
    if (!openKey) return;
    e.preventDefault();
    e.stopPropagation();
    open(e.target);
  }, true);
}

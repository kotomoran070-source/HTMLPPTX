/**
 * Выпадающие списки в стиле интерфейса вместо системных.
 * Сам <select> остаётся: он хранит значение и шлёт input/change, поэтому
 * код, который с ним работает, не меняется. Подменяется только открытый список.
 */

let current: { select: HTMLSelectElement; close(): void } | null = null;

const CHECK = '<svg class="sel-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

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
    const span = document.createElement('span');
    span.textContent = o.text;
    // Список шрифтов показывает каждый шрифт им самим
    if (o.style.fontFamily) span.style.fontFamily = o.style.fontFamily;
    b.append(span);
    if (i === select.selectedIndex) b.insertAdjacentHTML('beforeend', CHECK);
    menu.append(b);
    items.push(b);
  });
  document.body.append(menu);

  // Место: под списком, а если внизу тесно — над ним; ширина не меньше самого поля
  const place = () => {
    const r = select.getBoundingClientRect();
    menu.style.minWidth = `${Math.round(r.width)}px`;
    menu.style.maxHeight = '';
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = menu.scrollHeight > below && above > below;
    menu.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    menu.style.top = up ? `${Math.max(8, r.top - 4 - menu.offsetHeight)}px` : `${r.bottom + 4}px`;
    menu.classList.toggle('up', up);
    return r;
  };
  place();

  const enabled = () => items.filter((b) => !b.disabled);
  // Список шрифтов на панели текста не забирает фокус: выделение в тексте остаётся
  const keepFocus = !!select.closest('.edtext');
  const focus = (b: HTMLButtonElement | undefined) => {
    if (!b) return;
    items.forEach((x) => x.classList.toggle('cur', x === b));
    if (!keepFocus) b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest' });
  };

  const close = (refocus = false) => {
    menu.remove();
    select.removeAttribute('data-open');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onClose);
    mo.disconnect();
    removeEventListener('scroll', onScroll, true);
    removeEventListener('blur', onClose);
    if (current?.select === select) current = null;
    if (refocus && !keepFocus) select.focus({ preventScroll: true });
  };
  const onClose = () => close();
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== select) close();
  };
  // Панель прокрутилась: список едет за полем, а поле ушло из вида — список закрывается
  const onScroll = (e: Event) => {
    if (menu.contains(e.target as Node)) return;
    if (!select.isConnected) return close();
    const r = place();
    if (r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) close();
  };
  let typed = '';
  let typedAt = 0;
  const onKey = (e: KeyboardEvent) => {
    const list = enabled();
    const i = list.findIndex((b) => b.classList.contains('cur'));
    if (e.key === 'Escape' || e.key === 'Tab') close(e.key === 'Escape');
    else if (e.key === 'ArrowDown') focus(list[Math.min(list.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') focus(list[Math.max(0, i - 1)]);
    else if (e.key === 'Home' || e.key === 'PageUp') focus(list[0]);
    else if (e.key === 'End' || e.key === 'PageDown') focus(list[list.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (i < 0) return;
      close(true);
      choose(select, Number(list[i].dataset.i));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Быстрый переход по первым буквам
      typed = (e.timeStamp - typedAt > 700 ? '' : typed) + e.key.toLowerCase();
      typedAt = e.timeStamp;
      focus(list.find((b) => b.textContent!.trim().toLowerCase().startsWith(typed)));
    } else return;
    if (e.key !== 'Tab') e.preventDefault();
    e.stopPropagation();
  };
  // Фокус остаётся там, где был (например, в тексте, который правится)
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
    if (!b || b.disabled) return;
    close(true);
    choose(select, Number(b.dataset.i));
  });
  menu.addEventListener('mousemove', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]:not(:disabled)');
    if (b && !b.classList.contains('cur')) {
      items.forEach((x) => x.classList.toggle('cur', x === b));
      if (!keepFocus) b.focus({ preventScroll: true });
    }
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
  current = { select, close };
  const sel = items.find((b) => b.getAttribute('aria-selected') === 'true' && !b.disabled) ?? enabled()[0];
  if (sel) {
    // Выбранный пункт виден и отмечен сразу
    sel.scrollIntoView({ block: 'nearest' });
    focus(sel);
  }
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

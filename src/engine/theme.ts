export type Theme = 'light' | 'dark';

const KEY = 'htmlpptx-theme';
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<(t: Theme) => void>();

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const attr = root.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return media.matches ? 'dark' : 'light';
}

/** Явно выбранная тема запоминается; без выбора тема следует за системой. */
export function setTheme(theme: Theme, persist = true): void {
  root.setAttribute('data-theme', theme);
  if (persist) {
    try { localStorage.setItem(KEY, theme); } catch { /* приватный режим */ }
  }
  listeners.forEach((l) => l(theme));
}

export function toggleTheme(): Theme {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Подписка на смену темы; возвращает отписку. */
export function onThemeChange(cb: (t: Theme) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function initTheme(): void {
  const s = stored();
  if (s) root.setAttribute('data-theme', s);
  media.addEventListener('change', () => {
    if (!root.hasAttribute('data-theme')) listeners.forEach((l) => l(currentTheme()));
  });
}

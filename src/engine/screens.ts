/**
 * Два экрана, как в PowerPoint: показ — во весь экран на проекторе, окно докладчика — у себя.
 * Работает через Window Management API (Chrome, Edge): браузер один раз спрашивает
 * разрешение «Управление окнами». Без него (Firefox, Safari) окна раскладываются вручную.
 */

interface ScreenDetailed extends Screen {
  availLeft: number;
  availTop: number;
  left: number;
  top: number;
  isPrimary?: boolean;
  isInternal?: boolean;
  label?: string;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

export type ScreenPlan =
  /** Экранов два и больше: here — где работает докладчик, audience — проектор */
  | { kind: 'two'; here: ScreenDetailed; audience: ScreenDetailed }
  /** Экран один: второй не подключён или стоит повтор экрана (зеркало) */
  | { kind: 'single' }
  /** Браузер не умеет или разрешение не дали */
  | { kind: 'manual'; denied: boolean };

export async function planScreens(): Promise<ScreenPlan> {
  const w = window as Window & { getScreenDetails?: () => Promise<ScreenDetails> };
  if (!w.getScreenDetails) return { kind: 'manual', denied: false };
  // Экран один — и спрашивать разрешение незачем
  if ((screen as Screen & { isExtended?: boolean }).isExtended === false) return { kind: 'single' };
  try {
    const d = await w.getScreenDetails();
    const here = d.currentScreen;
    const others = d.screens.filter((s) => s !== here && !(s.left === here.left && s.top === here.top));
    if (!others.length) return { kind: 'single' };
    // Проектор — внешний экран; из нескольких внешних — самый большой
    const audience = [...others].sort((a, b) => Number(!!a.isInternal) - Number(!!b.isInternal) || b.width * b.height - a.width * a.height)[0];
    return { kind: 'two', here, audience };
  } catch {
    return { kind: 'manual', denied: true };
  }
}

/** Разрешение уже дано: раскладка пройдёт в том же нажатии, без лишних вопросов. */
export async function screensGranted(): Promise<boolean> {
  try {
    const st = await navigator.permissions.query({ name: 'window-management' as PermissionName });
    return st.state === 'granted';
  } catch {
    return false;
  }
}

/** Параметры window.open: окно на весь доступный экран. */
export function popupOn(s: ScreenDetailed): string {
  return `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
}

/** Текущее окно — во весь экран на выбранном мониторе. */
export function fullscreenOn(s: ScreenDetailed): Promise<void> {
  return document.documentElement.requestFullscreen({ screen: s } as FullscreenOptions);
}

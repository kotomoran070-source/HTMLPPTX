import type { ShotRequest } from '../server/shot';

/** Снять слайды страницы снимка невидимым Chromium (Playwright, Chrome или Edge) */
export function playwrightShoot(r: ShotRequest): Promise<Buffer[]>;
/** Закрыть браузер */
export function closePlaywrightShoot(): Promise<void>;

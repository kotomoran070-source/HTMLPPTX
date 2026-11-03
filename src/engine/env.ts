/**
 * Где открыта страница — сервер сообщает это в самой странице (<meta name="slideria-env">): одна и та же
 * собранная студия работает и в программе, и (дальше) в облаке, а yarn dev — с исходниками.
 *   app   — программа Slideria (окно Electron): без команд терминала, презентации в «Документы/Slideria»;
 *   decks — как называть папку с презентациями в подсказках.
 */
export interface PageEnv {
  app: boolean;
  decks: string;
}

let cached: PageEnv | null = null;

export function pageEnv(): PageEnv {
  if (cached) return cached;
  let raw: Partial<PageEnv> = {};
  try {
    raw = JSON.parse(document.querySelector<HTMLMetaElement>('meta[name="slideria-env"]')?.content || '{}') as Partial<PageEnv>;
  } catch { /* нет сервера — собранный файл */ }
  cached = { app: raw.app === true, decks: typeof raw.decks === 'string' && raw.decks ? raw.decks : 'presentations/' };
  return cached;
}

import type { Plugin } from 'vite';
import { startFrameHost } from '../server/frame-host';

/** yarn dev: адрес для слайдов со звуком (server/frame-host.ts) — рядом с сервером Vite и в его страницах */
export function frameHostPlugin(): Plugin {
  let host: ReturnType<typeof startFrameHost> | null = null;
  return {
    name: 'slideria-frame-host',
    apply: 'serve',
    configureServer(s) {
      host = startFrameHost((m) => s.config.logger.warn(m));
      s.httpServer?.once('close', () => void host?.close());
    },
    // Адрес — страницам студии и показа; телефону в сети он недоступен, там звук не нужен
    async transformIndexHtml() {
      await host?.ready;
      const url = host?.url();
      return url ? [{ tag: 'meta', attrs: { name: 'slideria-frame-host', content: url }, injectTo: 'head' }] : [];
    },
  };
}

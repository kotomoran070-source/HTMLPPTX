/**
 * yarn dev: сервер Slideria внутри сервера разработки Vite. Всё, что с презентациями, — то же, что у программы
 * (server/serve.ts): ядро (server/core.ts), обработчик (server/http.ts), уведомления страницам (server/events.ts)
 * и слежение за папкой (server/watch.ts). Vite здесь только отдаёт исходники страниц и обновляет их при правке кода.
 * Страницы получают данные по адресам сервера (src/engine/deck-source.ts) — одинаково с исходниками и с готовой
 * сборкой студии.
 */
import path from 'node:path';
import type { Plugin } from 'vite';
import { createDecksCore, type DecksCore } from '../server/core';
import { createEvents } from '../server/events';
import { WORKER_CSP, createHandler } from '../server/http';
import { announce } from '../server/running';
import { watchDecks } from '../server/watch';
import { checkFirewall, checkMessage } from './firewall.mjs';

export { DATA_ID, listDecks, readYaml } from '../server/deck-files';
export { LICENSES } from '../server/http';

export interface DecksOptions {
  /** Папка с презентациями */
  dir: string;
  /** Общая библиотека шрифтов; по умолчанию — fonts/ в корне проекта */
  fonts?: string;
  /** Свои темы, шаблоны, эффекты и образы студии; по умолчанию — library/ в корне проекта */
  library?: string;
}

export function decksPlugin(opts: DecksOptions): Plugin {
  const dir = path.resolve(opts.dir);
  let core: DecksCore | null = null;
  let watch: ReturnType<typeof watchDecks> | null = null;

  return {
    name: 'htmlpptx-decks',
    apply: 'serve',

    // Папку презентаций Vite не отслеживает: страницы узнают о правке файлов от слежения Slideria
    // (server/watch.ts), а не перезагрузкой. Иначе картинка, записанная студией, перезагружала бы страницу
    config() {
      return { server: { watch: { ignored: [(p: string) => path.resolve(p).startsWith(dir + path.sep) || path.resolve(p) === dir] } } };
    },

    configResolved(c) {
      core = createDecksCore({
        dir,
        root: c.root,
        fonts: opts.fonts,
        library: opts.library,
        hooks: { release: (paths) => watch?.release(paths) ?? (() => {}) },
      });
    },

    configureServer(s) {
      const c = core!;
      const events = createEvents({ allowedHosts: () => s.config.server.allowedHosts });
      // Записали, удалили, агенты, журнал — открытым страницам
      c.on('saved', (e) => events.send('deck-saved', e));
      c.on('removed', (e) => events.send('deck-removed', e));
      c.on('agents', (e) => events.send('agents', e));
      c.on('journal', (e) => events.send('journal', e));
      watch = watchDecks(c, {
        changed: (name) => events.send('deck-changed', { name }),
        list: (e) => events.send('decks', e),
        error: (m) => s.config.logger.warn(`Слежение за папкой презентаций: ${m}`),
      });
      // WebSocket Vite (обновление кода) — его; уведомления Slideria — наши
      s.httpServer?.on('upgrade', (req, socket, head) => { events.upgrade(req, socket, head); });
      s.httpServer?.once('close', () => { watch?.close(); events.close(); });

      // Песочница скриптов пользователя (src/studio/script-worker.ts): как у программы (server/serve.ts)
      s.middlewares.use((req, res, next) => {
        if (/\/script-worker\.ts\?worker_file/.test(req.url ?? '')) res.setHeader('Content-Security-Policy', WORKER_CSP);
        next();
      });

      // Первым: защита адреса, пульт, лицензии, данные, команды проекта — всё в сервере Slideria
      s.middlewares.use(createHandler(c, {
        allowedHosts: () => s.config.server.allowedHosts,
        address: () => s.httpServer?.address(),
        log: (m) => s.config.logger.error(m, { timestamp: true }),
      }));

      // MCP находит открытую студию по записи в папке презентаций и шлёт правки через неё (server/running.ts)
      s.httpServer?.once('listening', () => {
        const a = s.httpServer?.address();
        if (a && typeof a === 'object') s.httpServer?.once('close', announce(dir, a));
      });
      // yarn dev --host: пульт с телефона — брандмауэр Windows только проверяется (без запроса администратора);
      // если что-то мешает, в терминале подсказка: yarn firewall
      s.httpServer?.once('listening', () => {
        const a = s.httpServer?.address();
        const host = a && typeof a === 'object' ? a.address : '127.0.0.1';
        if (host === '127.0.0.1' || host === '::1' || process.platform !== 'win32') return;
        void checkFirewall().then((st) => {
          const msg = checkMessage(st);
          if (msg) s.config.logger.info(msg);
        });
      });
    },

    // Настройки страниц — как у программы (server/serve.ts): здесь yarn dev, с командами терминала
    transformIndexHtml() {
      const decks = process.env.SLIDERIA_DECKS_LABEL || 'presentations/';
      return [{ tag: 'meta', attrs: { name: 'slideria-env', content: JSON.stringify({ app: false, decks }) }, injectTo: 'head-prepend' }];
    },
  };
}


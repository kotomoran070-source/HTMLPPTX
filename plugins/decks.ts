/**
 * Презентации в Vite — обёртка над сервером Slideria (server/core.ts — ядро, server/http.ts — HTTP).
 * Здесь только то, что связано с самим Vite:
 * - yarn dev и программа: HTTP-обработчик ядра подключается к серверу Vite; события ядра (записали,
 *   удалили презентацию) уходят страницам через его WebSocket; появилась или пропала презентация — страницы
 *   перезагружаются; правка deck.yaml, которую записал сам сервер, страницу не перезагружает;
 * - данные для страниц: импорт *.yaml превращает YAML в модуль, пути ./assets/… — в импорты картинок,
 *   virtual:decks — список презентаций;
 * - yarn build имя: данные со встроенными файлами кладутся прямо в HTML (ядро, fileHtml).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { createDecksCore, nodeRunner, type DecksCore, type Runner } from '../server/core';
import { createHandler } from '../server/http';
import { DATA_ID, listDecks, mapAssets, readYaml } from '../server/deck-files';
import { checkFirewall, checkMessage } from './firewall.mjs';

export { DATA_ID, listDecks, readYaml } from '../server/deck-files';
export { LICENSES } from '../server/http';

const VIRTUAL = 'virtual:decks';
const RESOLVED = '\0' + VIRTUAL;

export interface DecksOptions {
  /** Папка с презентациями */
  dir: string;
  /** Собрать только эту презентацию (yarn build имя) */
  only?: string;
  /** Общая библиотека шрифтов; по умолчанию — fonts/ в корне проекта */
  fonts?: string;
  /** Свои темы, шаблоны, эффекты и образы студии; по умолчанию — library/ в корне проекта */
  library?: string;
}

/**
 * Крючки программы (desktop/main.mjs ставит их до запуска сервера): вход для телефона, брандмауэр Windows,
 * сборка служебным процессом Electron
 */
type AppHooks = {
  __slideriaLan?: (deck: string) => Promise<number | null>;
  __slideriaFirewall?: () => Promise<string>;
  __slideriaRun?: Runner;
};

/** Наблюдатель Vite (chokidar) и его внутренние списки игнорируемых путей */
type Watcher = ViteDevServer['watcher'] & { _ignoredPaths?: Set<string>; _userIgnored?: unknown };

export function decksPlugin(opts: DecksOptions): Plugin {
  const dir = path.resolve(opts.dir);
  const app = globalThis as AppHooks;
  let core: DecksCore | null = null;
  let server: ViteDevServer | undefined;
  const need = (): DecksCore => {
    if (!core) throw new Error('Сервер презентаций ещё не готов');
    return core;
  };

  /** Наблюдение снимается с папки на время переноса в корзину (Windows не даёт переименовать папку под наблюдением) */
  const release = (paths: string[]) => {
    const w = server?.watcher as Watcher | undefined;
    w?.unwatch(paths);
    return () => {
      // unwatch навсегда записывает пути в игнор наблюдателя: новая презентация с тем же именем
      // иначе не замечалась бы (правки файла не обновляли страницу)
      if (!w?._ignoredPaths) return;
      for (const x of paths) { w._ignoredPaths.delete(x); w._ignoredPaths.delete(`${x}/**`); }
      w._userIgnored = undefined;
    };
  };

  return {
    name: 'htmlpptx-decks',
    enforce: 'pre',

    // Корзина не отслеживается: удалённые презентации не держатся наблюдением (на Windows — открытыми
    // папками) и не перезагружают страницы своим появлением там
    config() {
      return { server: { watch: { ignored: [(p: string) => /[\\/]\.trash([\\/]|$)/.test(p)] } } };
    },

    configResolved(c) {
      core = createDecksCore({
        dir,
        root: c.root,
        fonts: opts.fonts,
        library: opts.library,
        hooks: {
          release,
          run: (script, args, o) => (app.__slideriaRun ?? nodeRunner)(script, args, o),
        },
      });
    },

    configureServer(s) {
      server = s;
      const c = need();
      const invalidateList = () => {
        const mod = s.moduleGraph.getModuleById(RESOLVED);
        if (mod) s.moduleGraph.invalidateModule(mod);
      };
      // Другим окнам этой презентации — что файл записан; всем — что презентацию удалили (карточка убирается на месте)
      c.on('saved', (e) => s.ws.send({ type: 'custom', event: 'slideria:deck-saved', data: e }));
      c.on('removed', (e) => {
        invalidateList();
        s.ws.send({ type: 'custom', event: 'slideria:deck-removed', data: e });
      });
      // Презентация появилась или пропала (положили папку, удалили руками) — список и страницы заново
      const refresh = (file: string) => {
        if (!file.startsWith(dir) || path.basename(file) !== 'deck.yaml') return;
        const rel = path.relative(dir, file).split(path.sep);
        if (rel[0] === '.trash') return;
        invalidateList();
        // Удаление из студии — страницы получили сообщение и убрали карточку сами
        if (c.isTrashing(rel[0])) return;
        s.ws.send({ type: 'full-reload' });
      };
      s.watcher.add(dir);
      s.watcher.on('add', refresh);
      s.watcher.on('unlink', refresh);

      // Первым: защита адреса, пульт, лицензии, команды проекта — всё в сервере Slideria
      s.middlewares.use(createHandler(c, {
        allowedHosts: () => s.config.server.allowedHosts,
        address: () => s.httpServer?.address(),
        lan: app.__slideriaLan,
        firewall: app.__slideriaFirewall,
        log: (m) => s.config.logger.error(m, { timestamp: true }),
      }));

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

    async handleHotUpdate(ctx) {
      // Файл записал сам сервер: страница уже показывает эти данные, перезагружать не нужно
      if (core?.wrote(ctx.file) && core.ownWrite(ctx.file, await ctx.read())) return [];
      return undefined;
    },

    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },

    load(id) {
      if (id !== RESOLVED) return null;
      const c = need();
      const all = listDecks(dir);
      if (opts.only) {
        if (!all.includes(opts.only)) {
          throw new Error(`Презентация «${opts.only}» не найдена. Есть: ${all.join(', ') || 'ни одной'}`);
        }
        // Данные лежат в HTML: так сохранённая из браузера копия несёт свои правки
        return `import { unpackDeck } from ${JSON.stringify(path.join(c.root, 'src/engine/pack.ts'))};\n`
          + `const el = document.getElementById(${JSON.stringify(DATA_ID)});\n`
          + `export const decks = { ${JSON.stringify(opts.only)}: async () => unpackDeck(JSON.parse(el.textContent)) };\n`
          + `export const fixed = ${JSON.stringify(opts.only)};\n`;
      }
      const entries = all.map((n) => `  ${JSON.stringify(n)}: () => import(${JSON.stringify(c.urlOf(c.deckFile(n)))}).then((m) => m.default)`);
      return `export const decks = {\n${entries.join(',\n')}\n};\nexport const fixed = null;\n`;
    },

    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.ya?ml$/.test(file)) return null;
      let data: unknown;
      try {
        data = readYaml(file, code);
      } catch (e) {
        if (!server) throw e;
        // В yarn dev показываем ошибку прямо на странице, а не «Failed to fetch module»
        const msg = (e as Error).message;
        server.config.logger.error(msg, { timestamp: true });
        return { code: `export default ${JSON.stringify({ __error: msg })};\n`, map: null };
      }
      const imports: string[] = [];
      const walked = mapAssets(data, (v) => {
        const abs = path.resolve(path.dirname(file), v);
        if (!fs.existsSync(abs)) {
          this.warn(`Файл не найден: ${v} (из ${path.relative(process.cwd(), file)})`);
          return v;
        }
        // .wasm и .wad — просто файлы: адрес, а не модуль (у Vite свой разбор .wasm)
        imports.push(/\.(wasm|wad)$/i.test(v) ? `${v}?url` : v);
        return `__ASSET_${imports.length - 1}__`;
      });
      const json = JSON.stringify(walked, null, 1).replace(/"__ASSET_(\d+)__"/g, (_, i) => `__asset${i}`);
      const head = imports.map((p, i) => `import __asset${i} from ${JSON.stringify(p)};`).join('\n');
      return { code: `${head}\nexport default ${json};\n`, map: null };
    },

    async transformIndexHtml(html) {
      if (!opts.only) return html;
      // Компактный файл (--compact): картинки заранее сжимаются в WebP, видео и модели — как есть
      return need().fileHtml(html, opts.only, { compact: process.env.COMPACT === '1' });
    },
  };
}

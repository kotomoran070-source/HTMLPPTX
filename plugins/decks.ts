import fs from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { parseDocument } from 'yaml';

const VIRTUAL = 'virtual:decks';
const RESOLVED = '\0' + VIRTUAL;
/** Строки в deck.yaml, похожие на путь к файлу рядом с презентацией, превращаются в импорты */
const ASSET_RE = /^\.{1,2}\/[^\s]+\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mp3|woff2?|pdf)$/i;

export interface DecksOptions {
  /** Папка с презентациями */
  dir: string;
  /** Собрать только эту презентацию (yarn build имя) */
  only?: string;
}

export function listDecks(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(dir, d.name, 'deck.yaml')))
    .map((d) => d.name)
    .sort();
}

/** Читает deck.yaml с понятной ошибкой: файл, строка, столбец. */
export function readYaml(file: string, source = fs.readFileSync(file, 'utf8')): unknown {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const where = e.linePos?.[0] ? `:${e.linePos[0].line}:${e.linePos[0].col}` : '';
    throw new Error(`Ошибка в ${path.relative(process.cwd(), file)}${where}\n${e.message}`);
  }
  return doc.toJS();
}

/**
 * Презентации как данные:
 * - импорт *.yaml превращает YAML в JS, а пути ./assets/… — в импорты картинок;
 * - виртуальный модуль virtual:decks перечисляет презентации (или одну при сборке).
 */
export function decksPlugin(opts: DecksOptions): Plugin {
  const dir = path.resolve(opts.dir);
  let root = process.cwd();
  let server: ViteDevServer | undefined;
  /** Путь от корня проекта: /presentations/имя/deck.yaml (одинаково работает на Windows) */
  const deckImport = (n: string) =>
    JSON.stringify('/' + path.relative(root, path.join(dir, n, 'deck.yaml')).split(path.sep).join('/'));

  return {
    name: 'htmlpptx-decks',
    enforce: 'pre',

    configResolved(c) {
      root = c.root;
    },

    configureServer(s) {
      server = s;
      const refresh = (file: string) => {
        if (!file.startsWith(dir) || path.basename(file) !== 'deck.yaml') return;
        const mod = s.moduleGraph.getModuleById(RESOLVED);
        if (mod) s.moduleGraph.invalidateModule(mod);
        s.ws.send({ type: 'full-reload' });
      };
      s.watcher.add(dir);
      s.watcher.on('add', refresh);
      s.watcher.on('unlink', refresh);
    },

    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },

    load(id) {
      if (id !== RESOLVED) return null;
      const all = listDecks(dir);
      if (opts.only) {
        if (!all.includes(opts.only)) {
          throw new Error(`Презентация «${opts.only}» не найдена. Есть: ${all.join(', ') || 'ни одной'}`);
        }
        return `import d from ${deckImport(opts.only)};\nexport const decks = { ${JSON.stringify(opts.only)}: () => Promise.resolve(d) };\nexport const fixed = ${JSON.stringify(opts.only)};\n`;
      }
      const entries = all.map((n) => `  ${JSON.stringify(n)}: () => import(${deckImport(n)}).then((m) => m.default)`);
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
      const walk = (v: unknown): unknown => {
        if (typeof v === 'string' && ASSET_RE.test(v)) {
          const abs = path.resolve(path.dirname(file), v);
          if (!fs.existsSync(abs)) {
            this.warn(`Файл не найден: ${v} (из ${path.relative(process.cwd(), file)})`);
            return v;
          }
          imports.push(v);
          return `__ASSET_${imports.length - 1}__`;
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        }
        return v;
      };
      const json = JSON.stringify(walk(data), null, 1)
        .replace(/"__ASSET_(\d+)__"/g, (_, i) => `__asset${i}`);
      const head = imports.map((p, i) => `import __asset${i} from ${JSON.stringify(p)};`).join('\n');
      return { code: `${head}\nexport default ${json};\n`, map: null };
    },

    transformIndexHtml(html) {
      if (!opts.only) return html;
      try {
        const deck = readYaml(path.join(dir, opts.only, 'deck.yaml')) as { title?: string; lang?: string };
        let out = html;
        if (deck?.title) out = out.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(deck.title)}</title>`);
        if (deck?.lang) out = out.replace(/<html lang="[^"]*">/, `<html lang="${escapeHtml(deck.lang)}">`);
        return out;
      } catch {
        return html;
      }
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

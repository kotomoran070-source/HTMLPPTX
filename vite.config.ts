import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { decksPlugin } from './plugins/decks';
import { frameHostPlugin } from './plugins/frame-host';
import { licenseNotice } from './plugins/licenses.mjs';

// PLAYER=1 — сборка готового проигрывателя для экспорта (scripts/build.mjs --player, server/player.ts):
// одна страница на все презентации, данные вкладывает экспорт. CLEAN, PLAYER_MODEL, PLAYER_MATH — вариант
const player = process.env.PLAYER === '1';
// Приложение Slideria (desktop/main.mjs) держит презентации в «Документы/Slideria», а кэш — у себя
const decksDir = process.env.SLIDERIA_DECKS || 'presentations';
const app = process.env.SLIDERIA_APP === '1';

export default defineConfig(({ command }) => ({
  plugins: [
    decksPlugin({ dir: decksDir, player, fonts: process.env.SLIDERIA_FONTS, library: process.env.SLIDERIA_LIBRARY }),
    frameHostPlugin(),
    // Список библиотек варианта — рядом с ним (PLAYER_MANIFEST): блок лицензий вставляет экспорт
    ...(command === 'build' ? [viteSingleFile({ removeViteModuleLoader: true }), ...licenseNotice(process.cwd(), { manifest: process.env.PLAYER_MANIFEST || undefined })] : []),
  ],
  // Сборка «для показа» (yarn build --clean): режим правки не попадает в файл
  define: {
    __EDITABLE__: JSON.stringify(process.env.CLEAN !== '1'),
    // Библиотека 3D (≈1 МБ) попадает в файл, только если в презентации есть модель (вариант проигрывателя)
    __HAS_MODEL__: JSON.stringify(!player || process.env.PLAYER_MODEL === '1'),
    // Набор формул (Temml со шрифтами, ≈350 КБ) — только если в презентации есть формулы (вариант проигрывателя)
    __HAS_MATH__: JSON.stringify(!player || process.env.PLAYER_MATH === '1'),
    // Как называть папку с презентациями в подсказках
    __DECKS_DIR__: JSON.stringify(process.env.SLIDERIA_DECKS_LABEL || 'presentations/'),
    __APP__: JSON.stringify(app),
  },
  // Документы «живых» вставок (компонент embed) — обычные файлы-ассеты
  assetsInclude: ['**/*.htm', '**/*.glb', '**/*.wad', '**/*.cube'],
  // Библиотеки, которые подключаются по требованию (экспорт PPTX, 3D): собираются сразу при запуске,
  // иначе первое обращение к ним перезагружает страницу посреди работы
  optimizeDeps: {
    include: ['pptxgenjs', 'html-to-image', 'jszip', 'yaml', 'codemirror', '@codemirror/lang-yaml', '@codemirror/lang-css', '@codemirror/lang-html', '@codemirror/theme-one-dark'],
  },
  ...(process.env.SLIDERIA_CACHE ? { cacheDir: process.env.SLIDERIA_CACHE } : {}),
  server: app
    ? {
      // Окно приложения — единственный клиент: сервер слушает только этот компьютер,
      // а файлы презентаций и шрифтов лежат вне папки программы
      open: false,
      host: '127.0.0.1',
      fs: { allow: ['.', decksDir, ...(process.env.SLIDERIA_FONTS ? [process.env.SLIDERIA_FONTS] : [])] },
    }
    : { open: true },
  build: {
    outDir: process.env.OUT_DIR || 'dist/.build',
    emptyOutDir: true,
    // Всё внутрь HTML: картинки, шрифты, видео — файл открывается без интернета.
    // В yarn dev картинки остаются файлами: режим правки сохраняет их пути в deck.yaml
    assetsInlineLimit: command === 'build' ? () => true : 0,
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4096,
  },
}));

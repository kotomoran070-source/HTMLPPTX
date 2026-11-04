import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { decksPlugin } from './plugins/decks';
import { frameHostPlugin } from './plugins/frame-host';
import { licenseNotice } from './plugins/licenses.mjs';

// Три режима:
//   yarn dev       — исходники страниц и сервер Slideria внутри Vite (plugins/decks.ts);
//   PLAYER=1       — готовый проигрыватель для экспорта (scripts/build.mjs --player, server/player.ts): один
//                    HTML-файл, данные вкладывает экспорт. CLEAN, PLAYER_MODEL, PLAYER_MATH — вариант;
//   STUDIO=1       — студия для программы без Vite (scripts/build.mjs --app, server/serve.ts): обычные файлы
//                    с отпечатком в имени, части студии грузятся по мере надобности; список библиотек внутри —
//                    в STUDIO_LICENSES (страница «Лицензии» программы)
const player = process.env.PLAYER === '1';
const studio = process.env.STUDIO === '1';
const decksDir = process.env.SLIDERIA_DECKS || 'presentations';

/** Каркас страницы и плавная смена страниц (index.html, src/engine/boot.ts) — только страницам с сервером */
const noBoot = { name: 'slideria-no-boot', transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace(/<!--slideria-boot-->[\s\S]*?<!--\/slideria-boot-->\n?/g, '') } };

export default defineConfig(({ command }) => ({
  plugins: [
    decksPlugin({ dir: decksDir, fonts: process.env.SLIDERIA_FONTS, library: process.env.SLIDERIA_LIBRARY }),
    frameHostPlugin(),
    // Собранный файл презентации открывается сам по себе: каркас и смена страниц ему не нужны
    ...(player ? [noBoot] : []),
    ...(command === 'build' && !studio ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
    // Список библиотек варианта — рядом с ним (PLAYER_MANIFEST): блок лицензий вставляет экспорт
    ...(command === 'build' ? licenseNotice(process.cwd(), { manifest: (studio ? process.env.STUDIO_LICENSES : process.env.PLAYER_MANIFEST) || undefined }) : []),
  ],
  define: {
    // Сборка «для показа» (yarn build --clean): режим правки не попадает в файл
    __EDITABLE__: JSON.stringify(process.env.CLEAN !== '1'),
    // Библиотека 3D (≈1 МБ) попадает в файл, только если в презентации есть модель (вариант проигрывателя)
    __HAS_MODEL__: JSON.stringify(!player || process.env.PLAYER_MODEL === '1'),
    // Набор формул (Temml со шрифтами, ≈350 КБ) — только если в презентации есть формулы (вариант проигрывателя)
    __HAS_MATH__: JSON.stringify(!player || process.env.PLAYER_MATH === '1'),
    // Страница с сервером Slideria (студия, страница выбора, запись в deck.yaml) — всё, кроме проигрывателя
    __SERVED__: JSON.stringify(!player),
  },
  // Документы «живых» вставок (компонент embed) — обычные файлы-ассеты
  assetsInclude: ['**/*.htm', '**/*.glb', '**/*.wad', '**/*.cube'],
  // Библиотеки, которые подключаются по требованию (экспорт PPTX, 3D): собираются сразу при запуске,
  // иначе первое обращение к ним перезагружает страницу посреди работы
  optimizeDeps: {
    include: ['pptxgenjs', 'html-to-image', 'jszip', 'yaml', 'codemirror', '@codemirror/lang-yaml', '@codemirror/lang-css', '@codemirror/lang-html', '@codemirror/theme-one-dark'],
  },
  server: {
    open: true,
    // Сборки и временные файлы (код программы .tmp/app, тестовые копии, установщик) — не повод перезагружать страницы
    watch: { ignored: ['**/.tmp/**', '**/dist/**', '**/dist-app/**'] },
    // Презентации и библиотека шрифтов могут лежать вне папки проекта
    fs: { allow: ['.', decksDir, ...(process.env.SLIDERIA_FONTS ? [process.env.SLIDERIA_FONTS] : [])] },
  },
  // Песочница скриптов (src/studio/script-worker.ts) загружает скрипт пользователя как модуль
  worker: { format: 'es' },
  build: studio
    ? {
      outDir: process.env.OUT_DIR || 'dist/.studio',
      emptyOutDir: true,
      target: 'es2022',
      // Какие файлы у частей студии: сервер подсказывает их браузеру заранее (server/serve.ts)
      manifest: true,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 4096,
    }
    : {
      outDir: process.env.OUT_DIR || 'dist/.build',
      emptyOutDir: true,
      // Всё внутрь HTML: картинки, шрифты, видео — файл открывается без интернета
      assetsInlineLimit: command === 'build' ? () => true : 0,
      cssCodeSplit: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 4096,
    },
}));

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { decksPlugin } from './plugins/decks';

// DECK=имя задаёт scripts/build.mjs: собирается одна презентация в один HTML-файл
const only = process.env.DECK || undefined;
// Приложение Slideria (desktop/main.mjs) держит презентации в «Документы/Slideria», а кэш — у себя
const decksDir = process.env.SLIDERIA_DECKS || 'presentations';
const app = process.env.SLIDERIA_APP === '1';

function usesModel(name: string): boolean {
  try {
    return /\btype:\s*['"]?model\b/.test(fs.readFileSync(path.join(decksDir, name, 'deck.yaml'), 'utf8'));
  } catch {
    return true;
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    decksPlugin({ dir: decksDir, only, fonts: process.env.SLIDERIA_FONTS }),
    ...(command === 'build' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  // Сборка «для показа» (yarn build --clean): режим правки не попадает в файл
  define: {
    __EDITABLE__: JSON.stringify(process.env.CLEAN !== '1'),
    // Библиотека 3D (≈1 МБ) попадает в файл, только если в презентации есть модель
    __HAS_MODEL__: JSON.stringify(!only || usesModel(only)),
    // Как называть папку с презентациями в подсказках
    __DECKS_DIR__: JSON.stringify(process.env.SLIDERIA_DECKS_LABEL || 'presentations/'),
  },
  // Документы «живых» вставок (компонент embed) — обычные файлы-ассеты
  assetsInclude: ['**/*.htm', '**/*.glb', '**/*.wad'],
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

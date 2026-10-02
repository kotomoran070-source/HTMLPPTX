import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { decksPlugin } from './plugins/decks';

// DECK=имя задаёт scripts/build.mjs: собирается одна презентация в один HTML-файл
const only = process.env.DECK || undefined;

function usesModel(name: string): boolean {
  try {
    return /\btype:\s*['"]?model\b/.test(fs.readFileSync(path.join('presentations', name, 'deck.yaml'), 'utf8'));
  } catch {
    return true;
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    decksPlugin({ dir: 'presentations', only }),
    ...(command === 'build' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  // Сборка «для показа» (yarn build --clean): режим правки не попадает в файл
  define: {
    __EDITABLE__: JSON.stringify(process.env.CLEAN !== '1'),
    // Библиотека 3D (≈1 МБ) попадает в файл, только если в презентации есть модель
    __HAS_MODEL__: JSON.stringify(!only || usesModel(only)),
  },
  // Документы «живых» вставок (компонент embed) — обычные файлы-ассеты
  assetsInclude: ['**/*.htm', '**/*.glb'],
  // Библиотеки, которые подключаются по требованию (экспорт PPTX, 3D): собираются сразу при запуске,
  // иначе первое обращение к ним перезагружает страницу посреди работы
  optimizeDeps: {
    include: ['pptxgenjs', 'html-to-image', 'jszip', 'yaml', 'codemirror', '@codemirror/lang-yaml', '@codemirror/lang-css', '@codemirror/lang-html', '@codemirror/theme-one-dark'],
  },
  server: {
    open: true,
  },
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

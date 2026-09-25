import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { decksPlugin } from './plugins/decks';

// DECK=имя задаёт scripts/build.mjs: собирается одна презентация в один HTML-файл
const only = process.env.DECK || undefined;

export default defineConfig(({ command }) => ({
  plugins: [
    decksPlugin({ dir: 'presentations', only }),
    ...(command === 'build' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  server: {
    open: true,
  },
  build: {
    outDir: process.env.OUT_DIR || 'dist/.build',
    emptyOutDir: true,
    // Всё внутрь HTML: картинки, шрифты, видео — файл открывается без интернета
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4096,
  },
}));

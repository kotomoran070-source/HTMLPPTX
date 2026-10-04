/**
 * Импорт PowerPoint (.pptx) в новую презентацию: папка с deck.yaml и картинками в assets/.
 * Перевод слайдов — convert.ts; здесь — запись на диск и отчёт.
 */
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { slug } from '../import';
import { convertPptx } from './convert';

export interface PptxImportResult {
  name: string;
  title: string;
  slides: number;
  assets: number;
  warnings: string[];
  dryRun: boolean;
}

export async function importPptx(data: Buffer, opts: { dir: string; fileName?: string; name?: string; dryRun?: boolean }): Promise<PptxImportResult> {
  const res = await convertPptx(data, opts.fileName);
  // Имя папки: заданное, из имени файла или из названия (по границе слова); занятое — с номером
  const short = (t: string) => { const v = slug(t); return v.length < 40 ? v : v.replace(/-[^-]*$/, ''); };
  const base = slug(opts.name ?? '') || short(path.basename(opts.fileName ?? '').replace(/\.pptx$/i, '')) || short(res.title) || 'pptx';
  let name = base;
  for (let i = 2; fs.existsSync(path.join(opts.dir, name)); i++) name = `${base}-${i}`;
  if (!opts.dryRun) {
    const dst = path.join(opts.dir, name);
    fs.mkdirSync(path.join(dst, 'assets'), { recursive: true });
    for (const [file, buf] of res.assets) fs.writeFileSync(path.join(dst, 'assets', file), buf);
    const head = `# Импорт из PowerPoint: ${path.basename(opts.fileName ?? 'presentation.pptx')}\n`
      + '# Каждый слайд — свободный холст: объекты стоят там же, где в PowerPoint, и правятся в студии.\n\n';
    fs.writeFileSync(path.join(dst, 'deck.yaml'), head + stringify(res.deck, { lineWidth: 0 }));
  }
  return { name, title: res.title, slides: res.slides, assets: res.assets.size, warnings: res.warnings, dryRun: !!opts.dryRun };
}

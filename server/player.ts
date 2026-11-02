/**
 * Готовый проигрыватель для экспорта в один HTML-файл. Код показа собирается не на каждый экспорт, а один раз
 * на вариант: правка или только показ, с 3D или без, с формулами или без (3D — около 1 МБ, формулы — 160 КБ:
 * в файл они попадают, только если нужны). Экспорт берёт готовый вариант и вкладывает в него данные и файлы
 * презентации — доли секунды вместо сборки.
 *
 * Где лежат варианты:
 *   <программа>/player — собраны заранее, при сборке установщика (scripts/app-stage.mjs);
 *   кэш (по умолчанию node_modules/.cache/slideria-player) — собираются при первом экспорте и живут, пока не
 *   меняется код программы
 *   (отпечаток исходников — sourceHash).
 * Недостающий вариант собирает отдельный процесс: scripts/build.mjs --player=<вариант> (там — Vite). Здесь Vite нет.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { noticeInto } from '../plugins/licenses.mjs';
import type { Runner } from './core';

export interface Variant {
  /** Режим правки в файле (иначе — только показ) */
  edit: boolean;
  /** 3D-модели */
  model: boolean;
  /** Формулы */
  math: boolean;
}

/** Имя варианта: show, edit-3d, show-3d-math… */
export const variantId = (v: Variant) => `${v.edit ? 'edit' : 'show'}${v.model ? '-3d' : ''}${v.math ? '-math' : ''}`;

/** Все варианты — для сборки установщика */
export const VARIANTS: Variant[] = [false, true].flatMap((edit) => [false, true].flatMap((model) => [false, true].map((math) => ({ edit, model, math }))));

/** Есть ли в deck.yaml блок такого типа */
export const usesType = (yaml: string, type: string) => new RegExp(`\\btype:\\s*['"]?${type}\\b`).test(yaml);

/** Вариант для презентации: по её deck.yaml */
export const variantOf = (yaml: string, edit: boolean): Variant => ({ edit, model: usesType(yaml, 'model'), math: usesType(yaml, 'math') });

/**
 * «Анимации, даже если у зрителя включено «Уменьшить движение»»: запросы стилей и кода к этой настройке
 * отвечают «движение можно». Во всём файле — и в коде, и в своих стилях презентации внутри данных
 */
export function keepMotion(html: string): string {
  return html
    .replace(/\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g, 'not all')
    .replace(/\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/g, 'all');
}

/** Что входит в сборку проигрывателя: поменялось что-то из этого — варианты в кэше собираются заново */
const SOURCES = ['src', 'index.html', 'vite.config.ts', 'tsconfig.json', 'plugins/decks.ts', 'plugins/frame-host.ts', 'plugins/licenses.mjs', 'server/deck-files.ts', 'scripts/build.mjs', 'package.json', 'yarn.lock'];

/** Отпечаток исходников проигрывателя */
export function sourceHash(root: string): string {
  const h = createHash('sha256');
  const add = (rel: string) => {
    const abs = path.join(root, rel);
    let st: fs.Stats;
    try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs).sort()) add(`${rel}/${e}`);
      return;
    }
    h.update(rel).update('\0').update(fs.readFileSync(abs)).update('\0');
  };
  SOURCES.forEach(add);
  return h.digest('hex').slice(0, 16);
}

export interface Template {
  html: string;
  /** Библиотеки в коде варианта — для блока лицензий */
  packages: { name: string; version: string; license: string; text: string }[];
}

interface Manifest {
  /** Собраны заранее (установщик): подходят к коду, рядом с которым лежат */
  prebuilt?: boolean;
  /** Отпечаток исходников, из которых собраны (кэш) */
  hash?: string;
  variants: string[];
}

const readManifest = (dir: string): Manifest | null => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
    return Array.isArray(m.variants) ? m : null;
  } catch { return null; }
};

const readTemplate = (dir: string, id: string): Template | null => {
  try {
    const html = fs.readFileSync(path.join(dir, `${id}.html`), 'utf8');
    const side = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as { packages?: Template['packages'] };
    return { html, packages: Array.isArray(side.packages) ? side.packages : [] };
  } catch { return null; }
};

export interface PlayersOptions {
  /** Корень программы: scripts/build.mjs, исходники, готовые варианты в player/ */
  root: string;
  /** Куда собирать недостающие варианты */
  cache: string;
  /** Чем запускать сборку (в программе — служебным процессом Electron) */
  run: Runner;
}

export type Players = ReturnType<typeof createPlayers>;

export function createPlayers(o: PlayersOptions) {
  const prebuilt = path.join(o.root, 'player');
  /** Варианты, которые сейчас собираются: второй экспорт того же варианта ждёт первую сборку */
  const building = new Map<string, Promise<Template>>();

  async function build(id: string, hash: string): Promise<Template> {
    fs.mkdirSync(o.cache, { recursive: true });
    const out = path.join(o.cache, `${id}.html`);
    const { code, stderr } = await o.run(path.join(o.root, 'scripts', 'build.mjs'), [`--player=${id}`, `--out=${out}`], { cwd: o.root, env: { ...process.env } });
    const t = code ? null : readTemplate(o.cache, id);
    if (!t) throw new Error((stderr || 'Сборка проигрывателя не удалась').trim().split('\n').slice(-3).join(' '));
    // Список собранных: при другом отпечатке прежние варианты устарели
    const m = readManifest(o.cache);
    const keep = m?.hash === hash ? m.variants.filter((v) => v !== id) : [];
    if (m && m.hash !== hash) {
      for (const v of m.variants) if (v !== id) for (const ext of ['html', 'json']) fs.rmSync(path.join(o.cache, `${v}.${ext}`), { force: true });
    }
    fs.writeFileSync(path.join(o.cache, 'manifest.json'), JSON.stringify({ hash, variants: [...keep, id] }));
    return t;
  }

  /** Готовый вариант: собранный заранее, из кэша или собранный сейчас */
  async function get(v: Variant): Promise<Template> {
    const id = variantId(v);
    const pre = readManifest(prebuilt);
    if (pre?.prebuilt && pre.variants.includes(id)) {
      const t = readTemplate(prebuilt, id);
      if (t) return t;
    }
    const hash = sourceHash(o.root);
    const m = readManifest(o.cache);
    if (m?.hash === hash && m.variants.includes(id)) {
      const t = readTemplate(o.cache, id);
      if (t) return t;
    }
    let job = building.get(id);
    if (!job) {
      job = build(id, hash).finally(() => building.delete(id));
      building.set(id, job);
    }
    return job;
  }

  /** Собрать заранее все варианты, которых ещё нет (замеры, разработка) */
  async function warm(): Promise<void> {
    for (const v of VARIANTS) await get(v);
  }

  return { get, warm };
}

/**
 * Файл из проигрывателя и страницы с данными (fileHtml ядра уже вложил данные, имя и заголовок):
 * вид слайдов автора, анимации при «Уменьшить движение», блок лицензий
 */
export function finishFile(html: string, t: Template, root: string, o: { look?: 'light' | 'dark'; motion?: boolean }): string {
  let out = html;
  if (o.look) out = out.replace(/<html\b/, `<html data-slideria-look="${o.look}"`);
  if (o.motion) out = keepMotion(out);
  return noticeInto(out, t.packages, root);
}

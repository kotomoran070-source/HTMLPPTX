// Сборка презентаций в самодостаточные HTML-файлы: dist/<имя>.html
//   yarn build            — все презентации
//   yarn build microclimate — одну
//   --clean                — «для показа»: без режима правки, файл dist/<имя>.show.html
//   --compact              — картинки сжаты в WebP (GIF — в анимированный WebP): файл в разы меньше
//   --out=путь             — куда положить файл (одна презентация)
//   --look=light|dark      — файл открывается со светлыми или тёмными слайдами, а не как в системе зрителя
//   --motion               — анимации, даже если в системе зрителя включено «Уменьшить движение»
//                            (оба — галочка «Как на этом компьютере» в «Экспорте»)
//
// Файл — готовый проигрыватель и данные презентации (server/player.ts). Проигрыватель собирается один раз
// на вариант и живёт в кэше, пока не поменялся код программы; поэтому первая сборка дольше следующих.
// Те же режимы — у кнопки «Экспорт» студии (ядро сервера, server/core.ts).
//
// Сборка самого проигрывателя (Vite):
//   --player=<вариант> --out=файл.html — один вариант: show|edit, -3d, -math (так его собирает экспорт)
//   --players --out=папка             — все варианты и manifest.json: готовые для установщика (app-stage.mjs)
//
// Код программы без Vite (server/serve.ts, desktop/main.mjs):
//   --app [--out=папка] [--force]     — по умолчанию .tmp/app: studio/ (собранная студия), server.mjs (сервер
//                                       одним файлом), licenses.json (библиотеки внутри студии). Код не менялся —
//                                       сборка пропускается (--force — всё равно собрать)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { build, createServer } from 'vite';

const root = process.cwd();
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
const playerArg = args.find((a) => a.startsWith('--player='))?.slice(9);

/** Варианты проигрывателя — как VARIANTS в server/player.ts */
const VARIANTS = ['show', 'edit'].flatMap((m) => ['', '-3d'].flatMap((d) => ['', '-math'].map((f) => `${m}${d}${f}`)));

/** Собрать вариант проигрывателя в файл out; рядом — out без .html + .json: библиотеки для блока лицензий */
async function buildPlayer(id, out) {
  const m = /^(show|edit)(-3d)?(-math)?$/.exec(id);
  if (!m) throw new Error(`Нет такого варианта проигрывателя: «${id}». Есть: ${VARIANTS.join(', ')}`);
  // Временная папка — вне проекта: сборка во время работы студии не будит наблюдение за файлами
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `slideria-player-${id}-`));
  Object.assign(process.env, {
    // Сборку запускает сервер студии, а у него NODE_ENV=development: с ним Vite собрал бы код разработки
    // (страница выбора презентаций и прочее, чего в файле быть не должно)
    NODE_ENV: 'production',
    PLAYER: '1',
    CLEAN: m[1] === 'show' ? '1' : '',
    PLAYER_MODEL: m[2] ? '1' : '',
    PLAYER_MATH: m[3] ? '1' : '',
    PLAYER_MANIFEST: out.replace(/\.html$/, '') + '.json',
    OUT_DIR: tmp,
  });
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });
    // copyFile: временная папка может быть на другом диске
    fs.copyFileSync(path.join(tmp, 'index.html'), out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Что входит в код программы: поменялось что-то из этого — сборка --app нужна заново */
const APP_SOURCES = ['src', 'server', 'plugins', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'yarn.lock', 'scripts/build.mjs'];

function codeHash() {
  const h = createHash('sha256');
  const add = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs).sort()) add(`${rel}/${e}`);
      return;
    }
    h.update(rel).update('\0').update(fs.readFileSync(abs)).update('\0');
  };
  APP_SOURCES.forEach(add);
  return h.digest('hex').slice(0, 16);
}

/** Имя пакета из импорта: lodash/fp → lodash, @scope/x/y → @scope/x */
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/**
 * Сервер одним файлом (server/serve.ts и всё, что он берёт из server/, plugins/, src/engine/). Сторонние
 * библиотеки — снаружи, из node_modules программы: проверяем, что все они в dependencies — только они
 * попадают в установщик
 */
async function bundleServer(out) {
  const { build: esbuild } = await import('esbuild');
  const r = await esbuild({
    entryPoints: [path.join(root, 'server', 'serve.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    metafile: true,
    // Без лишних пробелов и с короткими именами, тексты лицензий (/*! … */) — на месте
    minifyWhitespace: true,
    minifyIdentifiers: true,
    legalComments: 'inline',
    charset: 'utf8',
    logLevel: 'warning',
  });
  const deps = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies ?? {}));
  const builtin = new Set(builtinModules);
  const used = new Set();
  for (const o of Object.values(r.metafile.outputs)) {
    for (const i of o.imports) if (i.external && !i.path.startsWith('node:') && !builtin.has(i.path)) used.add(packageOf(i.path));
  }
  const missing = [...used].filter((n) => !deps.has(n));
  if (missing.length) throw new Error(`Серверу нужны библиотеки не из dependencies (их не будет в программе): ${missing.join(', ')}`);
  return [...used].sort();
}

/** Код программы без Vite: студия, сервер, список библиотек студии */
async function buildApp(dir, force) {
  const stamp = path.join(dir, 'build.json');
  const hash = codeHash();
  let was = null;
  try { was = JSON.parse(fs.readFileSync(stamp, 'utf8')); } catch { /* ещё не собирали */ }
  if (!force && was?.hash === hash && fs.existsSync(path.join(dir, 'studio', 'index.html')) && fs.existsSync(path.join(dir, 'server.mjs'))) {
    console.log(`✓ код программы не менялся: ${path.relative(root, dir) || dir}`);
    return;
  }
  const t0 = Date.now();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  Object.assign(process.env, {
    NODE_ENV: 'production',
    STUDIO: '1',
    OUT_DIR: path.join(dir, 'studio'),
    STUDIO_LICENSES: path.join(dir, 'licenses.json'),
  });
  await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });
  const libs = await bundleServer(path.join(dir, 'server.mjs'));
  fs.writeFileSync(stamp, JSON.stringify({ hash, server: libs }));
  const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  console.log(`✓ код программы: студия ${(size(path.join(dir, 'studio')) / 1048576).toFixed(1)} МБ, сервер ${kb(path.join(dir, 'server.mjs'))} · ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}

const fail = (msg) => {
  console.error(msg);
  process.exitCode = 1;
};
const kb = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)} КБ`;

if (playerArg) {
  if (!outArg) fail('--player: куда собрать — --out=файл.html');
  else {
    try {
      await buildPlayer(playerArg, path.resolve(outArg));
    } catch (e) {
      fail(`✗ проигрыватель ${playerArg}: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
    }
  }
} else if (args.includes('--app')) {
  try {
    await buildApp(path.resolve(outArg || path.join('.tmp', 'app')), args.includes('--force'));
  } catch (e) {
    fail(`✗ код программы: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
  }
} else if (args.includes('--players')) {
  const dir = path.resolve(outArg || path.join('dist', 'player'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const id of VARIANTS) {
      const out = path.join(dir, `${id}.html`);
      await buildPlayer(id, out);
      console.log(`✓ проигрыватель ${id}  ${kb(out)}`);
    }
    // Собраны вместе с программой: подходят к её коду, отпечаток исходников не нужен
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ prebuilt: true, variants: VARIANTS }));
  } catch (e) {
    fail(`✗ проигрыватель: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
  }
} else {
  // Приложение Slideria держит презентации вне папки программы (SLIDERIA_DECKS)
  const presDir = process.env.SLIDERIA_DECKS ? path.resolve(process.env.SLIDERIA_DECKS) : path.join(root, 'presentations');
  const wanted = args.filter((a) => !a.startsWith('-'));
  const clean = args.includes('--clean');
  const compact = args.includes('--compact');
  const look = args.find((a) => a.startsWith('--look='))?.slice(7);
  const motion = args.includes('--motion');
  // Ядро сервера — TypeScript: Vite загружает его как модуль, без сервера страниц и наблюдения за файлами
  const server = await createServer({
    configFile: false, root, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  try {
    const { createDecksCore } = await server.ssrLoadModule('/server/core.ts');
    const core = createDecksCore({ dir: presDir, root });
    const all = core.names();
    const names = wanted.length ? wanted : all;
    const missing = names.filter((n) => !all.includes(n));
    if (missing.length) fail(`Не найдены презентации: ${missing.join(', ')}. Есть: ${all.join(', ') || 'ни одной'}`);
    else if (!names.length) fail('В папке presentations нет ни одной презентации. Создайте: yarn new имя');
    else if (outArg && names.length !== 1) fail('--out работает для одной презентации: yarn build имя --out=файл.html');
    else if (look && look !== 'light' && look !== 'dark') fail(`--look: light или dark, а не «${look}»`);
    else {
      for (const name of names) {
        // С --out папка dist не нужна: приложение может стоять там, куда писать нельзя
        const out = outArg ? path.resolve(outArg) : path.join(root, 'dist', `${name}${clean ? '.show' : ''}.html`);
        try {
          const html = await core.exportHtml(name, { clean, compact, look, motion });
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, html);
        } catch (e) {
          fail(`✗ ${name}: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
          continue;
        }
        console.log(`✓ ${path.relative(root, out)}  ${kb(out)}${clean ? ' · для показа' : ''}${compact ? ' · компактный' : ''}`);
      }
    }
  } finally {
    await server.close();
  }
}

// Сборка проигрывателя в приложении идёт служебным процессом Electron (desktop/main.mjs), а он сам
// не завершается: выход — когда сообщения об ошибках дописаны
if (process.parentPort) process.stderr.write('', () => process.exit(process.exitCode ?? 0));

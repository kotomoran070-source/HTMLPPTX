// yarn serve — сервер Slideria без Vite на собранной студии, как в программе (server/serve.ts):
//   node scripts/serve.mjs [--port=5190] [--host=127.0.0.1]
// Папки — как у yarn dev: SLIDERIA_DECKS (по умолчанию presentations/), SLIDERIA_FONTS, SLIDERIA_LIBRARY.
// Код (студия и сервер одним файлом) собирается перед запуском, если поменялся: scripts/build.mjs --app → .tmp/app.
// Им же автотесты проверяют путь программы: SLIDERIA_SERVE=1 yarn test:e2e.
//   --root=папка --code=папка — код из копии для установщика (yarn test:stage): корень программы (шаблоны,
//                               проигрыватель, шрифты комплекта) и её app/; ничего не собирается
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const own = arg('code');
const code = own ? path.resolve(own) : path.join(root, '.tmp', 'app');
const appRoot = arg('root') ? path.resolve(arg('root')) : root;

if (!own) {
  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--app', `--out=${code}`], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const { startServer } = await import(pathToFileURL(path.join(code, 'server.mjs')).href);
const server = await startServer({
  dir: path.resolve(root, process.env.SLIDERIA_DECKS || 'presentations'),
  root: appRoot,
  studio: path.join(code, 'studio'),
  fonts: process.env.SLIDERIA_FONTS ? path.resolve(root, process.env.SLIDERIA_FONTS) : undefined,
  library: process.env.SLIDERIA_LIBRARY ? path.resolve(root, process.env.SLIDERIA_LIBRARY) : undefined,
  host: arg('host') || '127.0.0.1',
  port: Number(arg('port') || 5190),
  env: { app: false, decks: process.env.SLIDERIA_DECKS_LABEL || 'presentations/' },
});
console.log(`Slideria: ${server.url}`);
const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

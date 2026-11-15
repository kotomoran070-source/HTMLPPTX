// Сервер из исходников (без сжатия имён) + профиль процессора на время сохранений
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
await build({ entryPoints: ['server/serve.ts'], outfile: '.tmp/zz-server.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external', logLevel: 'warning' });
const { startServer } = await import(pathToFileURL(path.resolve('.tmp/zz-server.mjs')).href);
const server = await startServer({ dir: path.resolve('.tmp/test-decks'), root, studio: path.resolve('.tmp/app/studio'), fonts: path.resolve('.tmp/test-fonts'), library: path.resolve('.tmp/test-library'), host: '127.0.0.1', port: 5194, env: { app: false, decks: 'x' } });
console.log('up', server.url);
const s = new inspector.Session();
s.connect();
const post = (m, p) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 500 });
process.on('SIGUSR2', async () => { await post('Profiler.start'); console.log('prof on'); });
process.on('SIGTERM', async () => {
  const { profile } = await post('Profiler.stop');
  fs.writeFileSync('.tmp/zz-server.cpuprofile', JSON.stringify(profile));
  process.exit(0);
});

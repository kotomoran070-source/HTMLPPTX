// Показ с пультом на телефоне: собирает презентацию и раздаёт её в локальной сети.
//   yarn present slideria            — собрать и показать
//   yarn present slideria --no-build — показать уже собранный dist/slideria.html
//   --port=5180                      — свой порт
//   --no-firewall                    — не настраивать брандмауэр Windows
// Откройте показ на этом компьютере (откроется сам) и нажмите R: на экране будет QR для телефона.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { lanAddresses, lanUrls, remoteRelay } from '../plugins/remote-relay.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('-'));
const portArg = Number(args.find((a) => a.startsWith('--port='))?.slice(7)) || 5180;

if (!name) {
  const all = fs.existsSync(path.join(root, 'presentations'))
    ? fs.readdirSync(path.join(root, 'presentations')).filter((d) => fs.existsSync(path.join(root, 'presentations', d, 'deck.yaml')) && !d.startsWith('.'))
    : [];
  console.error(`Укажите презентацию: yarn present имя. Есть: ${all.join(', ') || 'ни одной'}`);
  process.exit(1);
}

const file = path.join(root, 'dist', `${name}.html`);
if (!args.includes('--no-build')) {
  console.log(`Собираю ${name}…`);
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), name], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!fs.existsSync(file)) {
  console.error(`Нет файла ${path.relative(root, file)}: соберите презентацию (yarn build ${name}).`);
  process.exit(1);
}

// Брандмауэр Windows: один раз разрешить порты пульта (yarn dev — 5173, yarn present — 5180…5199)
// только для устройств локальной сети. Отключать брандмауэр не нужно.
const RULE = 'Slideria remote';
const PORTS = '5173,5180-5199';
let firewall = 'skip';
if (process.platform === 'win32' && !args.includes('--no-firewall')) {
  const has = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`], { stdio: 'ignore' }).status === 0;
  if (has) firewall = 'ok';
  else {
    console.log('Разрешаю пульт в брандмауэре Windows: подтвердите запрос администратора (один раз)…');
    const add = `advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${PORTS} remoteip=localsubnet profile=private,public`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '${add}'`], { stdio: 'ignore' });
    const ok = r.status === 0 && spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`], { stdio: 'ignore' }).status === 0;
    firewall = ok ? 'added' : 'failed';
  }
}

let port = portArg;
const server = http.createServer((req, res) => {
  if (remoteRelay(req, res, () => ({ port, localOnly: false }))) return;
  const p = new URL(req.url ?? '/', 'http://local').pathname;
  if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === `/${name}.html`)) {
    // Файл читается при каждом запросе: пересобрали — обновите страницу
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Не найдено');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < portArg + 20) {
    port++;
    server.listen(port, '0.0.0.0');
  } else {
    console.error(e.message);
    process.exit(1);
  }
});

server.listen(port, '0.0.0.0', () => {
  const local = `http://localhost:${port}/`;
  const lan = lanUrls(port);
  console.log(`\n  Показ:      ${local}`);
  // Имена адаптеров: видно, какой адрес — Wi-Fi, а какой виртуальный
  for (const a of lanAddresses()) console.log(`  ${a.score > -100 ? 'В сети:' : 'Пропущен:'}${' '.repeat(a.score > -100 ? 5 : 3)}http://${a.ip}:${port}/   (${a.name})`);
  if (firewall === 'added') console.log('\n  Брандмауэр: порты пульта разрешены для локальной сети — больше спрашивать не будет.');
  else if (firewall === 'failed') {
    console.log('\n  Брандмауэр: разрешение не получено. Один раз выполните в PowerShell от имени администратора:');
    console.log(`  netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${PORTS} remoteip=localsubnet profile=private,public`);
  }
  if (!lan.length) console.log('  В сети:     нет подключения — телефон не сможет подключиться');
  console.log('\n  Нажмите R в показе — на экране появится QR для телефона (он должен быть в той же Wi-Fi).');
  console.log('  Остановить: Ctrl+C\n');
  // Открыть показ в браузере этого компьютера
  const cmd = process.platform === 'darwin' ? ['open', [local]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', local]] : ['xdg-open', [local]];
  if (!args.includes('--no-open')) {
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* браузер откроют вручную */ }
  }
});

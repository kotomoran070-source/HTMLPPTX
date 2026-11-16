// Расширение Slideria для Claude Desktop (.mcpb, server/connect.ts): Claude Desktop запускает этот файл своим
// Node.js, а он — Slideria на этом компьютере с ключом --mcp. Что запускать — в target.json рядом: его пишет
// Slideria при «Подключить к Claude Desktop». Протокол MCP переливается потоками: у встроенного Node Claude Desktop
// вход и выход — потоки внутри программы, а не трубы (fd 0 и 1 пусты), — переданные напрямую, Slideria видела бы
// закрытый вход и сразу выходила.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  process.stderr.write(`[slideria] ${message}\n`);
  process.exit(1);
}

let target;
try {
  target = JSON.parse(fs.readFileSync(path.join(__dirname, 'target.json'), 'utf8'));
} catch (e) {
  fail(`расширение повреждено: нет target.json (${e.message}). Подключите заново: Slideria → Файл → Интеграции → Агенты`);
}
if (!target || typeof target.command !== 'string' || !Array.isArray(target.args)) fail('расширение повреждено: в target.json нет команды');
if (path.isAbsolute(target.command) && !fs.existsSync(target.command)) {
  fail(`Slideria не найдена: ${target.command}. Установите её или подключите заново: Slideria → Файл → Интеграции → Агенты`);
}

// Claude Desktop может запускать Node самим собой (Electron в режиме Node). Slideria — тоже Electron: с этими
// переменными она запустилась бы не программой, а Node
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const child = spawn(target.command, target.args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
child.on('error', (e) => fail(`не удалось запустить Slideria: ${e.message}`));
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
// Сообщения Slideria — в журнал расширения у Claude Desktop
child.stderr.pipe(process.stderr);
// Агент ушёл — вход закрывается, Slideria выходит сама; ушла Slideria раньше — запись в её вход не роняет запуск
child.stdin.on('error', () => {});
// close — после того, как всё из её stdout дописано: последние ответы не теряются
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
// Claude Desktop останавливает расширение — останавливается и Slideria
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

// Расширение Slideria для Claude Desktop (.mcpb, server/connect.ts): Claude Desktop запускает этот файл своим
// Node.js, а он — Slideria на этом компьютере с ключом --mcp. Что запускать — в target.json рядом: его пишет
// Slideria при «Подключить к Claude Desktop». Протокол MCP идёт напрямую: stdin и stdout у Slideria — те же.
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

const child = spawn(target.command, target.args, { stdio: 'inherit', env, windowsHide: true });
child.on('error', (e) => fail(`не удалось запустить Slideria: ${e.message}`));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
// Claude Desktop останавливает расширение — останавливается и Slideria
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

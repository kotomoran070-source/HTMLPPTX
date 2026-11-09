// Вход MCP программы (Slideria --mcp, docs/MCP.md). На Windows Electron при запуске подменяет process.stdin
// пустым, уже закрытым потоком: программа видела «вход закрыт» и выходила, не прочитав ни одного запроса агента.
// Труба от агента (fd 0) при этом цела — её читаем сами, как Node открыл бы process.stdin: сокетом (его чтение
// отменяется, когда агент уходит). Вход — файл — читается как файл. На macOS и Linux process.stdin в порядке.
import fs from 'node:fs';
import net from 'node:net';

export function mcpInput(platform = process.platform) {
  if (platform !== 'win32') return process.stdin;
  try {
    const s = new net.Socket({ fd: 0, readable: true, writable: false });
    // Агента закрыли посреди сообщения — вход просто закрывается, как при обычном уходе
    s.on('error', () => s.destroy());
    return s;
  } catch (e) {
    if (e?.code === 'ERR_INVALID_FD_TYPE' && /FILE/.test(String(e.message))) return fs.createReadStream('', { fd: 0, autoClose: false });
    throw new Error('Вход — не труба от агента: Slideria --mcp запускает сам агент (Claude Desktop, Claude Code, Codex), а не человек в терминале');
  }
}

/** Дописать всё, что ещё в буфере stdout: без этого app.exit обрывает последние ответы */
export const flush = (out = process.stdout) => new Promise((done) => { out.write('', () => done()); });

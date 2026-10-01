// Брандмауэр Windows для пульта с телефона: yarn dev --host и yarn present.
// Отключать брандмауэр не нужно. Один раз (с подтверждением администратора):
//  1) разрешаются входящие подключения к портам показа 5173–5199 — только из локальной сети;
//  2) выключаются запрещающие правила для node.exe. Windows создаёт их сама, если в окне
//     «Разрешить доступ» при первом запуске Node нажали «Отмена» или сняли галочки, — и запрет
//     сильнее любого разрешения. Другие порты Node этим не открываются: без разрешающего правила
//     входящие подключения брандмауэр и так не пускает.
import { spawn } from 'node:child_process';

export const RULE = 'Slideria remote';
export const PORTS = '5173-5199';

const ps = (s) => s.replace(/'/g, "''");
const exe = ps(process.execPath);

/** Проверка без прав администратора: «1 0» — правило есть, запретов нет */
const CHECK = `$ErrorActionPreference='SilentlyContinue'
$ok = 0
$r = @(Get-NetFirewallRule -DisplayName '${RULE}' | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
if ($r.Count -eq 1) { $p = $r | Get-NetFirewallPortFilter; if (@($p.LocalPort) -contains '${PORTS}') { $ok = 1 } }
$b = @(Get-NetFirewallApplicationFilter -Program '${exe}' | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' }).Count
Write-Output "$ok $b"`;

/** Исправление — от имени администратора */
const FIX = `Remove-NetFirewallRule -DisplayName '${RULE}' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName '${RULE}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${PORTS} -RemoteAddress LocalSubnet -Profile Any | Out-Null
Get-NetFirewallApplicationFilter -Program '${exe}' -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } | Disable-NetFirewallRule`;

const encoded = (s) => Buffer.from(s, 'utf16le').toString('base64');

function run(args) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try {
      p = spawn('powershell', ['-NoProfile', '-NonInteractive', ...args], { windowsHide: true });
    } catch {
      return resolve({ code: -1, out });
    }
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve({ code: -1, out }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function check() {
  const r = await run(['-EncodedCommand', encoded(CHECK)]);
  const m = /(\d)\s+(\d+)/.exec(r.out);
  return m ? { rule: m[1] === '1', blocks: Number(m[2]) } : null;
}

/**
 * 'skip' — не Windows; 'ok' — уже настроено; 'fixed' — настроено сейчас;
 * 'declined' — запрос администратора отклонён; 'error' — не удалось проверить или настроить
 */
export async function ensureFirewall({ log = console.log } = {}) {
  if (process.platform !== 'win32') return 'skip';
  const before = await check();
  if (!before) return 'error';
  if (before.rule && !before.blocks) return 'ok';
  log(before.blocks
    ? `  Брандмауэр: Node заблокирован (${before.blocks} запрещающ. правил) — разрешаю пульт, подтвердите запрос администратора (один раз)…`
    : '  Брандмауэр: разрешаю порты пульта для локальной сети — подтвердите запрос администратора (один раз)…');
  const elevated = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded(FIX)}'`;
  const r = await run(['-Command', elevated]);
  const after = await check();
  if (after?.rule && !after.blocks) return 'fixed';
  return r.code !== 0 ? 'declined' : 'error';
}

/** Что сказать после ensureFirewall (пустая строка — нечего) */
export function firewallMessage(state) {
  if (state === 'fixed') return '  Брандмауэр: пульт разрешён для локальной сети — больше спрашивать не будет.';
  if (state === 'declined' || state === 'error') {
    return `  Брандмауэр: разрешение не получено — телефон может не подключиться. Выполните один раз: yarn firewall\n`
      + '  (или в PowerShell от имени администратора — см. plugins/firewall.mjs)';
  }
  return '';
}

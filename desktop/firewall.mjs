// Брандмауэр Windows для пульта с телефона — только по кнопке «Разрешить в брандмауэре»
// в окне с QR. Обычно это не нужно: в первый раз Windows сама спрашивает, пускать ли Slideria
// в сеть. Кнопка — для случаев, когда там нажали «Отмена» или сеть помечена «общественной».
//
// Приложение перезапускает само себя с правами администратора (в запросе Windows видно
// «Slideria»), и этот экземпляр только меняет правила стандартной утилитой netsh и выходит.
import { spawn, spawnSync } from 'node:child_process';
import { app } from 'electron';

export const FIX_FLAG = '--slideria-firewall';
const RULE = 'Slideria';
const PORTS = '5180-5199';
// Код выхода экземпляра-администратора: всё получилось
const OK = 0;
const FAILED = 7;

/** Экземпляр с правами администратора: правила для этой программы — и сразу выход */
export function runFirewallFix() {
  const exe = process.execPath;
  // Аргументы как есть: netsh ждёт program="путь", а не "program=путь"
  const netsh = (...args) => spawnSync('netsh', ['advfirewall', 'firewall', ...args], { windowsHide: true, windowsVerbatimArguments: true }).status;
  // Старые правила этой программы, в том числе запрет, который Windows создаёт после «Отмены»
  netsh('delete', 'rule', 'name=all', 'dir=in', `program="${exe}"`);
  const st = netsh('add', 'rule', `name="${RULE}"`, 'dir=in', 'action=allow', `program="${exe}"`, 'enable=yes',
    'profile=any', 'protocol=tcp', `localport=${PORTS}`, 'remoteip=localsubnet');
  process.exit(st === 0 ? OK : FAILED);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** 'fixed' — разрешено; 'declined' — запрос администратора отклонён; 'error' — не вышло */
export function allowFirewall(log) {
  if (process.platform !== 'win32') return Promise.resolve('fixed');
  // yarn app: программа — electron.exe, ей нужна папка проекта первым аргументом
  const args = [...(process.defaultApp ? [`"${app.getAppPath()}"`] : []), FIX_FLAG].join(' ');
  const cmd = `try { $p = Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${q(args)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 99 }`;
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true });
    } catch {
      return resolve('error');
    }
    p.on('error', () => resolve('error'));
    p.on('close', (code) => {
      const state = code === OK ? 'fixed' : code === 99 ? 'declined' : 'error';
      log('Брандмауэр:', state, `(код ${code})`);
      resolve(state);
    });
  });
}

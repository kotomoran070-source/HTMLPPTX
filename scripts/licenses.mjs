// yarn licenses — лицензии библиотек, которые программа везёт с собой (без инструментов разработки).
// Лицензия вне разрешённого списка (plugins/licenses.mjs) — ошибка; yarn app:build проверяет то же самое.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLicenses, prodPackages } from '../plugins/licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Пусто — всё в порядке; иначе список «пакет: лицензия» */
export function licenseProblems() {
  return checkLicenses(prodPackages(root)).map((p) => `${p.name} ${p.version}: ${p.license}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkgs = prodPackages(root);
  const by = new Map();
  for (const p of pkgs) by.set(p.license, [...(by.get(p.license) ?? []), p.name]);
  for (const [lic, names] of [...by].sort((a, b) => b[1].length - a[1].length)) console.log(`${lic.padEnd(28)} ${String(names.length).padStart(3)}  ${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}`);
  const bad = licenseProblems();
  if (bad.length) {
    console.error(`\nЛицензия вне разрешённого списка:\n  ${bad.join('\n  ')}\nРазрешённые — PERMISSIVE и LGPL_OK в plugins/licenses.mjs`);
    process.exitCode = 1;
  } else console.log(`\nВсего библиотек: ${pkgs.length}, лицензии в порядке`);
}

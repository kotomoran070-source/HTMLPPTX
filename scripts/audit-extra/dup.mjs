// Повторы кода: окна из WIN одинаковых (после обрезки пробелов) содержательных строк в разных местах
import fs from 'node:fs';
import path from 'node:path';
const WIN = 8;
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p); } };
['src', 'server', 'plugins', 'desktop', 'scripts'].forEach(walk);
const seen = new Map();
let total = 0;
const per = new Map();
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [l.trim(), i + 1]).filter(([l]) => l.length > 3 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*') && !l.startsWith('import ') && !/^[{}()\[\];,]+$/.test(l));
  total += lines.length;
  per.set(f, lines);
  for (let i = 0; i + WIN <= lines.length; i++) {
    const key = lines.slice(i, i + WIN).map(([l]) => l).join('\n');
    if (key.length < 240) continue;
    const a = seen.get(key) ?? [];
    a.push([f, i]);
    seen.set(key, a);
  }
}
const dupLines = new Map();
const pairs = new Map();
for (const places of seen.values()) {
  if (places.length < 2) continue;
  for (const [f, i] of places) { const s = dupLines.get(f) ?? new Set(); for (let k = i; k < i + WIN; k++) s.add(k); dupLines.set(f, s); }
  const [a, b] = places;
  const k = `${a[0]}|${b[0]}|${a[1] - b[1]}`;
  const p = pairs.get(k) ?? { a: a[0], b: b[0], la: per.get(a[0])[a[1]][1], lb: per.get(b[0])[b[1]][1], n: WIN - 1 };
  p.n++;
  pairs.set(k, p);
}
const dup = [...dupLines.values()].reduce((s, x) => s + x.size, 0);
console.log(`файлов ${files.length}, содержательных строк ${total}, в повторах ${dup} (${(dup * 100 / total).toFixed(1)} %)`);
for (const p of [...pairs.values()].sort((x, y) => y.n - x.n).slice(0, 16)) console.log(`${String(p.n).padStart(4)} строк  ${p.a}:${p.la}  ↔  ${p.b}:${p.lb}`);

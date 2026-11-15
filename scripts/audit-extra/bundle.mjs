// Состав сборки студии: какие модули сколько занимают в каждой части
import path from 'node:path';
import { build } from 'vite';
Object.assign(process.env, { NODE_ENV: 'production', STUDIO: '1', OUT_DIR: path.resolve('.tmp/zz-studio-build'), STUDIO_LICENSES: path.resolve('.tmp/zz-studio-build.json') });
const rows = [];
await build({ configFile: path.resolve('vite.config.ts'), logLevel: 'error', plugins: [{ name: 'zz-sizes', generateBundle(_o, bundle) {
  for (const c of Object.values(bundle)) {
    if (c.type !== 'chunk') continue;
    const groups = new Map();
    for (const [id, m] of Object.entries(c.modules)) {
      const rel = id.replace(/\0/g, '').replace(process.cwd() + '/', '');
      const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(rel);
      const key = nm ? `nm:${nm[1]}` : rel.split('?')[0].split('/').slice(0, rel.startsWith('src/components') ? 3 : 2).join('/');
      groups.set(key, (groups.get(key) || 0) + m.renderedLength);
    }
    rows.push({ file: c.fileName, size: c.code.length, entry: c.isEntry, dyn: c.isDynamicEntry, imports: c.imports.length, groups: [...groups].sort((a, b) => b[1] - a[1]) });
  }
} }] });
rows.sort((a, b) => b.size - a.size);
for (const r of rows.slice(0, 7)) {
  console.log(`\n${r.file} — ${(r.size / 1024).toFixed(0)} КБ${r.entry ? ' (вход)' : ''}${r.dyn ? ' (по требованию)' : ''}`);
  for (const [k, v] of r.groups.slice(0, 16)) console.log(`   ${(v / 1024).toFixed(0).padStart(5)} КБ  ${k}`);
}

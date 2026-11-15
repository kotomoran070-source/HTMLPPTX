import fs from 'node:fs';
const profile = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const n = Number(process.argv[3] || 25);
const { nodes, samples, timeDeltas } = profile;
const byId = new Map(nodes.map((x) => [x.id, x]));
const parent = new Map();
for (const x of nodes) for (const c of x.children || []) parent.set(c, x.id);
const self = new Map();
for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) || 0) + (timeDeltas[i] || 0));
const name = (c) => `${c.functionName || '(anon)'} ${c.url.replace(/^.*node_modules\//, 'nm/').replace(/^file:\/\/.*\/audit\//, '')}:${c.lineNumber + 1}`;
const fn = new Map(); const incl = new Map(); const pkg = new Map(); let total = 0;
for (const [id, us] of self) {
  const c = byId.get(id).callFrame;
  if (c.functionName === '(idle)' || c.functionName === '(program)') continue;
  total += us;
  fn.set(name(c), (fn.get(name(c)) || 0) + us);
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(c.url);
  const p = m ? m[1] : c.url.startsWith('node:') ? 'node:' : c.url ? 'свой код' : '(native)';
  pkg.set(p, (pkg.get(p) || 0) + us);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const cf = byId.get(cur).callFrame;
    if (cf.url.includes('node_modules') || cf.url.startsWith('node:') || !cf.url) continue;
    const k = name(cf);
    if (seen.has(k)) continue;
    seen.add(k);
    incl.set(k, (incl.get(k) || 0) + us);
  }
}
const fmt = (m, k = n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([k, us]) => `  ${(us / 1000).toFixed(0).padStart(6)} мс  ${k}`).join('\n');
console.log(`всего ${(total / 1000).toFixed(0)} мс\n— по пакетам:\n${fmt(pkg, 10)}\n— своё время:\n${fmt(fn, 14)}\n— вместе с вложенными (свой код):\n${fmt(incl)}`);

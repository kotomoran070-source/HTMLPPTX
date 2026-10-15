// Лицензии сторонних библиотек и шрифтов: что внутри собранного HTML и приложения и на каких условиях.
//   licenseNotice()  — модуль сборки: в собранный файл — авторы и тексты лицензий того, что в него попало
//   prodPackages()   — все библиотеки программы (окно «Справка → Лицензии» приложения, проверка при сборке)
//   checkLicenses()  — лицензии вне разрешённого списка (scripts/licenses.mjs, yarn app:build)
import fs from 'node:fs';
import path from 'node:path';

/** Свободные лицензии: можно встраивать в файл и распространять, сохранив упоминание авторов */
export const PERMISSIVE = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Zlib', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0']);
/**
 * LGPL — только у библиотек, которые работают в студии и приложении отдельными файлами и в собранный
 * HTML не попадают (LGPL это разрешает: библиотеку можно заменить своей версией).
 * sharp — сжатие картинок (libvips), occt-import-js — открытие 3D-чертежей STEP
 */
export const LGPL_OK = new Set(['@img/sharp-libvips-linux-x64', '@img/sharp-libvips-linuxmusl-x64', '@img/sharp-libvips-linux-arm64', '@img/sharp-libvips-linuxmusl-arm64',
  '@img/sharp-libvips-darwin-x64', '@img/sharp-libvips-darwin-arm64', '@img/sharp-win32-x64', '@img/sharp-win32-ia32', '@img/sharp-win32-arm64', 'occt-import-js']);

/** Лицензия из package.json одной строкой SPDX */
function licenseOf(pj) {
  const l = pj.license ?? pj.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => x?.type ?? x).join(' OR ');
  return l?.type ?? 'нет лицензии';
}

/** Подходит ли выражение SPDX: в «A OR B» — хотя бы одна, в «A AND B» — все */
export function spdxOk(expr, allowed = PERMISSIVE) {
  const e = expr.replace(/[()]/g, ' ').trim();
  return e.split(/\s+OR\s+/i).some((alt) => alt.split(/\s+AND\s+/i).every((x) => allowed.has(x.trim())));
}

/** Тексты лицензии и NOTICE (Apache-2.0 требует передавать и его) */
function licenseTexts(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return ''; }
  const pick = (re) => names.filter((n) => re.test(n)).sort().map((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim()).join('\n\n');
  const lic = pick(/^(licen[sc]e|copying)([.-][\w.-]*)?$/i);
  const notice = pick(/^notice(\.(md|txt))?$/i);
  return [lic, notice].filter(Boolean).join('\n\n');
}

/** Стандартные тексты: у части пакетов файла с лицензией нет, есть только её название в package.json */
const TEMPLATES = {
  MIT: (who) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (who) => `ISC License\n\nCopyright (c) ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'BSD-3-Clause': (who) => `BSD 3-Clause License\n\nCopyright (c) ${who}\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  'LGPL-3.0-or-later': (who) => `GNU Lesser General Public License, version 3 or later — ${who}.\nThe full license text: https://www.gnu.org/licenses/lgpl-3.0.txt (together with https://www.gnu.org/licenses/gpl-3.0.txt).\nSource code of libvips: https://github.com/libvips/libvips. The library is shipped as a separate file and can be replaced with another build.`,
};
/** Сборки под конкретную систему: текст лицензии — у основного пакета проекта */
const PARENT = [[/^@esbuild\//, 'esbuild'], [/^@rollup\/rollup-/, 'rollup'], [/^@napi-rs\/lzma-/, '@napi-rs/lzma']];

function findPackage(name, from) {
  for (let d = from; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (path.dirname(d) === d) return null;
  }
}

export function readPackage(dir) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = licenseOf(pj);
  let text = licenseTexts(dir);
  if (!text) {
    const parent = PARENT.find(([re]) => re.test(pj.name))?.[1];
    const pdir = parent ? findPackage(parent, dir) : null;
    if (pdir) text = licenseTexts(pdir);
  }
  if (!text && TEMPLATES[license]) {
    const who = (typeof pj.author === 'string' ? pj.author : pj.author?.name) || `the ${pj.name} authors`;
    text = `${TEMPLATES[license](who.replace(/\s*<[^>]*>|\s*\([^)]*\)/g, ''))}\n(Текст лицензии по стандартному шаблону: в пакете есть только её название и автор.)`;
  }
  return { dir, name: pj.name, version: pj.version, license, text };
}

/** Папка пакета, из которого модуль сборки (…/node_modules/имя/… или …/node_modules/@scope/имя/…) */
export function packageDirOf(id) {
  const file = id.replace(/^\0/, '').replace(/[?#].*$/, '').replace(/\\/g, '/');
  const at = file.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = file.slice(at + 14).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  const dir = file.slice(0, at + 14) + name;
  return fs.existsSync(path.join(dir, 'package.json')) ? dir : null;
}

/** Все библиотеки, которые программа везёт с собой (dependencies и их зависимости, без инструментов разработки) */
export function prodPackages(root) {
  const seen = new Map();
  const find = findPackage;
  const walk = (name, from, optional) => {
    const dir = find(name, from);
    if (!dir) {
      if (!optional) seen.set(`?${name}`, { dir: '', name, version: '', license: 'не установлена', text: '' });
      return;
    }
    if (seen.has(dir)) return;
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    seen.set(dir, readPackage(dir));
    for (const d of Object.keys(pj.dependencies ?? {})) walk(d, dir, false);
    for (const d of Object.keys(pj.optionalDependencies ?? {})) walk(d, dir, true);
  };
  const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const d of Object.keys(pj.dependencies ?? {})) walk(d, root, false);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Библиотеки с лицензией вне разрешённого списка; html — только то, что попадает в собранный файл (LGPL нельзя) */
export function checkLicenses(pkgs, { html = false } = {}) {
  return pkgs.filter((p) => !spdxOk(p.license) && (html || !LGPL_OK.has(p.name)));
}

/** Текст «сторонние компоненты»: одинаковые тексты лицензий — один раз, с перечнем пакетов */
export function noticeText(pkgs, fonts = '') {
  const groups = new Map();
  for (const p of pkgs) {
    const key = p.text || `Лицензия ${p.license} (текст в пакете не найден)`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${p.name} ${p.version} — ${p.license}`);
  }
  const parts = ['Сторонние компоненты и их лицензии', ''];
  for (const [text, names] of groups) parts.push(`== ${names.join(', ')} ==`, text, '');
  if (fonts) parts.push('== Шрифты ==', fonts, '');
  return parts.join('\n');
}

/** Шрифты комплекта (OFL), которые есть в собранном файле: их данные встречаются в нём как есть */
function kitFontsIn(html, root) {
  const dir = path.join(root, 'src', 'fonts');
  const files = [];
  const scan = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { if (n.isDirectory()) scan(path.join(d, n.name)); else if (/\.woff2$/.test(n.name)) files.push(path.join(d, n.name)); } };
  try { scan(dir); } catch { return []; }
  return files.filter((f) => html.includes(fs.readFileSync(f).toString('base64').slice(0, 400))).map((f) => path.basename(f, '.woff2'));
}

/**
 * Модуль сборки: в собранный HTML — авторы и тексты лицензий всех библиотек, которые в нём оказались,
 * и лицензия шрифтов комплекта, если они есть. Блок <script type="text/plain">: на странице не виден
 */
export function licenseNotice(root) {
  const used = new Map();
  return [
    {
      name: 'slideria-licenses-collect',
      apply: 'build',
      generateBundle(_, bundle) {
        for (const c of Object.values(bundle)) {
          if (c.type !== 'chunk') continue;
          for (const [id, m] of Object.entries(c.modules)) {
            if (!m.renderedLength) continue;
            const dir = packageDirOf(id);
            if (dir && !used.has(dir)) used.set(dir, readPackage(dir));
          }
        }
      },
    },
    {
      // После упаковки в один файл (vite-plugin-singlefile): дописываем в готовый index.html
      name: 'slideria-licenses-emit',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        const page = bundle['index.html'];
        if (!page || page.type !== 'asset') return;
        const html = String(page.source);
        const bad = checkLicenses([...used.values()], { html: true });
        if (bad.length) this.error(`В собранный файл попадает библиотека с неподходящей лицензией: ${bad.map((p) => `${p.name} (${p.license})`).join(', ')}`);
        const kit = kitFontsIn(html, root);
        const fonts = kit.length ? `${kit.join(', ')}\n\n${fs.readFileSync(path.join(root, 'src', 'fonts', 'OFL.txt'), 'utf8').trim()}` : '';
        if (!used.size && !fonts) return;
        const text = noticeText([...used.values()].sort((a, b) => a.name.localeCompare(b.name)), fonts).replace(/<\//g, '<\\/');
        page.source = html.replace(/<\/body>(?![\s\S]*<\/body>)/, `<script type="text/plain" id="slideria-licenses">\n${text}</script>\n</body>`);
      },
    },
  ];
}

// Фигуры студии со стандартной геометрией PowerPoint: определения из plugins/pptx/presets.ts (все 187, ECMA-376)
// → src/components/shape/presets.ts (только нужные студии — чтобы не везти в каждую презентацию все).
// Новая фигура: имя PowerPoint — в список ниже и в PRESET_KINDS (components/shape/kinds.ts), затем node scripts/shape-presets.mjs
import fs from 'node:fs';
import path from 'node:path';

const NAMES = [
  'roundRect', 'ellipse', 'diamond', 'triangle', 'rtTriangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
  'star5', 'plus', 'heart', 'lightningBolt', 'donut', 'cloud',
  'rightArrow', 'leftRightArrow', 'chevron', 'homePlate',
  'wedgeRoundRectCallout', 'can', 'rightBrace',
];

const root = path.resolve(import.meta.dirname, '..');
const all = fs.readFileSync(path.join(root, 'plugins/pptx/presets.ts'), 'utf8');
// Жёлтые ручки (ahLst) — из полного presetShapeDefinitions.xml (ECMA-376), путь к нему — первым аргументом;
// без него ручки берутся из уже собранного presets.ts
const spec = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(path.join(root, 'src/components/shape/presets.ts'), 'utf8');
const handlesOf = (n) => {
  const body = new RegExp(`<${n}>([\\s\\S]*?)</${n}>`).exec(spec)?.[1] ?? '';
  const ah = /<ahLst[^>]*>([\s\S]*?)<\/ahLst>/.exec(body)?.[1];
  return ah ? `<ahLst>${ah.replace(/\s+xmlns="[^"]*"/g, '').replace(/>\s+</g, '><').trim()}</ahLst>` : '';
};
const defs = NAMES.map((n) => {
  const m = new RegExp(`<${n}>[\\s\\S]*?</${n}>`).exec(all);
  if (!m) throw new Error(`Нет фигуры ${n} в plugins/pptx/presets.ts`);
  return m[0].replace(/<ahLst>[\s\S]*?<\/ahLst>/, '').replace('<pathLst>', `${handlesOf(n)}<pathLst>`);
});
fs.writeFileSync(path.join(root, 'src/components/shape/presets.ts'), `/**
 * Определения фигур студии (ECMA-376, presetShapeDefinitions): регулировки, формулы, жёлтые ручки и контуры — как у
 * всех 187 в plugins/pptx/presets.ts, только нужные студии. Не править руками: node scripts/shape-presets.mjs
 */
export default \`<presets>
${defs.join('\n')}
</presets>\`;
`);
console.log(`src/components/shape/presets.ts: ${NAMES.length} фигур`);

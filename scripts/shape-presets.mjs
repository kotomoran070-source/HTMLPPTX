// Фигуры студии со стандартной геометрией PowerPoint: определения из plugins/pptx/presets.ts (все 187, ECMA-376)
// → src/components/shape/presets.ts (только нужные студии — чтобы не везти в каждую презентацию все).
// Новая фигура: имя PowerPoint — в список ниже и в PRESET_KINDS (components/shape/kinds.ts), затем node scripts/shape-presets.mjs
import fs from 'node:fs';
import path from 'node:path';

const NAMES = [
  'diamond', 'triangle', 'rtTriangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
  'star5', 'plus', 'heart', 'lightningBolt', 'donut', 'cloud',
  'rightArrow', 'leftRightArrow', 'chevron', 'homePlate',
  'wedgeRoundRectCallout', 'can', 'rightBrace',
];

const root = path.resolve(import.meta.dirname, '..');
const all = fs.readFileSync(path.join(root, 'plugins/pptx/presets.ts'), 'utf8');
const defs = NAMES.map((n) => {
  const m = new RegExp(`<${n}>[\\s\\S]*?</${n}>`).exec(all);
  if (!m) throw new Error(`Нет фигуры ${n} в plugins/pptx/presets.ts`);
  return m[0];
});
fs.writeFileSync(path.join(root, 'src/components/shape/presets.ts'), `/**
 * Определения фигур студии (ECMA-376, presetShapeDefinitions): регулировки, формулы и контуры — как у всех 187
 * в plugins/pptx/presets.ts, только нужные студии. Не править руками: node scripts/shape-presets.mjs
 */
export default \`<presets>
${defs.join('\n')}
</presets>\`;
`);
console.log(`src/components/shape/presets.ts: ${NAMES.length} фигур`);

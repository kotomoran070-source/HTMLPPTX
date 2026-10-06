// Временная копия презентаций для автотестов: .tmp/test-decks
//   tpl      — стартовый шаблон, как «Новая презентация → с примерами»;
//   slideria — витрина из проекта (только чтение);
//   morph    — два слайда с переходом «Морф»;
//   schemes  — новые блоки-схемы (tests/e2e/schemes.yaml);
//   design   — стартовый шаблон для вкладки «Дизайн».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.tmp', 'test-decks');
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(path.join(root, '.tmp', 'test-fonts'), { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

fs.cpSync(path.join(root, 'templates', 'basic'), path.join(dir, 'tpl'), { recursive: true });
const file = path.join(dir, 'tpl', 'deck.yaml');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('{{title}}', 'Тестовая презентация'));
fs.cpSync(path.join(root, 'presentations', 'slideria'), path.join(dir, 'slideria'), { recursive: true });
// morph — два слайда с переходом «Морф»: заголовок (пара по тексту) и фигура (пара по имени)
fs.mkdirSync(path.join(dir, 'morph'));
fs.writeFileSync(path.join(dir, 'morph', 'deck.yaml'), `title: Морф
slides:
  - template: canvas
    free:
      - {type: text, text: "Архитектура", styles: {text: {size: 64}}, place: {x: 80, y: 280, w: 700}}
      - {type: shape, id: box, kind: round, fill: "#2563EB", place: {x: 900, y: 120, w: 200, h: 200}}
  - template: canvas
    transition: morph
    free:
      - {type: text, text: "Архитектура", styles: {text: {size: 40}}, place: {x: 60, y: 40, w: 600}}
      - {type: shape, id: box, kind: round, fill: "#DC2626", place: {x: 200, y: 260, w: 700, h: 300}}
`);
// design — стартовый шаблон для вкладки «Дизайн» (темы меняют всю презентацию)
fs.cpSync(path.join(root, 'templates', 'basic'), path.join(dir, 'design'), { recursive: true });
const dfile = path.join(dir, 'design', 'deck.yaml');
fs.writeFileSync(dfile, fs.readFileSync(dfile, 'utf8').replaceAll('{{title}}', 'Темы'));
// schemes — новые блоки-схемы, по слайду на каждый
fs.mkdirSync(path.join(dir, 'schemes'));
fs.copyFileSync(path.join(root, 'tests', 'e2e', 'schemes.yaml'), path.join(dir, 'schemes', 'deck.yaml'));
console.log('Тестовые презентации:', fs.readdirSync(dir).join(', '));

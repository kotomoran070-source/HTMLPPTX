// Временная копия презентаций для автотестов: .tmp/test-decks
//   tpl      — стартовый шаблон, как «Новая презентация → с примерами»;
//   slideria — витрина из проекта (только чтение).
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
console.log('Тестовые презентации:', fs.readdirSync(dir).join(', '));

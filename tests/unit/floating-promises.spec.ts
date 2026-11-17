import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Висящие обещания — то же, что правило no-floating-promises у typescript-eslint, но без ESLint: на компиляторе
 * TypeScript, который в проекте уже есть. Вызов, который возвращает Promise, стоит отдельной строкой — без await,
 * без void и без обработки ошибки. Ошибка такого вызова пользователю не видна (в консоли — «Uncaught (in promise)»),
 * а код идёт дальше, не дождавшись результата. tsc этого не замечает.
 * Не ждать намеренно — `void вызов()`; ошибка не важна — `.catch(() => {})`; уборка при любом исходе — `.then(f, f)`
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('асинхронные вызовы без await — с void или с обработкой ошибки', () => {
  const file = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json')!;
  const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(file, ts.sys.readFile).config, ts.sys, ROOT);
  const program = ts.createProgram(cfg.fileNames, cfg.options);
  const checker = program.getTypeChecker();

  // Обещание — тип с вызываемым then (у Promise | undefined из вызова через ?. — хотя бы у одной части)
  const thenable = (t: ts.Type, at: ts.Node): boolean => {
    if (t.isUnion()) return t.types.some((x) => thenable(x, at));
    const then = t.getProperty('then');
    return !!then && checker.getTypeOfSymbolAtLocation(then, at).getCallSignatures().length > 0;
  };
  const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
  /** Выражение даёт обещание, ошибку которого никто не обработает */
  const floating = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e)) return floating(e.expression);
    if (ts.isVoidExpression(e) || ts.isAwaitExpression(e)) return false;
    if (ts.isConditionalExpression(e)) return floating(e.whenTrue) || floating(e.whenFalse);
    if (ts.isBinaryExpression(e)) return LOGICAL.has(e.operatorToken.kind) && floating(e.right);
    // Обещание — и вызов, и свойство в цепочке (transition.finished.finally(…))
    if (!thenable(checker.getTypeAtLocation(e), e)) return false;
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const name = e.expression.name.text;
      if (name === 'catch' || (name === 'then' && e.arguments.length >= 2)) return false;
      // finally ошибку не ловит: обработана ли она — решает цепочка до него
      if (name === 'finally') return floating(e.expression.expression);
    }
    return true;
  };

  const bad: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('/node_modules/')) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isExpressionStatement(n) && floating(n.expression)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        bad.push(`${path.relative(ROOT, sf.fileName)}:${line + 1}: ${n.getText(sf).split('\n')[0].slice(0, 120)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  expect(bad, 'Добавьте await, void (не ждать намеренно) или .catch (ошибка не важна)').toEqual([]);
});

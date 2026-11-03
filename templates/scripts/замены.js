// @name Заменить слова по списку
// @description Несколько замен сразу во всей презентации: название компании, термины, имена
// @param pairs: lines = "Старое название = Новое название" — Замены, по одной в строке: что = на что
export default async function ({ apply, params, log }) {
  const pairs = String(params.pairs ?? '').split('\n')
    .map((line) => line.split('='))
    .filter((p) => p.length === 2 && p[0].trim())
    .map(([find, replace]) => ({ op: 'text.replace', find: find.trim(), replace: replace.trim() }));
  if (!pairs.length) throw new Error('Нет замен: по одной в строке, «что = на что»');
  const done = apply(pairs);
  log(done.join(' · '));
}

// Сколько сервер тратит на одно автосохранение (и держит при этом свой поток)
const BASE = process.env.BASE || 'http://127.0.0.1:5192';
for (const name of process.argv.slice(2)) {
  const r0 = await fetch(`${BASE}/__slideria/deck/${name}`);
  const txt = await r0.text();
  let deck = JSON.parse(txt);
  if (deck.deck) deck = deck.deck;
  const base = structuredClone(deck);
  const times = [];
  for (let i = 0; i < 6; i++) {
    const next = structuredClone(deck);
    // Маленькая правка: сдвиг первого объекта третьего слайда
    const s = next.slides[2];
    if (Array.isArray(s.free) && s.free[0]?.place) s.free[0].place.x = (s.free[0].place.x || 0) + 1 + i;
    else s.notes = `правка ${i}`;
    const body = JSON.stringify({ deck: next, base: deck });
    const t0 = performance.now();
    // Параллельно — лёгкий запрос: сколько он ждёт, пока сервер занят записью
    const ping = (async () => { const p0 = performance.now(); await (await fetch(`${BASE}/__slideria/deck/${name}`, { method: 'HEAD' }).catch(() => fetch(`${BASE}/`))).arrayBuffer(); return performance.now() - p0; })();
    const r = await fetch(`${BASE}/__htmlpptx/save?deck=${name}&from=zzaudit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const j = await r.json();
    const t = performance.now() - t0;
    times.push([Math.round(t), Math.round(await ping), body.length, r.status, j.changed]);
    deck = j.base ?? next;
  }
  console.log(name, 'сохранение мс / параллельный запрос мс / тело байт / статус / изменено:', JSON.stringify(times));
}

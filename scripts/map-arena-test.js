/* Matchmaking: online players pack into one live lobby per mode. Run while the server is up. */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed = true;
};

async function account(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

async function join(cookie, mapId, mode = 'ffa') {
  const s = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise((r, j) => { s.on('connect', r); s.on('connect_error', j); });
  const res = await new Promise((r) => s.emit('mp:join', { primary: 'pistol', mapId, mode }, r));
  const seen = new Set();
  s.on('mp:snap', (d) => { for (const p of d.p) seen.add(p[0]); });
  return { s, res, seen };
}

(async () => {
  const tag = Date.now() % 100000;
  const catalog = await (await fetch(`${BASE}/api/catalog`)).json();
  const mapIds = catalog.maps?.map((m) => m.id) || [];
  check('catalog lists maps', catalog.maps?.length >= 8 && mapIds.includes('forest') && mapIds.includes('metro'), mapIds.join(', '));

  const a = await join(await account(`maptestA${tag}`), 'harbor');
  const b = await join(await account(`maptestB${tag}`), 'winter');
  const c = await join(await account(`maptestC${tag}`), 'harbor');
  const forest = await join(await account(`maptestF${tag}`), 'forest');
  const bogus = await join(await account(`maptestD${tag}`), 'not-a-map');

  check('first player opens preferred map', a.res.mapId === 'harbor', a.res.mapId);
  check('later players join the live lobby (not their preferred map)', b.res.mapId === 'harbor' && c.res.mapId === 'harbor' && forest.res.mapId === 'harbor',
    `${b.res.mapId}, ${c.res.mapId}, ${forest.res.mapId}`);
  check('matched flag set when redirected', b.res.matched === true && forest.res.matched === true);
  check('unknown preference still packs into live lobby', bogus.res.mapId === 'harbor', bogus.res.mapId);
  check('joiner sees existing players', b.res.players.some((p) => p.id === a.res.selfId));

  await sleep(400);
  check('snapshots share one arena', a.seen.has(b.res.selfId) && a.seen.has(c.res.selfId) && a.seen.has(forest.res.selfId));

  // Fill-style: TDM is a separate lobby from FFA
  const tdm = await join(await account(`maptestT${tag}`), 'desert', 'tdm');
  check('TDM opens its own lobby', tdm.res.mapId === 'desert' && tdm.res.mode === 'tdm', `${tdm.res.mapId}/${tdm.res.mode}`);

  const cookie = await account(`maptestE${tag}`);
  const counts = await (await fetch(`${BASE}/api/arenas`, { headers: { Cookie: cookie } })).json();
  check('live lobby reported', counts.live?.ffa?.mapId === 'harbor' && counts.live.ffa.count >= 4, JSON.stringify(counts.live));
  check('arena counts on live map', counts.counts.harbor.ffa >= 4, JSON.stringify(counts.counts));

  for (const x of [a, b, c, forest, bogus, tdm]) x.s.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

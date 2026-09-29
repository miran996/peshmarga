/**
 * Admin panel smoke: RBAC, analytics, economy override, announce.
 * Requires a running server on PORT (default 3000) and admin/admin123.
 */
const PORT = process.env.PORT || 3000;
const base = `http://127.0.0.1:${PORT}`;

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie?.() || [];
  let nextCookie = cookie;
  for (const c of set) {
    const [kv] = c.split(';');
    nextCookie = kv;
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, cookie: nextCookie };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  let r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert(r.ok, `admin login failed: ${JSON.stringify(r.data)}`);
  const cookie = r.cookie;
  assert(r.data.user.role === 'super' || r.data.user.isAdmin, 'admin should be super');

  r = await req('/api/admin/me', { cookie });
  assert(r.ok, `admin me failed: ${JSON.stringify(r.data)}`);
  assert(r.data.perms.includes('*'), 'super needs *');

  r = await req('/api/admin/analytics', { cookie });
  assert(r.ok, `analytics failed: ${JSON.stringify(r.data)}`);
  assert(typeof r.data.server.rssMb === 'number', 'server metrics missing');

  r = await req('/api/admin/economy/override', {
    cookie, method: 'POST',
    body: { kind: 'weapon', itemId: 'autorifle', price: 350, discountPct: 0 },
  });
  assert(r.ok, `override failed: ${JSON.stringify(r.data)}`);

  r = await req('/api/catalog');
  assert(r.data.weapons.autorifle.cost === 350, `effective price expected 350 got ${r.data.weapons.autorifle.cost}`);

  r = await req('/api/admin/economy/override/clear', {
    cookie, method: 'POST', body: { kind: 'weapon', itemId: 'autorifle' },
  });
  assert(r.ok, 'clear override failed');

  r = await req('/api/admin/liveops/announce', {
    cookie, method: 'POST', body: { text: 'Admin test ping' },
  });
  assert(r.ok, `announce failed: ${JSON.stringify(r.data)}`);

  r = await req('/api/admin/moderation/flags', { cookie });
  assert(r.ok, 'flags list failed');

  console.log('PASS  admin panel APIs');
})().catch((e) => {
  console.error('FAIL ', e.message);
  process.exit(1);
});

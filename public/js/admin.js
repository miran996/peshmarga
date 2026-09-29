(function () {
  const $ = (id) => document.getElementById(id);
  let users = [];
  let pollTimer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDur = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('T') ? '' : 'Z')).toLocaleString() : '?');

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!err);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function showLogin() {
    clearInterval(pollTimer);
    location.replace('/');
  }

  async function showApp(user) {
    $('admin-app').classList.remove('hidden');
    $('a-name').textContent = user.username;
    await refreshUsers();
    await refreshSessions();
    await refreshOrders();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { refreshSessions(); refreshUsers(true); refreshOrders(true); }, 3000);
  }

  $('a-logout').addEventListener('click', async () => {
    await api('/api/logout', {}).catch(() => {});
    showLogin();
  });

  $('a-search').addEventListener('input', renderUsers);

  async function refreshUsers(silent) {
    try {
      const data = await api('/api/admin/users');
      users = data.users;
      const focused = document.activeElement?.classList.contains('coin-input');
      if (!(silent && focused)) renderUsers();
      $('c-users').textContent = users.length;
      $('c-coins').textContent = users.reduce((s, u) => s + u.coins, 0).toLocaleString();
    } catch (err) {
      if (err.status === 401 || err.status === 403) showLogin();
    }
  }

  function renderUsers() {
    const q = $('a-search').value.trim().toLowerCase();
    const rows = users.filter((u) => !q || u.username.toLowerCase().includes(q));
    $('users-body').innerHTML = rows.length ? rows.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${esc(u.username)} ${u.isAdmin ? '<span class="tag admin">admin</span>' : ''}</td>
        <td class="coins-cell">${u.coins.toLocaleString()}</td>
        <td>${u.totalKills} / ${u.totalDeaths}</td>
        <td>${u.ownedWeapons.map((w) => `<span class="tag">${esc(w)}</span>`).join('')}</td>
        <td>${esc(u.equippedCosmetic)}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>
          <div class="adjust">
            <input class="coin-input" type="number" step="1" placeholder="+500" data-id="${u.id}" />
            <button class="btn small primary" data-add="${u.id}">Add</button>
            <button class="btn small ghost" data-quick="${u.id}" data-amt="100">+100</button>
            <button class="btn small ghost" data-quick="${u.id}" data-amt="1000">+1k</button>
          </div>
        </td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">No players found</td></tr>';

    document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      const input = document.querySelector(`.coin-input[data-id="${b.dataset.add}"]`);
      addCoins(b.dataset.add, Number(input.value), input);
    }));
    document.querySelectorAll('.coin-input').forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCoins(inp.dataset.id, Number(inp.value), inp);
    }));
    document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => addCoins(b.dataset.quick, Number(b.dataset.amt))));
  }

  async function addCoins(id, amount, input) {
    if (!Number.isInteger(amount) || amount === 0) return toast('Enter a whole, non-zero amount', true);
    try {
      const { user } = await api(`/api/admin/users/${id}/coins`, { amount });
      if (input) { input.value = ''; input.blur(); }
      toast(`${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount).toLocaleString()} coins ${amount > 0 ? 'to' : 'from'} ${user.username} ? ${user.coins.toLocaleString()}`);
      await refreshUsers();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function refreshSessions() {
    try {
      const { active, recent, arena } = await api('/api/admin/sessions');
      $('c-active').textContent = active.length;
      $('c-arena').textContent = arena.length;
      $('active-body').innerHTML = active.length ? active.map((s) => `
        <tr><td>${esc(s.username)}</td><td>${s.mode === 'single' ? `Single ? ${esc(s.difficulty)}` : `Multiplayer${s.difficulty ? ' ? ' + esc(s.difficulty) : ''}`}</td>
        <td>${fmtDur(s.durationSec)}</td><td>${s.kills} / ${s.deaths}</td><td class="coins-cell">+${s.coins}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">No one is playing right now</td></tr>';
      $('arena-body').innerHTML = arena.length ? arena.map((p) => `
        <tr><td>${esc(p.username)}</td><td>${esc(p.map)}</td><td>${p.alive ? p.hp : 'KIA'}</td><td>${esc(p.weapon)}</td><td>${p.kills} / ${p.deaths}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">Arena empty</td></tr>';
      $('recent-body').innerHTML = recent.length ? recent.map((s) => `
        <tr><td>${s.id}</td><td>${esc(s.username)}</td><td>${s.mode === 'single' ? `Single ? ${esc(s.difficulty)}` : `Multiplayer${s.difficulty ? ' ? ' + esc(s.difficulty) : ''}`}</td>
        <td>${fmtDate(s.started_at)}</td><td>${s.ended_at ? fmtDate(s.ended_at) : '<span class="live-dot">LIVE</span>'}</td>
        <td>${s.kills} / ${s.deaths}</td><td class="coins-cell">+${s.coins_earned}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">No sessions yet</td></tr>';
    } catch (err) {
      if (err.status === 401 || err.status === 403) showLogin();
    }
  }

  async function refreshOrders(silent) {
    try {
      const { orders } = await api('/api/admin/coin-orders?status=all');
      const pending = orders.filter((o) => o.status === 'pending');
      $('orders-body').innerHTML = orders.length ? orders.map((o) => `
        <tr>
          <td><code>${esc(o.refCode)}</code></td>
          <td>${esc(o.username)}</td>
          <td>${esc(o.packId)}</td>
          <td>${esc(o.methodId)}</td>
          <td class="coins-cell">${o.coins.toLocaleString()}</td>
          <td>${o.iqd.toLocaleString()} IQD</td>
          <td>${esc(o.note || '?')}</td>
          <td><span class="tag">${esc(o.status === 'fulfilled' ? 'Completed' : o.status)}</span></td>
          <td>${o.status === 'pending' ? `
            <button class="btn small primary" data-fulfill="${o.id}">Complete</button>
            <button class="btn small ghost" data-reject="${o.id}">Reject</button>` : esc(o.fulfilledBy || '')}
          </td>
        </tr>`).join('') : '<tr><td colspan="9" class="empty">No coin orders</td></tr>';
      document.querySelectorAll('[data-fulfill]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api(`/api/admin/coin-orders/${b.dataset.fulfill}/complete`, {});
          toast('Completed ? coins credited');
          await refreshOrders();
          await refreshUsers();
        } catch (err) { toast(err.message, true); }
      }));
      document.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api(`/api/admin/coin-orders/${b.dataset.reject}/reject`, {});
          toast('Order rejected');
          await refreshOrders();
        } catch (err) { toast(err.message, true); }
      }));
      if (!silent && pending.length) {
        /* keep quiet unless refreshing manually */
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) showLogin();
    }
  }

  $('a-orders-refresh')?.addEventListener('click', () => refreshOrders());

  (async function boot() {
    try {
      const { user } = await api('/api/me');
      if (user.isAdmin) return showApp(user);
    } catch { /* not logged in */ }
    showLogin();
  })();
})();

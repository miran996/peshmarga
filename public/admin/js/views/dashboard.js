import { api, esc, fmtDur, can, toast } from '../api.js';

async function completeOrder(id, onDone) {
  try {
    await api(`/api/admin/coin-orders/${id}/complete`, {});
    toast('Completed — coins added');
    onDone?.();
  } catch (e) {
    try {
      await api(`/api/admin/coin-orders/${id}/fulfill`, {});
      toast('Completed — coins added');
      onDone?.();
    } catch (e2) {
      toast(e2.message || e.message, true);
    }
  }
}

export async function renderDashboard(root, state) {
  const data = await api('/api/admin/analytics');
  const maxRev = Math.max(1, ...data.revenueByDay.map((d) => d.iqd || 0));
  root.innerHTML = `
    <div class="cards">
      <div class="card"><span>Players</span><b>${data.playerCount}</b></div>
      <div class="card"><span>Coins out</span><b>${Number(data.coinsInCirculation).toLocaleString()}</b></div>
      <div class="card"><span>Online sessions</span><b>${data.live.sessions}</b></div>
      <div class="card ${data.pendingOrders ? 'card-warn' : ''}"><span>Pending coin orders</span><b class="${data.pendingOrders ? 'warn-count' : ''}">${data.pendingOrders}</b></div>
    </div>
    <div class="grid-2">
      <section class="block">
        <h2>Server load</h2>
        <p class="muted">Uptime ${fmtDur(data.server.uptimeSec)} · RSS ${data.server.rssMb} MB · Heap ${data.server.heapMb} MB</p>
        <p class="muted">CPU cores ${data.server.cpus} · load1 ${data.server.load1?.toFixed?.(2) ?? data.server.load1} · tick ~${data.server.pingMs} ms</p>
        <p class="muted">Open cheat flags: <b>${data.openFlags}</b>
          · Coin multiplier: <b>×${data.doubleCoin}</b> · Weather: <b>${esc(data.liveops?.weather || 'clear')}</b></p>
      </section>
      <section class="block">
        <h2>Revenue (IQD, last days)</h2>
        <div class="spark">
          ${data.revenueByDay.length
    ? data.revenueByDay.map((d) => `<i title="${esc(d.day)}: ${d.iqd} IQD" style="height:${Math.max(6, Math.round((d.iqd / maxRev) * 100))}%"></i>`).join('')
    : '<p class="muted">No fulfilled orders yet</p>'}
        </div>
        <p class="muted" style="margin-top:8px">${data.revenueByDay.map((d) => `${d.day}: ${Number(d.iqd).toLocaleString()} IQD`).join(' · ') || ''}</p>
      </section>
    </div>
    ${can(state, 'orders.view') ? `
    <section class="block" id="dash-orders">
      <div class="block-head"><h2>Pending coin orders</h2><button class="btn small ghost" id="dash-orders-refresh">Refresh</button></div>
      <p class="muted">Player packs waiting for payment check — <b>Complete</b> credits coins.</p>
      <div id="dash-orders-table"><p class="muted">Loading…</p></div>
    </section>` : ''}
    ${can(state, 'sessions.view') ? `<section class="block" id="dash-sessions"><h2>Live snapshot</h2><p class="muted">Refreshing…</p></section>` : ''}
  `;

  const loadPending = async () => {
    const box = root.querySelector('#dash-orders-table');
    if (!box) return;
    try {
      const { orders } = await api('/api/admin/coin-orders?status=pending');
      box.innerHTML = `<table class="data">
        <thead><tr><th>Ref</th><th>Player</th><th>Pack</th><th>Coins</th><th>IQD</th><th>When</th><th></th></tr></thead>
        <tbody>${(orders || []).map((o) => `<tr class="row-pending">
          <td><code>${esc(o.refCode)}</code></td>
          <td>${esc(o.username)}</td>
          <td>${esc(o.packId)}</td>
          <td class="coins-cell">+${Number(o.coins).toLocaleString()}</td>
          <td>${Number(o.iqd).toLocaleString()}</td>
          <td>${esc(String(o.createdAt || '').slice(0, 16))}</td>
          <td>${can(state, 'orders.fulfill')
    ? `<button class="btn small primary" data-complete="${o.id}">Complete</button>
               <button class="btn small ghost" data-reject="${o.id}">Reject</button>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">No pending orders</td></tr>'}</tbody></table>`;
      box.querySelectorAll('[data-complete]').forEach((b) => b.addEventListener('click', () => {
        if (!confirm('Complete and add coins?')) return;
        completeOrder(b.dataset.complete, loadPending);
      }));
      box.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Reject without coins?')) return;
        try {
          await api(`/api/admin/coin-orders/${b.dataset.reject}/reject`, {});
          toast('Rejected');
          loadPending();
        } catch (e) { toast(e.message, true); }
      }));
    } catch (e) {
      box.innerHTML = `<p class="muted" style="color:var(--admin-bad)">${esc(e.message)}</p>`;
    }
  };

  if (can(state, 'orders.view')) {
    root.querySelector('#dash-orders-refresh')?.addEventListener('click', loadPending);
    await loadPending();
  }

  if (can(state, 'sessions.view')) {
    const sess = await api('/api/admin/sessions');
    const el = root.querySelector('#dash-sessions');
    el.innerHTML = `
      <h2>Live arenas (${sess.arena.length})</h2>
      <table class="data"><thead><tr><th>Player</th><th>Map</th><th>HP</th><th>Weapon</th><th>K/D</th></tr></thead>
      <tbody>${sess.arena.length ? sess.arena.map((p) => `<tr><td>${esc(p.username)}</td><td>${esc(p.map)}</td><td>${p.alive ? p.hp : 'KIA'}</td><td>${esc(p.weapon)}</td><td>${p.kills}/${p.deaths}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">Empty</td></tr>'}</tbody></table>`;
  }
}

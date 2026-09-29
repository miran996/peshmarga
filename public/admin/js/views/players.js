import { api, toast, esc, fmtDate, fmtDur, can } from '../api.js';

export async function renderPlayers(root, state) {
  root.innerHTML = `
    <section class="block">
      <div class="block-head">
        <h2>Player search</h2>
        <div class="form-row" style="margin:0">
          <input id="p-search" placeholder="Username or ID…" />
          <select id="p-online-filter">
            <option value="all">All</option>
            <option value="online">Online only</option>
            <option value="offline">Offline only</option>
          </select>
          <button class="btn small ghost" id="p-refresh">Refresh</button>
        </div>
      </div>
      <p class="muted" id="p-online-summary">Loading…</p>
      <div class="split split-players">
        <div>
          <table class="data"><thead><tr><th class="num">ID</th><th class="col-name">Name</th><th>Status</th><th>Coins</th><th class="num">K/D</th></tr></thead>
          <tbody id="p-list"></tbody></table>
        </div>
        <div id="p-profile" class="profile-pane muted">Select a player</div>
      </div>
    </section>
    ${can(state, 'orders.view') ? `
    <section class="block">
      <div class="block-head">
        <h2>Pending coin orders</h2>
        <button class="btn small ghost" id="p-orders-refresh">Refresh</button>
      </div>
      <p class="muted">Verify payment, then <b>Complete</b> to add coins. Full queue: <b>Coin Orders</b> in the sidebar.</p>
      <div id="p-orders"></div>
    </section>` : ''}
  `;

  let users = [];
  let onlineCount = 0;
  const list = root.querySelector('#p-list');
  const filterEl = root.querySelector('#p-online-filter');
  const searchEl = root.querySelector('#p-search');

  const drawList = () => {
    const q = searchEl.value.trim().toLowerCase();
    const of = filterEl.value;
    let rows = users.filter((u) => !q || u.username.toLowerCase().includes(q) || String(u.id) === q);
    if (of === 'online') rows = rows.filter((u) => u.online);
    if (of === 'offline') rows = rows.filter((u) => !u.online);
    root.querySelector('#p-online-summary').textContent =
      `${onlineCount} online · ${users.length} total · showing ${rows.length}`;
    list.innerHTML = rows.slice(0, 120).map((u) => `
      <tr data-id="${u.id}" style="cursor:pointer" class="${u.online ? 'row-online' : ''}">
        <td class="num">${u.id}</td>
        <td class="player-name"><span class="player-name-text">${esc(u.username)}</span>${u.role && u.role !== 'none' ? ` <span class="tag warn">${esc(u.role)}</span>` : ''}</td>
        <td>${u.online
    ? `<span class="tag ok"><i class="dot-on"></i> Online${u.arena ? ` · ${esc(u.arena.mapName)}` : ''}</span>`
    : `<span class="tag muted-tag">Offline</span>`}</td>
        <td class="coins-cell">${u.coins.toLocaleString()}</td>
        <td>${u.totalKills}/${u.totalDeaths}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">None</td></tr>';
    list.querySelectorAll('[data-id]').forEach((tr) => tr.addEventListener('click', () => loadProfile(tr.dataset.id)));
  };

  const loadUsers = async () => {
    const data = await api('/api/admin/users');
    users = data.users || [];
    onlineCount = data.onlineCount ?? users.filter((u) => u.online).length;
    drawList();
  };

  searchEl.addEventListener('input', drawList);
  filterEl.addEventListener('change', drawList);
  root.querySelector('#p-refresh').addEventListener('click', () => loadUsers().catch((e) => toast(e.message, true)));
  await loadUsers();

  async function loadProfile(id) {
    const pane = root.querySelector('#p-profile');
    pane.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const p = await api(`/api/admin/players/${id}`);
      const u = p.user;
      const live = users.find((x) => x.id === u.id);
      pane.innerHTML = `
        <h2 style="margin:0 0 8px">${esc(u.username)}
          ${live?.online ? '<span class="tag ok">Online</span>' : '<span class="tag muted-tag">Offline</span>'}
        </h2>
        <p class="muted">Role ${esc(u.role)} · Coins ${u.coins.toLocaleString()} · K/D ${p.kd} · Play ~${fmtDur(p.estimatedPlaytimeSec)}</p>
        <p class="muted">IP ${esc(u.lastIp || '—')} · Device ${esc((u.deviceHash || '').slice(0, 12) || '—')}
          ${live?.arena ? ` · In ${esc(live.arena.mapName)} (${esc(live.arena.mode)})` : ''}</p>
        ${can(state, 'economy.gift') ? `<div class="form-row">
          <input id="gift-amt" type="number" placeholder="+500" />
          <button class="btn small primary" id="gift-btn">Gift coins</button>
        </div>` : ''}
        ${can(state, '*') ? `<div class="form-row">
          <select id="role-sel">
            <option value="none">Player</option>
            <option value="mod">Moderator</option>
            <option value="accountant">Accountant</option>
            <option value="super">Super</option>
          </select>
          <button class="btn small" id="role-btn">Set role</button>
        </div>` : ''}
        ${can(state, 'moderation.act') ? `<div class="form-row">
          <button class="btn small" data-ban="account">Ban account</button>
          <button class="btn small" data-ban="shadow">Shadow ban</button>
          <button class="btn small" data-ban="ip" ${u.lastIp ? '' : 'disabled'}>Ban IP</button>
          <button class="btn small" data-ban="device" ${u.deviceHash ? '' : 'disabled'}>Ban device</button>
          <button class="btn small ghost" id="kick-btn">Kick</button>
        </div>
        <p class="muted">Kick removes them from the live match. Ban/block stops login until you <b>Remove</b> it below.</p>` : ''}
        <h2 style="margin-top:16px">Coin purchase history</h2>
        <table class="data"><thead><tr><th>Ref</th><th>Pack</th><th>Coins</th><th>IQD</th><th>Status</th><th>When</th></tr></thead>
        <tbody>${(p.coinOrders || []).map((o) => `<tr>
          <td><code>${esc(o.refCode)}</code></td>
          <td>${esc(o.packId)}</td>
          <td class="coins-cell">+${Number(o.coins).toLocaleString()}</td>
          <td>${Number(o.iqd).toLocaleString()}</td>
          <td><span class="tag ${esc(o.status)}">${o.status === 'fulfilled' ? 'Completed' : o.status === 'pending' ? 'Pending' : 'Rejected'}</span></td>
          <td>${fmtDate(o.createdAt)}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No purchases</td></tr>'}</tbody></table>
        <h2 style="margin-top:16px">Sessions</h2>
        <table class="data"><thead><tr><th>Mode</th><th>K/D</th><th>Coins</th><th>Started</th></tr></thead>
        <tbody>${p.sessions.map((s) => `<tr><td>${esc(s.mode)} ${esc(s.difficulty || '')}</td><td>${s.kills}/${s.deaths}</td><td>${s.coins_earned}</td><td>${fmtDate(s.started_at)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None</td></tr>'}</tbody></table>
        <h2 style="margin-top:16px">Chat</h2>
        <table class="data"><thead><tr><th>When</th><th>Text</th></tr></thead>
        <tbody>${p.chats.map((c) => `<tr><td>${fmtDate(c.created_at)}</td><td>${esc(c.text)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">No chat</td></tr>'}</tbody></table>
        <h2 style="margin-top:16px">Flags / bans</h2>
        <p class="muted">${p.flags.filter((f) => !f.resolved).map((f) => `${f.flag_type}: ${esc(f.detail || '')}`).join(' · ') || 'No open flags'}</p>
        <table class="data"><thead><tr><th>Type</th><th>Target</th><th>Reason</th><th></th></tr></thead>
        <tbody>${(p.bans || []).map((b) => `<tr>
          <td><span class="tag bad">${esc(b.ban_type)}</span></td>
          <td><code>${esc(String(b.target || '').slice(0, 24))}</code></td>
          <td>${esc(b.reason || '—')}</td>
          <td>${can(state, 'moderation.act')
    ? `<button class="btn small primary" data-lift="${b.id}">Remove</button>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">No active bans — player can play</td></tr>'}</tbody></table>
      `;
      if (can(state, '*')) pane.querySelector('#role-sel').value = u.role || 'none';
      pane.querySelector('#gift-btn')?.addEventListener('click', async () => {
        try {
          await api('/api/admin/gift', { username: u.username, amount: Number(pane.querySelector('#gift-amt').value) });
          toast('Gifted');
          loadProfile(id);
        } catch (e) { toast(e.message, true); }
      });
      pane.querySelector('#role-btn')?.addEventListener('click', async () => {
        try {
          await api(`/api/admin/users/${u.id}/role`, { role: pane.querySelector('#role-sel').value });
          toast('Role updated');
          loadProfile(id);
        } catch (e) { toast(e.message, true); }
      });
      pane.querySelector('#kick-btn')?.addEventListener('click', async () => {
        try {
          await api('/api/admin/moderation/kick', { userId: u.id, reason: 'Kicked by admin' });
          toast('Kicked from match');
          loadUsers().catch(() => {});
          loadProfile(id);
        } catch (e) { toast(e.message, true); }
      });
      pane.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', async () => {
        const banType = b.dataset.ban;
        const target = banType === 'ip' ? u.lastIp : banType === 'device' ? u.deviceHash : String(u.id);
        try {
          await api('/api/admin/moderation/ban', { banType, target, userId: u.id, reason: `${banType} via admin` });
          toast(`${banType} ban applied`);
          loadProfile(id);
        } catch (e) { toast(e.message, true); }
      }));
      pane.querySelectorAll('[data-lift]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api(`/api/admin/moderation/bans/${b.dataset.lift}/lift`, {});
          toast('Ban removed — player can play again');
          loadProfile(id);
        } catch (e) { toast(e.message, true); }
      }));
    } catch (e) {
      pane.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  if (can(state, 'orders.view')) {
    const loadOrders = async () => {
      const box = root.querySelector('#p-orders');
      if (!box) return;
      box.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const { orders } = await api('/api/admin/coin-orders?status=pending');
        box.innerHTML = `<table class="data">
          <thead><tr><th>Ref</th><th>Player</th><th>Pack</th><th>Coins</th><th>IQD</th><th></th></tr></thead>
          <tbody>${(orders || []).map((o) => `<tr class="row-pending">
            <td><code>${esc(o.refCode)}</code></td><td>${esc(o.username)}</td><td>${esc(o.packId)}</td>
            <td class="coins-cell">+${Number(o.coins).toLocaleString()}</td>
            <td>${Number(o.iqd).toLocaleString()}</td>
            <td>${can(state, 'orders.fulfill')
    ? `<button class="btn small primary" data-f="${o.id}">Complete</button>
               <button class="btn small ghost" data-r="${o.id}">Reject</button>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty">No pending orders</td></tr>'}</tbody></table>`;
        box.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await api(`/api/admin/coin-orders/${b.dataset.f}/complete`, {});
            toast('Completed — coins added');
            loadOrders();
            loadUsers().catch(() => {});
          } catch (e) { toast(e.message, true); }
        }));
        box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await api(`/api/admin/coin-orders/${b.dataset.r}/reject`, {});
            toast('Rejected');
            loadOrders();
          } catch (e) { toast(e.message, true); }
        }));
      } catch (e) {
        box.innerHTML = `<p class="muted" style="color:var(--admin-bad)">${esc(e.message)}</p>`;
        toast(e.message, true);
      }
    };
    root.querySelector('#p-orders-refresh')?.addEventListener('click', loadOrders);
    await loadOrders();
  }
}

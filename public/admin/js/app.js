import { api, toast, can } from './api.js';
import { renderDashboard } from './views/dashboard.js';
import { renderPlayers } from './views/players.js';
import { renderEconomy } from './views/economy.js';
import { renderModeration } from './views/moderation.js';
import { renderLiveops } from './views/liveops.js';
import { renderOrders } from './views/orders.js';
import { renderAccount } from './views/account.js';

const state = { user: null, role: 'none', perms: [], view: 'dashboard' };
const $ = (id) => document.getElementById(id);

const NAV = [
  { id: 'dashboard', label: 'Dashboard', perm: 'dashboard.view' },
  { id: 'orders', label: 'Coin Orders', perm: 'orders.view' },
  { id: 'players', label: 'Players', perm: 'players.view' },
  { id: 'economy', label: 'Economy', perm: 'economy.view' },
  { id: 'moderation', label: 'Moderation', perm: 'moderation.view' },
  { id: 'liveops', label: 'LiveOps', perm: 'dashboard.view' },
  { id: 'account', label: 'Account', perm: 'dashboard.view' },
];

function showLogin() {
  location.replace('/');
}

function buildNav(pendingOrders = 0) {
  const nav = $('side-nav');
  nav.innerHTML = NAV.filter((n) => can(state, n.perm) || can(state, '*')).map((n) => {
    const badge = n.id === 'orders' && pendingOrders > 0
      ? `<span class="nav-badge">${pendingOrders}</span>` : '';
    return `<button class="nav-item ${state.view === n.id ? 'active' : ''}" data-view="${n.id}">${n.label}${badge}</button>`;
  }).join('');
  nav.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    buildNav(state.pendingOrders || 0);
    render();
  }));
}

async function refreshPendingBadge() {
  if (!can(state, 'orders.view') && !can(state, '*')) return;
  try {
    const { orders } = await api('/api/admin/coin-orders?status=pending');
    state.pendingOrders = (orders || []).length;
    buildNav(state.pendingOrders);
  } catch { /* ignore */ }
}

async function render() {
  const titles = {
    dashboard: 'Dashboard', orders: 'Coin Orders', players: 'Players',
    economy: 'Economy', moderation: 'Moderation', liveops: 'LiveOps',
    account: 'Account',
  };
  $('view-title').textContent = titles[state.view] || 'Admin';
  const root = $('view-root');
  root.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (state.view === 'dashboard') await renderDashboard(root, state);
    else if (state.view === 'orders') await renderOrders(root, state);
    else if (state.view === 'players') await renderPlayers(root, state);
    else if (state.view === 'economy') await renderEconomy(root, state);
    else if (state.view === 'moderation') await renderModeration(root, state);
    else if (state.view === 'liveops') await renderLiveops(root, state);
    else if (state.view === 'account') await renderAccount(root, state);
    refreshPendingBadge();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return showLogin();
    root.innerHTML = `<p class="muted">${err.message}</p>`;
    toast(err.message, true);
  }
}

$('a-logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  showLogin();
});

(async function boot() {
  try {
    const me = await api('/api/admin/me');
    state.user = me.user;
    state.role = me.role;
    state.perms = me.perms.includes('*') ? ['*'] : me.perms;
    state.pendingOrders = 0;
    $('a-name').textContent = me.user.username;
    $('a-role').textContent = me.role;
    buildNav(0);
    try {
      const { orders } = await api('/api/admin/coin-orders?status=pending');
      state.pendingOrders = (orders || []).length;
      if (state.pendingOrders > 0 && can(state, 'orders.view')) state.view = 'orders';
      buildNav(state.pendingOrders);
    } catch { /* ignore */ }
    await render();
    setInterval(() => {
      refreshPendingBadge();
      if (state.view === 'dashboard') render().catch(() => {});
    }, 8000);
  } catch {
    showLogin();
  }
})();

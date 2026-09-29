import { api, toast, esc, fmtDate, can } from '../api.js';

/** Dedicated pending coin-order queue: Complete adds coins, Reject closes without credit. */
export async function renderOrders(root, state) {
  if (!can(state, 'orders.view')) {
    root.innerHTML = '<p class="muted">No permission to view coin orders.</p>';
    return;
  }

  root.innerHTML = `
    <section class="block">
      <div class="block-head">
        <h2>Coin orders</h2>
        <div class="form-row" style="margin:0">
          <select id="o-filter">
            <option value="pending">Pending only</option>
            <option value="all">All statuses</option>
            <option value="fulfilled">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
          <button class="btn small ghost" id="o-refresh">Refresh</button>
        </div>
      </div>
      <p class="muted">When a player requests a pack it stays <b>pending</b> until you verify payment.
        Press <b>Complete</b> to add the coins to their account, or <b>Reject</b> to close it.</p>
      <div id="o-table"></div>
    </section>
  `;

  const filter = root.querySelector('#o-filter');
  const table = root.querySelector('#o-table');

  const statusLabel = (s) => ({
    pending: 'Pending',
    fulfilled: 'Completed',
    rejected: 'Rejected',
  }[s] || s);

  const load = async () => {
    table.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const q = filter.value || 'pending';
      const { orders } = await api(`/api/admin/coin-orders?status=${encodeURIComponent(q)}`);
      table.innerHTML = `<table class="data">
      <thead>
        <tr>
          <th>Ref</th><th>Player</th><th>Pack</th><th>Method</th>
          <th>Coins</th><th>IQD</th><th>Note</th><th>When</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${(orders || []).map((o) => `<tr class="${o.status === 'pending' ? 'row-pending' : ''}">
          <td><code>${esc(o.refCode)}</code></td>
          <td>${esc(o.username)} <span class="muted">#${o.userId}</span></td>
          <td>${esc(o.packId)}</td>
          <td>${esc(o.methodId)}</td>
          <td class="coins-cell">+${Number(o.coins).toLocaleString()}</td>
          <td>${Number(o.iqd).toLocaleString()} IQD</td>
          <td>${esc(o.note || '—')}</td>
          <td>${fmtDate(o.createdAt)}</td>
          <td><span class="tag ${esc(o.status)}">${statusLabel(o.status)}</span>
            ${o.fulfilledBy ? `<div class="muted" style="font-size:11px">by ${esc(o.fulfilledBy)}</div>` : ''}
          </td>
          <td class="actions">
            ${o.status === 'pending' && can(state, 'orders.fulfill') ? `
              <button class="btn small primary" data-complete="${o.id}" title="Add coins to player">Complete</button>
              <button class="btn small ghost" data-reject="${o.id}">Reject</button>
            ` : '—'}
          </td>
        </tr>`).join('') || '<tr><td colspan="10" class="empty">No orders in this filter</td></tr>'}
      </tbody>
    </table>`;

      table.querySelectorAll('[data-complete]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Complete this order and add coins to the player?')) return;
        try {
          await api(`/api/admin/coin-orders/${b.dataset.complete}/complete`, {});
          toast('Completed — coins added');
          load();
        } catch (e) {
          try {
            await api(`/api/admin/coin-orders/${b.dataset.complete}/fulfill`, {});
            toast('Completed — coins added');
            load();
          } catch (e2) { toast(e2.message || e.message, true); }
        }
      }));
      table.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Reject this order? No coins will be added.')) return;
        try {
          await api(`/api/admin/coin-orders/${b.dataset.reject}/reject`, {});
          toast('Order rejected');
          load();
        } catch (e) { toast(e.message, true); }
      }));
    } catch (e) {
      table.innerHTML = `<p class="muted" style="color:var(--admin-bad)">${esc(e.message)}</p>`;
      toast(e.message, true);
    }
  };

  filter.addEventListener('change', load);
  root.querySelector('#o-refresh').addEventListener('click', load);
  await load();
}

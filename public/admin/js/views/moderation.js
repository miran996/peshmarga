import { api, toast, esc, fmtDate, can } from '../api.js';

export async function renderModeration(root, state) {
  if (!can(state, 'moderation.view')) {
    root.innerHTML = '<p class="muted">No access</p>';
    return;
  }
  const [flags, bans] = await Promise.all([
    api('/api/admin/moderation/flags'),
    api('/api/admin/moderation/bans'),
  ]);
  root.innerHTML = `
    <section class="block">
      <div class="block-head"><h2>Cheat flags (auto)</h2>
        <button class="btn small ghost" id="m-refresh">Refresh</button></div>
      <p class="muted">Flags only — never auto-ban. Review HS rate / kill rate anomalies.</p>
      <table class="data"><thead><tr><th>Player</th><th>Type</th><th>Detail</th><th>Score</th><th>When</th><th></th></tr></thead>
      <tbody>${flags.flags.map((f) => `<tr>
        <td>${esc(f.username)}</td><td><span class="tag warn">${esc(f.flag_type)}</span></td>
        <td>${esc(f.detail || '')}</td><td>${Number(f.score).toFixed(2)}</td><td>${fmtDate(f.created_at)}</td>
        <td>${can(state, 'moderation.act') ? `<button class="btn small" data-res="${f.id}">Resolve</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">Clean</td></tr>'}</tbody></table>
    </section>
    <section class="block">
      <h2>Active bans</h2>
      <table class="data"><thead><tr><th>Type</th><th>Target</th><th>User</th><th>Reason</th><th>By</th><th></th></tr></thead>
      <tbody>${bans.bans.map((b) => `<tr>
        <td><span class="tag bad">${esc(b.ban_type)}</span></td>
        <td>${esc(b.target)}</td><td>${b.user_id || '—'}</td><td>${esc(b.reason || '')}</td><td>${esc(b.created_by || '')}</td>
        <td>${can(state, 'moderation.act') ? `<button class="btn small ghost" data-lift="${b.id}">Lift</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">No bans</td></tr>'}</tbody></table>
    </section>
  `;
  root.querySelector('#m-refresh')?.addEventListener('click', () => renderModeration(root, state));
  root.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/moderation/flags/${b.dataset.res}/resolve`, {}); toast('Resolved'); renderModeration(root, state); }
    catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-lift]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/moderation/bans/${b.dataset.lift}/lift`, {}); toast('Ban lifted'); renderModeration(root, state); }
    catch (e) { toast(e.message, true); }
  }));
}

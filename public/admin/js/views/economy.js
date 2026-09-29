import { api, toast, esc, can } from '../api.js';

export async function renderEconomy(root, state) {
  if (!can(state, 'economy.view')) {
    root.innerHTML = '<p class="muted">No access</p>';
    return;
  }
  const data = await api('/api/admin/economy');
  const dc = data.events.find((e) => e.id === 'double_coin') || { active: 0, mult: 2 };
  const packs = Object.values(data.coinPacks || {});
  const pays = Object.values(data.paymentMethods || {});
  const edit = can(state, 'economy.edit');

  root.innerHTML = `
    <section class="block">
      <h2>Buy Coins — packs (IQD + coins)</h2>
      <p class="muted">Players see these prices in Buy Coins. Change IQD amount, coin grant, and bonus anytime.</p>
      <table class="data">
        <thead><tr><th>Pack</th><th>Name</th><th>Coins</th><th>Bonus</th><th>Price (IQD)</th><th>Description</th><th></th></tr></thead>
        <tbody>
          ${packs.map((p) => `
            <tr data-pack="${esc(p.id)}">
              <td><code>${esc(p.id)}</code>${p.overridden ? ' <span class="tag warn">edited</span>' : ''}</td>
              <td><input data-f="name" value="${esc(p.name)}" ${edit ? '' : 'disabled'} style="width:140px"/></td>
              <td><input data-f="coins" type="number" value="${p.coins}" ${edit ? '' : 'disabled'} style="width:90px"/></td>
              <td><input data-f="bonus" type="number" value="${p.bonus || 0}" ${edit ? '' : 'disabled'} style="width:80px"/></td>
              <td><input data-f="iqd" type="number" value="${p.iqd}" ${edit ? '' : 'disabled'} style="width:110px"/></td>
              <td><input data-f="description" value="${esc(p.description || '')}" ${edit ? '' : 'disabled'} style="width:160px"/></td>
              <td>${edit ? `
                <button class="btn small primary" data-save-pack="${esc(p.id)}">Save</button>
                <button class="btn small ghost" data-reset-pack="${esc(p.id)}">Reset</button>
              ` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>Buy Coins — payment mobiles</h2>
      <p class="muted">Fib / NBI / AsiaPay / … phone numbers shown to players when they request a pack.</p>
      <table class="data">
        <thead><tr><th>Method</th><th>Display name</th><th>Mobile / wallet</th><th>Hint</th><th></th></tr></thead>
        <tbody>
          ${pays.map((m) => `
            <tr data-pay="${esc(m.id)}">
              <td><code>${esc(m.id)}</code>${m.overridden ? ' <span class="tag warn">edited</span>' : ''}</td>
              <td><input data-f="name" value="${esc(m.name)}" ${edit ? '' : 'disabled'} style="width:130px"/></td>
              <td><input data-f="phone" value="${esc(m.phone)}" ${edit ? '' : 'disabled'} style="width:140px"/></td>
              <td><input data-f="hint" value="${esc(m.hint || '')}" ${edit ? '' : 'disabled'} style="min-width:180px;width:100%"/></td>
              <td>${edit ? `
                <button class="btn small primary" data-save-pay="${esc(m.id)}">Save</button>
                <button class="btn small ghost" data-reset-pay="${esc(m.id)}">Reset</button>
              ` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>

    <section class="block">
      <h2>Live events</h2>
      <div class="form-row">
        <label><input type="checkbox" id="dc-active" ${dc.active ? 'checked' : ''}/> Double Coin (×${dc.mult || 2})</label>
        ${edit ? '<button class="btn small primary" id="dc-save">Save event</button>' : ''}
      </div>
      <p class="muted">When active, kill coin rewards are multiplied server-side. Shop prices unchanged.</p>
    </section>
    <section class="block">
      <div class="block-head"><h2>Gift coins by username</h2></div>
      ${can(state, 'economy.gift') ? `<div class="form-row">
        <input id="g-user" placeholder="username" />
        <input id="g-amt" type="number" placeholder="amount" />
        <button class="btn small primary" id="g-btn">Send</button>
      </div>` : '<p class="muted">No gift permission</p>'}
    </section>
    <section class="block">
      <h2>Shop price overrides</h2>
      <p class="muted">Leave price blank to keep catalog base; discount % stacks on top.</p>
      <div class="form-row">
        <select id="ov-kind"><option value="weapon">Weapon</option><option value="cosmetic">Cosmetic</option><option value="flag">Flag</option></select>
        <select id="ov-item"></select>
        <input id="ov-price" type="number" placeholder="price (blank=base)" />
        <input id="ov-disc" type="number" placeholder="discount %" min="0" max="90" />
        ${edit ? '<button class="btn small primary" id="ov-save">Save</button><button class="btn small ghost" id="ov-clear">Clear</button>' : ''}
      </div>
      <table class="data"><thead><tr><th>Kind</th><th>Item</th><th>Override</th><th>Discount</th><th>Effective</th></tr></thead>
      <tbody id="ov-body"></tbody></table>
    </section>
  `;

  root.querySelectorAll('[data-save-pack]').forEach((b) => b.addEventListener('click', async () => {
    const tr = root.querySelector(`tr[data-pack="${b.dataset.savePack}"]`);
    const val = (f) => tr.querySelector(`[data-f="${f}"]`).value;
    try {
      await api(`/api/admin/economy/coin-packs/${b.dataset.savePack}`, {
        name: val('name'),
        coins: Number(val('coins')),
        bonus: Number(val('bonus')),
        iqd: Number(val('iqd')),
        description: val('description'),
      });
      toast('Coin pack saved');
      renderEconomy(root, state);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-reset-pack]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/admin/economy/coin-packs/${b.dataset.resetPack}/reset`, {});
      toast('Pack reset to default');
      renderEconomy(root, state);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-save-pay]').forEach((b) => b.addEventListener('click', async () => {
    const tr = root.querySelector(`tr[data-pay="${b.dataset.savePay}"]`);
    const val = (f) => tr.querySelector(`[data-f="${f}"]`).value;
    try {
      await api(`/api/admin/economy/payments/${b.dataset.savePay}`, {
        name: val('name'),
        phone: val('phone'),
        hint: val('hint'),
      });
      toast('Payment mobile saved');
      renderEconomy(root, state);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-reset-pay]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/admin/economy/payments/${b.dataset.resetPay}/reset`, {});
      toast('Payment reset to default');
      renderEconomy(root, state);
    } catch (e) { toast(e.message, true); }
  }));

  const fillItems = () => {
    const kind = root.querySelector('#ov-kind').value;
    const cat = data.catalog[kind === 'weapon' ? 'weapons' : kind === 'cosmetic' ? 'cosmetics' : 'flags'];
    root.querySelector('#ov-item').innerHTML = Object.values(cat).map((i) =>
      `<option value="${i.id}">${esc(i.name)} (base ${i.cost})</option>`).join('');
  };
  fillItems();
  root.querySelector('#ov-kind').addEventListener('change', fillItems);

  const drawOverrides = () => {
    root.querySelector('#ov-body').innerHTML = data.overrides.length
      ? data.overrides.map((o) => {
        const item = data.catalog[o.kind === 'weapon' ? 'weapons' : o.kind === 'cosmetic' ? 'cosmetics' : 'flags'][o.item_id];
        const e = data.effective[o.kind === 'weapon' ? 'weapons' : o.kind === 'cosmetic' ? 'cosmetics' : 'flags'][o.item_id];
        return `<tr><td>${esc(o.kind)}</td><td>${esc(item?.name || o.item_id)}</td>
          <td>${o.price == null ? '—' : o.price}</td><td>${o.discount_pct}%</td>
          <td class="coins-cell">${e?.cost ?? '—'}</td></tr>`;
      }).join('')
      : '<tr><td colspan="5" class="empty">No overrides</td></tr>';
  };
  drawOverrides();

  root.querySelector('#dc-save')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/economy/events/double_coin', { active: root.querySelector('#dc-active').checked, mult: 2 });
      toast('Double Coin updated');
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#g-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/gift', { username: root.querySelector('#g-user').value.trim(), amount: Number(root.querySelector('#g-amt').value) });
      toast('Gift sent');
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#ov-save')?.addEventListener('click', async () => {
    const priceVal = root.querySelector('#ov-price').value;
    try {
      await api('/api/admin/economy/override', {
        kind: root.querySelector('#ov-kind').value,
        itemId: root.querySelector('#ov-item').value,
        price: priceVal === '' ? null : Number(priceVal),
        discountPct: Number(root.querySelector('#ov-disc').value) || 0,
      });
      toast('Override saved');
      Object.assign(data, await api('/api/admin/economy'));
      drawOverrides();
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#ov-clear')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/economy/override/clear', {
        kind: root.querySelector('#ov-kind').value,
        itemId: root.querySelector('#ov-item').value,
      });
      toast('Cleared');
      Object.assign(data, await api('/api/admin/economy'));
      drawOverrides();
    } catch (e) { toast(e.message, true); }
  });
}

import { api, toast, esc, can } from '../api.js';

export async function renderLiveops(root, state) {
  const data = await api('/api/admin/liveops');
  const maxPl = data.maxPlayers ?? data.state?.max_players ?? 12;
  root.innerHTML = `
    <section class="block">
      <h2>Players per lobby (auto new server)</h2>
      ${can(state, '*') ? `<div class="form-row">
        <input id="max-pl" type="number" min="2" max="32" step="1" value="${Number(maxPl)}" style="width:100px" />
        <button class="btn small primary" id="max-pl-btn">Save limit</button>
      </div>` : `<p class="muted">Current limit: <b>${Number(maxPl)}</b></p>`}
      <p class="muted">Players fill one lobby together. When it reaches this number, the next players automatically join a <b>new</b> server/lobby. Range 2–32.</p>
    </section>
    <section class="block">
      <div class="block-head"><h2>Live public lobbies</h2>
        <button class="btn small ghost" id="lobbies-refresh">Refresh</button>
      </div>
      <table class="data"><thead><tr><th>Lobby</th><th>Map</th><th>Mode</th><th>Players</th><th>Status</th></tr></thead>
      <tbody id="live-lobbies">${(data.arenas || []).map((a) => `<tr>
        <td><code>${esc(a.key)}</code></td>
        <td>${esc(a.name)}</td>
        <td>${esc(a.mode)}</td>
        <td class="num">${a.count} / ${a.max}</td>
        <td>${a.full ? '<span class="tag bad">Full → next opens new</span>' : a.count ? '<span class="tag ok">Open</span>' : '<span class="tag muted-tag">Empty</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No public lobbies yet</td></tr>'}</tbody></table>
    </section>
    <section class="block">
      <h2>Global announcement</h2>
      ${can(state, 'liveops.announce') ? `<div class="form-row">
        <input id="ann-text" maxlength="160" placeholder="Message to all players…" style="flex:1;min-width:220px" />
        <button class="btn small primary" id="ann-btn">Broadcast</button>
      </div>` : '<p class="muted">No announce permission</p>'}
      <p class="muted">Last: ${esc(data.state?.announce || '—')}</p>
    </section>
    <section class="block">
      <h2>Weather / lighting</h2>
      ${can(state, '*') ? `<div class="form-row">
        <select id="wx">${data.weatherOptions.map((w) => `<option value="${w}" ${data.state?.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select>
        <button class="btn small primary" id="wx-btn">Apply</button>
      </div>` : `<p class="muted">Current: ${esc(data.state?.weather || 'clear')} (super only)</p>`}
    </section>
    <section class="block">
      <h2>Preferred map (new lobbies)</h2>
      ${can(state, '*') ? `<div class="form-row">
        <select id="map-sel"><option value="">(auto matchmaking)</option>
          ${data.maps.map((m) => `<option value="${m.id}" ${data.state?.preferred_map === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
        </select>
        <label><input type="checkbox" id="map-rotate"/> Also clear empty arenas</label>
        <button class="btn small primary" id="map-btn">Save</button>
      </div>` : `<p class="muted">${esc(data.state?.preferred_map || 'auto')}</p>`}
      <p class="muted">Does not teleport players mid-round.</p>
    </section>
    <section class="block">
      <h2>Tournament lobbies (password)</h2>
      ${can(state, '*') ? `<div class="form-row">
        <select id="lb-map">${data.maps.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <select id="lb-mode"><option value="ffa">FFA</option><option value="tdm">TDM</option></select>
        <input id="lb-pass" placeholder="password" />
        <input id="lb-label" placeholder="label" />
        <button class="btn small primary" id="lb-create">Create</button>
      </div>` : ''}
      <table class="data"><thead><tr><th>ID</th><th>Label</th><th>Map</th><th>Mode</th><th></th></tr></thead>
      <tbody>${data.lobbies.map((l) => `<tr>
        <td><code>${esc(l.id)}</code></td><td>${esc(l.label || '')}</td><td>${esc(l.mapId)}</td><td>${esc(l.mode)}</td>
        <td>${can(state, '*') ? `<button class="btn small ghost" data-close="${l.id}">Close</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No lobbies</td></tr>'}</tbody></table>
      <p class="muted">Players join via console: set lobby id + password in multiplayer join payload (advanced). Share lobby id + password privately.</p>
    </section>
  `;

  root.querySelector('#max-pl-btn')?.addEventListener('click', async () => {
    try {
      const { maxPlayers } = await api('/api/admin/liveops/max-players', {
        maxPlayers: Number(root.querySelector('#max-pl').value),
      });
      toast(`Lobby limit set to ${maxPlayers} — full lobbies open a new server`);
      renderLiveops(root, state);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#lobbies-refresh')?.addEventListener('click', () => {
    renderLiveops(root, state).catch((e) => toast(e.message, true));
  });
  root.querySelector('#ann-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/liveops/announce', { text: root.querySelector('#ann-text').value });
      toast('Announced');
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#wx-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/liveops/weather', { weather: root.querySelector('#wx').value });
      toast('Weather set');
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#map-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/admin/liveops/map', {
        mapId: root.querySelector('#map-sel').value,
        rotateEmpty: root.querySelector('#map-rotate').checked,
      });
      toast('Map preference saved');
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector('#lb-create')?.addEventListener('click', async () => {
    try {
      const { lobby } = await api('/api/admin/liveops/lobbies', {
        mapId: root.querySelector('#lb-map').value,
        mode: root.querySelector('#lb-mode').value,
        password: root.querySelector('#lb-pass').value,
        label: root.querySelector('#lb-label').value,
      });
      toast(`Lobby ${lobby.id} created — password ${lobby.password}`);
      renderLiveops(root, state);
    } catch (e) { toast(e.message, true); }
  });
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/admin/liveops/lobbies/${b.dataset.close}/close`, {});
      toast('Closed');
      renderLiveops(root, state);
    } catch (e) { toast(e.message, true); }
  }));
}

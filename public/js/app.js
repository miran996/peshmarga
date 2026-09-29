import * as THREE from 'three';
import { Game } from './game/engine.js';
import { SinglePlayerMode, MultiplayerMode } from './game/modes.js';
import { Stickman } from './game/stickman.js';
import { audio } from './game/audio.js';
import { drawMapImage } from './game/hud.js';
import { settings, updateSettings, onSettings, SETTINGS_FIELDS, QUALITY } from './settings.js';
import { getDeviceHash } from './device.js';
import { mountCharacterSelect, selectedCharacter } from './character-select.js';
import { enhanceOperatorMaterials } from './graphics/materials.js';
import { resolveGraphicsConfig } from './graphics/config.js';
import { t, tOpt, initI18n, bindLangSelect, onLangChange, applyI18n } from './i18n.js';
import {
  BIND_ROWS, binds, setBind, resetKeybinds, formatCode, isBlockedCode, onKeybinds,
} from './keybinds.js';

const $ = (id) => document.getElementById(id);
const WEATHERS = ['clear', 'day', 'night', 'fog', 'rain'];
const state = {
  user: null, catalog: null, socket: null, game: null, diff: 'normal', primary: null, preview: null,
  mapId: localStorage.getItem('fps_map'), mapCounts: {},
  mpMode: localStorage.getItem('fps_mpmode') === 'tdm' ? 'tdm' : 'ffa', lbSort: 'kills',
  weather: WEATHERS.includes(localStorage.getItem('fps_weather')) ? localStorage.getItem('fps_weather') : 'clear',
  secondary: localStorage.getItem('fps_secondary') || 'pistol',
  lethal: localStorage.getItem('fps_lethal') === 'molotov' ? 'molotov' : 'frag',
  perk: ['doubletime', 'quickfix', 'trophy'].includes(localStorage.getItem('fps_perk')) ? localStorage.getItem('fps_perk') : 'doubletime',
  pendingKind: null,
  inviteToken: null,
  pendingInvite: null,
  /** Operator portrait id from character sheet — ready for mp backend. */
  selectedCharacter,
};
audio.setVolume(settings.volume);

initI18n();
bindLangSelect($('auth-lang'));
bindLangSelect($('menu-lang'));

async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function show(screen) {
  for (const id of ['screen-auth', 'screen-menu', 'screen-game']) $(id).classList.toggle('hidden', id !== screen);
}

// ---------------------------------------------------------------- auth
let authMode = 'login';
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('auth-confirm-wrap').classList.toggle('hidden', authMode !== 'register');
    $('auth-submit').textContent = authMode === 'register' ? t('auth.enlist') : t('auth.deploy');
    $('auth-pass').autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
    $('auth-error').textContent = '';
  });
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('auth-user').value.trim();
  const password = $('auth-pass').value;
  $('auth-error').textContent = '';
  if (authMode === 'register' && password !== $('auth-confirm').value) {
    $('auth-error').textContent = t('auth.passMismatch');
    return;
  }
  $('auth-submit').disabled = true;
  try {
    const { user } = await api(authMode === 'register' ? '/api/register' : '/api/login', {
      username, password, deviceHash: getDeviceHash(),
    });
    $('auth-pass').value = $('auth-confirm').value = '';
    enterMenu(user);
    if (authMode === 'register') toast(t('auth.welcome', { name: user.username }));
    if (user.isAdmin) toast(t('toast.adminPlay'));
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally {
    $('auth-submit').disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  state.socket?.disconnect();
  state.socket = null;
  state.user = null;
  show('screen-auth');
});

$('admin-panel-btn')?.addEventListener('click', () => {
  location.assign('/admin');
});

// ---------------------------------------------------------------- socket
function connectSocket() {
  state.socket?.disconnect();
  const s = window.io({ transports: ['websocket', 'polling'], withCredentials: true });
  s.on('coins', (d) => {
    applyCoinPayload(d);
  });
  s.on('admin:announce', (d) => {
    toast(d.text || t('toast.announce'));
    if (state.game?.hud) state.game.hud.message(d.text || t('toast.announce'), 'ADMIN');
  });
  s.on('admin:weather', (d) => {
    state.game?.applyWeather?.(d.weather);
  });
  s.on('admin:kick', (d) => {
    toast(d.reason || t('toast.kicked'), true);
    exitGame();
  });
  s.on('friends:invite', (d) => {
    showPartyInvite(d);
  });
  s.on('friends:updated', () => {
    if ($('panel-friends')?.classList.contains('active')) loadFriends();
  });
  s.on('friends:presence', () => {
    if ($('panel-friends')?.classList.contains('active')) loadFriends();
  });
  s.on('admin:economy', async (d) => {
    if (state.catalog && d.coinMultiplier != null) state.catalog.coinMultiplier = d.coinMultiplier;
    try {
      const cat = await api('/api/catalog');
      if (cat.coinPacks) state.catalog.coinPacks = cat.coinPacks;
      if (cat.paymentMethods) state.catalog.paymentMethods = cat.paymentMethods;
      if (cat.weapons) state.catalog.weapons = cat.weapons;
      if (cat.cosmetics) state.catalog.cosmetics = cat.cosmetics;
      if (cat.flags) state.catalog.flags = cat.flags;
      if (!$('screen-menu').classList.contains('hidden')) {
        renderShops();
        if ($('panel-coins')?.classList.contains('active')) renderCoinShop();
      }
    } catch { /* ignore */ }
  });
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') toast(t('toast.session'), true);
  });
  state.socket = s;
}

// ---------------------------------------------------------------- menu
function enterMenu(user) {
  state.user = user;
  connectSocket();
  $('menu-user').textContent = user.username;
  renderAvatar(user);
  const rename = $('rename-user');
  if (rename) rename.value = user.username;
  const adminBtn = $('admin-panel-btn');
  if (adminBtn) adminBtn.classList.toggle('hidden', !user.isAdmin);
  const saved = localStorage.getItem('fps_primary');
  const W = state.catalog.weapons;
  if (saved && user.ownedWeapons.includes(saved)) state.primary = saved;
  else if (saved === '') state.primary = null;
  else state.primary = user.ownedWeapons.find((w) => W[w]?.slot === 'primary') || null;
  renderCoins();
  renderShops();
  renderMaps();
  show('screen-menu');
  refreshMapCounts();
  if (!state.preview) state.preview = new Preview($('preview-canvas'));
  state.preview.setCosmetic(state.catalog.cosmetics[user.equippedCosmetic]);
  state.preview.setFlag(state.catalog.flags?.[user.equippedFlag]);
  state.preview.setWeapon(loadoutIds()[0]);
}

function renderCoins() {
  $('menu-coins').textContent = (state.user?.coins ?? 0).toLocaleString();
  const lv = $('menu-level');
  if (lv) lv.textContent = String(state.user?.level ?? 1);
}

function applyCoinPayload(d) {
  if (!d) return;
  if (d.user) {
    state.user = d.user;
    $('menu-user').textContent = d.user.username;
    renderAvatar(d.user);
    const rename = $('rename-user');
    if (rename && document.activeElement !== rename) rename.value = d.user.username;
  } else if (state.user) {
    state.user.coins = d.coins;
    if (d.level != null) state.user.level = d.level;
  }
  renderCoins();
  if (!$('screen-menu').classList.contains('hidden')) renderShops();
  if (d.levelsGained > 0) {
    const level = d.user?.level ?? d.level ?? state.user?.level;
    const bonus = d.levelBonus || 0;
    toast(t('toast.levelUp', { level, coins: bonus }));
    state.game?.hud?.message?.(t('hud.levelUp', { level }), 'LEVEL UP');
  }
}

function renderAvatar(user = state.user) {
  const url = user?.avatarUrl || null;
  const menu = $('menu-avatar');
  if (menu) {
    if (url) {
      menu.src = url;
      menu.classList.remove('hidden');
    } else {
      menu.removeAttribute('src');
      menu.classList.add('hidden');
    }
  }
  const preview = $('avatar-preview');
  if (preview) {
    if (url) {
      preview.style.backgroundImage = `url("${url}")`;
      preview.classList.remove('empty');
    } else {
      preview.style.backgroundImage = '';
      preview.classList.add('empty');
    }
  }
}

/** Resize/crop to square JPEG data-URL for upload (client-side). */
function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      reject(new Error('Use a JPEG, PNG or WebP image.'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('Image must be under 8 MB.'));
      return;
    }
    const img = new Image();
    const obj = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(obj);
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > 280_000 && quality > 0.45) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > 280_000) {
        reject(new Error('Could not compress image enough. Try a simpler photo.'));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(obj);
      reject(new Error('Could not read that image.'));
    };
    img.src = obj;
  });
}

async function uploadAvatar(file) {
  try {
    const image = await resizeAvatarFile(file);
    const { user } = await api('/api/me/avatar', { image });
    state.user = user;
    renderAvatar(user);
    toast(t('toast.photoOk'));
  } catch (err) {
    toast(err.message, true);
  }
}

async function clearAvatar() {
  try {
    const { user } = await api('/api/me/avatar/clear', {});
    state.user = user;
    renderAvatar(user);
    toast(t('toast.photoGone'));
  } catch (err) {
    toast(err.message, true);
  }
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.ui();
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${btn.dataset.panel}`));
    if (btn.dataset.panel === 'leaderboard') loadLeaderboard();
    if (btn.dataset.panel === 'coins') renderCoinShop();
    if (btn.dataset.panel === 'settings') renderPurchaseHistory();
    if (btn.dataset.panel === 'friends') loadFriends();
    if (btn.dataset.panel === 'controls') renderKeybinds();
  });
});

function orderStatusLabel(status) {
  if (status === 'fulfilled') return t('coins.status.fulfilled');
  if (status === 'pending') return t('coins.status.pending');
  if (status === 'rejected') return t('coins.status.rejected');
  return status;
}

function formatOrderRow(o) {
  const when = o.createdAt ? new Date(String(o.createdAt).replace(' ', 'T') + 'Z').toLocaleString() : '';
  const done = o.fulfilledAt && o.status === 'fulfilled'
    ? t('coins.credited', { when: new Date(String(o.fulfilledAt).replace(' ', 'T') + 'Z').toLocaleString() })
    : '';
  return `<div class="order-row">
    <span class="ref">${esc(o.refCode)}</span>
    <span>+${Number(o.coins).toLocaleString()} coins · ${fmtIqd(o.iqd)}</span>
    <span>${esc(o.methodId)} · ${esc(o.packId)}</span>
    <span class="order-when">${esc(when)}${esc(done)}</span>
    <span class="status ${esc(o.status)}">${esc(orderStatusLabel(o.status))}</span>
  </div>`;
}

async function renderPurchaseHistory() {
  const el = $('purchase-history');
  if (!el) return;
  el.innerHTML = `<p class="sub">${esc(t('coins.noHistory'))}</p>`;
  try {
    const { orders } = await api('/api/shop/coin-orders');
    el.innerHTML = orders.length
      ? orders.map(formatOrderRow).join('')
      : `<p class="sub">${esc(t('coins.noHistory'))}</p>`;
  } catch {
    el.innerHTML = `<p class="sub">${esc(t('coins.historyFail'))}</p>`;
  }
}

async function saveUsername() {
  const input = $('rename-user');
  const username = (input?.value || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    toast(t('toast.nameBad'), true);
    return;
  }
  try {
    const { user } = await api('/api/me/username', { username });
    state.user = user;
    $('menu-user').textContent = user.username;
    input.value = user.username;
    if (state.game?.player) state.game.player.name = user.username;
    toast(t('toast.nameOk', { name: user.username }));
  } catch (err) {
    toast(err.message, true);
  }
}

$('rename-btn')?.addEventListener('click', () => { audio.ui(); saveUsername(); });
$('rename-user')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveUsername(); }
});

async function savePassword() {
  const currentPassword = $('pw-current')?.value || '';
  const newPassword = $('pw-new')?.value || '';
  const confirm = $('pw-confirm')?.value || '';
  if (!currentPassword) {
    toast(t('toast.pwNeed'), true);
    return;
  }
  if (newPassword.length < 6 || newPassword.length > 72) {
    toast(t('toast.pwLen'), true);
    return;
  }
  if (newPassword !== confirm) {
    toast(t('toast.pwMismatch'), true);
    return;
  }
  try {
    await api('/api/me/password', { currentPassword, newPassword });
    $('pw-current').value = '';
    $('pw-new').value = '';
    $('pw-confirm').value = '';
    toast(t('toast.pwOk'));
  } catch (err) {
    toast(err.message, true);
  }
}

$('pw-btn')?.addEventListener('click', () => { audio.ui(); savePassword(); });
['pw-current', 'pw-new', 'pw-confirm'].forEach((id) => {
  $(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); savePassword(); }
  });
});

$('avatar-file')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) { audio.ui(); uploadAvatar(file); }
});
$('avatar-clear')?.addEventListener('click', () => { audio.ui(); clearAvatar(); });

// ---------------------------------------------------------------- settings
function fieldLabel(f) {
  const map = {
    sens: 'set.sens', adsSens: 'set.adsSens', fov: 'set.fov',
    volume: 'set.volume', quality: 'set.quality', showFps: 'set.showFps',
  };
  return t(map[f.key] || f.label);
}

function qualityLabel(id) {
  return t(`set.q.${id}`) || QUALITY[id]?.label || id;
}

function buildSettingsForm(container) {
  container.innerHTML = '';
  const sync = [];
  for (const f of SETTINGS_FIELDS) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = fieldLabel(f);
    row.appendChild(label);
    if (f.options || f.toggle) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      const opts = f.toggle
        ? [[true, t('set.on')], [false, t('set.off')]]
        : Object.keys(QUALITY).map((id) => [id, qualityLabel(id)]);
      const buttons = opts.map(([value, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.addEventListener('click', () => { audio.ui(); updateSettings({ [f.key]: value }); });
        seg.appendChild(b);
        return [value, b];
      });
      sync.push(() => buttons.forEach(([value, b]) => b.classList.toggle('selected', settings[f.key] === value)));
      row.appendChild(seg);
    } else {
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: f.min, max: f.max, step: f.step });
      const out = document.createElement('output');
      input.addEventListener('input', () => updateSettings({ [f.key]: Number(input.value) }));
      sync.push(() => { input.value = settings[f.key]; out.textContent = f.fmt(settings[f.key]); });
      row.append(input, out);
    }
    container.appendChild(row);
  }
  const refresh = () => sync.forEach((fn) => fn());
  refresh();
  onSettings(refresh);
}

function rebuildSettingsForms() {
  buildSettingsForm($('menu-settings'));
  buildSettingsForm($('pause-settings'));
}
rebuildSettingsForms();
$('pause-settings-btn').addEventListener('click', () => $('pause-settings').classList.toggle('hidden'));

let charSelect = mountCharacterSelect($('character-select-root'), {
  onSelect: (ch) => {
    state.selectedCharacter = ch.id;
    audio.ui();
  },
});
if (charSelect) state.selectedCharacter = charSelect.selectedId;

function refreshUiLanguage() {
  applyI18n();
  bindLangSelect($('auth-lang'));
  bindLangSelect($('menu-lang'));
  $('auth-submit').textContent = authMode === 'register' ? t('auth.enlist') : t('auth.deploy');
  rebuildSettingsForms();
  charSelect = mountCharacterSelect($('character-select-root'), {
    onSelect: (ch) => {
      state.selectedCharacter = ch.id;
      audio.ui();
    },
    initialId: state.selectedCharacter,
  }) || charSelect;
  if (state.catalog) {
    renderLoadoutSummary();
    renderMpMode();
    renderMaps();
    renderShops();
    if ($('panel-coins')?.classList.contains('active')) renderCoinShop();
    if ($('panel-settings')?.classList.contains('active')) renderPurchaseHistory();
    if ($('panel-loadout')?.classList.contains('active')) renderLoadout();
    if ($('panel-leaderboard')?.classList.contains('active')) loadLeaderboard();
    if ($('panel-friends')?.classList.contains('active')) loadFriends();
    if ($('panel-controls')?.classList.contains('active')) renderKeybinds();
  }
}

onLangChange(refreshUiLanguage);

// ---------------------------------------------------------------- leaderboard
async function loadLeaderboard() {
  const body = $('lb-body');
  try {
    const data = await api(`/api/leaderboard?sort=${state.lbSort}`);
    const C = state.catalog;
    body.innerHTML = data.rows.length ? data.rows.map((r) => {
      const color = C.cosmetics[r.cosmetic]?.colors.accent || '#888';
      const av = r.avatarUrl
        ? `<img class="lb-av" src="${esc(r.avatarUrl)}" alt="" width="28" height="28" />`
        : `<i style="background:${color}"></i>`;
      return `<tr class="${r.rank <= 3 ? `top${r.rank}` : ''} ${r.id === state.user?.id ? 'me' : ''}">
        <td>${r.rank}</td><td><span class="who">${av}${esc(r.username)}</span></td>
        <td>${r.kills}</td><td>${r.deaths}</td><td>${r.kd.toFixed(2)}</td><td>${r.coins.toLocaleString()}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No players yet. Be the first on the board.</td></tr>';
    $('lb-me').textContent = data.me ? t('lb.rank', { rank: data.me.rank, total: data.total }) : '';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${esc(err.message)}</td></tr>`;
  }
}
document.querySelectorAll('#lb-sort .chip').forEach((b) => b.addEventListener('click', () => {
  audio.ui();
  state.lbSort = b.dataset.sort;
  document.querySelectorAll('#lb-sort .chip').forEach((x) => x.classList.toggle('selected', x === b));
  loadLeaderboard();
}));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- multiplayer mode
function renderMpMode() {
  document.querySelectorAll('#mp-mode-select .diff').forEach((b) => b.classList.toggle('selected', b.dataset.mpmode === state.mpMode));
  $('play-mp').textContent = state.mpMode === 'tdm' ? t('play.joinTdm') : t('play.joinFfa');
}
document.querySelectorAll('#mp-mode-select .diff').forEach((b) => b.addEventListener('click', () => {
  audio.ui();
  state.mpMode = b.dataset.mpmode;
  localStorage.setItem('fps_mpmode', state.mpMode);
  renderMpMode();
  renderMaps();
}));
renderMpMode();

function renderWeather() {
  document.querySelectorAll('#weather-select .weather-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.weather === state.weather);
  });
}
document.querySelectorAll('#weather-select .weather-btn').forEach((b) => b.addEventListener('click', () => {
  audio.ui();
  state.weather = b.dataset.weather;
  localStorage.setItem('fps_weather', state.weather);
  renderWeather();
}));
renderWeather();

function mapLabel(m, field = 'name') {
  if (!m?.id) return '';
  return tOpt(`map.${m.id}.${field}`, field === 'name' ? m.name : m.desc);
}

function renderMaps() {
  const maps = state.catalog.maps;
  if (!maps.some((m) => m.id === state.mapId)) state.mapId = maps[0].id;
  const grid = $('map-select');
  if (!grid.children.length) {
    for (const m of maps) {
      const card = document.createElement('button');
      card.className = 'map-card';
      card.dataset.map = m.id;
      card.style.setProperty('--map-accent', m.accent);
      card.appendChild(drawMapImage(window.StickMap.buildMap(m.id), 1.6));
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<b></b><small></small><span class="online"></span>';
      card.appendChild(info);
      card.addEventListener('click', () => {
        audio.ui();
        state.mapId = m.id;
        localStorage.setItem('fps_map', m.id);
        renderMaps();
      });
      grid.appendChild(card);
    }
  }
  const live = state.arenaLive?.[state.mpMode];
  const max = state.arenaMax || 12;
  for (const card of grid.children) {
    const map = maps.find((m) => m.id === card.dataset.map);
    if (map) {
      const b = card.querySelector('b');
      const small = card.querySelector('small');
      if (b) b.textContent = mapLabel(map, 'name');
      if (small) small.textContent = mapLabel(map, 'desc');
    }
    const isLive = live && live.mapId === card.dataset.map;
    card.classList.toggle('selected', card.dataset.map === state.mapId);
    card.classList.toggle('live-lobby', !!isLive);
    const n = state.mapCounts[card.dataset.map]?.[state.mpMode] || 0;
    const onlineEl = card.querySelector('.online');
    if (!onlineEl) continue;
    const modeName = state.mpMode === 'tdm' ? t('mp.tdm') : t('mp.ffa');
    if (isLive) onlineEl.textContent = t('play.liveLobby', { n, max, mode: modeName });
    else if (n) onlineEl.textContent = t('play.playing', { n, mode: modeName });
    else onlineEl.textContent = live
      ? t('play.openPlaying', { n: live.count || 0 })
      : t('play.openEmpty');
    onlineEl.classList.toggle('live', n > 0 || !!isLive);
  }
  const hint = $('map-match-hint');
  if (hint) {
    hint.textContent = live ? t('play.mapHintLive') : t('play.mapHint');
  }
}

async function refreshMapCounts() {
  if ($('screen-menu').classList.contains('hidden') || !state.user) return;
  try {
    const data = await api('/api/arenas');
    state.mapCounts = data.counts || {};
    state.arenaLive = data.live || {};
    state.arenaMax = data.maxPlayers || 12;
    renderMaps();
  } catch { /* offline or logged out */ }
}
setInterval(refreshMapCounts, 5000);

document.querySelectorAll('#difficulty-select .diff').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.diff = btn.dataset.diff;
    document.querySelectorAll('#difficulty-select .diff').forEach((b) => b.classList.toggle('selected', b === btn));
  });
});

const WEAPON_ART = {
  pistol: '<path d="M60 40 h70 v14 h-44 l-8 30 h-16 l6 -30 h-8z"/><path d="M84 54 q4 10 -4 12"/>',
  autorifle: '<path d="M14 42 h36 l6 -6 h82 v10 h14 v6 h-14 v8 h-46 l-8 28 h-14 l6 -28 h-18 l-6 22 h-12 l4 -22 h-30z"/><rect x="152" y="40" width="34" height="12" rx="3"/><rect x="66" y="22" width="40" height="12" rx="6"/><path d="M76 34 v4 M96 34 v4"/>',
  rpg: '<path d="M14 46 h120 v10 h-120z"/><path d="M14 44 l-10 -6 v26 l10 -6"/><path d="M134 42 h18 l30 9 l-30 9 h-18z"/><path d="M60 56 l-4 22 h10 l2 -22 M92 56 l-4 22 h10 l2 -22"/><rect x="70" y="32" width="18" height="12"/>',
  machinegun: '<path d="M10 40 h40 l6 -8 h110 v16 h24 v8 h-24 v8 h-66 l-8 26 h-14 l6 -26 h-34 v-8 h-40z"/><rect x="78" y="56" width="26" height="24"/><path d="M150 64 l-10 24 M156 64 l10 24"/>',
  sniper: '<path d="M6 46 h40 l10 -4 h90 v8 h48 v6 h-48 v4 h-80 l-8 24 h-14 l6 -24 h-44z"/><rect x="70" y="26" width="56" height="10" rx="5"/><path d="M84 36 v6 M112 36 v6"/>',
  smg: '<path d="M30 44 h70 v12 h-20 l-6 22 h-12 l4 -22 h-36z"/><path d="M30 50 h-16 v8 h10"/><rect x="70" y="30" width="28" height="10" rx="3"/>',
  shotgun: '<path d="M20 46 h90 v10 h-90z"/><path d="M110 44 h40 v14 h-40z"/><path d="M50 56 l-4 20 h12 l2 -20"/><rect x="70" y="34" width="16" height="8"/>',
  dmr: '<path d="M16 46 h100 v10 h-30 l-6 22 h-12 l4 -22 h-56z"/><rect x="140" y="44" width="30" height="12"/><rect x="70" y="28" width="40" height="10" rx="4"/>',
  revolver: '<path d="M50 46 h50 v12 h-14 v16 h-16 v-16 h-20z"/><circle cx="70" cy="52" r="10"/><path d="M50 50 h-14 v8 h8"/>',
  vector: '<path d="M36 40 h60 v16 h-18 l-4 20 h-12 l3 -20 h-29z"/><path d="M36 48 h-12 v8 h8"/><rect x="72" y="26" width="26" height="10" rx="2"/>',
  goldar: '<path d="M14 42 h36 l6 -6 h82 v10 h14 v6 h-14 v8 h-46 l-8 28 h-14 l6 -28 h-18 l-6 22 h-12 l4 -22 h-30z"/><rect x="152" y="40" width="34" height="12" rx="3"/><rect x="66" y="22" width="40" height="12" rx="6" fill="#c9a227" stroke="#c9a227"/>',
  antimaterial: '<path d="M4 48 h50 l12 -4 h80 v10 h56 v6 h-56 v4 h-70 l-8 22 h-14 l6 -22 h-56z"/><rect x="80" y="24" width="60" height="12" rx="5"/><path d="M96 36 v6 M124 36 v6"/>',
};

function weaponArt(id) {
  return `<svg viewBox="0 0 200 100" fill="none" stroke="#e9e4d8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${WEAPON_ART[id] || ''}</svg>`;
}

function stickArt(c) {
  const { body, limb, accent } = c.colors;
  return `<svg viewBox="0 0 100 100"><g stroke-linecap="round" fill="none">
    <circle cx="50" cy="20" r="10" fill="${body}" stroke="#000" stroke-width="2"/>
    <path d="M43 19 h14" stroke="${accent}" stroke-width="3"/>
    <path d="M50 30 v30" stroke="${body}" stroke-width="7"/>
    <path d="M50 36 l-16 16 M50 36 l16 16 M50 60 l-12 26 M50 60 l12 26" stroke="${limb}" stroke-width="5"/>
  </g></svg>`;
}

function flagArt(f) {
  if (!f.stripes) {
    return `<svg class="flag-art" viewBox="0 0 120 72"><rect width="120" height="72" fill="#2a2c30"/><text x="60" y="40" text-anchor="middle" fill="#888" font-size="14">NONE</text></svg>`;
  }
  const h = 72 / f.stripes.length;
  let svg = f.stripes.map((c, i) => `<rect y="${i * h}" width="120" height="${h + 1}" fill="${c}"/>`).join('');
  if (f.sun) svg += `<circle cx="60" cy="36" r="12" fill="${f.sun}"/>`;
  if (f.triangle) svg += `<path d="M0 0 L46 36 L0 72 Z" fill="${f.triangle}"/>`;
  if (f.mark) svg += `<circle cx="50" cy="36" r="14" fill="${f.mark}"/><circle cx="56" cy="36" r="11" fill="${f.stripes[0]}"/>`;
  return `<svg class="flag-art" viewBox="0 0 120 72">${svg}</svg>`;
}

function fmtIqd(n) {
  return `${Number(n).toLocaleString()} IQD`;
}

function statRows(w, all) {
  const max = (k) => Math.max(...Object.values(all).map((x) => x[k]));
  const dps = (x) => x.damage * x.fireRate;
  const maxDps = Math.max(...Object.values(all).map(dps));
  const rows = [
    ['Damage', w.damage / max('damage')],
    ['Fire rate', w.fireRate / max('fireRate')],
    ['DPS', dps(w) / maxDps],
    ['Accuracy', 1 - w.hipSpread / (max('hipSpread') * 1.1)],
    ['Range', Math.min(1, w.range / 120)],
    ['Reload', 1 - w.reloadTime / (max('reloadTime') * 1.1)],
  ];
  return rows.map(([k, v]) => `<span>${k}</span><div class="stat-bar"><i style="width:${Math.round(Math.max(0.05, v) * 100)}%"></i></div>`).join('');
}

function renderShops() {
  const u = state.user, C = state.catalog;
  if (!u) return;

  renderLoadoutSummary();

  $('weapon-grid').innerHTML = Object.values(C.weapons).map((w) => {
    const owned = u.ownedWeapons.includes(w.id);
    return `<div class="shop-item ${owned ? 'owned' : ''}">
      <div class="art">${weaponArt(w.id)}</div>
      <h4>${w.name}</h4>
      <p>${w.description}</p>
      <div class="stats">${statRows(w, C.weapons)}</div>
      <div class="stats"><span>Mag</span><span>${w.magSize} / ${w.reserve}</span><span>Reload</span><span>${w.reloadTime}s</span></div>
      <div class="price">
        ${owned ? `<span class="cost">${esc(t('shop.owned'))}</span>` : `<span class="cost"><i class="coin"></i>${w.cost.toLocaleString()}</span>`}
        ${owned ? '' : `<button class="btn small ${u.coins >= w.cost ? 'primary' : ''}" data-buy-weapon="${w.id}" ${u.coins < w.cost ? 'disabled' : ''}>${esc(t('shop.buy'))}</button>`}
      </div>
    </div>`;
  }).join('');

  $('cosmetic-grid').innerHTML = Object.values(C.cosmetics).map((c) => {
    const owned = u.ownedCosmetics.includes(c.id);
    const equipped = u.equippedCosmetic === c.id;
    let action;
    if (equipped) action = `<span class="cost">${esc(t('shop.equipped'))}</span>`;
    else if (owned) action = `<button class="btn small" data-equip="${c.id}">${esc(t('shop.equip'))}</button>`;
    else action = `<button class="btn small ${u.coins >= c.cost ? 'primary' : ''}" data-buy-cos="${c.id}" ${u.coins < c.cost ? 'disabled' : ''}>${esc(t('shop.buy'))}</button>`;
    return `<div class="shop-item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}" data-preview="${c.id}">
      <div class="art">${stickArt(c)}</div>
      <h4>${c.name}</h4>
      <p>${c.description}</p>
      <div class="swatches">${Object.values(c.colors).map((col) => `<i style="background:${col}"></i>`).join('')}</div>
      <div class="price">${owned ? `<span class="cost">${esc(t('shop.owned'))}</span>` : `<span class="cost"><i class="coin"></i>${c.cost}</span>`}${action}</div>
    </div>`;
  }).join('');

  const flags = C.flags || {};
  if ($('flag-grid')) {
    $('flag-grid').innerHTML = Object.values(flags).map((f) => {
      const owned = (u.ownedFlags || ['none']).includes(f.id);
      const equipped = (u.equippedFlag || 'none') === f.id;
      let action;
      if (equipped) action = `<span class="cost">${esc(t('shop.equipped'))}</span>`;
      else if (owned) action = `<button class="btn small" data-equip-flag="${f.id}">${esc(t('shop.equip'))}</button>`;
      else if (f.cost <= 0) action = `<button class="btn small" data-equip-flag="${f.id}">${esc(t('shop.equip'))}</button>`;
      else action = `<button class="btn small ${u.coins >= f.cost ? 'primary' : ''}" data-buy-flag="${f.id}" ${u.coins < f.cost ? 'disabled' : ''}>${esc(t('shop.buy'))}</button>`;
      return `<div class="shop-item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}" data-preview-flag="${f.id}">
        <div class="art">${flagArt(f)}</div>
        <h4>${esc(f.name)}</h4>
        <p>${esc(f.description)}</p>
        <div class="price">${owned || f.cost <= 0 ? `<span class="cost">${esc(t('shop.owned'))}</span>` : `<span class="cost"><i class="coin"></i>${f.cost}</span>`}${action}</div>
      </div>`;
    }).join('');
  }

  const buy = async (kind, id) => {
    try {
      const { user } = await api('/api/shop/buy', { kind, id });
      state.user = user;
      if (kind === 'weapon' && C.weapons[id].slot === 'primary' && !state.primary) state.primary = id;
      if (kind === 'cosmetic') {
        state.preview?.setCosmetic(C.cosmetics[id]);
        state.preview?.setFlag(C.flags[user.equippedFlag]);
        state.loPreview?.setCosmetic(C.cosmetics[id]);
        state.loPreview?.setFlag(C.flags[user.equippedFlag]);
      }
      if (kind === 'flag') {
        state.preview?.setFlag(C.flags[id]);
        state.loPreview?.setFlag(C.flags[id]);
      }
      const name = kind === 'weapon' ? C.weapons[id].name
        : kind === 'cosmetic' ? C.cosmetics[id].name
          : C.flags[id].name;
      toast(t('toast.bought', { name }));
      renderCoins();
      renderShops();
    } catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll('[data-buy-weapon]').forEach((b) => b.addEventListener('click', () => buy('weapon', b.dataset.buyWeapon)));
  document.querySelectorAll('[data-buy-cos]').forEach((b) => b.addEventListener('click', () => buy('cosmetic', b.dataset.buyCos)));
  document.querySelectorAll('[data-buy-flag]').forEach((b) => b.addEventListener('click', () => buy('flag', b.dataset.buyFlag)));
  document.querySelectorAll('[data-equip]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { user } = await api('/api/shop/equip', { id: b.dataset.equip });
      state.user = user;
      state.preview?.setCosmetic(C.cosmetics[user.equippedCosmetic]);
      state.preview?.setFlag(C.flags[user.equippedFlag]);
      state.loPreview?.setCosmetic(C.cosmetics[user.equippedCosmetic]);
      state.loPreview?.setFlag(C.flags[user.equippedFlag]);
      renderShops();
    } catch (err) { toast(err.message, true); }
  }));
  document.querySelectorAll('[data-equip-flag]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { user } = await api('/api/shop/equip-flag', { id: b.dataset.equipFlag });
      state.user = user;
      state.preview?.setFlag(C.flags[user.equippedFlag]);
      state.loPreview?.setFlag(C.flags[user.equippedFlag]);
      renderShops();
    } catch (err) { toast(err.message, true); }
  }));
  document.querySelectorAll('[data-preview]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      state.preview?.setCosmetic(C.cosmetics[el.dataset.preview]);
      state.preview?.setFlag(C.flags[state.user.equippedFlag]);
    });
    el.addEventListener('mouseleave', () => {
      state.preview?.setCosmetic(C.cosmetics[state.user.equippedCosmetic]);
      state.preview?.setFlag(C.flags[state.user.equippedFlag]);
    });
  });
  document.querySelectorAll('[data-preview-flag]').forEach((el) => {
    el.addEventListener('mouseenter', () => state.preview?.setFlag(C.flags[el.dataset.previewFlag]));
    el.addEventListener('mouseleave', () => state.preview?.setFlag(C.flags[state.user.equippedFlag]));
  });
}

async function renderCoinShop() {
  const C = state.catalog;
  if (!C?.coinPacks || !$('coin-pack-grid')) return;
  const packs = Object.values(C.coinPacks);
  const methods = Object.values(C.paymentMethods || {});
  $('coin-pack-grid').innerHTML = packs.map((p) => {
    const total = p.coins + (p.bonus || 0);
    const methodOpts = methods.map((m) => `<option value="${m.id}">${esc(m.name)} — ${esc(m.phone)}</option>`).join('');
    return `<div class="shop-item">
      <h4>${esc(p.name)}</h4>
      <p>${esc(p.description)}</p>
      <div class="price"><span class="cost"><i class="coin"></i>${total.toLocaleString()}</span><span class="iqd-price">${fmtIqd(p.iqd)}</span></div>
      <label class="sub" style="margin:0">${esc(t('coins.payMethod'))}
        <select data-pack-method="${p.id}">${methodOpts}</select>
      </label>
      <input data-pack-note="${p.id}" placeholder="${esc(t('coins.notePh'))}" maxlength="120" />
      <p class="pay-hint" data-pack-hint="${p.id}">${esc(methods[0]?.hint || '')}</p>
      <button class="btn small primary" data-order-pack="${p.id}">${esc(t('coins.request'))}</button>
    </div>`;
  }).join('');

  const syncHint = (packId) => {
    const sel = document.querySelector(`[data-pack-method="${packId}"]`);
    const hint = document.querySelector(`[data-pack-hint="${packId}"]`);
    const m = C.paymentMethods[sel?.value];
    if (hint && m) hint.textContent = `${m.name}: ${m.phone} — ${m.hint}`;
  };
  packs.forEach((p) => {
    syncHint(p.id);
    document.querySelector(`[data-pack-method="${p.id}"]`)?.addEventListener('change', () => syncHint(p.id));
  });
  document.querySelectorAll('[data-order-pack]').forEach((b) => b.addEventListener('click', async () => {
    const packId = b.dataset.orderPack;
    const methodId = document.querySelector(`[data-pack-method="${packId}"]`)?.value;
    const note = document.querySelector(`[data-pack-note="${packId}"]`)?.value || '';
    try {
      const { order } = await api('/api/shop/coin-order', { packId, methodId, note });
      toast(t('coins.orderCreated', { ref: order.refCode, iqd: fmtIqd(order.iqd), method: order.method.name }));
      renderCoinShop();
    } catch (err) { toast(err.message, true); }
  }));

  try {
    const { orders } = await api('/api/shop/coin-orders');
    $('coin-order-list').innerHTML = orders.length
      ? orders.map(formatOrderRow).join('')
      : `<p class="sub">${esc(t('coins.noOrders'))}</p>`;
  } catch {
    $('coin-order-list').innerHTML = `<p class="sub">${esc(t('coins.loadFail'))}</p>`;
  }
}

// ---------------------------------------------------------------- preview
class Preview {
  constructor(canvas, { captionId = 'preview-name', menuGate = true } = {}) {
    this.canvas = canvas;
    this.captionId = captionId;
    this.menuGate = menuGate;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a3036');
    this.scene.fog = new THREE.Fog('#3a4248', 12, 28);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.25, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.AmbientLight('#e8e4dc', 0.7));
    this.scene.add(new THREE.HemisphereLight('#f0ece4', '#5a5448', 2.4));
    const key = new THREE.DirectionalLight('#fff4e6', 3.0);
    key.position.set(-3, 5, 2);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#c8d0d8', 1.4);
    fill.position.set(2, 2, 4);
    this.scene.add(fill);
    this.renderer.toneMappingExposure = 1.35;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.9 }));
    ped.position.y = -0.06;
    ped.receiveShadow = true;
    ped.add(new THREE.LineSegments(new THREE.EdgesGeometry(ped.geometry, 30), new THREE.LineBasicMaterial({ color: '#000' })));
    this.scene.add(ped);
    this.man = new Stickman(null);
    this.man.root.rotation.y = Math.PI * 0.8;
    this.scene.add(this.man.root);
    enhanceOperatorMaterials(this.man, resolveGraphicsConfig(settings.quality).operatorPbr);
    this.clock = new THREE.Clock();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }
  setCosmetic(c) {
    if (!c) return;
    this.man.setCosmetic(c);
    const cap = $(this.captionId);
    if (cap) cap.textContent = c.name;
    if (this.captionId !== 'preview-name') $('preview-name').textContent = c.name;
    if (this.captionId !== 'lo-preview-name') $('lo-preview-name').textContent = c.name;
  }
  setFlag(f) { this.man.setFlag(f || { id: 'none' }); }
  setWeapon(id) { this.man.setWeapon(id); }
  frame() {
    if (this.menuGate && $('screen-menu').classList.contains('hidden')) return;
    if (this.captionId === 'lo-preview-name' && !$('panel-loadout').classList.contains('active')) return;
    const dt = this.clock.getDelta();
    this.man.root.rotation.y += dt * 0.4;
    this.man.update(dt, { speed: 0, pitch: Math.sin(this.clock.elapsedTime * 0.8) * 0.05 });
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- loadout
/** Weapon ids for the chosen class: [primary, secondary]; the pistol stands in when nothing else is owned. */
function loadoutIds() {
  const u = state.user, W = state.catalog.weapons;
  const primary = state.primary && W[state.primary]?.slot === 'primary' && u.ownedWeapons.includes(state.primary) ? state.primary : null;
  const secondary = state.secondary && W[state.secondary]?.slot === 'secondary' && u.ownedWeapons.includes(state.secondary) ? state.secondary : 'pistol';
  if (primary) return [primary, secondary];
  return secondary === 'pistol' ? ['pistol'] : ['pistol', secondary];
}

function renderLoadoutSummary() {
  const C = state.catalog, u = state.user;
  if (!u) return;
  const names = loadoutIds().map((id) => C.weapons[id].name).join(' + ');
  $('loadout-summary').textContent = t('lo.summary', {
    names,
    lethal: C.equipment[state.lethal].name,
    perk: C.perks?.[state.perk]?.name || '',
    cosmetic: C.cosmetics[u.equippedCosmetic]?.name || '',
  });
}

function loCard(attrs, art, title, sub, { selected, locked, lockText } = {}) {
  return `<button class="lo-card ${selected ? 'selected' : ''}" ${attrs} ${locked ? 'disabled' : ''}>
    ${locked ? `<span class="lock">${lockText}</span>` : ''}<div class="art">${art}</div><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
}

const LETHAL_ART = {
  frag: '<svg viewBox="0 0 100 100" fill="none" stroke="#e9e4d8" stroke-width="4"><ellipse cx="46" cy="60" rx="22" ry="26"/><rect x="36" y="24" width="20" height="12"/><path d="M56 28 q20 0 22 22"/></svg>',
  molotov: '<svg viewBox="0 0 100 100" fill="none" stroke="#e9e4d8" stroke-width="4"><path d="M38 88 h24 v-40 l-6 -10 v-14 h-12 v14 l-6 10 z"/><path d="M50 22 q-8 -10 2 -18 q2 10 8 6 q2 8 -10 12" stroke="#e8b04a"/></svg>',
};

function renderLoadout() {
  const u = state.user, C = state.catalog, W = C.weapons;
  const kind = state.pendingKind;
  const map = C.maps.find((m) => m.id === state.mapId) || C.maps[0];
  $('lo-context').textContent = kind === 'sp'
    ? t('lo.ctxSp', { diff: `${mapLabel(map)} · ${t(`diff.${state.diff}`)}` })
    : t('lo.ctxMp', { mode: `${state.mpMode === 'tdm' ? t('mp.tdm') : t('mp.ffa')} · ${mapLabel(map)}` });
  const ids = loadoutIds();
  $('lo-outfits').innerHTML = Object.values(C.cosmetics).map((c) => {
    const owned = u.ownedCosmetics.includes(c.id);
    return loCard(`data-cos="${c.id}"`, stickArt(c), c.name, owned ? '' : `${c.cost} coins in the Wardrobe`,
      { selected: u.equippedCosmetic === c.id, locked: !owned, lockText: 'LOCKED' });
  }).join('');
  const weaponCard = (w, slot) => {
    const owned = u.ownedWeapons.includes(w.id);
    const sub = `DMG ${w.damage} · ${w.magSize}/${w.reserve} · ${w.reloadTime}s reload`;
    return loCard(`data-${slot}="${w.id}"`, weaponArt(w.id), w.name, owned ? sub : `${w.cost} coins in the Armory`,
      { selected: ids.includes(w.id) && (slot === 'secondary' || ids[0] === w.id), locked: !owned, lockText: 'LOCKED' });
  };
  $('lo-primary').innerHTML = Object.values(W).filter((w) => w.slot === 'primary').map((w) => weaponCard(w, 'primary')).join('')
    + loCard('data-primary=""', '', 'None', 'Pistol only', { selected: !ids.some((id) => W[id].slot === 'primary') });
  $('lo-secondary').innerHTML = Object.values(W).filter((w) => w.slot === 'secondary').map((w) => weaponCard(w, 'secondary')).join('');
  $('lo-lethal').innerHTML = Object.values(C.equipment).filter((e) => e.lethal).map((e) => loCard(`data-lethal="${e.id}"`, LETHAL_ART[e.id] || '', e.name,
    e.id === 'frag' ? 'Bounces, explodes after 2.5 s' : `Bursts into a ${e.radius} m fire for ${e.duration} s`, { selected: state.lethal === e.id })).join('');
  const PERK_ART = {
    doubletime: '<svg viewBox="0 0 100 100" fill="none" stroke="#e9e4d8" stroke-width="4"><path d="M20 70 h60 M30 70 l20 -40 l20 40"/><path d="M40 50 h20"/></svg>',
    quickfix: '<svg viewBox="0 0 100 100" fill="none" stroke="#e9e4d8" stroke-width="4"><path d="M50 18 v64 M28 40 h44"/><circle cx="50" cy="50" r="28"/></svg>',
    trophy: '<svg viewBox="0 0 100 100" fill="none" stroke="#e9e4d8" stroke-width="4"><path d="M30 28 h40 v18 a20 20 0 0 1 -40 0 z"/><path d="M30 34 h-10 a16 16 0 0 0 16 16 M70 34 h10 a16 16 0 0 1 -16 16"/><path d="M42 66 h16 v12 h-16 z"/></svg>',
  };
  $('lo-perk').innerHTML = Object.values(C.perks || {}).map((p) => loCard(`data-perk="${p.id}"`, PERK_ART[p.id] || '', p.name, p.description,
    { selected: state.perk === p.id })).join('');
}

function openLoadout(kind) {
  audio.ui();
  state.pendingKind = kind;
  renderLoadout();
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-loadout'));
  $('lo-deploy').textContent = kind === 'sp' ? t('lo.start') : state.mpMode === 'tdm' ? t('play.joinTdm') : t('play.joinFfa');
  if (!state.loPreview) state.loPreview = new Preview($('lo-preview-canvas'), { captionId: 'lo-preview-name', menuGate: false });
  const c = state.catalog.cosmetics[state.user.equippedCosmetic];
  state.preview?.setCosmetic(c);
  state.preview?.setFlag(state.catalog.flags?.[state.user.equippedFlag]);
  state.preview?.setWeapon(loadoutIds()[0]);
  state.loPreview.setCosmetic(c);
  state.loPreview.setFlag(state.catalog.flags?.[state.user.equippedFlag]);
  state.loPreview.setWeapon(loadoutIds()[0]);
}

$('panel-loadout').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const C = state.catalog;
  if (b.dataset.cos !== undefined) {
    if (b.dataset.cos === state.user.equippedCosmetic) return;
    try {
      const { user } = await api('/api/shop/equip', { id: b.dataset.cos });
      state.user = user;
      state.preview?.setCosmetic(C.cosmetics[user.equippedCosmetic]);
      state.preview?.setFlag(C.flags[user.equippedFlag]);
      state.loPreview?.setCosmetic(C.cosmetics[user.equippedCosmetic]);
      state.loPreview?.setFlag(C.flags[user.equippedFlag]);
    } catch (err) { toast(err.message, true); }
  } else if (b.dataset.primary !== undefined) {
    state.primary = b.dataset.primary || null;
    localStorage.setItem('fps_primary', state.primary || '');
  } else if (b.dataset.secondary !== undefined) {
    state.secondary = b.dataset.secondary;
    localStorage.setItem('fps_secondary', state.secondary);
  } else if (b.dataset.lethal !== undefined) {
    state.lethal = b.dataset.lethal;
    localStorage.setItem('fps_lethal', state.lethal);
  } else if (b.dataset.perk !== undefined) {
    state.perk = b.dataset.perk;
    localStorage.setItem('fps_perk', state.perk);
  } else {
    return;
  }
  audio.ui();
  state.preview?.setWeapon(loadoutIds()[0]);
  state.loPreview?.setWeapon(loadoutIds()[0]);
  renderLoadout();
  renderLoadoutSummary();
  renderShops();
});
$('lo-back').addEventListener('click', () => document.querySelector('[data-panel="play"]').click());
$('lo-deploy').addEventListener('click', () => startGame(state.pendingKind));

// ---------------------------------------------------------------- game
async function startGame(kind) {
  const u = state.user, C = state.catalog;
  audio.ensure();
  show('screen-game');
  if (!state.game) {
    state.game = new Game({
      canvas: $('game-canvas'), stage: $('stage'), catalog: C, socket: state.socket,
      onExit: exitGame,
      onCoins: (payload) => {
        if (payload && typeof payload === 'object') applyCoinPayload(payload);
        else if (state.user) { state.user.coins = payload; renderCoins(); }
      },
    });
  }
  const g = state.game;
  g.socket = state.socket;
  g.resize();
  const loadout = loadoutIds();
  const cosmetic = C.cosmetics[u.equippedCosmetic] || C.cosmetics.classic;
  const mode = kind === 'sp'
    ? new SinglePlayerMode(g, state.diff, state.mapId, state.weather)
    : new MultiplayerMode(g, loadout, state.mapId, state.mpMode, state.lethal, state.perk, state.weather);
  if (kind === 'mp' && state.inviteToken) {
    mode.inviteToken = state.inviteToken;
    state.inviteToken = null;
  }
  $('pause-settings').classList.add('hidden');
  try {
    await g.start(mode, { loadout, cosmetic, user: u, lethal: state.lethal, perk: state.perk });
  } catch (err) {
    toast(err.message || t('toast.startFail'), true);
    exitGame();
  }
}

async function exitGame() {
  state.game?.stop();
  try {
    const { user } = await api('/api/me');
    state.user = user;
  } catch { /* keep cached */ }
  renderCoins();
  renderShops();
  show('screen-menu');
  refreshMapCounts();
}

$('play-sp').addEventListener('click', () => openLoadout('sp'));
$('play-mp').addEventListener('click', () => openLoadout('mp'));
$('click-to-play').addEventListener('click', () => state.game?.requestLock());
$('resume-btn').addEventListener('click', () => state.game?.requestLock());
$('quit-btn').addEventListener('click', exitGame);
$('results-btn').addEventListener('click', exitGame);

// ---------------------------------------------------------------- friends / party
let friendSearchTimer = null;

function friendAvatar(other) {
  if (other?.avatarUrl) {
    return `<img class="av" src="${esc(other.avatarUrl)}" alt="" width="36" height="36" />`;
  }
  const letter = (other?.username || '?').slice(0, 1).toUpperCase();
  return `<span class="av placeholder">${esc(letter)}</span>`;
}

function modeLabelShort(mode) {
  return mode === 'tdm' ? t('mp.tdm') : t('mp.ffa');
}

function bindFriendListActions(root = document) {
  root.querySelectorAll('[data-friend-accept]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/friends/respond', { id: Number(b.dataset.friendAccept), accept: true });
      toast(t('friends.accepted'));
      loadFriends();
      searchFriends(true);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-friend-decline]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('/api/friends/respond', { id: Number(b.dataset.friendDecline), accept: false });
      loadFriends();
      searchFriends(true);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-friend-remove]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/friends/${b.dataset.friendRemove}`, undefined, 'DELETE');
      loadFriends();
      searchFriends(true);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelectorAll('[data-friend-invite]').forEach((b) => b.addEventListener('click', () => {
    inviteFriend(Number(b.dataset.friendInvite), b);
  }));
  root.querySelectorAll('[data-friend-add]').forEach((b) => b.addEventListener('click', async () => {
    const username = b.dataset.friendAdd;
    try {
      const res = await api('/api/friends/request', { username });
      const name = res.friendship?.other?.username || username;
      toast(res.autoAccepted ? t('friends.autoAccepted', { name }) : t('friends.requestSent', { name }));
      loadFriends();
      searchFriends(true);
    } catch (e) { toast(e.message, true); }
  }));
}

function renderFriendRows(el, rows, { emptyKey, kind }) {
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<p class="sub">${esc(t(emptyKey))}</p>`;
    return;
  }
  el.innerHTML = rows.map((f) => {
    const o = f.other || f;
    const arena = f.inArena
      ? `<span class="arena-tag">${esc(t('friends.inArena', { map: f.inArena.mapName, mode: modeLabelShort(f.inArena.mode) }))}</span>`
      : '';
    const status = `<span><i class="status-dot ${f.online ? 'on' : ''}"></i>${esc(f.online ? t('friends.online') : t('friends.offline'))}</span>`;
    let actions = '';
    if (kind === 'incoming') {
      actions = `<button class="btn small primary" data-friend-accept="${f.id}">${esc(t('friends.accept'))}</button>
        <button class="btn small ghost" data-friend-decline="${f.id}">${esc(t('friends.decline'))}</button>`;
    } else if (kind === 'friend') {
      actions = `<button class="btn small primary" data-friend-invite="${o.id}" ${f.online ? '' : 'disabled'} title="${esc(t('friends.invitePlay'))}">${esc(t('friends.invite'))}</button>
        <button class="btn small ghost" data-friend-remove="${o.id}">${esc(t('friends.remove'))}</button>`;
    } else if (kind === 'search') {
      if (f.relation === 'friends') {
        actions = `<button class="btn small primary" data-friend-invite="${o.id}" ${f.online ? '' : 'disabled'}>${esc(t('friends.invite'))}</button>
          <span class="friend-rel">${esc(t('friends.already'))}</span>`;
      } else if (f.relation === 'outgoing') {
        actions = `<span class="friend-rel">${esc(t('friends.pendingOut'))}</span>`;
      } else if (f.relation === 'incoming') {
        actions = `<button class="btn small primary" data-friend-accept="${f.friendshipId}">${esc(t('friends.accept'))}</button>
          <button class="btn small ghost" data-friend-decline="${f.friendshipId}">${esc(t('friends.decline'))}</button>`;
      } else {
        actions = `<button class="btn small primary" data-friend-add="${esc(o.username)}">${esc(t('friends.addBtn'))}</button>`;
      }
    }
    return `<div class="friend-row">
      <div class="who">${friendAvatar(o)}<div class="meta"><b>${esc(o.username || '')}</b>${status}${arena}</div></div>
      <div class="actions">${actions}</div>
    </div>`;
  }).join('');
  bindFriendListActions(el);
}

async function searchFriends(force = false) {
  const input = $('friend-user');
  const box = $('friend-search-results');
  if (!input || !box) return;
  const q = input.value.trim();
  if (q.length < 1) {
    box.innerHTML = `<p class="sub">${esc(t('friends.searchEmpty'))}</p>`;
    return;
  }
  box.innerHTML = `<p class="sub">${esc(t('friends.searching'))}</p>`;
  try {
    const { results } = await api(`/api/friends/search?q=${encodeURIComponent(q)}`);
    if (!results?.length) {
      box.innerHTML = `<p class="sub">${esc(t('friends.searchNone', { q }))}</p>`;
      return;
    }
    renderFriendRows(box, results, { emptyKey: 'friends.searchNone', kind: 'search' });
  } catch (e) {
    box.innerHTML = `<p class="sub">${esc(e.message)}</p>`;
  }
}

function scheduleFriendSearch() {
  clearTimeout(friendSearchTimer);
  friendSearchTimer = setTimeout(() => searchFriends(), 220);
}

async function loadFriends() {
  try {
    const data = await api('/api/friends');
    renderFriendRows($('friends-list'), data.friends || [], { emptyKey: 'friends.empty', kind: 'friend' });
    renderFriendRows($('friends-incoming'), data.incoming || [], { emptyKey: 'friends.noneIncoming', kind: 'incoming' });
    renderFriendRows($('friends-outgoing'), data.outgoing || [], { emptyKey: 'friends.noneOutgoing', kind: 'outgoing' });
    if (($('friend-user')?.value || '').trim()) searchFriends(true);
    else if ($('friend-search-results')) {
      $('friend-search-results').innerHTML = `<p class="sub">${esc(t('friends.searchEmpty'))}</p>`;
    }
  } catch (e) {
    toast(e.message, true);
  }
}

function inviteFriend(toUserId, btn) {
  const sock = state.socket;
  if (!sock?.connected) return toast(t('toast.session'), true);
  if (btn) btn.disabled = true;
  sock.emit('friends:invite', {
    toUserId,
    mapId: state.mapId,
    mode: state.mpMode,
  }, (res) => {
    if (btn) btn.disabled = false;
    if (!res?.ok) return toast(res?.error || t('toast.startFail'), true);
    const name = btn?.closest('.friend-row')?.querySelector('b')?.textContent || '';
    toast(t('friends.inviteSent', { name }));
    // If you're not in a match yet, open multiplayer loadout so you can deploy into the same lobby.
    if ($('screen-menu') && !$('screen-menu').classList.contains('hidden')
      && !$('panel-loadout')?.classList.contains('active')) {
      openLoadout('mp');
    }
  });
}

let partyInviteTimer;
function hidePartyInvite() {
  state.pendingInvite = null;
  $('party-invite')?.classList.add('hidden');
  clearTimeout(partyInviteTimer);
}

function showPartyInvite(d) {
  if (!d?.token) return;
  state.pendingInvite = d;
  const el = $('party-invite');
  const text = $('party-invite-text');
  if (!el || !text) return;
  const map = d.mapName || d.mapId;
  const mode = modeLabelShort(d.mode);
  text.textContent = d.inArena
    ? t('friends.inviteBannerArena', {
      name: d.from?.username || '?', map, mode, count: d.count || 0, max: d.max || 12,
    })
    : t('friends.inviteBanner', { name: d.from?.username || '?', map, mode });
  el.classList.remove('hidden');
  clearTimeout(partyInviteTimer);
  partyInviteTimer = setTimeout(hidePartyInvite, (d.expiresIn || 120) * 1000);
}

async function acceptPartyInvite() {
  const inv = state.pendingInvite;
  if (!inv?.token) return hidePartyInvite();
  state.inviteToken = inv.token;
  if (inv.mapId) {
    state.mapId = inv.mapId;
    localStorage.setItem('fps_map', inv.mapId);
  }
  if (inv.mode === 'tdm' || inv.mode === 'ffa') {
    state.mpMode = inv.mode;
    localStorage.setItem('fps_mpmode', inv.mode);
    renderMpMode();
  }
  hidePartyInvite();
  if (!$('screen-menu').classList.contains('hidden')) {
    openLoadout('mp');
    return;
  }
  await exitGame();
  openLoadout('mp');
}

$('friend-add-btn')?.addEventListener('click', async () => {
  const username = ($('friend-user')?.value || '').trim();
  if (!username) return;
  try {
    const res = await api('/api/friends/request', { username });
    const name = res.friendship?.other?.username || username;
    toast(res.autoAccepted ? t('friends.autoAccepted', { name }) : t('friends.requestSent', { name }));
    loadFriends();
    searchFriends(true);
  } catch (e) { toast(e.message, true); }
});
$('friend-user')?.addEventListener('input', () => scheduleFriendSearch());
$('friend-user')?.addEventListener('focus', () => scheduleFriendSearch());
$('friend-user')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstAdd = $('friend-search-results')?.querySelector('[data-friend-add]');
    if (firstAdd) firstAdd.click();
    else $('friend-add-btn')?.click();
  }
});
$('party-invite-accept')?.addEventListener('click', () => { audio.ui(); acceptPartyInvite(); });
$('party-invite-decline')?.addEventListener('click', () => { audio.ui(); hidePartyInvite(); });

// ---------------------------------------------------------------- keybinds
let listeningAction = null;
let listenHandler = null;
let bindsEditMode = false;

function stopListening() {
  listeningAction = null;
  if (listenHandler) {
    window.removeEventListener('keydown', listenHandler, true);
    listenHandler = null;
  }
  document.querySelectorAll('.bind-btn.listening').forEach((b) => b.classList.remove('listening'));
}

function beginListen(action, btn) {
  if (listeningAction === action) {
    stopListening();
    renderKeybinds();
    return;
  }
  stopListening();
  listeningAction = action;
  bindsEditMode = true;
  $('panel-controls')?.classList.add('editing');
  $('binds-edit-toggle')?.classList.add('is-on');
  btn.classList.add('listening');
  btn.textContent = t('bind.listening');
  listenHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      stopListening();
      renderKeybinds();
      return;
    }
    if (isBlockedCode(e.code)) return;
    setBind(action, e.code);
    stopListening();
    toast(t('bind.changed', { action: t(BIND_ROWS.find((r) => r.action === action)?.labelKey || action), key: formatCode(e.code) }));
    renderKeybinds();
  };
  window.addEventListener('keydown', listenHandler, true);
}

function renderKeybinds() {
  const list = $('keybind-list');
  if (!list) return;
  const wasListening = listeningAction;
  stopListening();
  $('panel-controls')?.classList.toggle('editing', bindsEditMode);
  $('binds-edit-toggle')?.classList.toggle('is-on', bindsEditMode);
  if ($('binds-edit-toggle')) {
    $('binds-edit-toggle').textContent = bindsEditMode ? t('bind.editDone') : t('bind.edit');
  }
  list.innerHTML = BIND_ROWS.map(({ action, labelKey }) => {
    const code = binds[action];
    const label = formatCode(code);
    return `<div class="keybind-row" data-action="${action}">
      <button type="button" class="bind-btn ${code ? '' : 'unbound'}" data-bind="${action}" title="${esc(t('bind.clickChange'))}">${esc(code ? label : '—')}</button>
      <span class="bind-label">${esc(t(labelKey))}</span>
      <span class="bind-edit-tag">${esc(t('bind.clickChange'))}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-bind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.ui();
      beginListen(btn.dataset.bind, btn);
    });
  });
  if (wasListening) {
    const btn = list.querySelector(`[data-bind="${wasListening}"]`);
    if (btn) beginListen(wasListening, btn);
  }
}

$('binds-edit-toggle')?.addEventListener('click', () => {
  audio.ui();
  bindsEditMode = !bindsEditMode;
  if (!bindsEditMode) stopListening();
  renderKeybinds();
  if (bindsEditMode) toast(t('bind.editHint'));
});

$('binds-reset')?.addEventListener('click', () => {
  audio.ui();
  stopListening();
  resetKeybinds();
  renderKeybinds();
  toast(t('bind.resetDone'));
});
onKeybinds(() => {
  if ($('panel-controls')?.classList.contains('active')) renderKeybinds();
});
renderKeybinds();

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    state.catalog = await api('/api/catalog');
  } catch {
    document.body.innerHTML = '<p style="padding:40px">Server unreachable. Is it running?</p>';
    return;
  }
  try {
    const { user } = await api('/api/me');
    enterMenu(user);
  } catch {
    show('screen-auth');
  }
})();

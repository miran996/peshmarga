import { t } from '../i18n.js';
import { binds, formatCode } from '../keybinds.js';

const $ = (id) => document.getElementById(id);

const KIND_COLORS = {
  wall: '#cfc6b4', boundary: '#6b6e73', car: '#8a6a58', bus: '#8f8458', container: '#6d8190', barrier: '#a5a29a',
  sandbag: '#9a8a66', crate: '#8a6e4a', rubble: '#7d776d', tree: '#3a302b', pole: '#3a302b',
  platform: '#9a8570', pillar: '#6a5a4a', stair: '#9a8570', rail: '#6a5a4a',
  rack: '#8c8f93', crane: '#c7792b', rock: '#8a7a66', tent: '#8f8a6a', foliage: '#2e4a38', log: '#6a4d36',
  bunker: '#9aa0a6', barrel: '#8a4a2a',
};

/** Top-down drawing of a map at `ppm` pixels per metre. */
export function drawMapImage(map, ppm, canvas = document.createElement('canvas')) {
  const size = Math.round(map.SIZE * ppm);
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const h = map.HALF;
  g.fillStyle = map.theme.radarBg;
  g.fillRect(0, 0, size, size);
  g.fillStyle = map.theme.radarRoad;
  for (const r of map.roads) g.fillRect((r.x - r.w / 2 + h) * ppm, (r.z - r.d / 2 + h) * ppm, r.w * ppm, r.d * ppm);
  const order = map.boxes.slice().sort((a, b) => a.maxY - b.maxY);
  for (const b of order) {
    if (b.kind === 'boundary') continue;
    g.fillStyle = KIND_COLORS[b.kind] || '#888';
    g.fillRect((b.minX + h) * ppm, (b.minZ + h) * ppm, Math.max(1, b.w * ppm), Math.max(1, b.d * ppm));
  }
  g.strokeStyle = '#d9a52b';
  g.lineWidth = Math.max(1, ppm * 0.75);
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, size - g.lineWidth, size - g.lineWidth);
  return canvas;
}

export class Hud {
  constructor(map) {
    this.el = {
      health: $('health-fill'), dmgOverlay: $('damage-overlay'), dmgInd: $('damage-indicators'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), scope: $('scope'),
      ammoWrap: $('ammo'), mag: $('ammo-mag'), res: $('ammo-res'), wName: $('weapon-name'), slots: $('weapon-slots'),
      reloadHint: $('reload-hint'), killfeed: $('killfeed'), center: $('center-msg'), coinPop: $('coin-pop'),
      coins: $('hud-coin-val'), scoreYou: $('score-you'), scoreGoal: $('score-goal'), timer: $('timer'), modeLabel: $('mode-label'),
      scoreboard: $('scoreboard'), sbBody: $('scoreboard-body'),
      death: $('death-screen'), killer: $('killer-name'), respawn: $('respawn-timer'),
      radar: $('radar'), fps: $('fps'), streaks: $('streaks'), grenades: $('grenade-count'),
      grenadeWarn: $('grenade-warn'), uav: $('uav-tag'), chatLog: $('chat-log'), chatEntry: $('chat-entry'),
      chatInput: $('chat-input'), chatScope: $('chat-scope'), roundEnd: $('round-end'), scoreLine: $('score-line'),
      lethalName: $('lethal-name'), perkName: $('perk-name'), trophy: $('trophy-tag'),
      acog: $('acog'), reddot: $('reddot'), holo: $('holo'),
    };
    this.radarCtx = this.el.radar.getContext('2d');
    this.hitT = 0;
    this.setMap(map);
  }

  setMap(map) {
    this.map = map;
    this.mapImg = { canvas: drawMapImage(map, 4), ppm: 4 };
  }

  drawRadar(player, yaw, blips, range = 45) {
    const ctx = this.radarCtx;
    const W = this.el.radar.width, R = W / 2;
    const scale = R / range;
    const { canvas, ppm } = this.mapImg;
    const h = this.map.HALF;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(R, R);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(canvas, -(player.x + h), -(player.z + h), canvas.width / ppm, canvas.height / ppm);
    ctx.globalAlpha = 1;
    for (const b of blips) {
      const dx = b.x - player.x, dz = b.z - player.z;
      if (dx * dx + dz * dz > range * range * 1.2) continue;
      ctx.fillStyle = b.color || '#e0362c';
      ctx.globalAlpha = b.alpha ?? 1;
      ctx.beginPath();
      ctx.arc(dx, dz, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e9e4d8';
    ctx.beginPath();
    ctx.moveTo(R, R - 7); ctx.lineTo(R + 5, R + 6); ctx.lineTo(R, R + 3); ctx.lineTo(R - 5, R + 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(233,228,216,0.15)';
    ctx.lineWidth = 1;
    for (const r of [R * 0.33, R * 0.66]) { ctx.beginPath(); ctx.arc(R, R, r, 0, Math.PI * 2); ctx.stroke(); }
  }

  setHealth(hp) {
    const p = Math.max(0, hp) / 100;
    this.el.health.style.width = `${p * 100}%`;
    this.el.health.style.background = p < 0.35 ? '#d8433b' : '#e9e4d8';
    this.el.dmgOverlay.style.opacity = String(Math.max(0, (0.75 - p) * 1.3));
  }

  setAmmo(name, mag, reserve, magSize) {
    this.el.wName.textContent = name;
    this.el.mag.textContent = mag;
    this.el.res.textContent = `/ ${reserve}`;
    this.el.ammoWrap.classList.toggle('low', mag <= Math.ceil(magSize * 0.25));
  }

  setSlots(slots, active) {
    this.el.slots.innerHTML = slots.map((s, i) => `<span class="${i === active ? 'active' : ''}">${i + 1} ${s}</span>`).join('');
  }

  setReloadHint(show, text) {
    this.el.reloadHint.classList.toggle('hidden', !show);
    this.el.reloadHint.textContent = text || t('hud.reloadKey', { key: formatCode(binds.reload) });
  }

  setCrosshair(gapEm, visible) {
    const c = this.el.crosshair;
    c.style.opacity = visible ? '1' : '0';
    const g = Math.max(0.35, gapEm);
    const [t, b, l, r] = c.children;
    t.style.top = `${-g - 0.9}em`;
    b.style.top = `${g}em`;
    l.style.left = `${-g - 0.9}em`;
    r.style.left = `${g}em`;
  }

  setScope(v) { this.setOptic(v ? 'scope' : null); }

  /** Shows one optic overlay (scope | acog | reddot | holo) or none. Hides hip crosshair while any optic is up. */
  setOptic(kind) {
    const map = { scope: this.el.scope, acog: this.el.acog, reddot: this.el.reddot, holo: this.el.holo };
    for (const [k, el] of Object.entries(map)) el.classList.toggle('hidden', k !== kind);
    this.el.crosshair.style.opacity = kind ? '0' : '';
  }

  hitmarker(head, kill) {
    const h = this.el.hitmarker;
    h.classList.toggle('head', !!head && !kill);
    h.classList.toggle('kill', !!kill);
    h.style.transition = 'none';
    h.style.opacity = '1';
    h.style.transform = kill ? 'scale(1.35)' : 'scale(1)';
    this.hitT = kill ? 0.35 : 0.2;
  }

  damageFrom(angle) {
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dmgInd.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  /** killerCls / victimCls: optional 'friendly' | 'enemy' colouring for team modes. */
  killfeed(killer, victim, weapon, head, killerIsMe, victimIsMe, killerCls = '', victimCls = '') {
    const d = document.createElement('div');
    d.className = 'kf';
    const k = killer ? `<span class="${killerIsMe ? 'me' : killerCls}">${esc(killer)}</span>` : '';
    d.innerHTML = `${k}<span class="w">[${esc(weapon)}]</span><span class="${victimIsMe ? 'me' : victimCls}">${esc(victim)}</span>${head ? `<span class="hs">${esc(t('hud.headshot'))}</span>` : ''}`;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.remove(), 5800);
  }

  message(text, sub = '') {
    this.el.center.innerHTML = `<div class="msg">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  }

  coinPop(amount) {
    const d = document.createElement('div');
    d.className = 'coin-pop';
    d.textContent = t('hud.coinsPop', { n: amount });
    this.el.coinPop.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  setCoins(v) { this.el.coins.textContent = Number(v).toLocaleString(); }

  setScore(label, you, goal, timer) {
    this.el.scoreLine.className = 'score-line';
    this.el.scoreLine.children[1].textContent = '/';
    this.el.modeLabel.textContent = label;
    this.el.scoreYou.textContent = you;
    this.el.scoreGoal.textContent = goal;
    this.el.timer.textContent = timer;
  }

  /** Team scores: own team on the left in its colour. */
  setTeamScore(label, mine, theirs, myTeam, timer) {
    this.el.scoreLine.className = `score-line teams mine-${myTeam}`;
    this.el.scoreLine.children[1].textContent = '–';
    this.el.modeLabel.textContent = label;
    this.el.scoreYou.textContent = mine;
    this.el.scoreGoal.textContent = theirs;
    this.el.timer.textContent = timer;
  }

  /** rows: { name, kills, deaths, me, alive, team? }. With `teams` the table is split into two sections. */
  setScoreboard(visible, rows, teams = null) {
    this.el.scoreboard.classList.toggle('hidden', !visible);
    if (!visible) return;
    const row = (r) => `<tr class="${r.me ? 'me' : ''} ${r.alive === false ? 'dead' : ''}"><td>${esc(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`;
    if (!teams) {
      this.el.sbBody.innerHTML = rows.map(row).join('');
      return;
    }
    this.el.sbBody.innerHTML = teams.map((t) => `<tr class="team-head ${t.id}"><td>${esc(t.label)}</td><td colspan="2">${t.score}</td></tr>`
      + rows.filter((r) => r.team === t.id).map(row).join('')).join('');
  }

  showDeath(killer, seconds) {
    this.el.death.classList.remove('hidden');
    this.el.killer.textContent = killer || t('hud.battlefield');
    this.setRespawn(seconds);
  }

  setFps(fps) {
    this.el.fps.classList.toggle('hidden', fps == null);
    if (fps != null) this.el.fps.textContent = `${Math.round(fps)} FPS`;
  }

  /** streak: current kills in a row; rewards: { uav: bool, airstrike: bool }; defs: catalog.killstreaks. */
  setStreaks(streak, rewards, defs, uavLeft = 0) {
    const html = Object.values(defs).map((k) => {
      const thresholds = Array.isArray(k.kills) ? k.kills : [k.kills];
      const next = thresholds.find((n) => n > streak) ?? thresholds[thresholds.length - 1];
      const ready = !!rewards[k.id];
      const active = k.id === 'uav' && uavLeft > 0;
      const state = active ? 'active' : ready ? 'ready' : '';
      const sub = active ? `${Math.ceil(uavLeft)}s` : ready ? `Press ${k.key}` : `${Math.min(streak, next)} / ${next}`;
      return `<div class="streak ${state}"><kbd>${k.key}</kbd><b>${esc(k.name)}</b><small>${sub}</small></div>`;
    }).join('');
    if (html !== this.lastStreakHtml) {
      this.el.streaks.innerHTML = html;
      this.lastStreakHtml = html;
    }
  }

  setGrenades(n) { this.el.grenades.textContent = n; }

  setLethal(name) { this.el.lethalName.textContent = name; }

  setPerk(perk) {
    if (this.el.perkName) this.el.perkName.textContent = perk?.name || '';
  }

  setTrophy(perk, until, readyAt, time) {
    const el = this.el.trophy;
    if (!el) return;
    if (!perk?.trophy) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (time < until) {
      el.textContent = `TROPHY ${Math.ceil(until - time)}s`;
      el.classList.add('active');
    } else if (time < readyAt) {
      el.textContent = `TROPHY ${Math.ceil(readyAt - time)}s`;
      el.classList.remove('active');
    } else {
      el.textContent = 'TROPHY [X]';
      el.classList.add('active');
    }
  }

  setAcog(v) { this.setOptic(v ? 'acog' : null); }

  /** angle: screen-space direction to the nearest live grenade (radians, 0 = ahead), or null to hide. */
  grenadeWarning(angle) {
    const w = this.el.grenadeWarn;
    w.classList.toggle('hidden', angle == null);
    if (angle != null) w.style.transform = `rotate(${angle}rad)`;
  }

  setUav(label) {
    this.el.uav.classList.toggle('hidden', !label);
    if (label) this.el.uav.textContent = label;
  }

  addChat(msg) {
    const d = document.createElement('div');
    d.className = `chat-line${msg.system ? ' system' : ''}`;
    if (!msg.system) {
      const name = document.createElement('b');
      name.className = msg.cls || '';
      name.textContent = `${msg.teamOnly ? '[TEAM] ' : ''}${msg.name}:`;
      d.appendChild(name);
    }
    d.appendChild(document.createTextNode(` ${msg.text}`));
    this.el.chatLog.appendChild(d);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 10000);
  }

  openChat(teamOnly) {
    this.el.chatScope.textContent = teamOnly ? t('hud.team') : t('hud.all');
    this.el.chatScope.className = teamOnly ? 'team' : '';
    this.el.chatEntry.classList.remove('hidden');
    this.el.chatLog.classList.add('open');
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
  }

  closeChat() {
    this.el.chatEntry.classList.add('hidden');
    this.el.chatLog.classList.remove('open');
    this.el.chatInput.blur();
  }

  showRoundEnd(title, cls, scoreText, nextIn) {
    const r = this.el.roundEnd;
    r.className = `round-end ${cls}`;
    r.innerHTML = `<h2>${esc(title)}</h2><div class="rs">${esc(scoreText)}</div><div class="rn">${esc(t('hud.nextRound', { n: Math.ceil(nextIn) }))}</div>`;
  }

  hideRoundEnd() { this.el.roundEnd.className = 'round-end hidden'; }
  setRespawn(s) { this.el.respawn.textContent = s > 0 ? t('hud.respawn', { n: Math.ceil(s) }) : t('hud.respawning'); }
  hideDeath() { this.el.death.classList.add('hidden'); }

  update(dt) {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) {
        this.el.hitmarker.style.transition = 'opacity 0.15s';
        this.el.hitmarker.style.opacity = '0';
      }
    }
  }

  reset() {
    this.el.killfeed.innerHTML = '';
    this.el.center.innerHTML = '';
    this.el.coinPop.innerHTML = '';
    this.el.dmgInd.innerHTML = '';
    this.el.chatLog.innerHTML = '';
    this.el.streaks.innerHTML = '';
    this.lastStreakHtml = '';
    this.closeChat();
    this.hideRoundEnd();
    this.grenadeWarning(null);
    this.setUav(null);
    this.hideDeath();
    this.setOptic(null);
    this.setReloadHint(false);
    this.setScoreboard(false, []);
    this.setHealth(100);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

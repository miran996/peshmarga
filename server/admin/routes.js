const express = require('express');
const os = require('os');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { requireStaff, requirePerm, ROLES, hasPerm } = require('./rbac');
const catalog = require('../catalog');
const MapLib = require('../../shared/map');

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

function createAdminRouter({ db, auth, realtime }) {
  const router = express.Router();
  router.use(auth.authMiddleware, requireStaff(db));

  router.get('/me', (req, res) => {
    res.json({
      user: req.adminUser,
      role: req.adminRole,
      perms: ROLES[req.adminRole]?.perms || [],
      roles: Object.values(ROLES).filter((r) => r.id !== 'none'),
    });
  });

  // ----- Analytics / dashboard -----
  router.get('/analytics', requirePerm(db, 'dashboard.view'), (req, res) => {
    const snap = db.getAnalyticsSnapshot();
    const mem = process.memoryUsage();
    const load = os.loadavg?.() || [0, 0, 0];
    const live = realtime.getLiveStats();
    res.json({
      ...snap,
      live,
      server: {
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        load1: load[0],
        cpus: os.cpus()?.length || 1,
        pingMs: live.tickMs || 50,
      },
      doubleCoin: db.getCoinMultiplier(),
      liveops: db.getLiveopsState(),
    });
  });

  // ----- Users / players -----
  router.get('/users', requirePerm(db, 'players.view'), (req, res) => {
    const online = realtime.getOnlineUserIds?.() || new Set();
    const includeBots = req.query.bots === '1';
    const users = db.getAllUsers()
      .filter((u) => includeBots || !u.isBot)
      .map((u) => ({
        ...u,
        online: online.has(Number(u.id)),
        arena: realtime.getUserArenaSummary?.(u.id) || null,
      }));
    users.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
    res.json({ users, onlineCount: users.filter((u) => u.online).length });
  });

  router.get('/players/:id', requirePerm(db, 'players.view'), wrap((req, res) => {
    res.json(db.getPlayerProfile(req.params.id));
  }));

  router.get('/chat', requirePerm(db, 'players.view'), (req, res) => {
    res.json({ logs: db.getChatLogs({ userId: req.query.userId ? Number(req.query.userId) : null, q: req.query.q, limit: req.query.limit }) });
  });

  router.post('/users/:id/role', requirePerm(db, '*'), wrap((req, res) => {
    // only super has *
    if (!hasPerm(req.adminRole, '*')) return res.status(403).json({ error: 'Super admin only' });
    const user = db.setUserRole(Number(req.params.id), String(req.body?.role || 'none'));
    res.json({ user });
  }));

  router.post('/users/:id/coins', requirePerm(db, 'economy.gift'), wrap((req, res) => {
    const amount = db.parseCoinAmount(req.body?.amount);
    if (amount == null) {
      return res.status(400).json({ error: 'Amount must be a non-zero integer up to 1,000,000.' });
    }
    if (!db.getUserById(Number(req.params.id))) return res.status(404).json({ error: 'User not found' });
    const user = db.addCoins(Number(req.params.id), amount, `admin:${req.adminUser.username}`);
    realtime.notifyUser(user, amount);
    res.json({ user, amount });
  }));

  router.post('/gift', requirePerm(db, 'economy.gift'), wrap((req, res) => {
    const amount = db.parseCoinAmount(req.body?.amount);
    if (amount == null) {
      return res.status(400).json({ error: 'Enter a non-zero amount (e.g. 500). Max 1,000,000.' });
    }
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Username required' });
    const user = db.giftCoinsByUsername(username, amount, req.adminUser.username);
    realtime.notifyUser(user, amount);
    res.json({ user, amount });
  }));

  // ----- Sessions -----
  router.get('/sessions', requirePerm(db, 'sessions.view'), (req, res) => {
    res.json({ active: realtime.getActiveSessions(), recent: db.recentSessions(40), arena: realtime.getArenaInfo() });
  });

  // ----- Coin orders -----
  router.get('/coin-orders', requirePerm(db, 'orders.view'), (req, res) => {
    const status = req.query.status === 'all' ? 'all' : (req.query.status || 'pending');
    res.json({ orders: db.listCoinOrders(status) });
  });

  router.post('/coin-orders/:id/fulfill', requirePerm(db, 'orders.fulfill'), wrap((req, res) => {
    const { user, coins } = db.fulfillCoinOrder(Number(req.params.id), req.adminUser.username);
    realtime.notifyUser(user, coins);
    res.json({ user, ok: true });
  }));

  /** Alias: Complete = verify payment + credit coins. */
  router.post('/coin-orders/:id/complete', requirePerm(db, 'orders.fulfill'), wrap((req, res) => {
    const { user, coins } = db.fulfillCoinOrder(Number(req.params.id), req.adminUser.username);
    realtime.notifyUser(user, coins);
    res.json({ user, ok: true });
  }));

  router.post('/coin-orders/:id/reject', requirePerm(db, 'orders.fulfill'), wrap((req, res) => {
    db.rejectCoinOrder(Number(req.params.id), req.adminUser.username);
    res.json({ ok: true });
  }));

  // ----- Economy -----
  router.get('/economy', requirePerm(db, 'economy.view'), (req, res) => {
    res.json({
      overrides: db.listEconomyOverrides(),
      events: db.listLiveEvents(),
      coinPacks: db.getCoinPacks(),
      paymentMethods: db.getPaymentMethods(),
      catalog: {
        weapons: catalog.WEAPONS,
        cosmetics: catalog.COSMETICS,
        flags: catalog.FLAGS,
      },
      effective: {
        weapons: db.applyCatalogPrices(catalog.WEAPONS, 'weapon'),
        cosmetics: db.applyCatalogPrices(catalog.COSMETICS, 'cosmetic'),
        flags: db.applyCatalogPrices(catalog.FLAGS, 'flag'),
      },
    });
  });

  router.post('/economy/coin-packs/:id', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const pack = db.setCoinPack(String(req.params.id), {
      name: req.body?.name,
      coins: req.body?.coins,
      iqd: req.body?.iqd,
      bonus: req.body?.bonus,
      description: req.body?.description,
      by: req.adminUser.username,
    });
    realtime.broadcastEconomy?.();
    res.json({ pack, coinPacks: db.getCoinPacks() });
  }));

  router.post('/economy/coin-packs/:id/reset', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const pack = db.resetCoinPack(String(req.params.id));
    realtime.broadcastEconomy?.();
    res.json({ pack, coinPacks: db.getCoinPacks() });
  }));

  router.post('/economy/payments/:id', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const method = db.setPaymentMethod(String(req.params.id), {
      name: req.body?.name,
      phone: req.body?.phone,
      hint: req.body?.hint,
      by: req.adminUser.username,
    });
    realtime.broadcastEconomy?.();
    res.json({ method, paymentMethods: db.getPaymentMethods() });
  }));

  router.post('/economy/payments/:id/reset', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const method = db.resetPaymentMethod(String(req.params.id));
    realtime.broadcastEconomy?.();
    res.json({ method, paymentMethods: db.getPaymentMethods() });
  }));

  router.post('/economy/override', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const { kind, itemId, price, discountPct } = req.body || {};
    const row = db.setEconomyOverride(String(kind), String(itemId), {
      price: price == null || price === '' ? null : Number(price),
      discountPct: Number(discountPct) || 0,
      by: req.adminUser.username,
    });
    res.json({ override: row });
  }));

  router.post('/economy/override/clear', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    db.clearEconomyOverride(String(req.body?.kind), String(req.body?.itemId));
    res.json({ ok: true });
  }));

  router.post('/economy/events/:id', requirePerm(db, 'economy.edit'), wrap((req, res) => {
    const ev = db.setLiveEvent(String(req.params.id), {
      active: !!req.body?.active,
      mult: Number(req.body?.mult) || 2,
      startsAt: req.body?.startsAt || null,
      endsAt: req.body?.endsAt || null,
      by: req.adminUser.username,
    });
    realtime.broadcastEconomy?.();
    res.json({ event: ev, mult: db.getCoinMultiplier() });
  }));

  // ----- Moderation -----
  router.get('/moderation/flags', requirePerm(db, 'moderation.view'), (req, res) => {
    res.json({ flags: db.listCheatFlags({ unresolvedOnly: req.query.all !== '1' }) });
  });

  router.post('/moderation/flags/:id/resolve', requirePerm(db, 'moderation.act'), wrap((req, res) => {
    db.resolveCheatFlag(Number(req.params.id));
    res.json({ ok: true });
  }));

  router.get('/moderation/bans', requirePerm(db, 'moderation.view'), (req, res) => {
    res.json({ bans: db.listBans(req.query.all !== '1') });
  });

  router.post('/moderation/ban', requirePerm(db, 'moderation.act'), wrap((req, res) => {
    const { banType, target, userId, reason } = req.body || {};
    const uid = userId ? Number(userId) : null;
    if (uid && uid === req.adminUser.id) {
      return res.status(400).json({ error: 'Cannot ban your own account/device' });
    }
    const ban = db.createBan({
      banType: String(banType),
      target: String(target || ''),
      userId: uid,
      reason: reason ? String(reason).slice(0, 200) : null,
      by: req.adminUser.username,
    });
    if (banType === 'account' || banType === 'shadow') {
      if (uid) realtime.kickUser?.(uid, reason || 'Banned');
    }
    res.json({ ban });
  }));

  router.post('/moderation/bans/:id/lift', requirePerm(db, 'moderation.act'), wrap((req, res) => {
    db.liftBan(Number(req.params.id), req.adminUser.username);
    res.json({ ok: true });
  }));

  router.post('/moderation/kick', requirePerm(db, 'liveops.kick'), wrap((req, res) => {
    const userId = Number(req.body?.userId);
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const ok = realtime.kickUser?.(userId, req.body?.reason || 'Kicked by admin');
    db.logModAction({ action: 'kick', targetUserId: userId, reason: req.body?.reason, by: req.adminUser.username });
    res.json({ ok: !!ok });
  }));

  // ----- LiveOps -----
  router.get('/liveops', requirePerm(db, 'dashboard.view'), (req, res) => {
    res.json({
      state: db.getLiveopsState(),
      maps: MapLib.MAP_LIST,
      lobbies: db.listTournamentLobbies(),
      weatherOptions: ['clear', 'day', 'rain', 'night', 'fog'],
    });
  });

  router.post('/liveops/announce', requirePerm(db, 'liveops.announce'), wrap((req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 160);
    if (!text) return res.status(400).json({ error: 'Text required' });
    db.setLiveopsState({ announce: text });
    realtime.announce?.(text);
    db.logModAction({ action: 'announce', reason: text, by: req.adminUser.username });
    res.json({ ok: true });
  }));

  router.post('/liveops/weather', requirePerm(db, '*'), wrap((req, res) => {
    const weather = String(req.body?.weather || 'clear');
    if (!['clear', 'day', 'rain', 'night', 'fog'].includes(weather)) {
      return res.status(400).json({ error: 'Invalid weather' });
    }
    const state = db.setLiveopsState({ weather });
    realtime.setWeather?.(weather);
    res.json({ state });
  }));

  router.post('/liveops/map', requirePerm(db, '*'), wrap((req, res) => {
    const mapId = String(req.body?.mapId || '');
    if (mapId && !MapLib.hasMap(mapId)) return res.status(400).json({ error: 'Unknown map' });
    const forceEmpty = !!req.body?.rotateEmpty;
    const state = db.setLiveopsState({ preferredMap: mapId || null });
    const result = realtime.setPreferredMap?.(mapId || null, { rotateEmpty: forceEmpty });
    res.json({ state, result });
  }));

  router.post('/liveops/lobbies', requirePerm(db, '*'), wrap((req, res) => {
    const mapId = String(req.body?.mapId || MapLib.DEFAULT_MAP);
    const mode = req.body?.mode === 'tdm' ? 'tdm' : 'ffa';
    const password = String(req.body?.password || '');
    if (!MapLib.hasMap(mapId)) return res.status(400).json({ error: 'Unknown map' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const id = `tour-${crypto.randomBytes(4).toString('hex')}`;
    const lobby = db.createTournamentLobby({
      id,
      mapId,
      mode,
      passwordHash: bcrypt.hashSync(password, 8),
      label: String(req.body?.label || id).slice(0, 40),
      by: req.adminUser.username,
    });
    realtime.registerTournamentLobby?.(lobby.id, mapId, mode);
    res.json({ lobby: { ...lobby, password } });
  }));

  router.post('/liveops/lobbies/:id/close', requirePerm(db, '*'), wrap((req, res) => {
    db.deactivateTournamentLobby(req.params.id);
    realtime.closeTournamentLobby?.(req.params.id);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createAdminRouter };

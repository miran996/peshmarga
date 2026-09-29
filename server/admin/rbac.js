/**
 * Role-based access for the admin panel.
 * Roles: super (full), mod (moderation), accountant (economy view/edit gifts/orders).
 */
const ROLES = {
  none: { id: 'none', label: 'Player', perms: [] },
  mod: {
    id: 'mod', label: 'Moderator',
    perms: [
      'dashboard.view', 'players.view', 'sessions.view',
      'moderation.view', 'moderation.act', 'liveops.kick', 'liveops.announce',
    ],
  },
  accountant: {
    id: 'accountant', label: 'Accountant',
    perms: [
      'dashboard.view', 'players.view', 'sessions.view', 'economy.view', 'economy.edit',
      'economy.gift', 'orders.view', 'orders.fulfill',
    ],
  },
  super: {
    id: 'super', label: 'Super Admin',
    perms: ['*'],
  },
};

function normalizeRole(role) {
  if (role && ROLES[role] && role !== 'none') return role;
  return 'none';
}

function isStaff(role) {
  return normalizeRole(role) !== 'none';
}

function hasPerm(role, perm) {
  const r = ROLES[normalizeRole(role)];
  if (!r) return false;
  if (r.perms.includes('*')) return true;
  if (perm === '*') return false;
  return r.perms.includes(perm);
}

function requireStaff(db) {
  return (req, res, next) => {
    const user = db.getUserById(req.user.id);
    if (!user || !isStaff(user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminUser = user;
    req.adminRole = user.role;
    next();
  };
}

function requirePerm(db, perm) {
  return (req, res, next) => {
    const user = req.adminUser || db.getUserById(req.user.id);
    if (!user || !hasPerm(user.role, perm)) {
      return res.status(403).json({ error: `Missing permission: ${perm}` });
    }
    req.adminUser = user;
    req.adminRole = user.role;
    next();
  };
}

module.exports = {
  ROLES,
  normalizeRole,
  isStaff,
  hasPerm,
  requireStaff,
  requirePerm,
};

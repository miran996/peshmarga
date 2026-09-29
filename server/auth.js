const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const { DATA_DIR } = require('./paths');
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  if (process.env.RENDER || process.env.NODE_ENV === 'production') {
    console.warn('[auth] JWT_SECRET env is missing — wrote a file secret under DATA_DIR. Prefer a fixed JWT_SECRET env var.');
  }
  return secret;
}

const JWT_SECRET = loadSecret();
const TOKEN_COOKIE = 'fps_token';

function signToken(user) {
  return jwt.sign(
    { id: Number(user.id), username: user.username, isAdmin: !!user.isAdmin, role: user.role || (user.isAdmin ? 'super' : 'none') },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.[TOKEN_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = payload;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = {
  JWT_SECRET,
  TOKEN_COOKIE,
  signToken,
  verifyToken,
  authMiddleware,
  adminMiddleware,
};

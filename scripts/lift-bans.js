const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const d = new DatabaseSync(path.join(__dirname, '..', 'data', 'game.db'));
const lifted = d.prepare('UPDATE bans SET active = 0 WHERE active = 1').run().changes;
const cleared = d.prepare('UPDATE users SET device_hash = NULL WHERE username = ?').run('admin').changes;
console.log(JSON.stringify({ lifted, cleared }));

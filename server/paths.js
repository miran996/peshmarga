const path = require('path');
const fs = require('fs');

/**
 * Prefer DATA_DIR env. Else use Render persistent mount /var/data when present.
 * Falls back to ./data (ephemeral on Render free — members wiped each deploy).
 */
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const renderDisk = '/var/data';
  try {
    if (fs.existsSync(renderDisk)) {
      fs.accessSync(renderDisk, fs.constants.W_OK);
      return renderDisk;
    }
  } catch { /* not mounted */ }
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();

module.exports = { resolveDataDir, DATA_DIR };

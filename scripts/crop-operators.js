/**
 * Clean operator portraits from tactical-forces-sheet.png (1024×572).
 * Uses contain + letterbox so heads/feet stay in frame and neighbours don't bleed.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'img', 'tactical-forces-sheet.png');
const OUT = path.join(__dirname, '..', 'public', 'img', 'operators');
fs.mkdirSync(OUT, { recursive: true });

const SHEET_W = 1024;
const SHEET_H = 572;
const W = 420;
const H = 540;
const BG = { r: 12, g: 14, b: 16, alpha: 1 };

const OPS = [
  { id: 'assault', name: 'Assault', role: 'Rifleman', box: [100, 0, 135, 275] },
  { id: 'heavy', name: 'Heavy', role: 'LMG Gunner', box: [245, 25, 135, 275] },
  { id: 'insurgent', name: 'Insurgent', role: 'Guerrilla', box: [430, 5, 125, 275] },
  { id: 'breacher', name: 'Breacher', role: 'Shotgun', box: [575, 0, 120, 270] },
  { id: 'scout', name: 'Scout', role: 'Carbine', box: [780, 5, 125, 270] },
  { id: 'ghillie', name: 'Ghillie', role: 'Sniper', box: [145, 295, 185, 240] },
  { id: 'smg', name: 'Pointman', role: 'SMG', box: [400, 220, 105, 250] },
  { id: 'nightops', name: 'Night Ops', role: 'CQC / NVG', box: [705, 190, 115, 260] },
  { id: 'riot', name: 'Riot Guard', role: 'Shield', box: [875, 115, 145, 310] },
  { id: 'prone', name: 'Recon', role: 'Prone Overwatch', box: [660, 395, 230, 150] },
];

function clampBox([left, top, width, height]) {
  left = Math.max(0, Math.min(left, SHEET_W - 1));
  top = Math.max(0, Math.min(top, SHEET_H - 1));
  if (left + width > SHEET_W) width = SHEET_W - left;
  if (top + height > SHEET_H) height = SHEET_H - top;
  return [left, top, Math.max(1, width), Math.max(1, height)];
}

(async () => {
  const meta = [];
  for (const op of OPS) {
    const [left, top, width, height] = clampBox(op.box);
    const extracted = await sharp(SRC).extract({ left, top, width, height }).png().toBuffer();

    const fitted = await sharp(extracted)
      .resize(W, H, {
        fit: 'contain',
        position: 'centre',
        background: BG,
      })
      .png()
      .toBuffer();

    const fade = Buffer.from(
      `<svg width="${W}" height="${H}">
        <defs>
          <linearGradient id="g" x1="0" y1="0.62" x2="0" y2="1">
            <stop offset="0%" stop-color="#0c0e10" stop-opacity="0"/>
            <stop offset="100%" stop-color="#0c0e10" stop-opacity="0.75"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`
    );

    await sharp(fitted)
      .composite([{ input: fade, blend: 'over' }])
      .png()
      .toFile(path.join(OUT, `${op.id}.png`));

    meta.push({ id: op.id, name: op.name, role: op.role, src: `/img/operators/${op.id}.png?v=3` });
    console.log('ok', op.id);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(meta, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });

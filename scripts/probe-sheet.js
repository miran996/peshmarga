const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const SRC = path.join(__dirname, '..', 'public', 'img', 'tactical-forces-sheet.png');
const OUT = path.join(__dirname, '..', 'public', 'img', '_probe');
fs.mkdirSync(OUT, { recursive: true });

// Probe a grid of candidate centers
const probes = [];
for (let y = 0; y < 500; y += 100) {
  for (let x = 0; x < 900; x += 100) {
    probes.push({ name: `p_${x}_${y}`, box: [x, y, 160, 200] });
  }
}

(async () => {
  // Also make a downscaled full sheet with a coordinate grid for visual mapping
  const svg = `
  <svg width="1024" height="572" xmlns="http://www.w3.org/2000/svg">
    ${[0,100,200,300,400,500,600,700,800,900,1000].map((x) =>
      `<line x1="${x}" y1="0" x2="${x}" y2="572" stroke="lime" stroke-width="1" opacity="0.7"/>
       <text x="${x+4}" y="14" fill="lime" font-size="12">${x}</text>`).join('')}
    ${[0,100,200,300,400,500].map((y) =>
      `<line x1="0" y1="${y}" x2="1024" y2="${y}" stroke="cyan" stroke-width="1" opacity="0.7"/>
       <text x="4" y="${y+14}" fill="cyan" font-size="12">${y}</text>`).join('')}
  </svg>`;
  await sharp(SRC)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toFile(path.join(OUT, 'grid.jpg'));
  console.log('wrote grid.jpg');
})().catch((e) => { console.error(e); process.exit(1); });

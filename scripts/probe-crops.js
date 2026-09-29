const path = require('path');
const sharp = require('sharp');
const SRC = path.join(__dirname, '..', 'public', 'img', 'tactical-forces-sheet.png');
const OUT = path.join(__dirname, '..', 'public', 'img', '_probe');

const tests = [
  { id: 't_assault', box: [100, 0, 160, 270] },
  { id: 't_heavy', box: [250, 20, 160, 270] },
  { id: 't_insurgent', box: [430, 10, 145, 260] },
  { id: 't_breacher', box: [560, 0, 150, 270] },
  { id: 't_scout', box: [760, 10, 160, 270] },
  { id: 't_ghillie', box: [140, 310, 200, 230] },
  { id: 't_smg', box: [350, 280, 160, 230] },
  { id: 't_nightops', box: [640, 210, 160, 260] },
  { id: 't_riot', box: [820, 130, 200, 310] },
  { id: 't_prone', box: [560, 380, 300, 155] },
];

(async () => {
  for (const t of tests) {
    let [l, top, w, h] = t.box;
    if (l + w > 1024) w = 1024 - l;
    if (top + h > 572) h = 572 - top;
    await sharp(SRC).extract({ left: l, top, width: w, height: h }).resize(200).png()
      .toFile(path.join(OUT, `${t.id}.png`));
    console.log(t.id);
  }
})();

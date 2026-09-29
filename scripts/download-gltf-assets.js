/**
 * Download curated Poly Haven (CC0) glTF models into public/models/.
 * Usage: node scripts/download-gltf-assets.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..', 'public', 'models');
const UA = 'StickmanWarfare/1.0 (Poly Haven CC0 assets; credit polyhaven.com)';

/** id → preferred resolution (weapons prefer 2k). */
const ASSETS = {
  covered_car: '1k',
  Barrel_01: '1k',
  old_military_crate: '1k',
  wooden_military_crate: '1k',
  ammo_box: '1k',
  metal_jerrycan: '1k',
  old_tyre: '1k',
  rusted_wheel_rim_01: '1k',
  concrete_road_barrier: '1k',
  modular_factory_facade: '1k',
  modular_urban_apartments_facade: '1k',
  bolt_action_rifle_7_62: '2k',
  service_pistol: '2k',
  stick_grenade: '1k',
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} → ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 64) return resolve(dest);
    const lib = url.startsWith('https') ? https : http;
    const tmp = `${dest}.part`;
    const file = fs.createWriteStream(tmp);
    lib.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmp);
        reject(new Error(`${url} → ${res.statusCode}`));
        res.resume();
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        fs.renameSync(tmp, dest);
        resolve(dest);
      }));
    }).on('error', (err) => {
      try { file.close(); fs.unlinkSync(tmp); } catch { /* ignore */ }
      reject(err);
    });
  });
}

async function downloadAsset(id, prefer) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  const gltf = files.gltf;
  if (!gltf) throw new Error(`${id}: no gltf`);
  const res = gltf[prefer] || gltf['1k'] || gltf['2k'] || Object.values(gltf)[0];
  const entry = res.gltf;
  if (!entry?.url) throw new Error(`${id}: missing gltf url`);
  const dir = path.join(ROOT, id);
  const mainName = path.basename(new URL(entry.url).pathname);
  const mainPath = path.join(dir, mainName);
  process.stdout.write(`  ${id} (${prefer})… `);
  await download(entry.url, mainPath);
  const includes = entry.include || {};
  for (const [rel, meta] of Object.entries(includes)) {
    const url = meta.url || meta;
    if (typeof url !== 'string') continue;
    await download(url, path.join(dir, rel.replace(/^\.\//, '')));
  }
  // Convenience pointer so the game can always load /models/<id>/model.gltf
  const pointer = path.join(dir, 'model.gltf');
  if (path.resolve(mainPath) !== path.resolve(pointer)) {
    fs.copyFileSync(mainPath, pointer);
  }
  console.log('ok');
  return { id, path: `models/${id}/model.gltf` };
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const manifest = {
    source: 'https://polyhaven.com',
    license: 'CC0',
    credit: 'Assets from Poly Haven (polyhaven.com)',
    assets: {},
  };
  for (const [id, res] of Object.entries(ASSETS)) {
    try {
      const info = await downloadAsset(id, res);
      manifest.assets[id] = info.path;
    } catch (e) {
      console.error(`FAIL ${id}:`, e.message);
    }
  }
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Wrote public/models/manifest.json');
})().catch((e) => { console.error(e); process.exit(1); });

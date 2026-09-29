# Graphics pipeline (modular)

Safe visual upgrade layer. Does **not** change multiplayer sockets, auth, economy, or hit detection.

## Layout

| File | Role |
|------|------|
| `config.js` | HD knobs per quality tier (LOD distances, anisotropy, PBR) |
| `materials.js` | Procedural PBR normals for operators + world texture mip/anisotropy |
| `lod.js` | Distance LOD for remote operators (far = hidden, mid = no shadows) |
| `atmosphere.js` | Extra fill/rim lights (sun still owned by `world.js`) |
| `index.js` | `attachGraphics(game)` — single entry point |

## Already free in Three.js

- **Frustum culling** — enabled by default on meshes
- **Mipmapping** — enabled when textures use mip filters (we force this on world maps)

## Not yet (planned Phase D)

- Real glTF/PBR scanned operators (needs art pipeline)
- GPU occlusion queries / Hi-Z
- KTX2/Basis texture compression at build time

## Quality

Settings → Graphics quality: Low / Medium / High / **Ultra**

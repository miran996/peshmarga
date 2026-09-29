/**
 * Modular HD graphics pipeline.
 * Attach once to Game; does not touch multiplayer sockets, stats, or auth.
 *
 * Usage:
 *   import { attachGraphics } from '../graphics/index.js';
 *   this.graphics = attachGraphics(this);
 *   // after loadMap / rebuildWorldVisuals:
 *   this.graphics.onWorldReady(this.world);
 *   // each frame:
 *   this.graphics.tick();
 */
import { resolveGraphicsConfig } from './config.js';
import { enhanceOperatorMaterials, boostWorldTextures } from './materials.js';
import { LodController } from './lod.js';
import { AtmosphereRig } from './atmosphere.js';
import { preloadGltf, WEAPON_ASSETS, GRENADE_ASSET } from './gltf.js';

export function attachGraphics(game) {
  let cfg = resolveGraphicsConfig('medium');
  const lod = new LodController(cfg);
  const atmosphere = new AtmosphereRig(game.scene);
  const enhanced = new WeakSet();

  const api = {
    /** Re-read settings quality id and apply caps. */
    applyQuality(qualityId) {
      cfg = resolveGraphicsConfig(qualityId);
      lod.setConfig(cfg);
      atmosphere.setEnabled(!!cfg.fillLights);
      atmosphere.applyEnvBoost(game.renderer, game.scene, !!cfg.envBoost);
      if (game.renderer && cfg.maxPixelRatio) {
        const dpr = Math.min(window.devicePixelRatio || 1, cfg.maxPixelRatio);
        // Engine also sets DPR from QUALITY — we only raise when HD asks for more headroom.
        if (cfg.hd) game.renderer.setPixelRatio(dpr);
      }
      // Re-boost textures if world exists
      if (game.world?.root) boostWorldTextures(game.world.root, cfg.anisotropy);
    },

    /** Call after buildWorld / rebuildWorldVisuals. */
    onWorldReady(world) {
      if (!world?.root) return;
      lod.bindWorld(world.root);
      boostWorldTextures(world.root, cfg.anisotropy);
      atmosphere.setEnabled(!!cfg.fillLights);
      atmosphere.applyEnvBoost(game.renderer, game.scene, !!cfg.envBoost);
    },

    /** Upgrade a Stickman instance (preview, remotes, bots optional). */
    enhanceOperator(stickman) {
      if (!stickman || enhanced.has(stickman)) return;
      enhanceOperatorMaterials(stickman, cfg.operatorPbr);
      if (cfg.operatorPbr) enhanced.add(stickman);
    },

    /** Per-frame: LOD + (future) occlusion hooks. */
    tick() {
      const remotes = game.mode?.remotes;
      lod.update(game.camera, remotes);
      // Enhance remotes lazily when they enter near band
      if (remotes && cfg.operatorPbr) {
        for (const r of remotes.values()) {
          if (r.model && !enhanced.has(r.model)) this.enhanceOperator(r.model);
        }
      }
    },

    dispose() {
      atmosphere.dispose();
    },
  };

  // Initial quality from engine's current preset id if available
  const qid = game.quality && Object.entries(game.quality).length
    ? (game._graphicsQualityId || 'medium')
    : 'medium';
  api.applyQuality(qid);
  game.graphics = api;

  // Warm Poly Haven weapon / grenade templates so first equip is instant.
  const warm = [
    ...new Set([
      ...Object.values(WEAPON_ASSETS).map((w) => w.id),
      GRENADE_ASSET.id,
    ]),
  ];
  preloadGltf(warm).catch(() => {});

  return api;
}

export { resolveGraphicsConfig, enhanceOperatorMaterials };

/**
 * HD graphics quality knobs — layered on top of existing QUALITY presets.
 * Does not replace gameplay settings; only drives the modular graphics pipeline.
 */
export const GRAPHICS = {
  /** Safe defaults when settings.quality is unknown. */
  fallback: {
    hd: false,
    lod: true,
    lodNear: 28,
    lodFar: 70,
    anisotropy: 4,
    fillLights: true,
    envBoost: true,
    operatorPbr: false,
    hideFarInk: true,
    maxPixelRatio: 1.25,
  },
  low: {
    hd: false, lod: true, lodNear: 22, lodFar: 55, anisotropy: 2,
    fillLights: true, envBoost: true, operatorPbr: false, hideFarInk: true, maxPixelRatio: 0.85,
  },
  medium: {
    hd: true, lod: true, lodNear: 26, lodFar: 65, anisotropy: 8,
    fillLights: true, envBoost: true, operatorPbr: true, hideFarInk: true, maxPixelRatio: 1.15,
  },
  high: {
    hd: true, lod: true, lodNear: 32, lodFar: 80, anisotropy: 12,
    fillLights: true, envBoost: true, operatorPbr: true, hideFarInk: true, maxPixelRatio: 1.35,
  },
  /** Optional cinematic tier — still capped for browser stability. */
  ultra: {
    hd: true, lod: true, lodNear: 36, lodFar: 95, anisotropy: 16,
    fillLights: true, envBoost: true, operatorPbr: true, hideFarInk: true, maxPixelRatio: 1.5,
  },
};

export function resolveGraphicsConfig(qualityId) {
  return GRAPHICS[qualityId] || GRAPHICS.fallback;
}

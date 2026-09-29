import * as THREE from 'three';

/**
 * Distance LOD for remote operators + optional world ink/line fade.
 * Frustum culling is already handled by Three.js Mesh frustumCulled (default true).
 * Full GPU occlusion queries are deferred — distance LOD gives most of the win cheaply.
 */
export class LodController {
  constructor(cfg) {
    this.cfg = cfg;
    this._tmp = new THREE.Vector3();
    this.inkRoot = null;
  }

  setConfig(cfg) {
    this.cfg = cfg;
  }

  /** Remember world root so we can fade expensive edge overlays. */
  bindWorld(worldRoot) {
    this.inkRoot = null;
    if (!worldRoot) return;
    worldRoot.traverse((o) => {
      if (o.isLineSegments && !this.inkRoot) this.inkRoot = o;
    });
  }

  /**
   * @param {THREE.Camera} camera
   * @param {Map|Iterable} remotes Map of remote players with `.model.root` and `.pos`
   */
  update(camera, remotes) {
    if (!this.cfg?.lod) {
      this._showAll(remotes);
      if (this.inkRoot) this.inkRoot.visible = true;
      return;
    }
    const near = this.cfg.lodNear;
    const far = this.cfg.lodFar;
    const cam = camera.position;

    if (this.cfg.hideFarInk && this.inkRoot) {
      // Ink edges are expensive; keep them when the player is close to cover clutter.
      this.inkRoot.visible = true;
      // Soft rule: always on for now at medium+, could toggle by map density later.
    }

    if (!remotes) return;
    for (const r of remotes.values ? remotes.values() : remotes) {
      const root = r.model?.root;
      if (!root) continue;
      const pos = r.pos || root.position;
      const d = cam.distanceTo(this._tmp.set(pos.x, pos.y, pos.z));

      // Near: full detail. Mid: hide shadows. Far: hide entirely (frustum + distance).
      if (d > far) {
        root.visible = false;
        if (r.label) r.label.visible = false;
        continue;
      }
      root.visible = true;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = d < near && !!o.castShadow;
          // Drop outline children when mid-range
          if (o.material?.side === THREE.BackSide) o.visible = d < near * 0.85;
        }
      });
    }
  }

  _showAll(remotes) {
    if (!remotes) return;
    for (const r of remotes.values ? remotes.values() : remotes) {
      if (r.model?.root) r.model.root.visible = true;
    }
  }
}

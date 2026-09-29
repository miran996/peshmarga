import * as THREE from 'three';

/**
 * Extra fill / rim lights for cinematic combat look.
 * Key sun remains owned by world.js (baked-feel directional + shadows).
 */
export class AtmosphereRig {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'graphics-atmosphere';
    this.fill = new THREE.HemisphereLight('#e8eef4', '#4a4034', 0.95);
    this.rim = new THREE.DirectionalLight('#c8d8ff', 0.55);
    this.rim.position.set(4, 8, -6);
    this.rim.castShadow = false;
    this.bounce = new THREE.DirectionalLight('#ffe4c0', 0.45);
    this.bounce.position.set(-6, 3, 4);
    this.bounce.castShadow = false;
    this.group.add(this.fill, this.rim, this.bounce);
    this.enabled = false;
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.scene.add(this.group);
    else this.scene.remove(this.group);
  }

  /** Raise exposure when HD / bright play is preferred. */
  applyEnvBoost(renderer, scene, on) {
    if (!renderer) return;
    if (on) {
      renderer.toneMappingExposure = Math.max(renderer.toneMappingExposure, 1.55);
      if (scene.fog?.isFog) {
        scene.fog.near = Math.max(8, scene.fog.near * 1.1);
        scene.fog.far = scene.fog.far * 1.15;
      }
    }
  }

  dispose() {
    this.setEnabled(false);
    this.fill.dispose?.();
  }
}

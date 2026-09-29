import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld } from './world.js';
import { Effects } from './effects.js';
import { Physics } from './physics.js';
import { BotAI } from './bots.js';
import { buildViewModel, buildKnifeViewModel } from './weapons.js';
import { audio } from './audio.js';
import { Hud } from './hud.js';
import { settings, onSettings, QUALITY, BASE_SENS } from '../settings.js';
import { actionDown, codeMatches } from '../keybinds.js';
import { grainDataUrl } from './textures.js';
import { attachGraphics } from '../graphics/index.js';
import { loadGltf, cloneGltf, GRENADE_ASSET } from '../graphics/gltf.js';

const MapLib = window.StickMap;
const MELEE_TIME = 0.5, MELEE_HIT_AT = 0.36, THROW_TIME = 0.45, THROW_RELEASE_AT = 0.25;
const STAND_H = 1.8, CROUCH_H = 1.2;
const EYE_STAND = 1.62, EYE_CROUCH = 1.1;
const GRAVITY = 18, JUMP_V = 6.6;
const REGEN_DELAY = 4, REGEN_RATE = 35;

const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

/** First-person weapon placement: hip offset and how far forward the sight sits when aiming. */
const VM_POSE = {
  pistol: { hip: [0.085, -0.095, -0.26], adsZ: -0.2 },
  rpg: { hip: [0.13, -0.07, -0.46], adsZ: -0.42 },
  default: { hip: [0.1, -0.11, -0.3], adsZ: -0.2 },
};

/** Final display-space pass: desaturation, contrast, tint, lifted blacks, vignette and animated film grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.03 }, vignette: { value: 0.08 },
    saturation: { value: 0.96 }, contrast: { value: 1.02 }, tint: { value: new THREE.Vector3(1.04, 1.03, 1.0) },
    lift: { value: new THREE.Vector3(0.09, 0.09, 0.1) }, res: { value: new THREE.Vector2(1280, 720) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette;
    uniform float saturation; uniform float contrast; uniform vec3 tint; uniform vec3 lift; uniform vec2 res;
    varying vec2 vUv;
    float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col = col * tint + lift * (1.0 - l);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * dot(d, d) * 1.8;
      float n = rnd(floor(vUv * res) + fract(time * 7.13) * 91.7) - 0.5;
      col += n * grain * (1.0 - l * 0.5);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Bahnschrift, Arial Narrow, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 20;
  s.visible = false;
  return s;
}

export class Game {
  constructor({ canvas, stage, catalog, socket, onExit, onCoins }) {
    this.canvas = canvas;
    this.stage = stage;
    this.catalog = catalog;
    this.weapons = catalog.weapons;
    this.socket = socket;
    this.onExit = onExit;
    this.onCoins = onCoins;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.baseFov = settings.fov;
    this.quality = QUALITY[settings.quality];
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.05, 500);
    this.camera.rotation.order = 'YXZ';

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10);
    this.vmScene.add(new THREE.AmbientLight('#e8e4dc', 0.65));
    this.vmScene.add(new THREE.HemisphereLight('#efe8dc', '#4a4038', 2.2));
    const vmSun = new THREE.DirectionalLight('#ffe8c8', 3.0);
    vmSun.position.set(-1, 2, 1);
    this.vmScene.add(vmSun);
    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);
    this.vmFlash = new THREE.PointLight('#ffb35c', 0, 3, 2);
    this.vmScene.add(this.vmFlash);

    this.effects = new Effects(this.scene);
    this.mapId = null;
    this.loadMap(MapLib.DEFAULT_MAP);
    this.hud = new Hud(this.map);
    document.getElementById('film-grain').style.backgroundImage = `url(${grainDataUrl()})`;

    this.grenadeGeo = new THREE.SphereGeometry(MapLib.GRENADE.radius * 1.3, 10, 8);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: '#3f4a2e', roughness: 0.7 });
    this.bottleGeo = new THREE.CylinderGeometry(0.035, 0.042, 0.2, 10);
    this.bottleMat = new THREE.MeshStandardMaterial({ color: '#4f7a52', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 });
    this.liveGrenades = [];
    this.rockets = [];
    this.fires = [];
    this.lethal = 'frag';
    this.scheduled = [];
    this.streak = 0;
    this.rewards = { uav: false, airstrike: false };
    this.uavUntil = 0;
    this.enemyUavUntil = 0;
    this.chatOpen = false;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.simAcc = 0;

    this.player = {
      id: 'player', isPlayer: true, name: 'You', pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      crouch: false, alive: false, hp: 100, lastDamageAt: -99, kills: 0, deaths: 0, lastShotAt: -99,
    };
    this.yaw = 0; this.pitch = 0;
    this.recoilP = 0; this.recoilY = 0;
    this.keys = new Set();
    this.mouseDown = [false, false];
    this.mouseDX = 0; this.mouseDY = 0;
    this.running = false;
    this.paused = false;
    this.mode = null;
    this.time = 0;
    this.clock = new THREE.Clock();

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    this.bindInput();
    this.graphics = attachGraphics(this);
    this._graphicsQualityId = settings.quality;
    this.graphics.applyQuality(settings.quality);
    this.graphics.onWorldReady(this.world);
    this._grenadeHd = null;
    loadGltf(GRENADE_ASSET.id).then((tpl) => {
      if (tpl) this._grenadeHd = cloneGltf(tpl);
    }).catch(() => {});
    this.applySettings(settings);
    onSettings((s) => this.applySettings(s));
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applySettings(s) {
    this.sens = BASE_SENS * s.sens;
    this.adsSens = s.adsSens;
    this.baseFov = s.fov;
    this.showFps = s.showFps;
    if (!s.showFps) this.hud.setFps(null);
    audio.setVolume(s.volume);
    const q = QUALITY[s.quality] || QUALITY.high;
    const changed = q !== this.quality || !this.postReady;
    const normalsChanged = this.world && q.normals !== this.quality.normals;
    this.quality = q;
    this._graphicsQualityId = s.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = !!q.shadows;
    this.applyShadowQuality();
    this.graphics?.applyQuality(s.quality);
    if (changed) {
      this.setupPost();
      this.postReady = true;
      this.stage.classList.toggle('q-low', !q.post);
      this.stage.classList.toggle('q-high', q.post && q.bloom);
    }
    if (normalsChanged) this.rebuildWorldVisuals();
    this.resize();
  }

  /** Medium/High: HDR render -> (bloom) -> tone mapping -> colour grade + grain. Low renders straight to screen. */
  setupPost() {
    this.composer?.dispose();
    this.composer = null;
    if (!this.quality.post) return;
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: this.quality.msaa });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    composer.addPass(this.vmPass);
    if (this.quality.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(640, 360), 0.3, 0.5, 0.9));
    composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    composer.addPass(this.gradePass);
    this.composer = composer;
  }

  rebuildWorldVisuals() {
    this.world.dispose();
    this.setRain(false);
    this.world = buildWorld(this.scene, this.map, { particles: this.quality.particles, normals: this.quality.normals });
    this.applyShadowQuality();
    this.graphics?.onWorldReady(this.world);
    if (this._weather) this.applyWeather(this._weather);
  }

  applyShadowQuality() {
    const sun = this.world?.sun;
    if (!sun) return;
    sun.castShadow = this.quality.shadows;
    const size = this.quality.shadowSize;
    if (size && sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  weaponName(id) {
    return this.weapons[id]?.name || this.catalog.equipment?.[id]?.name || id;
  }

  // ------------------------------------------------------------ layout
  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    let w = W, h = Math.round((W * 9) / 16);
    if (h > H) { h = H; w = Math.round((H * 16) / 9); }
    Object.assign(this.stage.style, {
      width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px`, fontSize: `${w / 100}px`,
    });
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.gradePass.uniforms.res.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    }
    this.stageH = h;
    this.emPx = w / 100;
  }

  // ------------------------------------------------------------ input
  bindInput() {
    document.addEventListener('keydown', (e) => {
      if (!this.running || this.chatOpen) return;
      if (codeMatches(e.code, 'scoreboard')) e.preventDefault();
      if (!this.locked()) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (codeMatches(e.code, 'reload')) this.startReload();
      else if (codeMatches(e.code, 'weapon1')) this.switchTo(0);
      else if (codeMatches(e.code, 'weapon2')) this.switchTo(1);
      else if (codeMatches(e.code, 'uav')) this.useStreak('uav');
      else if (codeMatches(e.code, 'airstrike')) this.useStreak('airstrike');
      else if (codeMatches(e.code, 'trophy')) this.activateTrophy();
      else if (codeMatches(e.code, 'lethal')) this.throwGrenade();
      else if (codeMatches(e.code, 'melee')) this.melee();
      else if (codeMatches(e.code, 'crouchToggle')) this.crouchToggle = !this.crouchToggle;
      else if (codeMatches(e.code, 'jump')) this.jumpQueued = true;
      else if (codeMatches(e.code, 'chat') || codeMatches(e.code, 'teamChat') || e.code === 'Enter') {
        if (this.mode?.chat) {
          e.preventDefault();
          this.openChat(codeMatches(e.code, 'teamChat'));
        }
      }
    });
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) this.mode?.sendChat?.(text, this.chatTeam);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.running) return;
      if (!this.locked()) return;
      if (e.button === 0) this.mouseDown[0] = true;
      if (e.button === 2) this.mouseDown[1] = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouseDown[0] = false; this.semiReady = true; }
      if (e.button === 2) this.mouseDown[1] = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.running || !this.locked()) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.running || !this.locked()) return;
      this.switchTo((this.slotIdx + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
    });
    this.stage.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.running) return;
      if (this.locked()) {
        document.getElementById('click-to-play').classList.add('hidden');
        document.getElementById('pause-menu').classList.add('hidden');
        this.paused = false;
      } else if (!this.ended) {
        if (this.chatOpen) this.closeChat();
        this.keys.clear();
        this.mouseDown = [false, false];
        document.getElementById('pause-menu').classList.remove('hidden');
        if (this.mode?.pausable) this.paused = true;
      }
    });
  }

  locked() { return document.pointerLockElement === this.canvas; }

  openChat(team) {
    this.chatOpen = true;
    this.chatTeam = !!team && !!this.mode?.teamChat;
    this.keys.clear();
    this.mouseDown = [false, false];
    this.hud.openChat(this.chatTeam);
  }

  closeChat() {
    this.chatOpen = false;
    this.hud.closeChat();
  }

  requestLock() {
    audio.ensure();
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  loadMap(id) {
    const map = MapLib.buildMap(id);
    const same = map.id === this.mapId;
    if (!same) {
      this.ai?.clear();
      this.world?.dispose();
      this.effects.clear();
      this.setRain(false);
      this.map = map;
      this.mapId = map.id;
      this.world = buildWorld(this.scene, map, { particles: this.quality.particles, normals: this.quality.normals });
      this.applyShadowQuality();
      this.physics = new Physics(map);
      this.ai = new BotAI(this, map, this.scene, this.physics);
      this.hud?.setMap(map);
      this.renderer.toneMappingExposure = map.theme.exposure;
      this.graphics?.onWorldReady(this.world);
    }
    if (this._weather) this.applyWeather(this._weather);
  }

  /** LiveOps / player weather presets — does not rebuild the map. */
  applyWeather(preset = 'clear') {
    const T = this.map?.theme;
    if (!T || !this.scene) return;
    const presets = {
      clear: {
        exposure: T.exposure, fogNear: T.fog[1], fogFar: T.fog[2], fogColor: T.fog[0],
        sun: 1, hemi: 1, sky: T.sky, cover: T.clouds ?? 0.6,
      },
      day: {
        exposure: T.exposure * 1.25, fogNear: T.fog[1] * 1.2, fogFar: T.fog[2] * 1.25,
        fogColor: '#c4d0d8', sun: 1.4, hemi: 1.25,
        sky: ['#6a9cc8', '#a8c8e0', '#d8e6f0'], cloudLight: '#f2f6fa', cloudDark: '#8aa0b4', cover: 0.35,
      },
      rain: {
        exposure: T.exposure * 0.88, fogNear: Math.max(10, T.fog[1] * 0.6), fogFar: T.fog[2] * 0.8,
        fogColor: '#5a656e', sun: 0.65, hemi: 0.8,
        sky: ['#2a3238', '#3a444c', '#5a646c'], cloudLight: '#6a747c', cloudDark: '#1e2428', cover: 0.92,
      },
      night: {
        exposure: T.exposure * 0.55, fogNear: T.fog[1] * 0.8, fogFar: T.fog[2] * 0.85,
        fogColor: '#121820', sun: 0.22, hemi: 0.45,
        sky: ['#05070c', '#0c1220', '#1a2438'], cloudLight: '#1a2430', cloudDark: '#05080e', cover: 0.55,
      },
      fog: {
        exposure: T.exposure * 0.85, fogNear: 5, fogFar: Math.min(65, T.fog[2] * 0.4),
        fogColor: '#9aa0a6', sun: 0.5, hemi: 0.85,
        sky: ['#7a8088', '#9aa0a6', '#b4b8bc'], cloudLight: '#c8ccd0', cloudDark: '#6a7078', cover: 0.85,
      },
    };
    const p = presets[preset] || presets.clear;
    this.renderer.toneMappingExposure = p.exposure;
    if (this.scene.fog) {
      this.scene.fog.color.set(p.fogColor);
      this.scene.fog.near = p.fogNear;
      this.scene.fog.far = p.fogFar;
    }
    if (this.world?.sun) this.world.sun.intensity = (T.sunIntensity || 1) * p.sun;
    this.world?.root?.traverse((o) => {
      if (o.isHemisphereLight) o.intensity = (T.hemi?.[2] || 1) * p.hemi;
    });
    const sky = this.world?.sky;
    if (sky?.material?.uniforms && p.sky) {
      const u = sky.material.uniforms;
      u.top.value.set(p.sky[0]);
      u.mid.value.set(p.sky[1]);
      u.horizon.value.set(p.sky[2]);
      if (p.cloudLight) u.cloudLight?.value.set(p.cloudLight);
      if (p.cloudDark) u.cloudDark?.value.set(p.cloudDark);
      if (p.cover != null) u.cover.value = p.cover;
    }
    this._weather = preset;
    this.setRain(preset === 'rain');
  }

  /** Soft rain particle curtain around the player (client-only FX). */
  setRain(on) {
    if (!on) {
      if (this._rain) {
        this.scene.remove(this._rain);
        this._rain.geometry?.dispose();
        this._rain.material?.dispose();
        this._rain = null;
      }
      return;
    }
    if (this._rain) return;
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: '#a8c0d0', size: 0.08, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this._rain = new THREE.Points(geo, mat);
    this._rain.frustumCulled = false;
    this.scene.add(this._rain);
  }

  updateRain(dt) {
    if (!this._rain || !this.player) return;
    const p = this._rain.geometry.attributes.position.array;
    const cx = this.player.pos.x, cz = this.player.pos.z;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] -= (9 + (i % 7)) * dt;
      if (p[i + 1] < 0) {
        p[i] = cx + (Math.random() - 0.5) * 40;
        p[i + 1] = 12 + Math.random() * 8;
        p[i + 2] = cz + (Math.random() - 0.5) * 40;
      }
    }
    this._rain.geometry.attributes.position.needsUpdate = true;
    this._rain.position.set(0, 0, 0);
  }

  /** (Re)builds the weapon slots and their first-person models, e.g. when the server trims a loadout. */
  setLoadout(ids) {
    if (this.slots) for (const s of this.slots) this.vmRoot.remove(s.vm.root);
    this.slots = ids.map((id) => {
      const def = this.weapons[id];
      return { id, def, mag: def.magSize, reserve: def.reserve, vm: buildViewModel(id, this.cosmetic) };
    });
    for (const s of this.slots) { s.vm.root.visible = false; this.vmRoot.add(s.vm.root); }
    this.slotIdx = 0;
    this.slots[0].vm.root.visible = true;
    this.reloadT = 0;
    this.updateSlotsHud();
    this.updateAmmoHud();
  }

  setLethal(type) {
    this.lethal = this.catalog.equipment[type]?.lethal ? type : 'frag';
    this.hud.setLethal(this.catalog.equipment[this.lethal].name);
  }

  setPerk(id) {
    const p = this.catalog.perks?.[id] || this.catalog.perks?.doubletime;
    this.perk = p || { id: 'doubletime', moveMult: 1, sprintMult: 1 };
    this.trophyUntil = 0;
    this.trophyReadyAt = 0;
    this.hud.setPerk?.(this.perk);
  }

  // ------------------------------------------------------------ session
  async start(mode, { loadout, cosmetic, user, lethal = 'frag', perk = 'doubletime' }) {
    this.user = user;
    this.cosmetic = cosmetic;
    this.mode = mode;
    this.ended = false;
    this.paused = false;
    this.hud.reset();
    this.hud.setCoins(user.coins);
    this.effects.clear();
    this.player.kills = 0;
    this.player.deaths = 0;
    this.player.name = user.username;
    this.player.team = null;
    this.lastKillAt = -99;
    this.clearTransient();
    this.streak = 0;
    this.rewards = { uav: false, airstrike: false };
    this.uavUntil = this.enemyUavUntil = 0;

    this.vmRoot.clear();
    this.slots = null;
    this.knifeVm = buildKnifeViewModel(cosmetic);
    this.vmRoot.add(this.knifeVm.root);
    this.setLoadout(loadout);
    this.setLethal(lethal);
    this.setPerk(perk);
    if (this.vmFlashSprite) this.vmScene.remove(this.vmFlashSprite);
    this.vmFlashSprite = new THREE.Sprite(this.effects.flashMat.clone());
    this.vmFlashSprite.visible = false;
    this.vmScene.add(this.vmFlashSprite);

    document.getElementById('results').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    this.stage.classList.remove('cinematic');
    await mode.start();
    this.running = true;
    this.paused = !!mode.pausable;
    const ctp = document.getElementById('click-to-play');
    document.getElementById('ctp-title').textContent = mode.title;
    ctp.classList.remove('hidden');
  }

  spawnPlayer(x, z, yaw, grenades = this.catalog.equipment[this.lethal].perLife) {
    const p = this.player;
    this.grenades = grenades;
    this.hud.setGrenades(grenades);
    this.meleeT = this.meleeCd = this.throwT = 0;
    if (this.knifeVm) this.knifeVm.root.visible = false;
    if (this.slot) this.slot.vm.root.visible = true;
    p.pos.set(x, 0, z);
    p.vel.set(0, 0, 0);
    p.hp = 100;
    p.alive = true;
    p.crouch = false;
    p.lastDamageAt = -99;
    this.crouchToggle = false;
    this.crouchAmt = 0;
    this.camY = EYE_STAND;
    this.yaw = yaw;
    this.pitch = 0;
    this.recoilP = this.recoilY = 0;
    this.onGround = true;
    this.semiReady = true;
    this.reloadT = 0;
    this.switchT = 0;
    this.fireCd = 0;
    this.adsAmt = 0;
    this.sprintAmt = 0;
    this.deathCam = null;
    for (const s of this.slots) { s.mag = s.def.magSize; s.reserve = s.def.reserve; }
    this.hud.hideDeath();
    this.hud.setHealth(100);
    this.stage.classList.remove('cinematic');
    this.updateAmmoHud();
  }

  killPlayer(killerEntity, killerName) {
    const p = this.player;
    p.alive = false;
    p.hp = 0;
    this.streak = 0;
    this.reloadT = 0;
    this.meleeT = this.throwT = 0;
    if (this.knifeVm) this.knifeVm.root.visible = false;
    this.hud.setHealth(0);
    this.hud.setScope(false);
    this.stage.classList.add('cinematic');
    const kp = killerEntity?.pos;
    this.deathCam = { t: 0, killer: kp ? kp.clone() : null, killerEntity };
    this.hud.showDeath(killerName, 3.5);
  }

  stop() {
    this.running = false;
    this.ended = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.mode?.stop();
    this.mode = null;
    this.ai.clear();
    this.clearTransient();
    this.setRain(false);
    this.player.alive = false;
    for (const id of ['results', 'pause-menu', 'click-to-play']) document.getElementById(id).classList.add('hidden');
    this.hud.reset();
  }

  showResults(title, stats) {
    this.ended = true;
    this.running = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.stage.classList.add('cinematic');
    document.getElementById('results-title').textContent = title;
    document.getElementById('res-kills').textContent = stats.kills;
    document.getElementById('res-deaths').textContent = stats.deaths;
    document.getElementById('res-kd').textContent = (stats.kills / Math.max(1, stats.deaths)).toFixed(2);
    document.getElementById('res-coins').textContent = `+${stats.coins}`;
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    this.hud.hideDeath();
  }

  // ------------------------------------------------------------ weapons
  get slot() { return this.slots[this.slotIdx]; }

  switchTo(i) {
    if (!this.slots || i === this.slotIdx || i < 0 || i >= this.slots.length || !this.player.alive) return;
    this.slot.vm.root.visible = false;
    this.slotIdx = i;
    this.slot.vm.root.visible = true;
    this.reloadT = 0;
    this.switchT = 0.4;
    this.hud.setReloadHint(false);
    this.updateSlotsHud();
    this.updateAmmoHud();
    audio.click();
  }

  startReload() {
    const s = this.slot;
    if (!s || this.reloadT > 0 || s.mag >= s.def.magSize || s.reserve <= 0 || !this.player.alive) return;
    this.reloadT = s.def.reloadTime;
    this.reloadTotal = s.def.reloadTime;
    this.hud.setReloadHint(false);
    audio.reload(s.id);
  }

  updateAmmoHud() {
    const s = this.slot;
    if (!s) return;
    this.hud.setAmmo(s.def.name, s.mag, s.reserve, s.def.magSize);
  }

  updateSlotsHud() {
    this.hud.setSlots(this.slots.map((s) => s.def.name), this.slotIdx);
  }

  addScavengerAmmo() {
    const s = this.slot;
    s.reserve = Math.min(s.def.reserve * 2, s.reserve + Math.ceil(s.def.magSize / 2));
    this.updateAmmoHud();
  }

  // ------------------------------------------------------------ knife
  melee() {
    if (!this.player.alive || this.meleeT > 0 || this.throwT > 0 || this.meleeCd > 0 || !this.mode) return;
    this.meleeT = MELEE_TIME;
    this.meleeCd = this.catalog.equipment.knife.cooldown;
    this.meleeResolved = false;
    this.reloadT = 0;
    this.hud.setReloadHint(false);
    this.slot.vm.root.visible = false;
    this.knifeVm.root.visible = true;
  }

  resolveMelee() {
    const K = this.catalog.equipment.knife;
    const p = this.player;
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const fh = Math.hypot(dir.x, dir.z) || 1;
    const fx = dir.x / fh, fz = dir.z / fh;
    let target = null, best = K.range;
    for (const e of this.mode.targets()) {
      if (e === p || !e.alive) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > best || Math.abs(e.pos.y - p.pos.y) > 1.6) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < Math.cos(0.9)) continue;
      const chest = new THREE.Vector3(e.pos.x, e.pos.y + (e.crouch ? 0.8 : 1.1), e.pos.z);
      if (!this.ai.losClear(origin, chest)) continue;
      target = e;
      best = d;
    }
    audio.knife(!!target);
    if (target) {
      this.effects.impact(new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z), null, 'ink');
      p.vel.x += fx * 3;
      p.vel.z += fz * 3;
    }
    this.mode.onMelee(origin, dir, target, K);
  }

  // ------------------------------------------------------------ grenades
  throwGrenade() {
    if (!this.player.alive || this.grenades <= 0 || this.throwT > 0 || this.meleeT > 0 || !this.mode) return;
    this.grenades--;
    this.hud.setGrenades(this.grenades);
    this.throwT = THROW_TIME;
    this.throwReleased = false;
    this.reloadT = 0;
    audio.throwWhoosh();
  }

  releaseGrenade() {
    const L = this.catalog.equipment[this.lethal];
    const q = this.camera.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const origin = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.35).addScaledVector(right, 0.12);
    const dir = fwd.clone();
    dir.y += 0.12;
    dir.normalize();
    const vel = dir.multiplyScalar(L.speed);
    vel.x += this.player.vel.x * 0.6;
    vel.z += this.player.vel.z * 0.6;
    const blocked = MapLib.raycastBoxes(this.map.boxes, origin.x, origin.y, origin.z, fwd.x, fwd.y, fwd.z, 0.4);
    if (blocked && !blocked.ground) origin.copy(this.camera.position);
    this.mode.onGrenadeThrow(origin, vel, this.lethal);
  }

  /**
   * Launches a visible frag or molotov. With `detonate` the explosion / fire is resolved locally
   * (single-player); in multiplayer the server sends the authoritative explosion or fire.
   */
  spawnGrenade({ ox, oy, oz, vx, vy, vz, fuse, owner = null, detonate = false, gid = null, type = 'frag' }) {
    const molotov = type === 'molotov';
    const sim = MapLib.simulateGrenade(this.map.boxes, ox, oy, oz, vx, vy, vz, fuse, { impact: molotov, half: this.map.HALF });
    let mesh;
    if (!molotov && this._grenadeHd) {
      mesh = this._grenadeHd.clone(true);
      mesh.scale.setScalar(0.55);
    } else {
      const geo = molotov ? this.bottleGeo : this.grenadeGeo;
      mesh = new THREE.Mesh(geo, molotov ? this.bottleMat : this.grenadeMat);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 40), new THREE.LineBasicMaterial({ color: 0x000000 })));
    }
    mesh.castShadow = true;
    if (molotov) {
      const wick = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.effects.fireTex, color: '#ffae4a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      wick.position.y = 0.14;
      wick.scale.setScalar(0.18);
      mesh.add(wick);
    }
    mesh.position.set(ox, oy, oz);
    this.scene.add(mesh);
    const g = { sim, t: 0, fuse: molotov ? sim.t : fuse, owner, detonate, gid, mesh, type, bounceIdx: 0, pos: mesh.position, done: false };
    this.liveGrenades.push(g);
    return g;
  }

  removeGrenade(g) {
    g.done = true;
    this.scene.remove(g.mesh);
    for (const c of g.mesh.children) { c.geometry?.dispose(); if (c.isSprite) c.material.dispose(); }
    const i = this.liveGrenades.indexOf(g);
    if (i >= 0) this.liveGrenades.splice(i, 1);
  }

  // ------------------------------------------------------------ rockets
  /** A flying rocket. With `detonate` the impact is resolved locally (single-player). */
  spawnRocket({ ox, oy, oz, dx, dy, dz, owner = null, detonate = false, rid = null }) {
    const W = this.weapons.rpg;
    const pos = new THREE.Vector3(ox, oy, oz);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const r = { pos, vel: dir.clone().multiplyScalar(W.projectile.speed), t: 0, owner, detonate, rid, fx: this.effects.addRocket(pos, dir), done: false };
    this.rockets.push(r);
    if (owner !== this.player) {
      const d = this.camera.position.distanceTo(pos);
      audio.rocketLaunch(d, this._v.subVectors(pos, this.camera.position).normalize().dot(this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion)));
    }
    return r;
  }

  retireRocket(r) {
    if (r.done) return;
    r.done = true;
    this.effects.removeRocket(r.fx);
    const i = this.rockets.indexOf(r);
    if (i >= 0) this.rockets.splice(i, 1);
  }

  removeRocketById(rid) {
    const r = this.rockets.find((x) => x.rid === rid);
    if (r) this.retireRocket(r);
  }

  updateRockets(dt) {
    const W = this.weapons.rpg;
    const dir = new THREE.Vector3();
    for (const r of [...this.rockets]) {
      let impact = null;
      for (let s = 0; s < 2 && !impact; s++) {
        const sdt = dt / 2;
        r.vel.y -= W.projectile.gravity * sdt;
        const sp = r.vel.length();
        dir.copy(r.vel).divideScalar(sp);
        const len = sp * sdt;
        const wall = MapLib.raycastBoxes(this.map.boxes, r.pos.x, r.pos.y, r.pos.z, dir.x, dir.y, dir.z, len);
        let t = wall ? wall.t : Infinity;
        for (const e of this.mode.targets()) {
          if (!e.alive || e === r.owner) continue;
          const h = MapLib.rayHumanoid(r.pos.x, r.pos.y, r.pos.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y, e.pos.z, e.crouch, Math.min(t, len));
          if (h && h.t < t) t = h.t;
        }
        r.t += sdt;
        if (t <= len) {
          impact = r.pos.clone().addScaledVector(dir, Math.max(0, t - 0.08));
        } else {
          r.pos.addScaledVector(dir, len);
          if (r.t >= W.projectile.life || Math.abs(r.pos.x) > this.map.HALF + 2 || Math.abs(r.pos.z) > this.map.HALF + 2) impact = r.pos.clone();
        }
      }
      if (impact) {
        this.retireRocket(r);
        if (r.detonate) this.blast(impact, r.owner, 'rpg', W.blast, 1.3);
      } else {
        this.effects.moveRocket(r.fx, r.pos, dir, dt);
      }
    }
  }

  // ------------------------------------------------------------ fire
  /** Burning molotov pool. With `detonate` it damages entities locally (single-player). */
  startFire(pos, owner = null, detonate = false, duration = this.catalog.equipment.molotov.duration) {
    const M = this.catalog.equipment.molotov;
    this.effects.fireArea(new THREE.Vector3(pos.x, pos.y, pos.z), M.radius, duration);
    this.fires.push({ x: pos.x, y: pos.y, z: pos.z, r: M.radius, until: this.time + duration, owner, detonate, acc: 0, crackleT: 0 });
  }

  updateFires(dt) {
    const M = this.catalog.equipment.molotov;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      if (this.time >= f.until) { this.fires.splice(i, 1); continue; }
      f.crackleT -= dt;
      if (f.crackleT <= 0) {
        f.crackleT = 0.08 + Math.random() * 0.14;
        audio.crackle(Math.hypot(this.player.pos.x - f.x, this.player.pos.z - f.z));
      }
      if (!f.detonate) continue;
      f.acc += dt;
      if (f.acc < 0.25) continue;
      f.acc -= 0.25;
      for (const e of [...this.mode.targets()]) {
        if (!e.alive || Math.hypot(e.pos.x - f.x, e.pos.z - f.z) > f.r || Math.abs(e.pos.y - f.y) > 1.5) continue;
        this.damageEntity(e, M.dps * 0.25, f.owner, false, 'molotov', f, true);
      }
    }
  }

  updateGrenades(dt) {
    for (const g of [...this.liveGrenades]) {
      g.t += dt;
      const s = g.sim.samples, n = s.length / 3;
      const f = Math.min(n - 1, g.t * 60);
      const i = Math.floor(f), k = f - i, j = Math.min(n - 1, i + 1);
      g.mesh.position.set(
        s[i * 3] + (s[j * 3] - s[i * 3]) * k,
        s[i * 3 + 1] + (s[j * 3 + 1] - s[i * 3 + 1]) * k,
        s[i * 3 + 2] + (s[j * 3 + 2] - s[i * 3 + 2]) * k,
      );
      if (i < n - 2) g.mesh.rotation.x += dt * 12;
      while (g.bounceIdx < g.sim.bounces.length && g.sim.bounces[g.bounceIdx] <= i) {
        g.bounceIdx++;
        audio.bounce(this.player.pos.distanceTo(g.mesh.position));
      }
      if (g.t < g.fuse) continue;
      if (this.grenadeBlockedByTrophy(g)) {
        this.removeGrenade(g);
        this.effects.glassBurst(g.mesh.position);
        audio.bounce(0.2);
        continue;
      }
      if (g.type === 'molotov') {
        this.removeGrenade(g);
        this.effects.glassBurst(g.mesh.position);
        audio.shatter(this.player.pos.distanceTo(g.mesh.position));
        if (g.detonate) this.startFire(MapLib.fireSpot(this.map.boxes, g.sim.x, g.sim.y, g.sim.z), g.owner, true);
      } else if (g.detonate) {
        this.removeGrenade(g);
        this.blast(new THREE.Vector3(g.sim.x, g.sim.y, g.sim.z), g.owner, 'frag', this.catalog.equipment.frag, 1);
      } else if (g.t > g.fuse + 1.5) {
        this.removeGrenade(g);
      }
    }
    let warn = null, nearest = 7.5;
    for (const g of this.liveGrenades) {
      if (g.owner === this.player) continue;
      const d = this.player.pos.distanceTo(g.mesh.position);
      if (d >= nearest || !this.player.alive) continue;
      nearest = d;
      const dx = g.mesh.position.x - this.player.pos.x, dz = g.mesh.position.z - this.player.pos.z;
      warn = -(Math.atan2(-dx, -dz) - this.yaw);
    }
    this.hud.grenadeWarning(warn);
  }

  // ------------------------------------------------------------ explosions
  explosionFx(pos, scale = 1) {
    this.effects.explosion(pos, scale);
    const d = this.camera.position.distanceTo(pos);
    const toSrc = this._v.subVectors(pos, this.camera.position).normalize();
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.explosion(d, toSrc.dot(right), scale > 1);
    this.shake = Math.max(this.shake || 0, Math.max(0, 1.8 - d / 14) * scale);
  }

  /** Single-player blast: visuals plus damage to everyone exposed within the radius. */
  blast(pos, owner, weaponId, spec, scale) {
    this.explosionFx(pos, scale);
    if (!this.mode) return;
    for (const e of [...this.mode.targets()]) {
      if (!e.alive || (weaponId === 'airstrike' && e === owner)) continue;
      const dmg = MapLib.blastDamage(this.map.boxes, pos.x, pos.y, pos.z, e.pos.x, e.pos.y, e.pos.z, e.crouch, spec);
      if (dmg > 0) this.damageEntity(e, dmg, owner, false, weaponId, pos);
    }
    this.ai.onGunshot(owner, pos, this.time);
  }

  schedule(delay, fn) { this.scheduled.push({ at: this.time + delay, fn }); }

  clearTransient() {
    for (const g of [...this.liveGrenades]) this.removeGrenade(g);
    for (const r of [...this.rockets]) this.retireRocket(r);
    this.fires = [];
    this.scheduled = [];
    this.meleeT = this.throwT = 0;
    if (this.chatOpen) this.closeChat();
  }

  // ------------------------------------------------------------ killstreaks
  setStreakState(streak, rewards) {
    for (const k of Object.values(this.catalog.killstreaks)) {
      if (rewards[k.id] && !this.rewards[k.id]) {
        this.hud.message(`${k.name} ready`, `Press ${k.key}`);
        audio.radio();
      }
    }
    this.streak = streak;
    this.rewards = { ...rewards };
  }

  /** Single-player kill bookkeeping: counts the streak locally and grants rewards. */
  registerKillStreak(weaponId) {
    const multi = this.announceKill();
    if (weaponId === 'airstrike') return;
    const streak = this.streak + 1;
    const rewards = { ...this.rewards };
    for (const k of Object.values(this.catalog.killstreaks)) {
      const thresholds = Array.isArray(k.kills) ? k.kills : [k.kills];
      if (thresholds.includes(streak)) rewards[k.id] = true;
    }
    this.setStreakState(streak, rewards);
    if (!multi) this.announceStreak(streak);
  }

  announceKill() {
    const multi = this.time - this.lastKillAt < 2.5;
    this.lastKillAt = this.time;
    if (multi) this.hud.message('Double Kill');
    return multi;
  }

  announceStreak(streak) {
    const msgs = { 8: 'Unstoppable', 12: 'Legendary', 16: 'Nuclear' };
    if (msgs[streak]) this.hud.message(msgs[streak], `${streak} kills`);
  }

  useStreak(kind) {
    if (!this.player.alive || !this.rewards[kind] || !this.mode) return;
    if (kind === 'uav') this.mode.useUav();
    else this.mode.useAirstrike(this.aimPoint(), this.yaw);
  }

  /** Deploy Trophy System (perk) — destroys nearby enemy grenades / molotovs for a few seconds. */
  activateTrophy() {
    if (!this.player.alive || !this.perk?.trophy || !this.mode) return;
    if (this.time < (this.trophyReadyAt || 0) || this.time < (this.trophyUntil || 0)) return;
    const spec = this.perk.trophy;
    if (this.mode.useTrophy) {
      this.mode.useTrophy();
      return;
    }
    this.trophyUntil = this.time + spec.duration;
    this.trophyReadyAt = this.trophyUntil + spec.cooldown;
    this.trophyPos = { x: this.player.pos.x, z: this.player.pos.z };
    this.hud.message('Trophy System', `${spec.duration}s active`);
    audio.radio();
  }

  /** True when an active Trophy covers this grenade impact (not the thrower's own). */
  grenadeBlockedByTrophy(g) {
    const pos = { x: g.sim.x, z: g.sim.z };
    if (this.perk?.trophy && this.trophyUntil && this.time <= this.trophyUntil && g.owner !== this.player) {
      const t = this.trophyPos || this.player.pos;
      if (Math.hypot(t.x - pos.x, t.z - pos.z) <= this.perk.trophy.radius) return true;
    }
    for (const t of this.enemyTrophies || []) {
      if (this.time > t.until) continue;
      if (Math.hypot(t.x - pos.x, t.z - pos.z) <= t.radius) return true;
    }
    return false;
  }

  activateUav(duration, byName) {
    this.uavUntil = this.time + duration;
    this.hud.message('UAV online', byName ? `called in by ${byName}` : 'Enemies revealed on radar');
    audio.radio();
  }

  enemyUav(duration) {
    this.enemyUavUntil = this.time + duration;
    this.hud.message('Enemy UAV', 'You are visible on their radar');
    audio.radio();
  }

  /** Point on the ground where the crosshair meets the world (for airstrikes). */
  aimPoint() {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const hit = MapLib.raycastBoxes(this.map.boxes, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 160);
    const t = hit ? hit.t : 60;
    const lim = this.map.HALF - 2;
    return {
      x: Math.max(-lim, Math.min(lim, origin.x + dir.x * t)),
      z: Math.max(-lim, Math.min(lim, origin.z + dir.z * t)),
    };
  }

  airstrikeBombs(point, yaw) {
    const A = this.catalog.equipment.airstrike;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const lim = this.map.HALF - 2;
    const bombs = [];
    for (let i = 0; i < A.bombs; i++) {
      const off = (i - (A.bombs - 1) / 2) * A.spacing;
      const x = Math.max(-lim, Math.min(lim, point.x + fx * off)), z = Math.max(-lim, Math.min(lim, point.z + fz * off));
      bombs.push([x, MapLib.surfaceHeight(this.map.boxes, x, z), z]);
    }
    return bombs;
  }

  /** Jet flyby over the bomb line. With `owner` the bombs are also scheduled and resolved locally. */
  airstrikeFx(bombs, yaw, delay, interval, owner = null) {
    if (!bombs?.length) return;
    const mid = bombs[Math.floor(bombs.length / 2)];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const duration = 2 * (delay + interval * Math.floor(bombs.length / 2));
    this.effects.jetFlyby(
      new THREE.Vector3(mid[0] - fx * 160, 48, mid[2] - fz * 160),
      new THREE.Vector3(mid[0] + fx * 160, 48, mid[2] + fz * 160),
      duration,
    );
    audio.jet(duration);
    if (!owner) return;
    const A = this.catalog.equipment.airstrike;
    bombs.forEach((b, i) => this.schedule(delay + i * interval, () => this.blast(new THREE.Vector3(b[0], b[1], b[2]), owner, 'airstrike', A, 1.5)));
  }

  /** Nearest hit along a ray against world and the mode's damageable entities. */
  trace(origin, dir, maxDist, shooter) {
    const wall = MapLib.raycastBoxes(this.map.boxes, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
    let t = wall ? wall.t : maxDist;
    let entity = null, head = false;
    const targets = this.mode ? this.mode.targets() : [];
    for (const e of targets) {
      if (e === shooter || !e.alive) continue;
      const h = MapLib.rayHumanoid(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, e.pos.x, e.pos.y, e.pos.z, e.crouch, t);
      if (h && h.t < t) { t = h.t; entity = e; head = h.head; }
    }
    const point = origin.clone().addScaledVector(dir, t);
    let normal = null;
    if (!entity && wall) {
      if (wall.ground) normal = new THREE.Vector3(0, 1, 0);
      else {
        const b = wall.box;
        const faces = [
          [Math.abs(point.x - b.minX), -1, 0, 0], [Math.abs(point.x - b.maxX), 1, 0, 0],
          [Math.abs(point.y - b.minY), 0, -1, 0], [Math.abs(point.y - b.maxY), 0, 1, 0],
          [Math.abs(point.z - b.minZ), 0, 0, -1], [Math.abs(point.z - b.maxZ), 0, 0, 1],
        ];
        faces.sort((a, c) => a[0] - c[0]);
        normal = new THREE.Vector3(faces[0][1], faces[0][2], faces[0][3]);
      }
    }
    return { t, point, normal, entity, head, hitWorld: !!wall && !entity };
  }

  fire() {
    const s = this.slot;
    const def = s.def;
    if (this.reloadT > 0 || this.switchT > 0 || this.fireCd > 0 || this.meleeT > 0 || this.throwT > 0) return;
    if (!def.auto && !this.semiReady) return;
    if (this.sprinting) { this.sprintBlock = 0.18; return; }
    if (s.mag <= 0) {
      if (this.semiReady || def.auto) audio.click();
      this.semiReady = false;
      if (s.reserve > 0) this.startReload();
      else this.hud.setReloadHint(true, 'No ammo');
      return;
    }
    this.semiReady = false;
    s.mag--;
    this.fireCd = 1 / def.fireRate;
    this.player.lastShotAt = this.time;

    const hs = Math.hypot(this.player.vel.x, this.player.vel.z);
    let spread = lerp(def.hipSpread, def.adsSpread, this.adsAmt);
    spread *= 1 + Math.min(1, hs / 5) * 0.9 * (1 - this.adsAmt * 0.6);
    if (!this.onGround) spread *= 2;
    if (this.player.crouch) spread *= 0.75;

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

    if (def.projectile) {
      const block = MapLib.raycastBoxes(this.map.boxes, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 0.8);
      const start = origin.clone().addScaledVector(dir, block && !block.ground ? Math.max(0, block.t - 0.15) : 0.8);
      this.pitch = Math.min(1.5, this.pitch + def.recoil * 0.4);
      this.recoilP += def.recoil * 0.6;
      this.vmKick = 1;
      this.shake = Math.max(this.shake || 0, 0.9);
      this.effects.backblast(this.camera.position.clone(), dir);
      this.effects.muzzleFlash(start, 1.1);
      audio.rocketLaunch();
      this.mode.onRocket(start, dir, def);
      this.updateAmmoHud();
      if (s.mag === 0 && s.reserve > 0) setTimeout(() => this.startReload(), 350);
      else if (s.reserve <= 0) this.hud.setReloadHint(true, 'No rockets');
      return;
    }

    const hit = this.trace(origin, dir, Math.min(300, def.range * 3), this.player);

    const kick = def.recoil * (1 - this.adsAmt * 0.35) * (this.player.crouch ? 0.8 : 1);
    this.pitch = Math.min(1.5, this.pitch + kick * 0.45);
    this.recoilP += kick * 0.55;
    this.recoilY += (Math.random() - 0.5) * kick * 0.7;
    this.vmKick = 1;
    this.shake = Math.max(this.shake || 0, def.id === 'sniper' ? 0.6 : 0.15);

    const vmMuzzle = s.vm.muzzle.getWorldPosition(new THREE.Vector3());
    this.vmFlashSprite.position.copy(vmMuzzle);
    this.vmFlashSprite.scale.setScalar(def.id === 'sniper' ? 0.35 : def.id === 'pistol' ? 0.16 : 0.24);
    this.vmFlashSprite.material.rotation = Math.random() * Math.PI;
    this.vmFlashSprite.visible = this.adsAmt < 0.9 || def.id !== 'sniper';
    this.vmFlashT = 0.04;
    this.vmFlash.position.copy(vmMuzzle);
    this.vmFlash.intensity = 3;

    const worldMuzzle = this.camera.localToWorld(vmMuzzle.clone().multiplyScalar(1));
    this.effects.tracer(worldMuzzle, hit.point, def.id === 'sniper' ? 1.4 : 1);
    if (hit.entity) this.effects.impact(hit.point, null, 'ink');
    else if (hit.normal) this.effects.impact(hit.point, hit.normal);
    audio.shot(def.id);

    this.mode.onLocalShot(origin, dir, hit, def);
    this.updateAmmoHud();
    if (s.mag === 0 && s.reserve > 0) setTimeout(() => this.startReload(), 180);
    if (s.mag <= Math.ceil(def.magSize * 0.25)) this.hud.setReloadHint(s.reserve > 0, s.reserve > 0 ? undefined : 'Low ammo');
  }

  /** Bot/remote shot visuals + (in SP) damage resolution. */
  entityShoot(src, eye, dir, weaponId, dmgMult = 1) {
    const def = this.weapons[weaponId];
    const hit = this.trace(eye, dir, Math.min(300, def.range * 2.5), src);
    const muzzle = src.model?.muzzle ? src.model.muzzle.getWorldPosition(new THREE.Vector3()) : eye;
    this.shotVisuals(muzzle, hit.point, weaponId, hit.normal, !!hit.entity);
    src.lastShotAt = this.time;
    this.ai.onGunshot(src, src.pos, this.time);
    if (hit.entity) {
      let dmg = def.damage * (hit.head ? def.headMult : 1) * dmgMult;
      if (hit.t > def.range) dmg *= 0.65;
      this.damageEntity(hit.entity, dmg, src, hit.head, weaponId);
    }
  }

  shotVisuals(muzzle, end, weaponId, normal, hitBody) {
    this.effects.muzzleFlash(muzzle, weaponId === 'sniper' ? 0.9 : 0.55);
    this.effects.tracer(muzzle, end, 0.8);
    if (hitBody) this.effects.impact(end, null, 'ink');
    else if (normal) this.effects.impact(end, normal);
    const d = this.player.pos.distanceTo(muzzle);
    const toSrc = this._v.subVectors(muzzle, this.camera.position).normalize();
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.shot(weaponId, Math.max(1, d), toSrc.dot(right));
  }

  /** quiet: skip the hitmarker for non-lethal damage ticks (fire). */
  damageEntity(target, dmg, attacker, head, weaponId, from = attacker?.pos, quiet = false) {
    if (!target.alive) return;
    target.hp -= dmg;
    target.lastDamageAt = this.time;
    if (target.isPlayer) this.onPlayerHurt(from);
    else target.onDamaged?.(attacker, this.time);
    const killed = target.hp <= 0;
    if (attacker?.isPlayer && attacker !== target && (!quiet || killed)) {
      this.hud.hitmarker(head, killed);
      audio.hit(head, killed);
    }
    if (killed) this.mode.onKill(attacker, target, head, weaponId);
  }

  onPlayerHurt(fromPos) {
    this.player.lastDamageAt = this.time;
    this.hud.setHealth(this.player.hp);
    if (this.time - (this.lastHurtSound ?? -9) > 0.3) {
      this.lastHurtSound = this.time;
      audio.hurt();
    }
    this.shake = Math.max(this.shake || 0, 0.35);
    if (fromPos) {
      const dx = fromPos.x - this.player.pos.x, dz = fromPos.z - this.player.pos.z;
      const worldAng = Math.atan2(-dx, -dz);
      this.hud.damageFrom(-(worldAng - this.yaw));
    }
  }

  // ------------------------------------------------------------ frame
  frame() {
    // Cap tab-switch spikes only. Never clamp sim below real time — that felt like slow-mo when FPS dipped.
    const raw = Math.min(0.12, this.clock.getDelta());
    if (!this.mode) return;
    this.fpsAcc += raw;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      if (this.showFps) this.hud.setFps(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    if (this.running && !this.paused) {
      this.simAcc += raw;
      const STEP = 1 / 60;
      const MAX_STEPS = 7;
      let steps = 0;
      while (this.simAcc >= STEP && steps < MAX_STEPS) {
        this.time += STEP;
        this.update(STEP, steps === 0);
        this.simAcc -= STEP;
        steps++;
      }
      if (steps === 0) {
        this.time += this.simAcc;
        this.update(this.simAcc, true);
        this.simAcc = 0;
      } else if (steps >= MAX_STEPS) {
        this.simAcc = 0;
        this.mouseDX = this.mouseDY = 0;
      }
    } else if (this.running) {
      this.mode?.idle?.(raw);
      this.mouseDX = this.mouseDY = 0;
      this.simAcc = 0;
    } else {
      this.mouseDX = this.mouseDY = 0;
      this.simAcc = 0;
    }

    this.world.update(raw, this.clock.elapsedTime);
    this.graphics?.tick();
    const showVm = this.running && this.player.alive && !!this.slots;
    if (this.composer) {
      this.vmPass.enabled = showVm;
      const u = this.gradePass.uniforms, G = this.map.theme.grade || {};
      u.time.value = this.clock.elapsedTime;
      u.grain.value = (G.grain ?? 0.03) * (this.quality.grainScale ?? 1);
      u.vignette.value = (G.vignette ?? 0.08) + (this.stage.classList.contains('cinematic') ? 0.12 : 0);
      u.saturation.value = G.saturation ?? 0.96;
      u.contrast.value = G.contrast ?? 1.02;
      if (G.tint) u.tint.value.set(...G.tint);
      if (G.lift) u.lift.value.set(...G.lift);
      this.composer.render();
      return;
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (showVm) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }

  /** @param {boolean} [consumeMouse=true] apply look input this step only once per frame */
  update(dt, consumeMouse = true) {
    this.updatePlayer(dt, consumeMouse);
    this.updateWeapon(dt);
    this.mode.update(dt);
    if (!this.mode) return;
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.scheduled[i].at > this.time) continue;
      const { fn } = this.scheduled.splice(i, 1)[0];
      fn();
      if (!this.mode) return;
    }
    this.updateGrenades(dt);
    this.updateRain(dt);
    this.updateRockets(dt);
    this.updateFires(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
    if (consumeMouse) this.mouseDX = this.mouseDY = 0;
  }

  updatePlayer(dt, consumeMouse = true) {
    const p = this.player;
    const k = this.keys;
    if (!p.alive) {
      this.sprinting = false;
      return;
    }
    if (consumeMouse) {
      const sensMul = (this.camera.fov / this.baseFov) * lerp(1, this.adsSens, this.adsAmt || 0);
      this.yaw -= this.mouseDX * this.sens * sensMul;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - this.mouseDY * this.sens * sensMul));
    }

    const fwd = (actionDown(k, 'forward') ? 1 : 0) - (actionDown(k, 'back') ? 1 : 0);
    const str = (actionDown(k, 'right') ? 1 : 0) - (actionDown(k, 'left') ? 1 : 0);
    const def = this.slot.def;
    const wantCrouch = this.crouchToggle || actionDown(k, 'crouch');
    if (wantCrouch) p.crouch = true;
    else if (p.crouch && this.physics.ceiling(p.pos, 0.35, p.pos.y + CROUCH_H - 0.05) > p.pos.y + STAND_H) p.crouch = false;

    this.sprintBlock = Math.max(0, (this.sprintBlock || 0) - dt);
    const ads = this.mouseDown[1] && this.switchT <= 0;
    this.sprinting = actionDown(k, 'sprint') && fwd > 0 && !ads && !p.crouch && this.reloadT <= 0 && !this.mouseDown[0] && this.sprintBlock <= 0;
    if (this.sprinting && p.crouch) p.crouch = false;

    let speed = p.crouch ? 2.6 : this.sprinting ? 7.4 : 5.0;
    if (ads) speed *= 0.6;
    speed *= def.moveMult;
    const perk = this.perk || {};
    speed *= this.sprinting ? (perk.sprintMult || 1) : (perk.moveMult || 1);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx = (wx / wl) * speed; wz = (wz / wl) * speed; }
    const accel = this.onGround ? 14 : 2.5;
    p.vel.x = damp(p.vel.x, wx, accel, dt);
    p.vel.z = damp(p.vel.z, wz, accel, dt);

    if (this.jumpQueued && this.onGround && !p.crouch) {
      p.vel.y = JUMP_V;
      this.onGround = false;
    }
    this.jumpQueued = false;
    p.vel.y -= GRAVITY * dt;

    const h = p.crouch ? CROUCH_H : STAND_H;
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    this.physics.resolveXZ(p.pos, 0.35, h);

    p.pos.y += p.vel.y * dt;
    const ceil = this.physics.ceiling(p.pos, 0.35, p.pos.y + 0.5);
    if (p.vel.y > 0 && p.pos.y + h > ceil) { p.pos.y = ceil - h; p.vel.y = 0; }
    const ground = this.physics.groundHeight(p.pos, 0.35);
    if (p.pos.y <= ground) {
      if (!this.onGround && p.vel.y < -6) { this.landDip = Math.min(0.18, -p.vel.y * 0.015); audio.step(0.25); }
      p.pos.y = ground;
      p.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && p.vel.y <= 0 && p.pos.y - ground < 0.5) {
      p.pos.y = ground;
      p.vel.y = 0;
    } else {
      this.onGround = false;
    }

    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (this.onGround && hs > 1) {
      this.stepDist = (this.stepDist || 0) + hs * dt;
      const stride = this.sprinting ? 2.3 : p.crouch ? 1.4 : 1.9;
      if (this.stepDist > stride) { this.stepDist = 0; audio.step(p.crouch ? 0.05 : this.sprinting ? 0.16 : 0.1); }
    }

    if (this.time - p.lastDamageAt > (this.perk?.regenDelay ?? REGEN_DELAY) && p.hp < 100 && this.mode.localHealth) {
      p.hp = Math.min(100, p.hp + (this.perk?.regenRate ?? REGEN_RATE) * dt);
      this.hud.setHealth(p.hp);
    }
  }

  updateWeapon(dt) {
    const p = this.player;
    const s = this.slot;
    this.fireCd -= dt;
    if (this.switchT > 0) this.switchT -= dt;
    if (this.meleeCd > 0) this.meleeCd -= dt;
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (!this.meleeResolved && this.meleeT <= MELEE_HIT_AT) { this.meleeResolved = true; this.resolveMelee(); }
      if (this.meleeT <= 0) {
        this.meleeT = 0;
        this.knifeVm.root.visible = false;
        s.vm.root.visible = true;
        this.switchT = 0.2;
      }
    }
    if (this.throwT > 0) {
      this.throwT -= dt;
      if (!this.throwReleased && this.throwT <= THROW_RELEASE_AT) { this.throwReleased = true; this.releaseGrenade(); }
      if (this.throwT < 0) this.throwT = 0;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = s.def.magSize - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take;
        s.reserve -= take;
        this.updateAmmoHud();
      }
    }
    const ads = p.alive && this.mouseDown[1] && this.switchT <= 0 && this.reloadT <= 0 && !this.sprinting;
    this.adsAmt = damp(this.adsAmt || 0, ads ? 1 : 0, s.id === 'sniper' ? 11 : 14, dt);
    this.sprintAmt = damp(this.sprintAmt || 0, this.sprinting ? 1 : 0, 10, dt);
    if (p.alive && this.mouseDown[0]) this.fire();

    if (this.vmFlashT > 0) {
      this.vmFlashT -= dt;
      if (this.vmFlashT <= 0) { this.vmFlashSprite.visible = false; this.vmFlash.intensity = 0; }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const s = this.slot;
    const cam = this.camera;
    this.crouchAmt = damp(this.crouchAmt || 0, p.crouch ? 1 : 0, 12, dt);
    const eye = lerp(EYE_STAND, EYE_CROUCH, this.crouchAmt);
    const targetY = p.pos.y + eye;
    this.camY = damp(this.camY ?? targetY, targetY, Math.abs(targetY - this.camY) > 1 ? 40 : 18, dt);
    this.landDip = damp(this.landDip || 0, 0, 8, dt);

    const hs = Math.hypot(p.vel.x, p.vel.z);
    const bobAmt = this.onGround ? Math.min(1, hs / 5) * (1 - this.adsAmt * 0.85) : 0;
    this.bobPhase = (this.bobPhase || 0) + dt * hs * 1.9;
    const bobY = Math.sin(this.bobPhase * 2) * 0.032 * bobAmt * (this.sprinting ? 1.5 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.02 * bobAmt;

    this.recoilP = damp(this.recoilP, 0, 7, dt);
    this.recoilY = damp(this.recoilY, 0, 7, dt);
    this.shake = damp(this.shake || 0, 0, 9, dt);
    const shakeX = (Math.random() - 0.5) * this.shake * 0.02, shakeY = (Math.random() - 0.5) * this.shake * 0.02;
    const str = (actionDown(this.keys, 'right') ? 1 : 0) - (actionDown(this.keys, 'left') ? 1 : 0);
    this.roll = damp(this.roll || 0, -str * 0.012 * (p.alive ? 1 : 0), 6, dt);

    if (!p.alive && this.deathCam) {
      const dc = this.deathCam;
      dc.t += dt;
      const kp = dc.killerEntity?.pos || dc.killer;
      if (kp) {
        const dx = kp.x - p.pos.x, dz = kp.z - p.pos.z;
        const want = Math.atan2(-dx, -dz);
        this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 3);
        const dy = kp.y + 1.2 - (p.pos.y + 0.5);
        this.pitch = damp(this.pitch, Math.atan2(dy, Math.hypot(dx, dz)), 3, dt);
      }
      this.camY = damp(this.camY, p.pos.y + 0.45, 3, dt);
      this.roll = damp(this.roll, 0.35, 2, dt);
    }

    const right = this._v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(p.pos.x + right.x * bobX, this.camY + bobY - this.landDip, p.pos.z + right.z * bobX);
    cam.rotation.set(this.pitch + this.recoilP + shakeY, this.yaw + this.recoilY + shakeX, this.roll);

    let fov = this.baseFov + this.sprintAmt * 6;
    fov = lerp(fov, s.def.adsFov * (this.baseFov / 74), this.adsAmt);
    cam.fov = damp(cam.fov, fov, 20, dt);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const optic = s.def.optic;
    const adsReady = p.alive && this.adsAmt > (optic === 'scope' ? 0.85 : 0.88);
    let opticHud = null;
    if (adsReady) {
      if (optic === 'scope') opticHud = 'scope';
      else if (optic === 'acog') opticHud = 'acog';
      else if (optic === 'reddot') opticHud = 'reddot';
      else if (optic === 'holo') opticHud = 'holo';
    }
    this.hud.setOptic(opticHud);
    const hideVm = opticHud === 'scope' || opticHud === 'acog' || opticHud === 'reddot' || opticHud === 'holo';
    const vm = s.vm.root;
    vm.visible = !hideVm && !(this.meleeT > 0);
    if (s.vm.warhead) s.vm.warhead.visible = s.mag > 0 && !(this.reloadT > this.reloadTotal * 0.35);

    const pose = VM_POSE[s.id] || VM_POSE.default;
    const hip = pose.hip;
    const adsPos = [0, -s.vm.sightY, pose.adsZ];
    this.swayX = damp(this.swayX || 0, -this.mouseDX * 0.0006, 10, dt);
    this.swayY = damp(this.swayY || 0, this.mouseDY * 0.0006, 10, dt);
    this.vmKick = damp(this.vmKick || 0, 0, 16, dt);
    const reloadCurve = this.reloadT > 0 ? Math.sin(Math.PI * (1 - this.reloadT / this.reloadTotal)) : 0;
    const switchCurve = this.switchT > 0 ? this.switchT / 0.4 : 0;
    const throwCurve = this.throwT > 0 ? Math.sin(Math.PI * (1 - this.throwT / THROW_TIME)) : 0;
    const a = this.adsAmt, sp = this.sprintAmt;
    const bobVm = bobAmt * (1 - a * 0.9);
    vm.position.set(
      lerp(hip[0], adsPos[0], a) + Math.cos(this.bobPhase) * 0.012 * bobVm + this.swayX * (1 - a * 0.7) - sp * 0.04,
      lerp(hip[1], adsPos[1], a) - Math.abs(Math.sin(this.bobPhase)) * 0.012 * bobVm + this.swayY * (1 - a * 0.7) - reloadCurve * 0.07 - switchCurve * 0.3 - throwCurve * 0.22 - sp * 0.03 - this.crouchAmt * 0.01,
      lerp(hip[2], adsPos[2], a) + this.vmKick * (s.id === 'sniper' ? 0.045 : 0.02)
    );
    vm.rotation.set(
      this.vmKick * 0.06 - reloadCurve * 0.5 - sp * 0.25 + this.swayY * 2 - throwCurve * 0.5,
      sp * 0.7 + this.swayX * 2,
      reloadCurve * 0.4 + sp * 0.2 - this.roll * 2 + throwCurve * 0.3
    );
    if (this.knifeVm?.root.visible) {
      const k = 1 - this.meleeT / MELEE_TIME;
      const slash = Math.min(1, Math.max(0, (k - 0.15) / 0.45));
      const e = slash * slash * (3 - 2 * slash);
      const out = Math.sin(Math.PI * k);
      const kv = this.knifeVm.root;
      kv.position.set(lerp(0.13, -0.07, e), lerp(-0.02, -0.13, e) - (1 - out) * 0.12, lerp(-0.2, -0.3, out));
      kv.rotation.set(lerp(0.5, -0.5, e), lerp(0.3, -0.2, e), lerp(-0.9, 0.8, e));
    }
    this.vmCamera.fov = damp(this.vmCamera.fov, lerp(58, 45, a), 20, dt);
    this.vmCamera.updateProjectionMatrix();
  }

  updateHud(dt) {
    const s = this.slot;
    const hs = Math.hypot(this.player.vel.x, this.player.vel.z);
    let spread = lerp(s.def.hipSpread, s.def.adsSpread, this.adsAmt) * (1 + Math.min(1, hs / 5) * 0.9);
    if (!this.onGround) spread *= 2;
    const px = (Math.tan(spread) / Math.tan((this.camera.fov * Math.PI) / 360)) * (this.stageH / 2);
    this.hud.setCrosshair(px / this.emPx, this.player.alive && this.adsAmt < 0.5 && !this.sprinting);
    this.hud.update(dt);

    const uavLeft = Math.max(0, this.uavUntil - this.time);
    const blips = this.mode.radarBlips(this.time, uavLeft > 0);
    this.hud.drawRadar(this.player.pos, this.yaw, blips);
    const board = this.mode.scoreboard();
    this.hud.setScoreboard(actionDown(this.keys, 'scoreboard'), board.rows || board, board.teams || null);
    this.mode.updateScore();
    this.hud.setStreaks(this.streak, this.rewards, this.catalog.killstreaks, uavLeft);
    this.hud.setTrophy?.(this.perk, this.trophyUntil, this.trophyReadyAt, this.time);
    const enemyUav = this.enemyUavUntil > this.time;
    this.hud.setUav(uavLeft > 0 ? `UAV ${Math.ceil(uavLeft)}s` : enemyUav ? 'ENEMY UAV' : null);

    if (this.player.alive) {
      const origin = this.camera.position;
      const dir = this._v2.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const hit = this.trace(origin, dir, 120, this.player);
      if (hit.entity?.label) hit.entity.labelT = 0.6;
    }
    for (const e of this.mode.labeled?.() || this.mode.targets()) {
      if (!e.label) continue;
      e.labelT = Math.max(0, (e.labelT || 0) - dt);
      e.label.visible = e.alive && (e.labelT > 0 || !!e.friendly);
      if (e.label.visible) e.label.position.set(e.pos.x, e.pos.y + (e.crouch ? 1.6 : 2.1), e.pos.z);
    }
  }

  makeLabel(text, color = '#ff5a4f') {
    const s = labelSprite(text, color);
    this.scene.add(s);
    return s;
  }

  bestSpawn(enemies, minDist = 0) {
    const spawns = this.map.spawns;
    const scored = spawns.map((sp) => {
      let min = 1e9;
      for (const e of enemies) if (e.alive) min = Math.min(min, Math.hypot(e.pos.x - sp.x, e.pos.z - sp.z));
      return { sp, min: min + Math.random() * 6 };
    }).filter((s) => s.min >= minDist);
    scored.sort((a, b) => b.min - a.min);
    const top = scored.slice(0, 4);
    const pick = top.length ? top[Math.floor(Math.random() * top.length)].sp : spawns[Math.floor(Math.random() * spawns.length)];
    return { x: pick.x + rand(-0.5, 0.5), z: pick.z + rand(-0.5, 0.5), yaw: Math.atan2(pick.x, pick.z) };
  }
}

import * as THREE from 'three';
import { FixedLoop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { loadSettings, QUALITY_PRESETS } from '../core/settings.js';
import { StaticColliders } from '../world/colliders.js';
import { generateCity, buildColliders } from '../world/city.js';
import { WorldView } from '../world/worldView.js';
import { Player } from '../player/player.js';
import { PlayerView } from '../player/playerView.js';
import { CameraRig } from '../player/cameraRig.js';

const SPAWN = new THREE.Vector3(0, 3, 40);
const tmpF = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const renderPos = new THREE.Vector3();

export class Game {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.quality = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;

    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.domElement.classList.add('gl');
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xdfe6e3, 60, this.quality.fogFar);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2400);

    this.city = generateCity(1337);
    this.colliders = buildColliders(this.city, new StaticColliders());
    this.worldView = new WorldView(this.scene, this.city, this.quality);

    this.player = new Player(SPAWN);
    this.playerView = new PlayerView(this.scene);
    this.cameraRig = new CameraRig(this.camera);
    this.cameraRig.yaw = 0;

    this.input = new Input(this.renderer.domElement, this.settings);
    this.state = 'menu';
    this.time = 0;
    this.intent = { wish: new THREE.Vector3(), jump: false, hooked: false };

    this._buildStartOverlay();
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loop = new FixedLoop({
      step: 1 / 120,
      preFrame: (dt) => this.preFrame(dt),
      update: (dt, first) => this.fixedUpdate(dt, first),
      render: (dt, alpha) => this.render(dt, alpha),
    });
  }

  _buildStartOverlay() {
    const el = document.createElement('div');
    el.className = 'screen visible';
    el.innerHTML = `<div class="panel"><h1 class="title">SKYHOOK</h1><p class="subtitle">Click to play</p></div>`;
    el.addEventListener('click', () => {
      this.input.requestLock();
    });
    this.container.appendChild(el);
    this.startOverlay = el;
    this.input.onLockChange = (locked) => {
      this.state = locked ? 'playing' : 'menu';
      el.classList.toggle('visible', !locked);
    };
    if (new URLSearchParams(location.search).has('autoplay')) {
      this.state = 'playing';
      el.classList.remove('visible');
    }
  }

  applyQuality() {
    this.quality = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.scene.fog.far = this.quality.fogFar;
    this.worldView.applyQuality(this.quality);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.loop.start();
  }

  /** Read per-frame input into the intent consumed by fixed steps. */
  readInput() {
    const inp = this.input;
    const m = inp.consumeMouse();
    this.cameraRig.applyMouse(m.x, m.y, this.settings.sensitivity, this.settings.invertY);
    this.cameraRig.moveBasis(tmpF, tmpR);
    const f = (inp.isDown('forward') ? 1 : 0) - (inp.isDown('back') ? 1 : 0);
    const r = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    const w = this.intent.wish.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (w.lengthSq() > 1) w.normalize();
    this.intent.jump = inp.isDown('boost');
  }

  fixedUpdate(dt, firstStep) {
    if (this.state !== 'playing') return;
    this.time += dt;
    const p = this.player;
    this.intent.hooked = false;
    p.integrate(dt, this.intent);
    p.collide(this.colliders, dt);
    p.pendingImpact = 0;
  }

  preFrame() {
    if (this.state === 'playing') this.readInput();
  }

  render(frameDt, alpha) {
    this.input.endFrame();
    const p = this.player;
    renderPos.lerpVectors(p.prevPos, p.pos, alpha);
    this.playerView.update(frameDt, renderPos, p, this.cameraRig.yaw, false);
    this.cameraRig.update(frameDt, renderPos, p.speed, this.colliders, this.settings.fovEffects);
    this.worldView.update(renderPos, this.time);
    this.renderer.render(this.scene, this.camera);
  }
}

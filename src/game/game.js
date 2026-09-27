import * as THREE from 'three';
import { FixedLoop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { loadSettings, QUALITY_PRESETS } from '../core/settings.js';
import { createRng } from '../core/rng.js';
import { StaticColliders } from '../world/colliders.js';
import { generateCity, buildColliders } from '../world/city.js';
import { WorldView } from '../world/worldView.js';
import { Player } from '../player/player.js';
import { PlayerView } from '../player/playerView.js';
import { CameraRig } from '../player/cameraRig.js';
import { Aimer } from '../player/aim.js';
import { GrappleSystem } from '../grapple/grappleSystem.js';
import { GrappleView } from '../grapple/grappleView.js';
import { CombatSystem } from '../combat/combatSystem.js';
import { Feedback } from '../combat/feedback.js';
import { GiantManager } from '../giants/giantManager.js';
import { SpeedLines } from '../fx/speedLines.js';
import { Particles } from '../fx/particles.js';
import { Hud } from '../ui/hud.js';

const SPAWN = new THREE.Vector3(0, 3, 40);
const tmpF = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const renderPos = new THREE.Vector3();

const PART_LABEL = { nape: 'nape', limb: 'limb', head: 'weak', body: 'weak' };

export class Game {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.quality = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    this.rng = createRng(Date.now() & 0xffff);

    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.domElement.classList.add('gl');
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xdfe6e3, 60, this.quality.fogFar);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2400);

    // World
    this.city = generateCity(1337);
    this.colliders = buildColliders(this.city, new StaticColliders());
    this.worldView = new WorldView(this.scene, this.city, this.quality);

    // Player + gear
    this.player = new Player(SPAWN);
    this.playerView = new PlayerView(this.scene);
    this.cameraRig = new CameraRig(this.camera);
    this.grapple = new GrappleSystem();
    this.grappleView = new GrappleView(this.scene);
    this.combat = new CombatSystem();
    this.giants = new GiantManager(this.scene, this.colliders, this.rng);
    this.particles = new Particles(this.scene, this.quality.particles);

    this.raycastHookable = (ox, oy, oz, dx, dy, dz, max, out) => this.raycastHookTargets(ox, oy, oz, dx, dy, dz, max, out);
    this.aimer = new Aimer(this.raycastHookable);

    // Overlay UI
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    container.appendChild(this.overlay);
    this.speedLines = new SpeedLines(this.overlay);
    this.feedback = new Feedback(this.overlay);
    this.hud = new Hud(this.overlay);
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.innerHTML = '<div class="ring"></div>';
    this.overlay.appendChild(this.crosshair);

    this.input = new Input(this.renderer.domElement, this.settings);
    this.state = 'menu';
    this.time = 0;
    this.hitStopT = 0;
    this.intent = { wish: new THREE.Vector3(), jump: false, hooked: false };
    this.controls = { reel: [false, false], boost: false, look: new THREE.Vector3(0, 0, -1) };
    this.pendingFire = [false, false];
    this.pendingSlash = false;
    this.hudState = {};

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

    this.spawnTestGiant();
  }

  _buildStartOverlay() {
    const el = document.createElement('div');
    el.className = 'screen visible';
    el.innerHTML = `<div class="panel"><h1 class="title">SKYHOOK</h1><p class="subtitle">Click to play</p></div>`;
    el.addEventListener('click', () => this.input.requestLock());
    this.container.appendChild(el);
    this.input.onLockChange = (locked) => {
      this.state = locked ? 'playing' : 'menu';
      el.classList.toggle('visible', !locked);
    };
    if (new URLSearchParams(location.search).has('autoplay')) {
      this.state = 'playing';
      el.classList.remove('visible');
    }
  }

  /** M3 sandbox: a single giant that plods toward the player. */
  spawnTestGiant() {
    const g = this.giants.spawn('large', -45, -10, 0, 14);
    g.brain = {
      update: (dt) => {
        const p = this.player.pos;
        const dx = p.x - g.pos.x, dz = p.z - g.pos.z;
        const d = Math.hypot(dx, dz);
        g.desiredYaw = Math.atan2(dx, dz);
        g.desiredSpeed = d > g.H * 0.6 ? g.cfg.walk : 0;
      },
    };
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
    this.particles.setViewportHeight(h * this.renderer.getPixelRatio());
    this.viewW = w;
    this.viewH = h;
  }

  start() {
    this.loop.start();
  }

  /** Everything a hook can bite into: hookable world colliders and giants. */
  raycastHookTargets(ox, oy, oz, dx, dy, dz, max, out) {
    out.attach = null;
    const hitWorld = this.colliders.raycast(ox, oy, oz, dx, dy, dz, max, out, (c) => c.hookable);
    const limit = hitWorld ? out.dist : max;
    if (this.giants.raycast(ox, oy, oz, dx, dy, dz, limit, out)) return true;
    if (hitWorld) out.attach = null;
    return hitWorld;
  }

  /** Debug helper: point the camera at a world position. */
  debugLookAt(x, y, z) {
    const p = this.player.pos;
    const dx = x - p.x, dy = y - p.y, dz = z - p.z;
    this.cameraRig.yaw = Math.atan2(-dx, -dz);
    this.cameraRig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
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

    this.aimer.update(this.camera.position, this.cameraRig.forward, this.cameraRig.right, this.player.pos);
    this.crosshair.classList.toggle('in-range', this.aimer.inRange);
    this.crosshair.classList.toggle('giant', this.aimer.inRange && !!this.aimer.giant);

    if (inp.pressed('hookLeft')) this.pendingFire[0] = true;
    if (inp.pressed('hookRight')) this.pendingFire[1] = true;
    if (inp.pressed('release')) this.grapple.releaseAll();
    if (inp.pressed('slash')) this.pendingSlash = true;
    if (inp.pressed('swap')) this.combat.trySwap();
    this.controls.reel[0] = inp.isDown('hookLeft');
    this.controls.reel[1] = inp.isDown('hookRight');
    this.controls.boost = inp.isDown('boost');
    this.controls.look.copy(this.cameraRig.forward);
  }

  preFrame(realDt) {
    // Hit-stop runs on real time so the freeze length is frame-rate independent.
    if (this.hitStopT > 0) {
      this.hitStopT -= realDt;
      this.loop.timeScale = this.hitStopT > 0 ? 0.03 : 1;
    }
    if (this.state === 'playing') this.readInput();
  }

  hitStop(duration) {
    this.hitStopT = Math.max(this.hitStopT, duration);
    this.loop.timeScale = 0.03;
  }

  fixedUpdate(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;
    const p = this.player;
    const g = this.grapple;

    g.updateOrigins(p.pos, this.cameraRig.right);
    for (let i = 0; i < 2; i++) {
      if (this.pendingFire[i]) {
        this.pendingFire[i] = false;
        g.fire(i, this.aimer.point);
      }
    }
    if (this.pendingSlash) {
      this.pendingSlash = false;
      if (this.combat.trySlash()) this.playerView.triggerSlash();
    }

    g.step(dt, p, this.controls, this.raycastHookable);
    this.intent.hooked = g.attachedCount > 0;
    this.intent.jump = this.controls.boost && p.grounded && !this.intent.hooked;
    p.integrate(dt, this.intent);
    g.constrain(p);
    p.collide(this.colliders, dt);
    this.giants.resolvePlayer(p);

    this.giants.step(dt, { player: p, game: this });
    this.combat.step(dt, p, this.cameraRig.forward, this.giants.giants);

    if (p.pendingImpact > 0) {
      p.damage(p.pendingImpact);
      this.cameraRig.addShake(Math.min(0.8, p.pendingImpact * 0.05));
      this.feedback.screenFlash('rgba(200,40,20,0.3)');
      p.pendingImpact = 0;
    }
    this.processEvents();
  }

  processEvents() {
    const fb = this.feedback;
    for (const e of this.combat.events) {
      switch (e.type) {
        case 'hit':
        case 'kill': {
          const label = e.type === 'kill' ? 'kill' : PART_LABEL[e.part];
          fb.damageNumber(e.point, e.damage > 0 ? String(e.damage) : 'DULL', label);
          this.hitStop(e.hitStop);
          this.cameraRig.addShake(e.type === 'kill' ? 0.6 : 0.25 + Math.min(0.3, e.damage / 300));
          const steamDir = tmpV.copy(this.player.vel).normalize();
          this.particles.emit(e.point, e.type === 'kill' ? 60 : 18, {
            color: e.part === 'nape' ? 0xc0392b : 0xd85a4a, speed: 9, spread: 0.7, dir: steamDir,
            size: 0.5, grow: 1.2, life: 0.9, gravity: 6, drag: 2, alpha: 0.9,
          });
          if (e.type === 'kill') {
            fb.killBanner('KILL', `${Math.round(e.speed)} m/s`);
            fb.screenFlash('rgba(255,240,220,0.35)');
          } else if (e.severed) {
            fb.toast(e.severed.startsWith('leg') ? 'LEG SEVERED — giant slowed' : 'ARM SEVERED');
          } else if (e.part === 'nape') {
            fb.toast('Too slow — hit the nape faster!');
          }
          break;
        }
        case 'slash':
          if (e.broken) fb.toast('Blades broken! Press ' + this.bindingLabel('swap') + ' to swap');
          break;
        case 'broken':
          fb.toast('Blades broken! Press ' + this.bindingLabel('swap') + ' to swap');
          break;
        case 'swap':
          fb.toast('Fresh blades');
          break;
        case 'noSpares':
          fb.toast('No spare blades — find a supply depot');
          break;
      }
    }
    this.combat.events.length = 0;

    for (const e of this.giants.events) {
      if (e.type === 'death') {
        const n = e.giant.napeWorld;
        this.particles.emit(n, 40, { color: 0xf2efe8, speed: 5, spread: 1, size: 1.6, grow: 2.2, life: 2.2, gravity: -3, drag: 1.2, alpha: 0.45, jitter: 1 });
      } else if (e.type === 'bodyfall') {
        const g = e.giant;
        this.cameraRig.addShake(Math.min(0.7, (g.H / 15) * 8 / (8 + this.player.pos.distanceTo(g.pos) * 0.3)));
        tmpV.set(g.pos.x + Math.sin(g.yaw) * g.H * 0.6, 0.5, g.pos.z + Math.cos(g.yaw) * g.H * 0.6);
        this.particles.emit(tmpV, 40, { color: 0xb3a58c, speed: g.H * 0.8, spread: 1, size: 2, grow: 3, life: 1.8, gravity: 2, drag: 2, alpha: 0.5, jitter: g.H * 0.4 });
        if (this.giants.aliveCount === 0 && this.sandbox !== false) setTimeout(() => this.spawnTestGiant(), 3000);
      } else if (e.type === 'step') {
        const g = e.giant;
        const d = this.player.pos.distanceTo(g.pos);
        if (d < g.H * 4) this.cameraRig.addShake(0.05 * (g.H / 15) * (1 - d / (g.H * 4)));
      }
    }
    this.giants.events.length = 0;
    this.grapple.events.length = 0;
  }

  bindingLabel(action) {
    const c = this.settings.bindings[action] || '';
    return c.replace(/^Key/, '');
  }

  render(frameDt, alpha) {
    this.input.endFrame();
    const p = this.player;
    renderPos.lerpVectors(p.prevPos, p.pos, alpha);
    this.playerView.update(frameDt, renderPos, p, this.cameraRig.yaw, this.grapple.attachedCount > 0);
    this.playerView.setBladesVisible(!this.combat.blades.broken);
    this.cameraRig.update(frameDt, renderPos, p.speed, this.colliders, this.settings.fovEffects);
    this.grapple.updateOrigins(renderPos, this.cameraRig.right);
    this.grappleView.update(this.grapple, this.grapple.origins);
    this.particles.update(frameDt * this.loop.timeScale);
    this.speedLines.update(frameDt, p.speed, this.settings.speedLines);
    this.feedback.update(frameDt, this.camera, this.viewW, this.viewH);
    this.updateHud();
    this.worldView.update(renderPos, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud() {
    const hs = this.hudState;
    const p = this.player;
    hs.health = p.health;
    hs.maxHealth = p.maxHealth;
    hs.gas = this.grapple.gas;
    hs.gasMax = this.grapple.gasMax;
    hs.boosting = this.grapple.boosting;
    hs.blade = this.combat.blades.durability;
    hs.bladeMax = this.combat.blades.max;
    hs.spares = this.combat.blades.spares;
    this.hud.update(hs);
  }
}

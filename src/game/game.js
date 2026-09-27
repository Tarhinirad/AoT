import * as THREE from 'three';
import { FixedLoop } from '../core/loop.js';
import { Input } from '../core/input.js';
import { loadSettings, QUALITY_PRESETS, codeLabel } from '../core/settings.js';
import { createRng } from '../core/rng.js';
import { StaticColliders } from '../world/colliders.js';
import { generateCity, buildColliders } from '../world/city.js';
import { WorldView } from '../world/worldView.js';
import { Depots } from '../world/depots.js';
import { Player } from '../player/player.js';
import { PlayerView } from '../player/playerView.js';
import { CameraRig } from '../player/cameraRig.js';
import { Aimer } from '../player/aim.js';
import { GrappleSystem } from '../grapple/grappleSystem.js';
import { GrappleView } from '../grapple/grappleView.js';
import { CombatSystem } from '../combat/combatSystem.js';
import { Feedback } from '../combat/feedback.js';
import { GiantManager } from '../giants/giantManager.js';
import { GiantBrain } from '../giants/ai.js';
import { GRAB_ESCAPE, escapeRequired, struggle } from '../giants/aiStateMachine.js';
import { SpeedLines } from '../fx/speedLines.js';
import { Particles } from '../fx/particles.js';
import { SlashTrail } from '../fx/slashTrail.js';
import { Hud } from '../ui/hud.js';
import { Minimap } from '../ui/minimap.js';
import { Menus, loadBest, saveBest } from '../ui/menus.js';
import { WaveDirector, WAVES } from './waves.js';
import { AudioEngine } from '../audio/audio.js';
import { PerfMonitor } from '../core/perf.js';
import { ScoreKeeper, waveClearBonus } from './score.js';

const SPAWN = new THREE.Vector3(0, 3, 40);
const tmpF = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const renderPos = new THREE.Vector3();
const PART_LABEL = { nape: 'nape', limb: 'limb', head: 'weak', body: 'weak' };
const DEPOT_HEAL = 35;
const INTERMISSION_HEAL = 25;
const DUST_COLORS = { building: 0xc9bca2, spire: 0xc9bca2, wall: 0xb5ad9e, tree: 0x6b5238, canopy: 0x4f7a3f, ground: 0xa89c86, depot: 0x8a7457, rubble: 0xa39c8e, giant: 0xc0392b };

/**
 * Top-level orchestrator. Owns the renderer, world, player, systems and UI,
 * runs the fixed-step simulation, and manages the run lifecycle:
 *   menu → playing ⇄ paused → results → (menu | playing)
 */
export class Game {
  constructor(container) {
    this.container = container;
    this.settings = loadSettings();
    this.quality = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    this.rng = createRng((Date.now() ^ 0x5bd1e995) >>> 0);
    this.debug = new URLSearchParams(location.search);

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
    this.depots = new Depots(this.city.depots);

    // Player, gear and systems
    this.player = new Player(SPAWN);
    this.playerView = new PlayerView(this.scene);
    this.cameraRig = new CameraRig(this.camera);
    this.grapple = new GrappleSystem();
    this.grappleView = new GrappleView(this.scene);
    this.combat = new CombatSystem();
    this.giants = new GiantManager(this.scene, this.colliders, this.rng);
    this.giants.brainFactory = (g) => new GiantBrain(g, this.rng, this.colliders);
    this.particles = new Particles(this.scene, this.quality.particles);
    this.slashTrail = new SlashTrail(this.scene);
    this.slowmoT = 0;
    this.waves = new WaveDirector(this.rng);
    this.score = new ScoreKeeper();
    this.raycastHookable = (ox, oy, oz, dx, dy, dz, max, out) => this.raycastHookTargets(ox, oy, oz, dx, dy, dz, max, out);
    this.aimer = new Aimer(this.raycastHookable);

    // Overlay UI
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    container.appendChild(this.overlay);
    this.overlay.insertAdjacentHTML('beforeend', '<div class="vignette"></div><div class="hurt-vignette"></div>');
    this.hurtVignette = this.overlay.querySelector('.hurt-vignette');
    this.speedLines = new SpeedLines(this.overlay);
    this.feedback = new Feedback(this.overlay);
    this.hud = new Hud(this.overlay);
    this.minimap = new Minimap(this.hud.minimapSlot, this.city);
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.innerHTML = '<div class="ring"></div>';
    this.hud.root.appendChild(this.crosshair);

    this.input = new Input(this.renderer.domElement, this.settings);
    this.menus = new Menus(container, {
      settings: this.settings,
      input: this.input,
      onPlay: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onQuit: () => this.quitToMenu(),
      onSettingsChanged: (q) => this.onSettingsChanged(q),
    });
    this.input.onLockChange = (locked) => this.onLockChange(locked);

    // Audio starts on the first user gesture (autoplay policy).
    this.audio = new AudioEngine();
    this.audio.volume = this.settings.volume;
    const unlockAudio = () => this.audio.init();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.menus.root.addEventListener('click', (e) => {
      if (e.target.closest('.btn, .key')) this.audio.click();
    });

    this.perf = new PerfMonitor(this.overlay, this.renderer);
    this.perf.onRatio = (r) => {
      this.renderer.setPixelRatio(r);
      this.resize();
    };
    if (this.debug.has('fps')) this.perf.toggle();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.perf.toggle();
      }
    });
    this.wasGrounded = true;
    this.steamT = 0;

    // Run state
    this.state = 'menu';
    this.time = 0;
    this.menuT = 0;
    this.hitStopT = 0;
    this.endT = 0;
    this.intent = { wish: new THREE.Vector3(), jump: false, hooked: false };
    this.controls = { reel: [false, false], boost: false, look: new THREE.Vector3(0, 0, -1) };
    this.pendingFire = [false, false];
    this.pendingSlash = false;
    this.pendingStruggle = 0;
    this.grab = null;
    this.hudState = {};

    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.loop = new FixedLoop({
      step: 1 / 120,
      preFrame: (dt) => this.preFrame(dt),
      update: (dt) => this.fixedUpdate(dt),
      render: (dt, alpha) => this.render(dt, alpha),
    });

    this.enterMenu();
    if (this.debug.has('autoplay')) this.startRun();
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  start() {
    this.loop.start();
  }

  enterMenu() {
    this.state = 'menu';
    this.giants.clear();
    this.player.alive = false; // giants ignore the (hidden) player in the menu
    this.playerView.root.visible = false;
    this.hud.setVisible(false);
    // Ambient giants roaming the district behind the title screen.
    for (let i = 0; i < 4; i++) {
      const v = ['small', 'medium', 'large', 'medium'][i];
      this.giants.spawn(v, this.rng.range(-120, 120), this.rng.range(-80, 160), this.rng.range(0, 6.28));
    }
    this.menus.show('main');
  }

  startRun() {
    this.audio.init();
    this.giants.clear();
    this.player.reset(SPAWN);
    this.player.grabImmunity = 0;
    this.playerView.root.visible = true;
    this.grapple.reset();
    this.combat.reset();
    this.waves.reset();
    this.score.reset();
    this.grab = null;
    this.endT = 0;
    this.time = 0;
    this.hitStopT = 0;
    this.slowmoT = 0;
    this.loop.timeScale = 1;
    this.cameraRig.yaw = 0;
    this.cameraRig.pitch = -0.1;
    this.cameraRig.initialized = false;
    this.hud.setVisible(true);
    this.menus.hideAll();
    this.state = 'playing';
    this.hud.announce('HOLD THE DISTRICT', `Wave 1 of ${WAVES.total} incoming`, 3);
    this.input.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.update(0, false, false, false);
    this.menus.show('pause');
    this.input.exitLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menus.hideAll();
    this.state = 'playing';
    this.input.requestLock();
  }

  quitToMenu() {
    this.input.exitLock();
    this.enterMenu();
  }

  endRun(victory) {
    if (this.state !== 'playing') return;
    this.state = 'results';
    this.input.exitLock();
    const s = this.score;
    const best = loadBest();
    const newBest = s.score > best.score;
    if (newBest) saveBest({ score: s.score, wave: this.waves.wave });
    this.menus.show('results', {
      victory,
      wave: this.waves.wave,
      score: s.score,
      newBest,
      kills: s.kills,
      killsByVariant: s.killsByVariant,
      limbs: s.limbs,
      escapes: s.escapes,
      bestCombo: s.bestCombo,
      topSpeed: s.topSpeed,
      fastestKill: s.fastestKill,
      time: s.time,
      styleTotals: s.styleTotals,
    });
    this.hud.setVisible(false);
  }

  onLockChange(locked) {
    if (!locked && this.state === 'playing' && !this.debug.has('autoplay')) this.pause();
  }

  onSettingsChanged(qualityChanged) {
    if (qualityChanged) this.applyQuality();
    this.audio.setVolume(this.settings.volume);
  }

  applyQuality() {
    this.quality = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    if (this.perf) {
      this.perf.dynamic = this.settings.dynamicRes;
      this.perf.setMax(ratio);
    }
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.scene.fog.far = this.quality.fogFar;
    this.worldView.applyQuality(this.quality);
    // Materials must recompile when the shadow map toggles.
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.resize();
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

  /* ------------------------------------------------------------------ */
  /* Input and aiming                                                    */
  /* ------------------------------------------------------------------ */

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

  bindingLabel(action) {
    return codeLabel(this.settings.bindings[action]);
  }

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

    const grabbed = this.player.grabbed;
    if (!grabbed) {
      if (inp.pressed('hookLeft')) this.pendingFire[0] = true;
      if (inp.pressed('hookRight')) this.pendingFire[1] = true;
    }
    if (inp.pressed('release')) this.grapple.releaseAll();
    if (inp.pressed('slash')) {
      if (grabbed) this.pendingStruggle += GRAB_ESCAPE.slashValue;
      else this.pendingSlash = true;
    }
    if (grabbed && inp.pressed('struggle')) this.pendingStruggle += 1;
    this.combat.held = inp.isDown('slash');
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
      this.loop.timeScale = this.hitStopT > 0 ? 0.03 : this.slowmoT > 0 ? 0.35 : 1;
    } else if (this.slowmoT > 0) {
      this.slowmoT -= realDt;
      this.loop.timeScale = this.slowmoT > 0 ? 0.35 : 1;
    }
    if (this.state === 'playing') {
      // Browsers usually exit pointer lock on Esc (→ onLockChange → pause); handle the key too.
      if (this.input.codePressed('Escape')) this.pause();
      else this.readInput();
    } else {
      this.input.consumeMouse();
    }
  }

  hitStop(duration) {
    this.hitStopT = Math.max(this.hitStopT, duration);
    this.loop.timeScale = 0.03;
  }

  /* ------------------------------------------------------------------ */
  /* Simulation                                                          */
  /* ------------------------------------------------------------------ */

  fixedUpdate(dt) {
    if (this.state === 'menu') {
      this.giants.step(dt, { player: this.player, game: this });
      this.giants.events.length = 0;
      return;
    }
    if (this.state !== 'playing') return;
    this.time += dt;
    const p = this.player;
    const g = this.grapple;

    if (p.alive) {
      g.updateOrigins(p.pos, this.cameraRig.right);
      for (let i = 0; i < 2; i++) {
        if (this.pendingFire[i]) {
          this.pendingFire[i] = false;
          g.fire(i, this.aimer.point);
        }
      }
      if (this.pendingSlash) {
        this.pendingSlash = false;
        if (this.combat.trySlash()) {
          this.playerView.triggerSlash();
          this.slashTrail.trigger(p.pos, p.speed > 4 ? p.vel : this.cameraRig.forward, false);
        }
      }
    }

    if (p.grabImmunity > 0) p.grabImmunity -= dt;
    if (p.grabbed) {
      this.updateGrabbed(dt);
    } else {
      g.step(dt, p, p.alive ? this.controls : IDLE_CONTROLS, this.raycastHookable);
      this.intent.hooked = g.attachedCount > 0;
      this.intent.jump = p.alive && this.controls.boost && p.grounded && !this.intent.hooked;
      if (!p.alive) this.intent.wish.set(0, 0, 0);
      p.integrate(dt, this.intent);
      g.constrain(p);
      p.collide(this.colliders, dt);
      this.giants.resolvePlayer(p);
      if (p.grounded && !this.wasGrounded && p.lastImpactSpeed > 9) {
        this.audio.land(p.lastImpactSpeed);
        this.particles.emit(tmpV.set(p.pos.x, p.pos.y - 0.4, p.pos.z), Math.min(20, Math.round(p.lastImpactSpeed / 2)), {
          color: 0xb3a58c, speed: 3 + p.lastImpactSpeed * 0.1, spread: 1, size: 0.6, grow: 1.5, life: 0.7, gravity: 1, drag: 3, alpha: 0.5,
        });
      }
      this.wasGrounded = p.grounded;
    }

    this.giants.step(dt, { player: p, game: this });
    this.combat.step(dt, p, this.cameraRig.forward, this.giants.giants);
    this.score.tick(dt, p.speed);

    // Supply depots
    const b = this.combat.blades;
    const needs = g.gas < g.gasMax - 1 || b.durability < b.max || b.spares < b.maxSpares || p.health < p.maxHealth;
    if (p.alive && this.depots.update(dt, p, needs)) this.resupply();

    // Waves
    this.waves.update(dt, this.giants.aliveCount, (variant) => this.spawnGiant(variant));
    for (const e of this.waves.events) this.onWaveEvent(e);
    this.waves.events.length = 0;

    if (p.pendingImpact > 0) {
      p.damage(p.pendingImpact);
      this.audio.hurt();
      this.cameraRig.addShake(Math.min(0.8, p.pendingImpact * 0.05));
      this.feedback.screenFlash('rgba(200,40,20,0.3)');
      p.pendingImpact = 0;
    }
    this.processEvents();

    if (!p.alive) {
      if (this.endT <= 0) this.onPlayerDeath();
      this.endT -= dt;
      if (this.endT <= 0) this.endRun(false);
    } else if (this.waves.phase === 'victory') {
      this.endT -= dt;
      if (this.endT <= 0) this.endRun(true);
    }
  }

  spawnGiant(variant) {
    const p = this.player.pos;
    const pts = this.city.spawns;
    // Prefer spawn points out of the player's immediate reach.
    const far = pts.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > 90);
    const list = far.length ? far : pts;
    const s = list[Math.floor(this.rng.next() * list.length)];
    const x = s.x + this.rng.range(-8, 8), z = s.z + this.rng.range(-6, 6);
    const yaw = Math.atan2(p.x - x, p.z - z);
    const giant = this.giants.spawn(variant, x, z, yaw);
    this.particles.emit(tmpV.set(x, 2, z), 30, { color: 0xf0ece4, speed: 6, spread: 1, size: 3, grow: 3, life: 2, gravity: -2, drag: 1.5, alpha: 0.4, jitter: giant.H * 0.5 });
  }

  onWaveEvent(e) {
    if (e.type === 'waveStart') {
      this.hud.announce(`WAVE ${e.wave}`, `${e.count} giants approaching`);
      this.audio.bell();
    } else if (e.type === 'waveCleared') {
      const bonus = waveClearBonus(e.wave, e.time);
      this.score.addBonus('WAVE CLEAR', bonus);
      this.player.health = Math.min(this.player.maxHealth, this.player.health + INTERMISSION_HEAL);
      if (e.wave < WAVES.total) this.hud.announce('WAVE CLEARED', `+${bonus.toLocaleString()} · next wave in ${WAVES.intermission}s`);
    } else if (e.type === 'victory') {
      this.hud.announce('DISTRICT HELD', 'Every wave repelled', 3);
      this.audio.fanfare();
      this.endT = 3;
    }
  }

  onPlayerDeath() {
    this.endT = 2.5;
    if (this.grab) this.releaseGrab(false);
    this.grapple.releaseAll();
    this.feedback.killBanner('FALLEN', '');
    this.feedback.screenFlash('rgba(120,0,0,0.6)');
  }

  resupply() {
    this.grapple.gas = this.grapple.gasMax;
    this.combat.blades.refill();
    const p = this.player;
    p.health = Math.min(p.maxHealth, p.health + DEPOT_HEAL);
    this.feedback.toast('RESUPPLIED — gas, blades, bandages');
    this.audio.resupply();
    this.particles.emit(p.pos, 20, { color: 0x9fd4ff, speed: 4, spread: 1, size: 0.6, grow: 1, life: 0.8, gravity: -2, drag: 2, alpha: 0.6 });
  }

  /** Player is in a giant's fist: follow the hand, take crush damage, struggle. */
  updateGrabbed(dt) {
    const p = this.player;
    const gr = this.grab;
    const giant = gr.giant;
    this.grapple.step(dt, p, IDLE_CONTROLS, this.raycastHookable);
    const st = giant.brain.state;
    if (!giant.alive || (st !== 'hold' && st !== 'grab')) {
      this.releaseGrab(true);
      return;
    }
    const hand = giant.rig.hitboxes.find((h) => h.name === 'hand' + gr.side);
    p.prevPos.copy(p.pos);
    p.pos.copy(hand.world);
    p.vel.set(0, 0, 0);
    p.damage(GRAB_ESCAPE.crushDps * dt);
    const r = struggle(gr.progress, this.pendingStruggle, dt, gr.required);
    this.pendingStruggle = 0;
    gr.progress = r.progress;
    if (r.escaped) {
      this.score.escapes++;
      this.score.addBonus('ESCAPE', 50);
      this.releaseGrab(true);
    }
  }

  onGrabbed(giant, side) {
    const p = this.player;
    if (p.grabbed || !p.alive) return;
    p.grabbed = true;
    this.grab = { giant, side, progress: 0, required: escapeRequired(giant.H) };
    this.pendingStruggle = 0;
    this.grapple.releaseAll();
    p.damage(GRAB_ESCAPE.initialDamage);
    this.audio.grabbed();
    this.cameraRig.addShake(0.7);
    this.feedback.screenFlash('rgba(200,20,10,0.45)');
    this.feedback.toast('GRABBED!', 1.2);
  }

  /** @param {boolean} escaped true if the player broke free (vs. being dropped) */
  releaseGrab(escaped) {
    const p = this.player;
    const gr = this.grab;
    if (!gr) return;
    p.grabbed = false;
    p.grabImmunity = 2.5;
    this.grab = null;
    gr.giant.brain?.releasePlayer();
    // Fling the player clear of the giant.
    tmpV.subVectors(p.pos, gr.giant.pos).setY(0).normalize();
    p.vel.set(tmpV.x * 10, escaped ? 13 : 4, tmpV.z * 10);
    p.pos.addScaledVector(tmpV, 1.5);
    p.prevPos.copy(p.pos);
    if (escaped && gr.giant.alive) {
      gr.giant.stagger(tmpV, 1.0);
      gr.giant.flashT = 0.15;
      this.feedback.toast('ESCAPED!');
      this.particles.emit(p.pos, 20, { color: 0xd85a4a, speed: 8, spread: 1, size: 0.5, grow: 1, life: 0.8, gravity: 6, drag: 2 });
    }
  }

  onSwiped(giant, dir) {
    const p = this.player;
    if (p.grabbed || !p.alive) return;
    p.damage(18);
    this.audio.hurt();
    this.grapple.releaseAll();
    p.vel.addScaledVector(dir, 24);
    p.vel.y += 9;
    this.cameraRig.addShake(0.6);
    this.feedback.screenFlash('rgba(200,30,10,0.4)');
  }

  processEvents() {
    const fb = this.feedback;
    for (const e of this.combat.events) {
      switch (e.type) {
        case 'hit':
        case 'kill': {
          const label = e.type === 'kill' ? 'kill' : PART_LABEL[e.part];
          this.slashTrail.hit = true;
          if (e.type === 'kill') {
            this.audio.kill();
            this.slowmoT = 0.45; // cinematic beat after the hit-stop
          }
          else if (e.damage > 0) this.audio.flesh(e.damage);
          else this.audio.dull();
          this.particles.emit(e.point, 10, { color: 0xfff2c0, speed: 18, spread: 1, size: 0.18, life: 0.3, gravity: 20, drag: 1, alpha: 1 });
          fb.damageNumber(e.point, e.damage > 0 ? String(e.damage) : 'DULL', label);
          this.hitStop(e.hitStop);
          this.cameraRig.addShake(e.type === 'kill' ? 0.6 : 0.25 + Math.min(0.3, e.damage / 300));
          const steamDir = tmpV.copy(this.player.vel).normalize();
          this.particles.emit(e.point, e.type === 'kill' ? 60 : 18, {
            color: e.part === 'nape' ? 0xc0392b : 0xd85a4a, speed: 9, spread: 0.7, dir: steamDir,
            size: 0.5, grow: 1.2, life: 0.9, gravity: 6, drag: 2, alpha: 0.9,
          });
          if (e.type === 'kill') {
            const res = this.score.registerKill({
              variant: e.giant.variant,
              speed: e.speed,
              airTime: this.player.airTime,
              oneCut: e.oneCut,
              health: this.player.health,
            });
            const tags = res.parts.filter((p) => p.label !== 'KILL').map((p) => p.label);
            if (res.multiplier > 1) tags.push(`x${res.multiplier.toFixed(2).replace(/0$/, '')}`);
            fb.killBanner('KILL', `+${res.total}  ${tags.join(' · ')}`);
            fb.screenFlash('rgba(255,240,220,0.35)');
          } else if (e.severed) {
            this.score.limbs++;
            this.audio.sever();
            this.score.addBonus('SEVER', 25);
            fb.toast(e.severed.startsWith('leg') ? 'LEG SEVERED — giant slowed' : 'ARM SEVERED');
          } else if (e.part === 'nape') {
            fb.toast('Too slow — hit the nape faster!');
          }
          break;
        }
        case 'slash':
          this.audio.slash(false);
          if (e.broken) fb.toast(`Blades broken! Press ${this.bindingLabel('swap')} to swap`);
          break;
        case 'broken':
          this.audio.broken();
          fb.toast(`Blades broken! Press ${this.bindingLabel('swap')} to swap`);
          break;
        case 'swap':
          this.audio.swap();
          this.particles.emit(this.player.pos, 8, { color: 0xdfe8f0, speed: 5, spread: 1, size: 0.2, life: 1, gravity: 20, drag: 0.5, alpha: 1 });
          fb.toast('Fresh blades');
          break;
        case 'noSpares':
          fb.toast('No spare blades — find a supply depot');
          break;
      }
    }
    this.combat.events.length = 0;

    for (const e of this.giants.events) {
      if (e.type === 'spot' || e.type === 'sprint') {
        this.audio.roar(e.giant.H, e.giant.abnormal, this.player.pos.distanceTo(e.giant.pos), this.panFor(e.giant.pos));
      } else if (e.type === 'windup') {
        this.audio.windup(this.player.pos.distanceTo(e.giant.pos), this.panFor(e.giant.pos));
      } else if (e.type === 'swipe') {
        this.audio.whoosh(this.panFor(e.giant.pos));
      } else if (e.type === 'grab') {
        this.onGrabbed(e.giant, e.side);
      } else if (e.type === 'swipeHit') {
        this.onSwiped(e.giant, e.dir);
      } else if (e.type === 'bite') {
        if (this.grab?.giant === e.giant) {
          this.player.damage(GRAB_ESCAPE.biteDamage);
          this.cameraRig.addShake(0.9);
          this.feedback.screenFlash('rgba(160,0,0,0.6)');
          this.releaseGrab(false);
        }
      } else if (e.type === 'death') {
        if (this.grab?.giant === e.giant) this.releaseGrab(true);
        const n = e.giant.napeWorld;
        this.particles.emit(n, 40, { color: 0xf2efe8, speed: 5, spread: 1, size: 1.6, grow: 2.2, life: 2.2, gravity: -3, drag: 1.2, alpha: 0.45, jitter: 1 });
      } else if (e.type === 'bodyfall') {
        const g = e.giant;
        this.audio.bodyfall(g.H, this.player.pos.distanceTo(g.pos), this.panFor(g.pos));
        this.cameraRig.addShake(Math.min(0.7, ((g.H / 15) * 8) / (8 + this.player.pos.distanceTo(g.pos) * 0.3)));
        tmpV.set(g.pos.x + Math.sin(g.yaw) * g.H * 0.6, 0.5, g.pos.z + Math.cos(g.yaw) * g.H * 0.6);
        this.particles.emit(tmpV, 40, { color: 0xb3a58c, speed: g.H * 0.8, spread: 1, size: 2, grow: 3, life: 1.8, gravity: 2, drag: 2, alpha: 0.5, jitter: g.H * 0.4 });
      } else if (e.type === 'step') {
        const g = e.giant;
        const d = this.player.pos.distanceTo(g.pos);
        this.audio.footstep(g.H, d, this.panFor(g.pos));
        if (g.H > 11 && d < 90) {
          tmpV.set(g.pos.x, 0.3, g.pos.z);
          this.particles.emit(tmpV, 5, { color: 0xb3a58c, speed: 3, spread: 1, size: 1.2, grow: 2, life: 1, gravity: 0, drag: 2, alpha: 0.35, jitter: g.H * 0.15 });
        }
        if (d < g.H * 4) this.cameraRig.addShake(0.05 * (g.H / 15) * (1 - d / (g.H * 4)));
      }
    }
    this.giants.events.length = 0;

    for (const e of this.grapple.events) {
      if (e.type === 'fire') this.audio.hookFire();
      else if (e.type === 'release') this.audio.release();
      else if (e.type === 'attach') {
        const tag = e.collider?.tag || 'building';
        this.audio.hookHit(tag === 'giant' ? 'giant' : tag === 'tree' || tag === 'canopy' ? 'tree' : 'building', this.panFor(e.point), 1);
        this.particles.emit(e.point, 10, { color: DUST_COLORS[tag] ?? 0xc9bca2, speed: 4, spread: 1, size: 0.35, grow: 1, life: 0.6, gravity: 4, drag: 2, alpha: 0.8 });
      } else if (e.type === 'empty') {
        this.audio.gasEmpty();
        this.feedback.toast('OUT OF GAS — find a supply depot');
      }
    }
    this.grapple.events.length = 0;
    this.depots.events.length = 0;
  }

  /** Stereo pan (-1..1) of a world position relative to the camera. */
  panFor(pos) {
    const c = this.camera.position, r = this.cameraRig.right;
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return ((dx * r.x + dz * r.z) / d) * 0.8;
  }

  /** Per-frame cosmetic particles: gas puffs, steam from corpses and stumps. */
  emitAmbientParticles(dt) {
    const p = this.player;
    const g = this.grapple;
    if (this.state === 'playing' && p.alive && !p.grabbed && (g.boosting || g.reelingAny)) {
      const sp = p.speed || 1;
      tmpV.copy(p.vel).multiplyScalar(-1 / sp);
      const n = g.boosting ? 2 : 1;
      this.particles.emit(p.pos, n, {
        color: 0xf4f4f0, speed: g.boosting ? 7 : 3, spread: 0.35, dir: tmpV, baseVel: tmpB.copy(p.vel).multiplyScalar(0.6),
        size: g.boosting ? 0.45 : 0.3, grow: 2.5, life: 0.55, gravity: -1, drag: 3, alpha: 0.5,
      });
    }
    this.steamT += dt;
    if (this.steamT < 0.08) return;
    this.steamT = 0;
    for (const gi of this.giants.giants) {
      if (!gi.alive) {
        if (gi.deathT < 8) {
          const hb = gi.rig.hitboxes[Math.floor(Math.random() * 6)];
          this.particles.emit(hb.world, 2, { color: 0xf2efe8, speed: 2, spread: 1, size: gi.H * 0.12, grow: gi.H * 0.15, life: 2.2, gravity: -4, drag: 1, alpha: 0.3, jitter: gi.H * 0.2 });
        }
        continue;
      }
      for (const limb of ['armL', 'armR', 'legL', 'legR']) {
        if (!gi.limbs[limb].severed) continue;
        const grp = gi._limbGroup(limb);
        grp.getWorldPosition(tmpV);
        this.particles.emit(tmpV, 1, { color: 0xf2efe8, speed: 1.5, spread: 1, size: gi.H * 0.05, grow: gi.H * 0.08, life: 1.2, gravity: -3, drag: 1, alpha: 0.4 });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  render(frameDt, alpha) {
    this.input.endFrame();
    const p = this.player;
    if (this.state === 'menu') {
      // Slow orbit over the district behind the title screen.
      this.menuT += frameDt;
      const a = this.menuT * 0.05;
      this.camera.position.set(Math.cos(a) * 150, 75, Math.sin(a) * 150 + 30);
      this.camera.lookAt(0, 18, 20);
      if (this.camera.fov !== 60) {
        this.camera.fov = 60;
        this.camera.updateProjectionMatrix();
      }
      this.cameraRig.fov = 60;
      renderPos.set(0, 0, 0);
    } else {
      renderPos.lerpVectors(p.prevPos, p.pos, alpha);
      this.playerView.update(frameDt, renderPos, p, this.cameraRig.yaw, this.grapple.attachedCount > 0);
      this.playerView.setBladesVisible(!this.combat.blades.broken);
      this.cameraRig.extraDistance = p.grabbed ? 5 : !p.alive ? 8 : 0;
      this.cameraRig.update(frameDt, renderPos, p.speed, this.colliders, this.settings.fovEffects);
      this.grapple.updateOrigins(renderPos, this.cameraRig.right);
      this.grappleView.update(this.grapple, this.grapple.origins);
    }
    this.emitAmbientParticles(frameDt);
    this.slashTrail.update(frameDt, renderPos);
    this.particles.update(frameDt * this.loop.timeScale);
    this.audio.update(p.speed, this.grapple.boosting, this.grapple.reelingAny, this.state === 'playing' && p.alive);
    this.perf.frame(frameDt, this.state === 'playing');
    // Cull giants hidden by fog (saves draw calls and shadow passes).
    const far = this.quality.fogFar + 40;
    for (const gi of this.giants.giants) gi.root.visible = gi.pos.distanceTo(this.camera.position) < far;
    this.speedLines.update(frameDt, this.state === 'playing' ? p.speed : 0, this.settings.speedLines);
    this.feedback.update(frameDt, this.camera, this.viewW, this.viewH);
    if (this.state === 'playing' || this.state === 'paused') this.updateHud(frameDt);
    this.worldView.update(this.state === 'menu' ? tmpV.set(0, 0, 40) : renderPos, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(dt) {
    const hs = this.hudState;
    const p = this.player;
    this.hud.tick(dt);
    hs.health = p.health;
    hs.maxHealth = p.maxHealth;
    const hurt = p.alive ? Math.max(0, 1 - p.health / 35) : 1;
    if (Math.abs((this._hurt ?? -1) - hurt) > 0.02) {
      this._hurt = hurt;
      this.hurtVignette.style.opacity = hurt.toFixed(2);
    }
    hs.gas = this.grapple.gas;
    hs.gasMax = this.grapple.gasMax;
    hs.boosting = this.grapple.boosting;
    hs.blade = this.combat.blades.durability;
    hs.bladeMax = this.combat.blades.max;
    hs.spares = this.combat.blades.spares;
    hs.danger = this.findDanger();
    hs.struggle = this.grab ? { pct: this.grab.progress / this.grab.required, key: `${this.bindingLabel('struggle')} / ${this.bindingLabel('slash')}` } : null;
    const w = this.waves;
    if (w.wave === 0) {
      hs.waveText = 'PREPARE';
      hs.waveSub = `first wave in ${Math.ceil(Math.max(0, w.timer))}s`;
    } else if (w.phase === 'intermission') {
      hs.waveText = `WAVE ${w.wave} CLEARED`;
      hs.waveSub = `next wave in ${Math.ceil(Math.max(0, w.timer))}s`;
    } else {
      hs.waveText = `WAVE ${w.wave} / ${WAVES.total}`;
      hs.waveSub = `${this.giants.aliveCount + w.remainingToSpawn} giants remaining`;
    }
    hs.score = this.score.score;
    hs.combo = this.score.combo;
    hs.speed = p.speed;
    hs.resupply = this.depots.progress / 1.2;
    this.hud.update(hs);
    this._minimapT = (this._minimapT || 0) + dt;
    if (this._minimapT > 1 / 30) {
      this.minimap.update(this._minimapT, p, this.cameraRig.yaw, this.giants.giants, this.depots);
      this._minimapT = 0;
    }
  }

  /** Nearest giant winding up an attack, as a screen-space direction for the HUD. */
  findDanger() {
    let best = null, bestD = 70;
    for (const g of this.giants.giants) {
      if (!g.alive || !g.brain?.telegraphing) continue;
      const d = g.pos.distanceTo(this.player.pos);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best) return null;
    tmpV.copy(best.rig.hitboxes[3].world).project(this.camera);
    let x = tmpV.x, y = tmpV.y;
    if (tmpV.z > 1) {
      x = -x;
      y = -y;
    }
    this._danger = this._danger || {};
    this._danger.angle = Math.atan2(x, y);
    this._danger.kind = best.brain.state === 'grabWindup' ? 'grab' : 'swipe';
    return this._danger;
  }
}

const IDLE_CONTROLS = { reel: [false, false], boost: false, look: new THREE.Vector3(0, 0, -1) };

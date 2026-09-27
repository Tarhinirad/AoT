import * as THREE from 'three';
import { CITY } from './city.js';
import { ATMOS, createSky } from '../render/atmosphere.js';
import { createFacadeMaterial, createRoofMaterial, createGroundMaterial, createClothMaterial } from './materials.js';
import { createRng } from '../core/rng.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const STYLE = { house: 0, tower: 1, hall: 2, wall: 3, bell: 4, plain: 5 };
const WOOD = 0x4a2f1c;
const IRON = 0x2b2a2a;

/** Unit hipped roof: footprint [-0.5,0.5]^2, height 1, short ridge along Z. */
function createHipGeometry(r = 0.22) {
  const g = new THREE.BufferGeometry();
  const p = [
    // long sides (trapezoids)
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, r, -0.5, 0, -0.5, 0, 1, r, 0, 1, -r,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -r, 0.5, 0, 0.5, 0, 1, -r, 0, 1, r,
    // hip ends
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, r,
    0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -r,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Unit gable prism: footprint [-0.5,0.5]^2, height 1, ridge along Z. */
function createGableGeometry() {
  const g = new THREE.BufferGeometry();
  const p = [
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5,
    0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
    0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

function setInstance(mesh, i, x, y, z, sx, sy, sz, rotY = 0, color = null) {
  tmpP.set(x, y, z);
  tmpQ.setFromAxisAngle(UP, rotY);
  tmpS.set(sx, sy, sz);
  tmpM.compose(tmpP, tmpQ, tmpS);
  mesh.setMatrixAt(i, tmpM);
  if (color !== null) mesh.setColorAt(i, tmpC.set(color));
}

/** Build an InstancedMesh from a list of {x,y,z,sx,sy,sz,rot?,rx?,rz?,color?} entries. */
function instanced(geo, mat, list, { shadow = true, receive = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  m.count = list.length;
  list.forEach((e, i) => {
    tmpP.set(e.x, e.y, e.z);
    tmpQ.setFromEuler(tmpE.set(e.rx || 0, e.rot || 0, e.rz || 0, 'YXZ'));
    tmpS.set(e.sx, e.sy, e.sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    m.setMatrixAt(i, tmpM);
    if (e.color !== undefined) m.setColorAt(i, tmpC.set(e.color));
  });
  m.castShadow = shadow;
  m.receiveShadow = receive;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

/** Facade instances also carry aFacade = (style, seed, plinth, v offset). */
function facadeInstanced(geo, mat, list) {
  const g = geo.clone();
  const data = new Float32Array(Math.max(1, list.length) * 4);
  list.forEach((e, i) => {
    data[i * 4] = e.style;
    data[i * 4 + 1] = e.seed ?? (i * 0.6180339) % 1 * 50;
    data[i * 4 + 2] = e.plinth ?? 0;
    data[i * 4 + 3] = e.voff ?? 0;
  });
  g.setAttribute('aFacade', new THREE.InstancedBufferAttribute(data, 4));
  return instanced(g, mat, list);
}

/** Heraldic banner texture: coloured field, gold border and a tower emblem, swallowtail hem. */
function bannerTexture(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 160;
  const g = c.getContext('2d');
  const col = '#' + new THREE.Color(color).getHexString();
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 0); g.lineTo(64, 160); g.lineTo(32, 132); g.lineTo(0, 160); g.closePath();
  g.fill();
  g.strokeStyle = '#d8b24a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(5, 4); g.lineTo(59, 4); g.lineTo(59, 150); g.lineTo(32, 126); g.lineTo(5, 150); g.closePath();
  g.stroke();
  // Emblem: a crenellated tower between two crossed hooks.
  g.fillStyle = '#e6c25a';
  g.fillRect(22, 48, 20, 36);
  for (let k = 0; k < 3; k++) g.fillRect(20 + k * 9, 40, 6, 9);
  g.fillStyle = col;
  g.beginPath();
  g.arc(32, 84, 6, Math.PI, 0);
  g.lineTo(38, 84);
  g.fill();
  g.strokeStyle = '#e6c25a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(12, 100); g.lineTo(52, 30);
  g.moveTo(52, 100); g.lineTo(12, 30);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Striped awning texture (white/grey, tinted per stall by instance colour). */
function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d');
  for (let k = 0; k < 8; k++) {
    g.fillStyle = k % 2 ? '#ffffff' : '#f0e6d0';
    g.fillRect(k * 8, 0, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function awningGeometry() {
  // Sloped canvas roof with a scalloped front valance, footprint 1 x 1, height 0.35.
  const g = new THREE.PlaneGeometry(1, 1.05, 8, 1).rotateX(-Math.PI / 2 + 0.33).translate(0, 0.17, 0);
  return g;
}

/** Barrel: a bulged lathe. */
function barrelGeometry() {
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    pts.push(new THREE.Vector2(0.36 + Math.sin(t * Math.PI) * 0.08, t));
  }
  const g = new THREE.LatheGeometry(pts, 12);
  const cap = new THREE.CircleGeometry(0.36, 12).rotateX(-Math.PI / 2).translate(0, 1, 0);
  return mergeSimple([g, cap]);
}

function mergeSimple(geos) {
  const pos = [], nor = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** Distant mountain range: a ring of noisy ridges with baked atmospheric haze. */
function mountainGeometry(r0, r1, hMax, seed, rock, haze, hazeK, snowLine) {
  const rng = createRng(seed);
  const N = 512, R = 10;
  const phases = Array.from({ length: 6 }, () => rng.range(0, 6.28));
  const pos = [], col = [], idx = [];
  const cRock = new THREE.Color(rock), cHaze = new THREE.Color(haze), cSnow = new THREE.Color(0xf4f1ea);
  const c = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const ridge = 0.55 + 0.25 * Math.sin(a * 3 + phases[0]) + 0.15 * Math.sin(a * 7 + phases[1]) + 0.1 * Math.sin(a * 17 + phases[2]) + 0.06 * Math.sin(a * 41 + phases[3]);
    for (let j = 0; j <= R; j++) {
      const t = j / R;
      const r = r0 + (r1 - r0) * t;
      const prof = Math.sin(t * Math.PI) ** 0.8;
      const jag = 0.84 + 0.1 * Math.sin(a * 63 + j * 1.7 + phases[4]) + 0.06 * Math.sin(a * 151 + j * 2.9 + phases[5]);
      const h = Math.max(0, hMax * ridge * prof * jag) - 20;
      pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
      const hn = h / hMax;
      c.copy(cRock).lerp(cSnow, snowLine > 0 ? THREE.MathUtils.smoothstep(hn, snowLine, snowLine + 0.12) : 0);
      c.lerp(cHaze, hazeK * (1 - 0.35 * hn));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = (i + 1) * (R + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class WorldView {
  constructor(scene, city, quality) {
    this.scene = scene;
    this.city = city;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sky = createSky(scene);
    this.facadeMat = createFacadeMaterial();
    this.facadeCylMat = createFacadeMaterial({ cylinder: true });
    this.roofMat = createRoofMaterial();
    this.coneRoofMat = createRoofMaterial({ cone: true });
    this.woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 });
    this.ironMat = new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.5, metalness: 0.7 });
    this.clothMats = [];
    this.fires = []; // brazier flames (animated)
    this.fireSources = []; // world positions for ember/smoke particles
    this.chimneyTops = city.chimneys.map((c) => new THREE.Vector3(c.x, c.top + 0.3, c.z));
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, true).translate(0, 0.5, 0);
    this._buildLights(quality);
    this._buildGround();
    this._buildBuildings();
    this._buildWall();
    this._buildTrees();
    this._buildMarket();
    this._buildBanners();
    this._buildLanterns();
    this._buildDepots();
    this._buildScenery();
    this._buildBirds();
    this.applyQuality(quality);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(ATMOS.hemiSky, ATMOS.hemiGround, 0.35);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(ATMOS.sunColor, ATMOS.sunIntensity);
    const ext = 100;
    sun.shadow.camera.left = -ext;
    sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext;
    sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 800;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunOffset = ATMOS.sunDir.clone().multiplyScalar(320);
    // Light-space basis used to snap the shadow frustum to whole texels.
    this.lightDir = ATMOS.sunDir.clone();
    this.lightRight = new THREE.Vector3().crossVectors(UP, this.lightDir).normalize();
    this.lightUp = new THREE.Vector3().crossVectors(this.lightDir, this.lightRight).normalize();
    this.shadowExtent = ext * 2;
    this.shadowTexel = this.shadowExtent / 1024;
    this._snap = new THREE.Vector3();
  }

  _buildGround() {
    const H = CITY.HALF;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), createGroundMaterial(0, 0x7d8b4c));
    grass.position.y = -0.15; // below the city floor to avoid z-fighting at grazing angles
    grass.receiveShadow = true;
    this.group.add(grass);
    // Cobbled streets (south of the forest band)
    const cityDepth = H - (CITY.FOREST_Z1 + 4);
    const cobble = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, cityDepth).rotateX(-Math.PI / 2), createGroundMaterial(1, 0x9a8f7e));
    cobble.position.set(0, 0, H - cityDepth / 2);
    cobble.receiveShadow = true;
    this.group.add(cobble);
    const forest = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H + CITY.FOREST_Z1 + 4).rotateX(-Math.PI / 2), createGroundMaterial(3, 0x5a6a3a));
    forest.position.set(0, 0, (-H + CITY.FOREST_Z1 + 4) / 2);
    forest.receiveShadow = true;
    this.group.add(forest);
    // Market square
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(CITY.PLAZA_R - 2, 64).rotateX(-Math.PI / 2), createGroundMaterial(2, 0xb3a58c));
    plaza.position.y = 0.06;
    plaza.receiveShadow = true;
    this.group.add(plaza);
    const flagMat = createGroundMaterial(4, 0xaa9f8a);
    for (const sq of this.city.squares) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sq.size, sq.size).rotateX(-Math.PI / 2), flagMat);
      m.position.set(sq.x, 0.06, sq.z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // Dirt road out of the broken gate
    const road = new THREE.Mesh(new THREE.PlaneGeometry(18, 600).rotateX(-Math.PI / 2), createGroundMaterial(3, 0x8a7657));
    road.position.set(0, -0.1, H + 300);
    road.receiveShadow = true;
    this.group.add(road);
  }

  _buildBuildings() {
    const box = [], cyl = [], gables = [], hips = [], cones = [], pyramids = [], beams = [], pinnacles = [];
    const P = CITY.PLINTH;
    let seed = 0;
    for (const b of this.city.buildings) {
      seed += 1.37;
      const s = (seed * 7.31) % 97;
      if (b.style === 'house' || b.style === 'hall') {
        const plinth = b.style === 'hall' ? 4.4 : P;
        const jx = b.jx ?? 0.25, jz = b.jz ?? 0.25;
        const st = b.style === 'hall' ? STYLE.hall : STYLE.house;
        box.push({ x: b.x, y: 0, z: b.z, sx: b.w, sy: plinth, sz: b.d, color: b.color, style: st, seed: s, plinth, voff: 0 });
        const uw = b.w + 2 * jx, ud = b.d + 2 * jz;
        box.push({ x: b.x, y: plinth, z: b.z, sx: uw, sy: b.h - plinth, sz: ud, color: b.color, style: st, seed: s, plinth, voff: plinth });
        // Jetty beam where the upper floors overhang the stone base.
        beams.push({ x: b.x, y: plinth - 0.12, z: b.z, sx: uw + 0.08, sy: 0.3, sz: ud + 0.08 });
        const alongZ = b.d >= b.w;
        (b.style === 'hall' ? hips : gables).push({
          x: b.x, y: b.h, z: b.z,
          sx: (alongZ ? uw : ud) + 0.9, sy: b.roofH, sz: (alongZ ? ud : uw) + 0.35,
          rot: alongZ ? 0 : Math.PI / 2, color: b.roofColor,
        });
      } else if (b.style === 'round') {
        cyl.push({ x: b.x, y: 0, z: b.z, sx: b.w, sy: b.h, sz: b.w, color: b.color, style: STYLE.tower, seed: s });
        // Corbelled ring under the roof
        cyl.push({ x: b.x, y: b.h - 1.4, z: b.z, sx: b.w + 0.9, sy: 1.4, sz: b.w + 0.9, color: b.color, style: STYLE.plain, seed: s });
        cones.push({ x: b.x, y: b.h, z: b.z, sx: b.w + 1.6, sy: b.roofH, sz: b.w + 1.6, color: b.roofColor });
      } else if (b.style === 'keep' || b.style === 'bell') {
        const st = b.style === 'bell' ? STYLE.bell : STYLE.tower;
        box.push({ x: b.x, y: 0, z: b.z, sx: b.w, sy: b.h, sz: b.d, color: b.color, style: st, seed: s });
        box.push({ x: b.x, y: b.h - 1.2, z: b.z, sx: b.w + 0.8, sy: 1.2, sz: b.d + 0.8, color: b.color, style: STYLE.plain, seed: s });
        if (b.roof === 'spire') {
          pyramids.push({ x: b.x, y: b.h, z: b.z, sx: b.w * 0.98, sy: b.roofH, sz: b.d * 0.98, color: b.roofColor });
          if (b.style === 'bell') {
            for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              pinnacles.push({ x: b.x + sx * (b.w / 2 + 0.1), y: b.h, z: b.z + sz * (b.d / 2 + 0.1), sx: 1.4, sy: 5, sz: 1.4, color: b.roofColor });
            }
          }
        } else {
          // Crenellated parapet
          this._merlonsRect(box, b.x, b.z, b.w + 0.8, b.d + 0.8, b.h, 0.9, 1.4, 0.55, 1.9, b.color);
        }
      } else if (b.style === 'pillar') {
        box.push({ x: b.x, y: 0, z: b.z, sx: 2.6, sy: 1.4, sz: 2.6, color: b.color, style: STYLE.plain, seed: s });
        cyl.push({ x: b.x, y: 1.4, z: b.z, sx: 1.7, sy: b.h - 2.2, sz: 1.7, color: b.color, style: STYLE.plain, seed: s });
        box.push({ x: b.x, y: b.h - 0.8, z: b.z, sx: 2.3, sy: 0.8, sz: 2.3, color: b.color, style: STYLE.plain, seed: s });
        this._brazier(b.x, b.h, b.z);
      }
    }
    for (const c of this.city.chimneys) {
      box.push({ x: c.x, y: c.y0, z: c.z, sx: c.w, sy: c.top - c.y0, sz: c.w, color: 0x8a6a58, style: STYLE.plain, seed: c.x });
      box.push({ x: c.x, y: c.top - 0.25, z: c.z, sx: c.w + 0.25, sy: 0.25, sz: c.w + 0.25, color: 0x6f5a4c, style: STYLE.plain, seed: c.z });
    }
    this.boxList = box;
    this.cylList = cyl;
    this.pinnacles = pinnacles;
    this.gableList = gables;
    this.hipList = hips;
    this.coneList = cones;
    this.pyramidList = pyramids;
    this.beamList = beams;
  }

  _merlonsRect(out, cx, cz, w, d, y, len, h, thick, step, color) {
    for (const [ax, half, other] of [[true, w / 2, d / 2], [false, d / 2, w / 2]]) {
      const n = Math.max(2, Math.floor((ax ? w : d) / step));
      for (let k = 0; k < n; k++) {
        const t = -half + (k + 0.5) * ((half * 2) / n);
        for (const sgn of [-1, 1]) {
          const x = ax ? cx + t : cx + sgn * (other - thick / 2);
          const z = ax ? cz + sgn * (other - thick / 2) : cz + t;
          out.push({ x, y, z, sx: ax ? len : thick, sy: h, sz: ax ? thick : len, color, style: STYLE.plain, seed: x * 0.1 + z });
        }
      }
    }
  }

  _brazier(x, y, z) {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.55, 0.8, 10), this.ironMat);
    bowl.position.set(x, y + 0.4, z);
    bowl.castShadow = true;
    this.group.add(bowl);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.62, 0.16), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flame = new THREE.Group();
    flame.position.set(x, y + 0.75, z);
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.5 - k * 0.12, 1.3 + k * 0.3, 7, 1, true).translate(0, 0.65 + k * 0.15, 0), flameMat);
      f.rotation.y = k * 1.3;
      flame.add(f);
    }
    this.group.add(flame);
    this.fires.push({ obj: flame, phase: x * 0.37 + z });
    this.fireSources.push(new THREE.Vector3(x, y + 2.2, z));
  }

  _buildWall() {
    const box = this.boxList, cyl = this.cylList;
    const stone = 0xb3a78f;
    for (const w of this.city.wall) {
      box.push({ x: (w.minX + w.maxX) / 2, y: 0, z: (w.minZ + w.maxZ) / 2, sx: w.maxX - w.minX, sy: w.maxY - w.minY, sz: w.maxZ - w.minZ, color: stone, style: STYLE.wall, seed: w.minX * 0.01 });
      // Merlons along both top edges, skipping the towers.
      const alongX = w.maxX - w.minX > w.maxZ - w.minZ;
      const len = alongX ? w.maxX - w.minX : w.maxZ - w.minZ;
      const n = Math.floor(len / 3.4);
      for (let k = 0; k < n; k++) {
        const t = (alongX ? w.minX : w.minZ) + (k + 0.5) * (len / n);
        for (const edge of [0, 1]) {
          const x = alongX ? t : edge ? w.maxX - 0.6 : w.minX + 0.6;
          const z = alongX ? (edge ? w.maxZ - 0.6 : w.minZ + 0.6) : t;
          if (this.city.wallTowers.some((tw) => Math.hypot(tw.x - x, tw.z - z) < tw.r + 1)) continue;
          box.push({ x, y: w.maxY, z, sx: alongX ? 1.8 : 1.2, sy: 2.4, sz: alongX ? 1.2 : 1.8, color: stone, style: STYLE.plain, seed: t });
        }
      }
    }
    for (const t of this.city.wallTowers) {
      cyl.push({ x: t.x, y: 0, z: t.z, sx: t.r * 2, sy: t.h, sz: t.r * 2, color: stone, style: STYLE.wall, seed: t.x * 0.1 + t.z });
      cyl.push({ x: t.x, y: t.h - 2, z: t.z, sx: t.r * 2 + 1.4, sy: 2, sz: t.r * 2 + 1.4, color: stone, style: STYLE.plain, seed: t.z });
      this.coneList.push({ x: t.x, y: t.h, z: t.z, sx: t.r * 2 + 2.6, sy: t.roofH, sz: t.r * 2 + 2.6, color: 0x4b5560 });
    }
    // Broken masonry at the breach edges.
    const rng = createRng(99);
    const BH = CITY.BREACH_HALF, H = CITY.HALF, WT = CITY.WALL_THICK;
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < 16; k++) {
        const s = rng.range(2, 4.5);
        const y = rng.range(0, CITY.WALL_HEIGHT - 4) * (k < 10 ? 1 : 0.3);
        box.push({
          x: sgn * (BH + rng.range(-1.2, 2.5)), y, z: H + rng.range(0.5, WT - 0.5),
          sx: s, sy: s * 0.6, sz: s * 0.9, rot: rng.range(-0.4, 0.4), rx: rng.range(-0.3, 0.3), rz: rng.range(-0.3, 0.3),
          color: 0xa89c86, style: STYLE.plain, seed: k,
        });
      }
    }
    // Rubble
    const rub = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0x958b7a, flatShading: true, roughness: 0.95 }), this.city.rubble.length);
    this.city.rubble.forEach((r, i) => setInstance(rub, i, r.x, r.h * 0.5, r.z, r.w, r.h * 1.6, r.d, r.rot * 6));
    rub.castShadow = true;
    rub.receiveShadow = true;
    this.group.add(rub);

    // Everything collected so far becomes a handful of instanced draws.
    this.group.add(facadeInstanced(this.boxGeo, this.facadeMat, this.boxList));
    this.group.add(facadeInstanced(this.cylGeo, this.facadeCylMat, this.cylList));
    this.group.add(instanced(createGableGeometry(), this.roofMat, this.gableList));
    this.group.add(instanced(createHipGeometry(), this.roofMat, this.hipList));
    this.group.add(instanced(new THREE.ConeGeometry(0.5, 1, 24, 1).translate(0, 0.5, 0), this.coneRoofMat, this.coneList));
    this.group.add(instanced(new THREE.ConeGeometry(0.7071, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), this.coneRoofMat, this.pyramidList));
    this.group.add(instanced(new THREE.ConeGeometry(0.5, 1, 6, 1).translate(0, 0.5, 0), this.coneRoofMat, this.pinnacles));
    this.group.add(instanced(this.boxGeo, this.woodMat, this.beamList, { shadow: false }));
    this._buildClock();
  }

  _buildClock() {
    const bell = this.city.buildings.find((b) => b.style === 'bell');
    if (!bell) return;
    const face = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.9 });
    const y = 44;
    const ticks = [];
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * Math.PI * 2;
      const g = new THREE.Group();
      g.position.set(bell.x + Math.sin(a) * (bell.w / 2 + 0.05), y, bell.z + Math.cos(a) * (bell.d / 2 + 0.05));
      g.rotation.y = a;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.2, 32).rotateX(Math.PI / 2), gold);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), face);
      disc.position.z = 0.11;
      const hour = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.05).translate(0, 0.6, 0), this.ironMat);
      hour.position.z = 0.16;
      hour.rotation.z = -2.2;
      const min = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.05).translate(0, 0.9, 0), this.ironMat);
      min.position.z = 0.18;
      min.rotation.z = 0.5;
      g.add(ring, disc, hour, min);
      g.updateMatrixWorld(true);
      for (let k = 0; k < 12; k++) {
        const ta = (k / 12) * Math.PI * 2;
        tmpP.set(Math.sin(ta) * 1.85, Math.cos(ta) * 1.85, 0.14);
        g.localToWorld(tmpP);
        ticks.push({ x: tmpP.x, y: tmpP.y, z: tmpP.z, sx: 0.12, sy: 0.35, sz: 0.04, rot: a, rz: -ta });
      }
      this.group.add(g);
    }
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1), this.ironMat, ticks, { shadow: false }));
  }

  _buildTrees() {
    const ts = this.city.trees;
    const bark = new THREE.MeshStandardMaterial({ color: 0x4f3a2a, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 1, 1, 7).translate(0, 0.5, 0), bark, ts.length);
    const coneGeo = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
    const layers = 4;
    const cones = new THREE.InstancedMesh(coneGeo, canopyMat, ts.length * layers);
    const greens = [0x2b4d2c, 0x34603a, 0x284629, 0x3d6537, 0x2f5530];
    ts.forEach((t, i) => {
      setInstance(trunks, i, t.x, 0, t.z, t.r * 2, t.h, t.r * 2);
      const span = t.h - t.canopyY;
      for (let k = 0; k < layers; k++) {
        const y = t.canopyY + (k * span) / (layers + 0.4);
        const s = t.canopyR * (1.05 - k * 0.2);
        tmpC.set(greens[(i + k) % greens.length]).multiplyScalar(0.85 + k * 0.08);
        setInstance(cones, i * layers + k, t.x, y, t.z, s, span * 0.5, s, i + k * 0.7, tmpC.getHex());
      }
    });
    for (const m of [trunks, cones]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
  }

  _buildMarket() {
    const stalls = this.city.stalls;
    const counters = [], posts = [], awnings = [], goods = [];
    const produce = [0xc0392b, 0xe0a33a, 0x6a8f3a, 0x8e5a2e, 0xd8c48a, 0x7a2f4f];
    let k = 0;
    for (const s of stalls) {
      const c = Math.cos(s.rot), sn = Math.sin(s.rot);
      const loc = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
      let [x, z] = loc(0, 0.2);
      counters.push({ x, y: 0, z, sx: s.w, sy: 1.0, sz: s.d * 0.6, rot: s.rot, color: 0x6b4a2c });
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        [x, z] = loc(px * (s.w / 2 - 0.1), pz * (s.d / 2 - 0.1));
        posts.push({ x, y: 0, z, sx: 0.14, sy: s.h - (pz > 0 ? 0.35 : 0), sz: 0.14, rot: s.rot, color: 0x4a2f1c });
      }
      [x, z] = loc(0, 0);
      awnings.push({ x, y: s.h - 0.35, z, sx: s.w + 0.5, sy: 1, sz: s.d + 0.5, rot: s.rot, color: s.color });
      for (let g = 0; g < 5; g++) {
        [x, z] = loc(-s.w / 2 + 0.4 + g * ((s.w - 0.8) / 4), 0.2);
        goods.push({ x, y: 1.0, z, sx: 0.5, sy: 0.3, sz: 0.5, rot: s.rot + g, color: produce[(k + g) % produce.length] });
      }
      k++;
    }
    const woodC = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.group.add(instanced(this.boxGeo, woodC, counters));
    this.group.add(instanced(this.boxGeo, woodC, posts));
    this.group.add(instanced(this.boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), goods));
    const awnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stripeTexture(), side: THREE.DoubleSide, roughness: 0.9 });
    this.group.add(instanced(awningGeometry(), awnMat, awnings));

    // Barrels and crates against the houses.
    const barrels = [], crates = [];
    for (const p of this.city.props) {
      if (p.kind === 'barrel') barrels.push({ x: p.x, y: 0, z: p.z, sx: p.s, sy: p.s * 1.1, sz: p.s, rot: p.rot, color: 0x7a5534 });
      else crates.push({ x: p.x, y: 0, z: p.z, sx: p.s, sy: p.s * 0.9, sz: p.s, rot: p.rot, color: 0x8f6b42 });
    }
    this.group.add(instanced(barrelGeometry(), woodC, barrels));
    this.group.add(instanced(this.boxGeo, woodC, crates));
  }

  _buildBanners() {
    const byColor = new Map();
    const poles = [];
    for (const b of this.city.banners) {
      if (!byColor.has(b.color)) byColor.set(b.color, []);
      byColor.get(b.color).push(b);
      const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
      const x = b.x + s * 0.25, z = b.z + c * 0.25;
      poles.push({ x: x - c * (b.w / 2 + 0.3), y: b.y + b.h / 2, z: z + s * (b.w / 2 + 0.3), sx: b.w + 0.6, sy: 0.14, sz: 0.14, rot: b.rotY, color: 0x3a2a1c });
    }
    const geo = new THREE.PlaneGeometry(1, 1, 3, 10).translate(0, -0.5, 0);
    for (const [color, list] of byColor) {
      const mat = createClothMaterial({ map: bannerTexture(color), alphaTest: 0.5 });
      this.clothMats.push(mat);
      const items = list.map((b) => {
        const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
        return { x: b.x + s * 0.3, y: b.y + b.h / 2, z: b.z + c * 0.3, sx: b.w, sy: b.h, sz: 1, rot: b.rotY };
      });
      const m = instanced(geo, mat, items, { shadow: true });
      this.group.add(m);
    }
    // Poles run along the banner's top edge (box is centred on x, translate below).
    const poleGeo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0);
    this.group.add(instanced(poleGeo, this.woodMat, poles, { shadow: false }));
  }

  _buildLanterns() {
    const ls = this.city.lanterns;
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.7, 0.6) });
    const glow = instanced(new THREE.BoxGeometry(0.28, 0.4, 0.28), glass, ls.map((l) => ({ x: l.x, y: l.y, z: l.z, sx: 1, sy: 1, sz: 1 })), { shadow: false, receive: false });
    const caps = instanced(new THREE.ConeGeometry(0.28, 0.25, 4).rotateY(Math.PI / 4), this.ironMat, ls.map((l) => ({ x: l.x, y: l.y + 0.32, z: l.z, sx: 1, sy: 1, sz: 1 })), { shadow: false });
    this.group.add(glow, caps);
  }

  _buildDepots() {
    this.depotBeacons = [];
    const plat = new THREE.MeshStandardMaterial({ color: 0x6d5238, roughness: 0.9 });
    const crate = new THREE.MeshStandardMaterial({ color: 0x9a7a4e, roughness: 0.85 });
    const canMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.35, metalness: 0.85 });
    const flagMat = createClothMaterial({ map: bannerTexture(0x1f4fa0), alphaTest: 0.5 });
    this.clothMats.push(flagMat);
    const beaconMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying float vDepth; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vDepth;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6) * (0.4 + 0.08 * sin(uTime * 2.5));
          a *= 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0);
          // Subtle up close (it's a landmark for finding depots from afar).
          a *= mix(0.12, 1.0, smoothstep(12.0, 90.0, vDepth));
          gl_FragColor = vec4(vec3(0.35, 0.65, 1.0) * a, a);
        }`,
    });
    this.beaconMat = beaconMat;
    for (const d of this.city.depots) {
      const g = new THREE.Group();
      g.position.set(d.x, 0, d.z);
      const p = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), plat);
      p.position.y = 0.6;
      p.receiveShadow = true;
      p.castShadow = true;
      g.add(p);
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crate);
        c.position.set(-3 + (k % 2) * 1.3, 1.8 + Math.floor(k / 2) * 1.2, -3 + (k === 3 ? 0.2 : 0));
        c.castShadow = true;
        g.add(c);
      }
      for (let k = 0; k < 3; k++) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 12), canMat);
        can.position.set(2.6 - k * 0.7, 1.9, 3);
        can.castShadow = true;
        g.add(can);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 6), this.woodMat);
      pole.position.set(3.4, 6.2, -3.4);
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4, 3, 10).translate(0, -2.2, 0), flagMat);
      flag.position.set(3.4, 11, -3.1);
      g.add(flag);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 140, 16, 1, true).translate(0, 70, 0), beaconMat);
      beacon.position.y = 1.2;
      g.add(beacon);
      this.depotBeacons.push(beacon);
      this.group.add(g);
    }
  }

  _buildScenery() {
    const ot = this.city.outerTrees;
    const conifers = ot.filter((t) => !t.broad), broad = ot.filter((t) => t.broad);
    const leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
    const cl = conifers.map((t, i) => ({ x: t.x, y: 0, z: t.z, sx: t.canopyR, sy: t.h, sz: t.canopyR, rot: i, color: [0x2f4f2e, 0x375a33, 0x2a4428][i % 3] }));
    this.group.add(instanced(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), leaf, cl, { shadow: false }));
    const bl = [];
    broad.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        bl.push({ x: t.x + Math.sin(i + k * 2.1) * t.canopyR * 0.5, y: t.h * (0.45 + k * 0.12), z: t.z + Math.cos(i + k * 2.1) * t.canopyR * 0.5, sx: t.canopyR, sy: t.canopyR * 0.8, sz: t.canopyR, rot: i + k, color: [0x4d6b30, 0x5a7a34, 0x44602c][(i + k) % 3] });
      }
    });
    this.group.add(instanced(new THREE.IcosahedronGeometry(1, 0), leaf, bl, { shadow: false }));
    const trunks = broad.map((t) => ({ x: t.x, y: 0, z: t.z, sx: 0.8, sy: t.h * 0.55, sz: 0.8 }));
    this.group.add(instanced(new THREE.CylinderGeometry(0.4, 0.6, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a3626 }), trunks, { shadow: false }));

    // Two mountain ranges: forested foothills and snow-capped peaks, hazed toward the sky.
    const haze = ATMOS.fogColor.clone().multiplyScalar(1.02).getHex();
    const hills = new THREE.Mesh(mountainGeometry(820, 1150, 120, 5, 0x3c5236, haze, 0.62, 0), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
    const peaks = new THREE.Mesh(mountainGeometry(1300, 1750, 330, 11, 0x6f7480, haze, 0.66, 0.58), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
    this.group.add(hills, peaks);
  }

  _buildBirds() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1, 0.25, -0.2, 0, 0, -0.1, 0, 0, 0.3, 0, 0, -0.1, 1, 0.25, -0.2], 3));
    g.computeVertexNormals();
    const n = 26;
    this.birds = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x1c1a18, side: THREE.DoubleSide }), n);
    this.birds.frustumCulled = false;
    this.birdData = Array.from({ length: n }, (_, i) => ({ r: 30 + (i % 7) * 6, y: 75 + (i % 5) * 4, a: i * 0.9, sp: 0.18 + (i % 4) * 0.03, ph: i * 1.7 }));
    this.group.add(this.birds);
  }

  applyQuality(q) {
    this.sun.castShadow = !!q.shadows;
    if (q.shadows) {
      this.shadowTexel = this.shadowExtent / q.shadowSize;
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  /** Per-frame: sky follows the camera, shadow frustum follows the player, ambient animation. */
  update(focus, time, camera) {
    const t = this.shadowTexel;
    const r = Math.round(focus.dot(this.lightRight) / t) * t;
    const u = Math.round(focus.dot(this.lightUp) / t) * t;
    const f = focus.dot(this.lightDir);
    const snap = this._snap.copy(this.lightRight).multiplyScalar(r).addScaledVector(this.lightUp, u).addScaledVector(this.lightDir, f);
    this.sun.target.position.copy(snap);
    this.sun.position.copy(snap).add(this.sunOffset);

    const now = performance.now() / 1000;
    if (camera) this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uTime.value = now;
    this.beaconMat.uniforms.uTime.value = now;
    for (const m of this.clothMats) m.userData.uTime.value = now;
    for (const fire of this.fires) {
      const p = now * 9 + fire.phase;
      fire.obj.scale.set(1 + Math.sin(p * 1.3) * 0.08, 1 + Math.sin(p) * 0.18 + Math.sin(p * 2.7) * 0.1, 1 + Math.cos(p * 1.1) * 0.08);
      fire.obj.rotation.y = now * 0.8 + fire.phase;
    }
    // Birds circling the bell tower
    for (let i = 0; i < this.birdData.length; i++) {
      const b = this.birdData[i];
      const a = b.a + now * b.sp;
      const x = Math.cos(a) * b.r, z = Math.sin(a) * b.r, y = b.y + Math.sin(now * 0.7 + b.ph) * 3;
      tmpP.set(x, y, z);
      tmpQ.setFromEuler(tmpE.set(0, -a, Math.sin(now * 0.9 + b.ph) * 0.3, 'YXZ'));
      const flap = 0.5 + 0.5 * Math.sin(now * 9 + b.ph);
      tmpS.set(1.1, 0.4 + flap * 1.4, 1.1);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.birds.setMatrixAt(i, tmpM);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }
}

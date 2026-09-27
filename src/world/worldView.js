import * as THREE from 'three';
import { CITY } from './city.js';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Lambert material with procedural windows/timber bands in world space. */
function createFacadeMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vFWorld;\nvarying vec3 vFNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        vec3 fn = normal;
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
          fn = mat3(instanceMatrix) * fn;
        #endif
        fwp = modelMatrix * fwp;
        vFWorld = fwp.xyz;
        vFNormal = normalize(mat3(modelMatrix) * fn);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFWorld;\nvarying vec3 vFNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vFNormal);
          if (abs(n.y) < 0.5) {
            float u = abs(n.x) > 0.5 ? vFWorld.z : vFWorld.x;
            float v = vFWorld.y;
            float fu = fract(u / 3.4);
            float fv = fract(v / 3.8);
            float win = step(0.32, fu) * step(fu, 0.68) * step(0.3, fv) * step(fv, 0.78) * step(3.0, v);
            float band = step(fract(v / 3.8), 0.07) * step(3.0, v);
            float base = 1.0 - step(1.2, v);
            diffuseColor.rgb *= 1.0 - 0.14 * band - 0.2 * base;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.18, 0.24), win * 0.85);
          }
        }`,
      );
  };
  return mat;
}

/** Unit gable prism: footprint [-0.5,0.5]^2, height 1, ridge along Z. */
function createGableGeometry() {
  const g = new THREE.BufferGeometry();
  const p = [
    // left slope
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    // right slope
    0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5,
    0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
    // gable ends
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

function createSky(scene) {
  const geo = new THREE.SphereGeometry(1800, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4f86c6) },
      horizon: { value: new THREE.Color(0xdfe6e3) },
      bottom: { value: new THREE.Color(0xb8c2b0) },
      sunDir: { value: new THREE.Vector3(0.45, 0.6, 0.3).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.6)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export class WorldView {
  constructor(scene, city, quality) {
    this.scene = scene;
    this.city = city;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.sky = createSky(scene);
    this._buildLights(quality);
    this._buildGround();
    this._buildBuildings();
    this._buildTrees();
    this._buildWall();
    this._buildDepots();
    this._buildScenery();
    this.applyQuality(quality);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6b5f4a, 1.35);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(90, 120, 60);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(90, 140, 60);
    // Light-space basis used to snap the shadow frustum to whole texels.
    this.lightDir = this.sunOffset.clone().normalize();
    this.lightRight = new THREE.Vector3().crossVectors(UP, this.lightDir).normalize();
    this.lightUp = new THREE.Vector3().crossVectors(this.lightDir, this.lightRight).normalize();
    this.shadowTexel = 180 / 1024;
    this._snap = new THREE.Vector3();
  }

  _buildGround() {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x7c8d56 }),
    );
    grass.position.y = -0.15; // below the city floor to avoid z-fighting at grazing angles
    grass.receiveShadow = true;
    this.group.add(grass);
    const H = CITY.HALF;
    // Cobbled city floor (south of the forest band)
    const cityDepth = H - (CITY.FOREST_Z1 + 4);
    const cobble = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, cityDepth).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x9d9384 }),
    );
    cobble.position.set(0, 0, H - cityDepth / 2);
    cobble.receiveShadow = true;
    this.group.add(cobble);
    // Forest floor
    const forest = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, H + CITY.FOREST_Z1 + 4).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x55663c }),
    );
    forest.position.set(0, 0, (-H + CITY.FOREST_Z1 + 4) / 2);
    forest.receiveShadow = true;
    this.group.add(forest);
    // Plaza disc
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(CITY.PLAZA_R - 2, 40).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xb8ad98 }),
    );
    plaza.position.y = 0.08;
    plaza.receiveShadow = true;
    this.group.add(plaza);
    for (const sq of this.city.squares) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(sq.size, sq.size).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0xb3a892 }),
      );
      m.position.set(sq.x, 0.08, sq.z);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  _buildBuildings() {
    const bs = this.city.buildings;
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const bodies = new THREE.InstancedMesh(box, createFacadeMaterial(), bs.length);
    const gables = bs.filter((b) => b.roof === 'gable');
    const spires = bs.filter((b) => b.roof === 'spire');
    const flats = bs.filter((b) => b.roof === 'flat');
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const gableMesh = new THREE.InstancedMesh(createGableGeometry(), roofMat, Math.max(1, gables.length));
    const spireGeo = new THREE.ConeGeometry(0.7071, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    const spireMesh = new THREE.InstancedMesh(spireGeo, roofMat, Math.max(1, spires.length));
    const capMesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, flats.length));

    bs.forEach((b, i) => setInstance(bodies, i, b.x, 0, b.z, b.w, b.h, b.d, 0, b.color));
    gables.forEach((b, i) => {
      const alongZ = b.d >= b.w;
      setInstance(gableMesh, i, b.x, b.h, b.z, alongZ ? b.w + 0.8 : b.d + 0.8, b.roofH, alongZ ? b.d + 0.8 : b.w + 0.8, alongZ ? 0 : Math.PI / 2, b.roofColor);
    });
    spires.forEach((b, i) => setInstance(spireMesh, i, b.x, b.h, b.z, b.w * 0.95, b.roofH, b.d * 0.95, 0, b.roofColor));
    flats.forEach((b, i) => {
      tmpC.set(b.color).multiplyScalar(0.8);
      setInstance(capMesh, i, b.x, b.h, b.z, b.w + 0.6, 0.8, b.d + 0.6, 0, tmpC.getHex());
    });
    for (const m of [bodies, gableMesh, spireMesh, capMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
    this.shadowCasters = [bodies, gableMesh, spireMesh, capMesh];
  }

  _buildTrees() {
    const ts = this.city.trees;
    const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a4332 }), ts.length);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const cones = new THREE.InstancedMesh(coneGeo, canopyMat, ts.length * 3);
    const greens = [0x2f5a32, 0x3a6b3a, 0x2c4f2e, 0x456f3c];
    ts.forEach((t, i) => {
      setInstance(trunks, i, t.x, 0, t.z, t.r * 2, t.h, t.r * 2);
      const span = t.h - t.canopyY;
      for (let k = 0; k < 3; k++) {
        const y = t.canopyY + (k * span) / 3.2;
        const s = t.canopyR * (1 - k * 0.25);
        setInstance(cones, i * 3 + k, t.x, y, t.z, s, span * 0.55, s, i + k, greens[(i + k) % greens.length]);
      }
    });
    for (const m of [trunks, cones]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
  }

  _buildWall() {
    const stone = new THREE.MeshLambertMaterial({ color: 0xa39c8e });
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const w of this.city.wall) {
      const m = new THREE.Mesh(box, stone);
      m.scale.set(w.maxX - w.minX, w.maxY - w.minY, w.maxZ - w.minZ);
      m.position.set((w.minX + w.maxX) / 2, (w.minY + w.maxY) / 2, (w.minZ + w.maxZ) / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // Horizontal masonry bands to break up the wall faces
    const bandMat = new THREE.MeshLambertMaterial({ color: 0x8d8678 });
    for (const w of this.city.wall) {
      for (const y of [12, 26, 40]) {
        const m = new THREE.Mesh(box, bandMat);
        m.scale.set(w.maxX - w.minX + 0.6, 1.2, w.maxZ - w.minZ + 0.6);
        m.position.set((w.minX + w.maxX) / 2, y, (w.minZ + w.maxZ) / 2);
        this.group.add(m);
      }
    }
    // Rubble
    const rub = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshLambertMaterial({ color: 0x8f887a, flatShading: true }), this.city.rubble.length);
    this.city.rubble.forEach((r, i) => setInstance(rub, i, r.x, r.h * 0.5, r.z, r.w, r.h * 1.6, r.d, r.rot * 6));
    rub.castShadow = true;
    this.group.add(rub);
  }

  _buildDepots() {
    this.depotBeacons = [];
    const plat = new THREE.MeshLambertMaterial({ color: 0x6d5a45 });
    const crate = new THREE.MeshLambertMaterial({ color: 0x9a7a4e });
    const flagMat = new THREE.MeshLambertMaterial({ color: 0x2f6fd6, side: THREE.DoubleSide });
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0x66b3ff, transparent: true, opacity: 0.22, depthWrite: false });
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
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 5), crate);
      pole.position.set(3.4, 5.7, -3.4);
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), flagMat);
      flag.position.set(4.7, 9.2, -3.4);
      g.add(flag);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 140, 8, 1, true), beaconMat);
      beacon.position.y = 70;
      g.add(beacon);
      this.depotBeacons.push(beacon);
      this.group.add(g);
    }
  }

  _buildScenery() {
    const ot = this.city.outerTrees;
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x3d5e36, flatShading: true }), ot.length);
    ot.forEach((t, i) => setInstance(cones, i, t.x, 0, t.z, t.canopyR, t.h, t.canopyR, i));
    this.group.add(cones);
    // Distant mountains ring
    const mts = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x7d8a8f, flatShading: true }), 36);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const d = 1100 + (i % 3) * 120;
      const s = 180 + ((i * 37) % 90);
      setInstance(mts, i, Math.cos(a) * d, -10, Math.sin(a) * d, s, s * 0.9, s, i);
    }
    this.group.add(mts);
  }

  applyQuality(q) {
    this.sun.castShadow = !!q.shadows;
    if (q.shadows) {
      this.shadowTexel = 180 / q.shadowSize;
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
  }

  /** Keep the shadow frustum centered on the player, snapped to texels to avoid shimmer. */
  update(focus, time) {
    const t = this.shadowTexel;
    const r = Math.round(focus.dot(this.lightRight) / t) * t;
    const u = Math.round(focus.dot(this.lightUp) / t) * t;
    const f = focus.dot(this.lightDir);
    const snap = this._snap.copy(this.lightRight).multiplyScalar(r).addScaledVector(this.lightUp, u).addScaledVector(this.lightDir, f);
    this.sun.target.position.copy(snap);
    this.sun.position.copy(snap).add(this.sunOffset);
    for (const b of this.depotBeacons) b.material.opacity = 0.16 + Math.sin(time * 2.5) * 0.06;
  }
}

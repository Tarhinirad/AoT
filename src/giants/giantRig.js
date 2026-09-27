import * as THREE from 'three';

/**
 * Procedural low-poly giant. All dimensions are fractions of the giant's
 * height H. Local forward is +Z (the face), so the nape is on -Z.
 *
 * Bone hierarchy (THREE.Group pivots):
 *   root (feet on ground, yaw)
 *     hips
 *       spine → chest → neck → head
 *                     → shoulderL/R → elbowL/R → handL/R
 *       hipL/R → kneeL/R
 */
const SHARED = {};
function sharedGeos() {
  if (SHARED.box) return SHARED;
  SHARED.box = new THREE.BoxGeometry(1, 1, 1);
  SHARED.limb = new THREE.CylinderGeometry(0.5, 0.42, 1, 6).translate(0, -0.5, 0);
  SHARED.head = new THREE.IcosahedronGeometry(0.5, 1);
  SHARED.sphere = new THREE.IcosahedronGeometry(0.5, 0);
  SHARED.torso = new THREE.CylinderGeometry(0.5, 0.42, 1, 7);
  SHARED.dark = new THREE.MeshLambertMaterial({ color: 0x1c1512 });
  SHARED.teeth = new THREE.MeshLambertMaterial({ color: 0xe8e0cc });
  SHARED.napeMat = new THREE.MeshLambertMaterial({ color: 0x8a2f2a, emissive: 0x3a0806 });
  return SHARED;
}

const SKINS = [0xe3b39a, 0xd8a184, 0xc98c6f, 0xe8c3a6, 0xb97a60, 0xd49a88];
const HAIRS = [0x2a1d14, 0x4b3322, 0x7a5a36, 0x1a1a1a, 0x9c8a6a];

export function buildGiantRig(H, rng, abnormal = false) {
  const G = sharedGeos();
  const skinColor = rng.pick(SKINS);
  const skin = new THREE.MeshLambertMaterial({ color: skinColor, flatShading: true, emissive: 0x000000 });
  const hairMat = new THREE.MeshLambertMaterial({ color: rng.pick(HAIRS), flatShading: true });

  // Proportion variation for an uncanny look
  const headS = rng.range(0.14, 0.18) * (abnormal ? 1.15 : 1);
  const armL = rng.range(0.9, 1.1) * (abnormal ? 1.2 : 1);
  const belly = rng.range(0.9, 1.25);
  const legL = rng.range(0.92, 1.05) * (abnormal ? 0.9 : 1);
  const hipH = 0.46 * legL;

  const bones = {};
  const mk = (name, parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x * H, y * H, z * H);
    parent.add(g);
    bones[name] = g;
    return g;
  };
  const mesh = (geo, mat, parent, sx, sy, sz, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx * H, sy * H, sz * H);
    m.position.set(x * H, y * H, z * H);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  bones.root = root;
  const tilt = new THREE.Group(); // pivots at the feet for falls
  root.add(tilt);
  bones.tilt = tilt;
  const hips = mk('hips', tilt, 0, hipH, 0);
  mesh(G.sphere, skin, hips, 0.2 * belly, 0.12, 0.14 * belly, 0, 0.0, 0);
  const spine = mk('spine', hips, 0, 0.02, 0);
  const torsoLen = 0.29;
  mesh(G.torso, skin, spine, 0.22 * belly, torsoLen * 0.7, 0.15 * belly, 0, torsoLen * 0.32, 0);
  const chest = mk('chest', spine, 0, torsoLen * 0.62, 0);
  mesh(G.torso, skin, chest, 0.26, 0.14, 0.16, 0, 0.02, 0);
  // Rib/abs hint
  mesh(G.box, skin, chest, 0.16, 0.05, 0.02, 0, -0.03, 0.075);

  const neck = mk('neck', chest, 0, 0.09, -0.01);
  mesh(G.limb, skin, neck, 0.075, -0.07, 0.075, 0, 0, 0);
  // Weak point marker on the back of the neck.
  const napeMark = mesh(G.sphere, G.napeMat, neck, 0.05, 0.035, 0.02, 0, 0.035, -0.036);
  const head = mk('head', neck, 0, 0.07 + headS * 0.45, 0.005);
  mesh(G.head, skin, head, headS * 0.9, headS, headS * 0.95);
  // Face: eyes, grin, nose, ears
  for (const s of [-1, 1]) {
    mesh(G.sphere, G.dark, head, headS * 0.16, headS * 0.1, headS * 0.08, s * headS * 0.19, headS * 0.08, headS * 0.43);
    mesh(G.sphere, skin, head, headS * 0.12, headS * 0.22, headS * 0.1, s * headS * 0.46, 0, 0);
  }
  mesh(G.box, G.teeth, head, headS * 0.46, headS * 0.08, headS * 0.05, 0, -headS * 0.22, headS * 0.42);
  mesh(G.box, G.dark, head, headS * 0.5, headS * 0.03, headS * 0.05, 0, -headS * 0.17, headS * 0.43);
  mesh(G.sphere, skin, head, headS * 0.12, headS * 0.18, headS * 0.14, 0, -headS * 0.02, headS * 0.5);
  if (rng.chance(0.75)) {
    mesh(G.head, hairMat, head, headS * 0.95, headS * 0.6, headS * 1.0, 0, headS * 0.25, -headS * 0.04);
  }

  // Arms
  const arms = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const sh = mk('shoulder' + side, chest, s * 0.14, 0.05, 0);
    mesh(G.sphere, skin, sh, 0.085, 0.085, 0.085);
    const up = 0.18 * armL, fore = 0.17 * armL;
    const upper = new THREE.Group();
    sh.add(upper);
    mesh(G.limb, skin, upper, 0.07, up, 0.07);
    const el = mk('elbow' + side, upper, 0, -up, 0);
    mesh(G.limb, skin, el, 0.058, fore, 0.058);
    const hand = mk('hand' + side, el, 0, -fore, 0);
    mesh(G.sphere, skin, hand, 0.07, 0.09, 0.05, 0, -0.035, 0);
    arms[side] = { shoulder: sh, upper, elbow: el, hand, up, fore };
    bones['upper' + side] = upper;
  }
  // Legs
  const legs = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const hip = mk('hip' + side, hips, s * 0.065, -0.02, 0);
    const thighL = 0.23 * legL, shinL = 0.22 * legL;
    mesh(G.limb, skin, hip, 0.1, thighL, 0.1);
    const knee = mk('knee' + side, hip, 0, -thighL, 0);
    mesh(G.limb, skin, knee, 0.08, shinL, 0.08);
    mesh(G.box, skin, knee, 0.08, 0.035, 0.13, 0, -shinL - 0.005, 0.03);
    legs[side] = { hip, knee, thighL, shinL };
  }

  /**
   * Hitboxes: sphere offsets in bone-local space (meters), radius in meters.
   * kind: nape | head | body | limb.  limb: which limb it belongs to.
   */
  const r = (f) => f * H;
  const hitboxes = [
    { name: 'nape', bone: neck, offset: new THREE.Vector3(0, r(0.035), r(-0.045)), radius: Math.max(0.38, r(0.045)), kind: 'nape' },
    { name: 'head', bone: head, offset: new THREE.Vector3(0, 0, 0), radius: r(headS * 0.5), kind: 'head' },
    { name: 'neck', bone: neck, offset: new THREE.Vector3(0, r(0.035), r(0.01)), radius: r(0.04), kind: 'body' },
    { name: 'chest', bone: chest, offset: new THREE.Vector3(0, r(0.0), 0), radius: r(0.12), kind: 'body' },
    { name: 'belly', bone: spine, offset: new THREE.Vector3(0, r(0.1), 0), radius: r(0.11 * belly), kind: 'body' },
    { name: 'pelvis', bone: hips, offset: new THREE.Vector3(0, 0, 0), radius: r(0.1), kind: 'body' },
  ];
  for (const side of ['L', 'R']) {
    const a = arms[side];
    hitboxes.push(
      { name: 'upperArm' + side, bone: a.upper, offset: new THREE.Vector3(0, -a.up * H * 0.5, 0), radius: r(0.05), kind: 'limb', limb: 'arm' + side },
      { name: 'foreArm' + side, bone: a.elbow, offset: new THREE.Vector3(0, -a.fore * H * 0.5, 0), radius: r(0.045), kind: 'limb', limb: 'arm' + side },
      { name: 'hand' + side, bone: a.hand, offset: new THREE.Vector3(0, r(-0.035), 0), radius: r(0.055), kind: 'limb', limb: 'arm' + side },
    );
    const l = legs[side];
    hitboxes.push(
      { name: 'thigh' + side, bone: l.hip, offset: new THREE.Vector3(0, -l.thighL * H * 0.5, 0), radius: r(0.06), kind: 'limb', limb: 'leg' + side },
      { name: 'shin' + side, bone: l.knee, offset: new THREE.Vector3(0, -l.shinL * H * 0.5, 0), radius: r(0.05), kind: 'limb', limb: 'leg' + side },
    );
  }
  for (const hb of hitboxes) hb.world = new THREE.Vector3();

  return { root, bones, arms, legs, hitboxes, skin, skinColor, napeMark, hipH, H };
}

/**
 * Procedural pose. `p` is an animation parameter bag produced by the giant's
 * state: walk phase/amount, reach targets, swipe, stagger, death.
 */
export function poseGiant(rig, p) {
  const { bones, arms, legs } = rig;
  const w = p.walk; // 0..1 blend of walk cycle
  const ph = p.phase;
  const sprint = p.sprint || 0;

  // Legs
  const stride = (0.45 + sprint * 0.3) * w;
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const leg = legs[side];
    const sw = Math.sin(ph + (s > 0 ? 0 : Math.PI));
    leg.hip.rotation.x = -sw * stride - (p.crawl || 0) * 1.2;
    leg.knee.rotation.x = Math.max(0, Math.cos(ph + (s > 0 ? 0 : Math.PI))) * stride * 1.4 + (p.crawl || 0) * 1.6;
    leg.hip.rotation.z = 0;
  }
  // Body bob and lean
  const bob = Math.abs(Math.sin(ph)) * 0.02 * w;
  bones.hips.position.y = (rig.hipH + bob - (p.crouch || 0) * 0.12 - (p.crawl || 0) * 0.3) * rig.H;
  bones.spine.rotation.x = 0.06 * w + sprint * 0.35 + (p.lean || 0) + (p.crawl || 0) * 0.9;
  bones.spine.rotation.z = Math.sin(ph) * 0.04 * w;
  bones.spine.rotation.y = (p.twist || 0) + Math.sin(ph) * 0.05 * w;
  bones.neck.rotation.x = -(p.lean || 0) * 0.5 - sprint * 0.3 + (p.headPitch || 0) - (p.crawl || 0) * 0.7;
  bones.neck.rotation.y = p.headYaw || 0;
  bones.neck.rotation.z = p.headTilt || 0;

  // Arms: walk swing, blended with reach/swipe poses.
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const arm = arms[side];
    const sw = Math.sin(ph + (s > 0 ? Math.PI : 0)) * (0.35 + sprint * 0.5) * w;
    let rx = sw, rz = s * 0.12, ry = 0, ex = -0.25 - sprint * 0.6;
    const reach = side === 'L' ? p.reachL || 0 : p.reachR || 0;
    if (reach > 0) {
      // Raise arm forward toward target elevation (reachPitch: 0 = forward, + up)
      const pitch = -Math.PI / 2 - (p.reachPitch || 0);
      rx = rx + (pitch - rx) * reach;
      rz = rz + (s * (p.reachSpread || 0.15) - rz) * reach;
      ex = ex + (-0.15 - ex) * reach;
    }
    const swipe = side === 'L' ? p.swipeL || 0 : p.swipeR || 0;
    if (swipe !== 0) {
      // swipe: -1..1 sweep across the body at shoulder height
      rx = rx + (-1.45 - rx) * Math.min(1, Math.abs(swipe) * 3);
      ry = -s * swipe * 1.3;
      rz = s * 0.4;
      ex = -0.2;
    }
    if (p.crawl) {
      rx = -1.2 + sw * 0.6;
      ex = -0.3;
    }
    arm.shoulder.rotation.set(rx, ry, rz);
    arm.elbow.rotation.x = ex;
    const grip = side === 'L' ? p.gripL || 0 : p.gripR || 0;
    arm.hand.rotation.x = -grip * 0.8;
  }

  // Stagger at the hips; death fall pivots the whole body at the feet.
  bones.hips.rotation.x = (p.stagger || 0) * 0.3;
  bones.hips.rotation.z = (p.stagger || 0) * 0.15 * (p.staggerSide || 1);
  bones.tilt.rotation.x = (p.fall || 0) * 1.5;
  bones.tilt.rotation.z = (p.fall || 0) * 0.15 * (p.staggerSide || 1);
}

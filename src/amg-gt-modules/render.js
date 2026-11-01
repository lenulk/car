/* ---------- photographic realism: surface detail ---------- */
const RT = makeRealismTextures(THREE, renderer);
paint.normalMap = RT.flakeNormal; paint.normalScale.set(.16, .16);
const tyreMat = rubber.clone(); tyreMat.normalMap = RT.treadNormal; tyreMat.normalScale.set(1.1, 1.1); tyreMat.roughness = .9;
RT.leatherNormal.repeat.set(6, 6);
for (const m of [leatherDark, leatherSeat]) { m.normalMap = RT.leatherNormal; m.normalScale.set(.35, .35); }
carbon.normalMap = RT.carbonNormal; RT.carbonNormal.repeat.set(10, 10); carbon.normalScale.set(.6, .6);

// clear outer glass that only adds reflections (fresnel), over whatever sits behind it
const reflectOnly = (k = 1.6) => new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0, metalness: 0, envMapIntensity: k, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const glassRefl = reflectOnly(1.9);
glass.envMapIntensity = .5;

/* ---------- lamps: real depth under a clear lens ---------- */
const lensClear = reflectOnly(1.7);
const lampBowl = new THREE.MeshStandardMaterial({ color: 0xa3a9b1, metalness: 1, roughness: .16, side: THREE.DoubleSide });
const lampHousing = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: .45, metalness: .25, side: THREE.DoubleSide });
const projGlass = new THREE.MeshPhysicalMaterial({ color: 0x0d1015, roughness: 0, metalness: .2, clearcoat: 1, side: THREE.DoubleSide });
const tailHousing = new THREE.MeshPhysicalMaterial({ color: 0x1c0204, roughness: .3, metalness: .4, clearcoat: .6, side: THREE.DoubleSide });
const tailLensTint = new THREE.MeshPhysicalMaterial({ color: 0x8a0814, roughness: .04, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide });
const tailLed2 = tailLed.clone(); tailLed2.emissiveIntensity = .6;
drl.emissiveIntensity = 3.2; tailLed.emissiveIntensity = 2.6;
const HEAD = { fn: (u, v) => [lerp(1.94, 2.258, u), lerp(lerp(30, 5, u), lerp(41, 33, u), v) * D], depth: .010, front: true, nu: 40, nv: 10 };
const TAIL = { fn: (u, v) => [lerp(-2.272, -2.06, u), lerp(lerp(16, 26, u), lerp(34, 32, u), v) * D], depth: .009, front: false, nu: 34, nv: 8 };
const subUV = (fn, u0, u1, v0, v1) => (u, v) => fn(lerp(u0, u1, u), lerp(v0, v1, v));
function surfAt(x, phi, side, off = 0) {
  const e = 1e-3, P = bodyPoint(x, phi, side, new THREE.Vector3());
  bodyPoint(x + e, phi, side, _a); bodyPoint(x - e, phi, side, _b); _a.sub(_b);
  bodyPoint(x, phi + e, side, _c); bodyPoint(x, phi - e, side, _d); _c.sub(_d);
  const n = new THREE.Vector3().crossVectors(_a, _c).normalize();
  if (n.dot(new THREE.Vector3(P.x * .3, P.y - .5, P.z)) < 0) n.negate();
  return { p: P.addScaledVector(n, off), n };
}
function projector(L, u, v, s, r) {
  const [x, phi] = L.fn(u, v), { p, n } = surfAt(x, phi, s, .0012);
  const g = new THREE.Group(); g.position.copy(p); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); car.add(g);
  const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r * .8, .006, 28, 1, true), lampBowl), g, false); cup.position.y = .003;
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(r, .0012, 8, 32), lampHousing), g, false); ring.rotation.x = Math.PI / 2; ring.position.y = .006;
  const dome = add(new THREE.Mesh(new THREE.SphereGeometry(r * .78, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), projGlass), g, false); dome.scale.y = .32; dome.position.y = .0045;
  const core = add(new THREE.Mesh(new THREE.CircleGeometry(r * .42, 24), beam), g, false); core.rotation.x = -Math.PI / 2; core.position.y = .0042;
}
function buildLamp(L, s) {
  if (L.front) {
    patch(L.fn, s, .0012, L.nu, L.nv, lampBowl);
    patch(subUV(L.fn, 0, 1, 0, .22), s, .0018, L.nu, 3, lampHousing);
    patch(subUV(L.fn, .03, .97, .74, .84), s, .0042, 50, 2, drl);
    patch(subUV(L.fn, .18, .44, .34, .56), s, .0026, 14, 4, beam);
    for (const u of [.53, .69, .85]) projector(L, u, .46, s, .0155);
  } else {
    patch(L.fn, s, .0012, L.nu, L.nv, tailHousing);
    patch(subUV(L.fn, .02, .98, .50, .62), s, .0042, 40, 2, tailLed);
    patch(subUV(L.fn, .06, .94, .18, .25), s, .0034, 40, 1, tailLed2);
    patch(L.fn, s, L.depth, L.nu, L.nv, tailLensTint);
  }
  patch(L.fn, s, L.depth + .0003, L.nu, L.nv, lensClear);
  const edges = [t => [t, 0], t => [t, 1], t => [0, t], t => [1, t]];
  for (const ed of edges) {
    const A = samples(0, 1, 30, t => surfAt(...L.fn(...ed(t)), s, 0).p);
    const B = samples(0, 1, 30, t => surfAt(...L.fn(...ed(t)), s, L.depth).p);
    ribbon(A, B, lampHousing, car);
  }
}

/* ---------- photographic pipeline ---------- */
const coarse = window.matchMedia('(pointer: coarse)').matches;
const quality = { high: !coarse && Math.min(window.innerWidth, window.innerHeight) > 520 };
let mirror = null;
try {
  mirror = new Reflector(new THREE.CircleGeometry(13, 72), { textureWidth: 1024, textureHeight: 1024, color: 0x90959c, clipBias: .003, multisample: 4 });
  mirror.rotation.x = -Math.PI / 2; mirror.position.y = -.002; scene.add(mirror);
} catch (e) { mirror = null; }
function applyFloorMode() {
  const refl = quality.high && mirror;
  if (mirror) mirror.visible = !!refl;
  floor.material.transparent = !!refl; floor.material.opacity = refl ? .8 : 1; floor.material.needsUpdate = true;
}
const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.blendIntensity = .85;
gtao.updateGtaoMaterial({ radius: .3, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
// keep glass, lenses, decals and the mirror floor out of the AO G-buffer
const baseOverride = gtao.overrideVisibility.bind(gtao);
gtao.overrideVisibility = function () {
  baseOverride();
  scene.traverse(o => { if (o === mirror || (o.isMesh && [].concat(o.material).every(m => m.transparent))) o.visible = false; });
};
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .42, .55, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function applyQuality() {
  gtao.enabled = quality.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.high ? 2 : 1.25));
  composer.setPixelRatio(renderer.getPixelRatio());
  renderer.shadowMap.needsUpdate = true;
  applyFloorMode();
  resize();
}

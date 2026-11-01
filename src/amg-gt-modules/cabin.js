/* ---------- cabin (right-hand drive, Thai-market layout) ---------- */
const TX = makeCarTextures(THREE, renderer);
const INTERIORS = [
  { name: 'ดำ · ตะเข็บแดง', seat: 0x161618, insert: 0x3a3a3e, swatch: '#1b1b1e', led: 0xff2a3a },
  { name: 'แดง Classic', seat: 0x6a0c12, insert: 0x8a1219, swatch: '#7a1016', led: 0xffffff },
  { name: 'น้ำตาล Saddle', seat: 0x5e3219, insert: 0x7a4524, swatch: '#6b3a1e', led: 0xffb36b },
];
const leatherDark = new THREE.MeshPhysicalMaterial({ color: 0x111113, roughness: .66, sheen: .4, sheenRoughness: .6, sheenColor: new THREE.Color(0x2c2c2c), side: THREE.DoubleSide });
const leatherSeat = new THREE.MeshPhysicalMaterial({ color: INTERIORS[0].seat, roughness: .5, sheen: .5, sheenRoughness: .5, sheenColor: new THREE.Color(0x555555) });
const quilt = new THREE.MeshPhysicalMaterial({ map: TX.quiltTex, color: INTERIORS[0].insert, roughness: .55, sheen: .4, sheenColor: new THREE.Color(0x444444) });
const carbon = new THREE.MeshPhysicalMaterial({ map: TX.carbonTex, metalness: .3, roughness: .32, clearcoat: 1, clearcoatRoughness: .05 });
const headliner = new THREE.MeshStandardMaterial({ color: 0x19191b, roughness: .95, side: THREE.DoubleSide });
const ambientLed = new THREE.MeshBasicMaterial({ color: INTERIORS[0].led, toneMapped: false });
const clusterMat = new THREE.MeshBasicMaterial({ map: TX.clusterTex, toneMapped: false });
const navMat = new THREE.MeshBasicMaterial({ map: TX.navTex, toneMapped: false });
const rb = (w, h, d, r = .02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const DRIVER_Z = .37;

function buildTub() {
  // inner shell: follows the body inwards so the cabin reads as closed through the glass
  const NX = 220, X0 = -1.96, X1 = .47, K = 36, phis = [];
  for (let k = 0; k <= K; k++) phis.push([1, lerp(44, -90, k / K) * D]);
  for (let k = 1; k <= K; k++) phis.push([-1, lerp(-90, 44, k / K) * D]);
  const RP = phis.length, pos = [], idx = [], v = new THREE.Vector3();
  for (let i = 0; i <= NX; i++) {
    const x = lerp(X0, X1, i / NX);
    for (const [s, phi] of phis) { bodyPoint(x, phi, s, v); pos.push(v.x, Math.max(v.y, .17), v.z * .955); }
  }
  for (let i = 0; i < NX; i++) for (let r = 0; r < RP - 1; r++) {
    const a = i * RP + r, b = a + 1, c = a + RP, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  add(new THREE.Mesh(g, leatherDark), car, false);
  for (const i of [0, NX]) {
    const verts = [], fan = []; let cy = 0, cx = pos[i * RP * 3];
    for (let r = 0; r < RP; r++) { const o = (i * RP + r) * 3; verts.push(pos[o], pos[o + 1], pos[o + 2]); cy += pos[o + 1]; }
    verts.unshift(cx, cy / RP, 0);
    for (let r = 0; r < RP - 1; r++) fan.push(0, r + 1, r + 2);
    fan.push(0, RP, 1);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    cg.setIndex(fan); cg.computeVertexNormals();
    add(new THREE.Mesh(cg, leatherDark), car, false);
  }
  // carpet
  const carpet = add(new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.2), new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 1 })), car, false);
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(-.25, .175, 0);
}

function buildSeat(zc) {
  const g = new THREE.Group(); g.position.set(-.50, .17, zc); car.add(g);
  const tilt = .07;
  const cush = add(new THREE.Mesh(rb(.50, .09, .46, .035), leatherSeat), g); cush.position.set(.04, .10, 0); cush.rotation.z = tilt;
  for (const s of [1, -1]) {
    const b = add(new THREE.Mesh(rb(.46, .11, .085, .035), leatherSeat), g); b.position.set(.04, .155, s * .205); b.rotation.z = tilt;
  }
  const ci = add(new THREE.Mesh(rb(.42, .02, .27, .008), quilt), g); ci.position.set(.05, .152, 0); ci.rotation.z = tilt;
  const back = new THREE.Group(); back.position.set(-.19, .12, 0); back.rotation.z = .32; g.add(back);
  add(new THREE.Mesh(rb(.10, .66, .46, .04), leatherSeat), back).position.set(0, .36, 0);
  for (const s of [1, -1]) add(new THREE.Mesh(rb(.16, .52, .085, .035), leatherSeat), back).position.set(.045, .32, s * .212);
  add(new THREE.Mesh(rb(.02, .40, .26, .008), quilt), back).position.set(.056, .32, 0);
  add(new THREE.Mesh(rb(.10, .17, .30, .045), leatherSeat), back).position.set(0, .76, 0);
  for (const s of [1, -1]) add(new THREE.Mesh(rb(.11, .05, .035, .012), glossBlack), back, false).position.set(0, .655, s * .09);
  const stitch = add(new THREE.Mesh(rb(.004, .50, .006, .002), ambientLed), back, false);
  stitch.position.set(.06, .32, -.135); stitch.material = new THREE.MeshBasicMaterial({ color: 0x9b1d24 });
  const stitch2 = stitch.clone(); stitch2.position.z = .135; back.add(stitch2);
  add(new THREE.Mesh(new THREE.BoxGeometry(.40, .06, .36), blackTrim), g, false).position.set(0, .03, 0);
}

function buildDash() {
  const prof = new THREE.Shape();
  prof.moveTo(.47, .84); prof.lineTo(.47, .45); prof.lineTo(.28, .45);
  prof.quadraticCurveTo(.10, .52, .04, .66); prof.quadraticCurveTo(.01, .76, .06, .84);
  prof.quadraticCurveTo(.25, .89, .47, .84);
  const dg = new THREE.ExtrudeGeometry(prof, { depth: 1.38, bevelEnabled: true, bevelThickness: .02, bevelSize: .015, bevelSegments: 3, curveSegments: 18 });
  dg.translate(0, 0, -.69);
  add(new THREE.Mesh(dg, leatherDark), car, false);
  // carbon fascia band + ambient light strip
  add(new THREE.Mesh(rb(.03, .05, 1.34, .01), carbon), car, false).position.set(.065, .615, 0);
  add(new THREE.Mesh(rb(.006, .006, 1.30, .002), ambientLed), car, false).position.set(.05, .585, 0);
  // driver binnacle + digital cluster (right side)
  add(new THREE.Mesh(rb(.18, .07, .42, .03), leatherDark), car, false).position.set(.12, .905, DRIVER_Z);
  const cl = add(new THREE.Mesh(new THREE.PlaneGeometry(.36, .1275), clusterMat), car, false);
  cl.rotation.set(0, -Math.PI / 2, 0); cl.position.set(.068, .835, DRIVER_Z);
  // floating centre screen
  add(new THREE.Mesh(rb(.03, .15, .27, .012), glossBlack), car, false).position.set(.15, .94, 0);
  const nav = add(new THREE.Mesh(new THREE.PlaneGeometry(.25, .14), navMat), car, false);
  nav.rotation.set(0, -Math.PI / 2, 0); nav.position.set(.134, .94, 0);
  // turbine vents
  for (const z of [-.58, -.13, .13, .58]) {
    const g = new THREE.Group(); g.position.set(.012, .735, z); g.rotation.y = -Math.PI / 2; car.add(g);
    add(new THREE.Mesh(new THREE.TorusGeometry(.043, .008, 12, 40), chrome), g, false);
    add(new THREE.Mesh(new THREE.CircleGeometry(.043, 32), new THREE.MeshBasicMaterial({ color: 0x050505 })), g, false).position.z = -.012;
    for (let k = 0; k < 6; k++) {
      const f = add(new THREE.Mesh(new THREE.BoxGeometry(.074, .006, .004), satin), g, false);
      f.rotation.z = k * Math.PI / 6; f.position.z = -.004;
    }
    add(new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .02, 16).rotateX(Math.PI / 2), chrome), g, false);
  }
}

function buildSteering() {
  const sw = new THREE.Group(); sw.position.set(-.07, .80, DRIVER_Z); sw.rotation.z = -.38; car.add(sw);
  const rimG = new THREE.TorusGeometry(.175, .019, 16, 72); rimG.rotateY(Math.PI / 2);
  add(new THREE.Mesh(rimG, leatherDark), sw, false);
  const mark = new THREE.TorusGeometry(.175, .0196, 12, 10, .16); mark.rotateZ(Math.PI / 2 - .08); mark.rotateY(Math.PI / 2);
  add(new THREE.Mesh(mark, new THREE.MeshPhysicalMaterial({ color: 0xa50f19, roughness: .5 })), sw, false);
  for (const s of [1, -1]) add(new THREE.Mesh(rb(.02, .035, .13, .01), satin), sw, false).position.set(0, -.01, s * .10);
  add(new THREE.Mesh(rb(.02, .12, .035, .01), leatherDark), sw, false).position.set(0, -.11, 0);
  add(new THREE.Mesh(rb(.05, .10, .12, .025), leatherDark), sw, false).position.set(.01, -.01, 0);
  for (const s of [1, -1]) add(new THREE.Mesh(rb(.006, .07, .05, .003), satin), sw, false).position.set(.04, .02, s * .14);
  add(new THREE.Mesh(new THREE.CylinderGeometry(.032, .04, .30, 20).rotateZ(Math.PI / 2), leatherDark), sw, false).position.set(.17, 0, 0);
}

function buildConsole() {
  add(new THREE.Mesh(rb(.95, .30, .24, .03), leatherDark), car, false).position.set(-.30, .32, 0);
  const ramp = add(new THREE.Mesh(rb(.34, .26, .22, .03), leatherDark), car, false); ramp.position.set(.12, .52, 0); ramp.rotation.z = .55;
  add(new THREE.Mesh(rb(.56, .016, .19, .006), carbon), car, false).position.set(-.15, .474, 0);
  for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++)
    add(new THREE.Mesh(rb(.034, .014, .034, .006), satin), car, false).position.set(-.02 - row * .05, .488, -.075 + k * .05);
  add(new THREE.Mesh(rb(.07, .06, .05, .02), glossBlack), car, false).position.set(-.30, .51, 0);
  add(new THREE.Mesh(rb(.30, .06, .18, .025), leatherSeat), car, false).position.set(-.74, .50, 0);
  for (const s of [1, -1]) {
    add(new THREE.Mesh(rb(.60, .05, .07, .02), leatherSeat), car, false).position.set(-.15, .62, s * .83);
    add(new THREE.Mesh(rb(.60, .005, .005, .002), ambientLed), car, false).position.set(-.15, .655, s * .80);
    const spk = add(new THREE.Mesh(new THREE.CircleGeometry(.06, 32), mesh), car, false);
    spk.position.set(.20, .40, s * .855); spk.rotation.y = s > 0 ? Math.PI : 0;
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(.06, .004, 8, 40), chrome), car, false);
    ring.position.copy(spk.position); ring.rotation.y = spk.rotation.y;
    add(new THREE.Mesh(rb(.08, .016, .016, .006), chrome), car, false).position.set(.05, .71, s * .835);
  }
}

function buildCabinDetails() {
  const roofY = x => ghPoint(x, Math.PI / 2).y;
  // rear-view mirror
  const ry = roofY(-.12) - .075;
  add(new THREE.Mesh(rb(.035, .065, .24, .02), glossBlack), car, false).position.set(-.10, ry, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(.015, .07, .015), glossBlack), car, false).position.set(-.10, ry + .055, 0);
  // wipers parked at the cowl
  for (const [z, len] of [[.20, .56], [-.36, .50]]) {
    const w = add(new THREE.Mesh(new THREE.BoxGeometry(.014, .012, len), glossBlack));
    w.position.set(.41, topF(.41) + .006, z); w.rotation.y = .06;
  }
  // shark-fin antenna
  const fs = new THREE.Shape();
  fs.moveTo(0, 0); fs.lineTo(.16, 0); fs.quadraticCurveTo(.04, .025, 0, .058); fs.closePath();
  const fg = new THREE.ExtrudeGeometry(fs, { depth: .036, bevelEnabled: true, bevelThickness: .006, bevelSize: .006, bevelSegments: 3 });
  fg.translate(0, 0, -.018);
  add(new THREE.Mesh(fg, paint)).position.set(-1.16, roofY(-1.08) - .006, 0);
  // interior fill light so the cabin is legible through tinted glass
  const fill = new THREE.PointLight(0xfff1e0, .9, 2.4, 2); fill.position.set(-.25, 1.08, 0); car.add(fill);
}

function buildCabin() {
  buildTub();
  buildSeat(DRIVER_Z);
  buildSeat(-DRIVER_Z);
  buildDash();
  buildSteering();
  buildConsole();
  buildCabinDetails();
}

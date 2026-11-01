/* ---------- opening panels: doors, bonnet, tailgate ---------- */
const PANELS = {};
const bayMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: .55, metalness: .35, side: THREE.DoubleSide });
const bayLiner = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: .95, side: THREE.DoubleSide });
function makePanel(name, px, py, pz, axis, sign, open) {
  const pivot = new THREE.Group(); pivot.position.set(px, py, pz); pivot.userData.panel = name; car.add(pivot);
  const inner = new THREE.Group(); inner.position.set(-px, -py, -pz); pivot.add(inner);
  PANELS[name] = { pivot, inner, axis, sign, open, t: 0, target: 0 };
  return PANELS[name];
}
function phiTopDeg(x) { return Math.acos(Math.pow(Math.min(ghW(x) / widthF(x), 1), N_UP / 2)) / D; }
const DOOR_X0 = -.88, DOOR_X1 = .47, DOOR_PHI0 = -56;
const HOOD_X0 = .50, HOOD_X1 = 2.02, HOOD_PHI = 58;
const HATCH_X0 = -2.16, HATCH_X1 = -1.12;
// which opening panel a body-surface face belongs to ('cut' = removed: open cabin top under the glasshouse)
function bodyPanelAt(x, phiDeg, side) {
  if (x > DOOR_X0 && x < DOOR_X1 && phiDeg > DOOR_PHI0 && phiDeg < phiTopDeg(x) + .5) return side > 0 ? 'doorR' : 'doorL';
  if (x > HOOD_X0 && x < HOOD_X1 && phiDeg > HOOD_PHI) return 'hood';
  if (x > HATCH_X1 && x < .44 && phiDeg >= phiTopDeg(x) + .5) return 'cut';
  if (x > HATCH_X0 && x <= HATCH_X1 && phiDeg > 62) return 'hatch';
  return null;
}
function initPanels() {
  for (const s of [1, -1]) makePanel(s > 0 ? 'doorR' : 'doorL', DOOR_X1, .5, s * bodyPoint(DOOR_X1, 0, 1).z, 'y', s, 1.12);
  makePanel('hood', HOOD_X0, topF(HOOD_X0), 0, 'z', 1, .92);
  makePanel('hatch', HATCH_X1, ghPoint(HATCH_X1, Math.PI / 2).y, 0, 'z', -1, 1.05);
}
const panelOf = name => (name && name !== 'cut' ? PANELS[name].inner : car);

// split one indexed geometry into meshes per panel, keeping shared (smooth) normals
function splitMesh(attrs, buckets, mats, castMain = true) {
  // buckets: { key: [list per material] }
  const out = {};
  for (const key in buckets) {
    if (key === 'cut') continue;
    const lists = buckets[key]; let idx = [];
    const g = new THREE.BufferGeometry();
    for (const k in attrs) g.setAttribute(k, attrs[k]);
    lists.forEach((l, m) => { if (l.length) { g.addGroup(idx.length, l.length, m); idx = idx.concat(l); } });
    if (!idx.length) continue;
    g.setIndex(idx);
    out[key] = add(new THREE.Mesh(g, mats), panelOf(key === 'main' ? null : key), castMain);
  }
  return out;
}
const bucket = (b, key, n) => (b[key] ||= Array.from({ length: n }, () => []));

// ribbon between two point lists (panel edges / jambs)
function ribbon(A, B, mat, parent) {
  const pos = [], idx = [];
  for (let i = 0; i < A.length; i++) pos.push(A[i].x, A[i].y, A[i].z, B[i].x, B[i].y, B[i].z);
  for (let i = 0; i < A.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return add(new THREE.Mesh(g, mat), parent, false);
}
const floorAt = x => (x < -1.72 ? .40 : .17);
function tubPt(x, phi, s) { const v = bodyPoint(x, phi, s, new THREE.Vector3()); v.z *= .955; v.y = Math.max(v.y, floorAt(x)); return v; }
function bayPt(x, phi, s) {
  const v = bodyPoint(x, phi, s, new THREE.Vector3(), false); v.z *= .955;
  if (Math.abs(v.z) > .60) v.y = Math.max(v.y, archY(x));
  v.y = Math.max(v.y, .20); return v;
}
const jambMats = [];
function jambMat() { const m = Object.assign(new THREE.MeshPhysicalMaterial().copy(paint), { side: THREE.DoubleSide }); jambMats.push(m); return m; }
const samples = (a, b, n, f) => Array.from({ length: n + 1 }, (_, i) => f(lerp(a, b, i / n)));

function buildPanelEdges() {
  const insul = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: .95, side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const door = PANELS[s > 0 ? 'doorR' : 'doorL'].inner, dm = jambMat(), bm = jambMat();
    // door shell edges (move with the door)
    for (const xe of [DOOR_X0, DOOR_X1]) {
      const top = phiTopDeg(xe);
      ribbon(samples(DOOR_PHI0, top, 30, p => bodyPoint(xe, p * D, s)), samples(DOOR_PHI0, top, 30, p => tubPt(xe, Math.min(p, 44) * D, s)), dm, door);
    }
    ribbon(samples(DOOR_X0, DOOR_X1, 40, x => bodyPoint(x, DOOR_PHI0 * D, s)), samples(DOOR_X0, DOOR_X1, 40, x => tubPt(x, DOOR_PHI0 * D, s)), dm, door);
    ribbon(samples(DOOR_X0, DOOR_X1, 60, x => bodyPoint(x, phiTopDeg(x) * D, s)), samples(DOOR_X0, DOOR_X1, 60, x => tubPt(x, 44 * D, s)), glossBlack, door);
    // body-side jambs, 6 mm proud of the door edges
    for (const [xe, dx] of [[DOOR_X0, -.006], [DOOR_X1, .006]]) {
      const top = phiTopDeg(xe);
      ribbon(samples(DOOR_PHI0, top, 30, p => bodyPoint(xe + dx, p * D, s)), samples(DOOR_PHI0, top, 30, p => tubPt(xe + dx, Math.min(p, 44) * D, s)), bm, car);
    }
    ribbon(samples(DOOR_X0, DOOR_X1, 40, x => bodyPoint(x, (DOOR_PHI0 - .8) * D, s)), samples(DOOR_X0, DOOR_X1, 40, x => tubPt(x, (DOOR_PHI0 - .8) * D, s)), bm, car);
    // bonnet: edge on the panel + jamb on the body + gutter to the bay
    const hood = PANELS.hood.inner, hm = jambMat();
    ribbon(samples(HOOD_X0, HOOD_X1, 60, x => bodyPoint(x, HOOD_PHI * D, s)), samples(HOOD_X0, HOOD_X1, 60, x => bodyPoint(x, HOOD_PHI * D, s).add(new THREE.Vector3(0, -.025, -s * .01))), hm, hood);
    ribbon(samples(HOOD_X0, HOOD_X1, 60, x => bodyPoint(x, (HOOD_PHI - .6) * D, s)), samples(HOOD_X0, HOOD_X1, 60, x => bayPt(x, HOOD_PHI * D, s)), jambMat(), car);
    for (const xe of [HOOD_X0, HOOD_X1]) ribbon(samples(HOOD_PHI, 90, 20, p => bodyPoint(xe, p * D, s)), samples(HOOD_PHI, 90, 20, p => bodyPoint(xe, p * D, s).add(new THREE.Vector3(0, -.025, 0))), hm, hood);
  }
  return insul;
}

function buildBay() {
  // engine bay shell with wheel towers; front-mid engine sits inside
  const NX = 140, X0 = .47, X1 = 2.04, K = 40, phis = [];
  for (let k = 0; k <= K; k++) phis.push([1, lerp(HOOD_PHI, -90, k / K) * D]);
  for (let k = 1; k <= K; k++) phis.push([-1, lerp(-90, HOOD_PHI, k / K) * D]);
  const RP = phis.length, pos = [], idx = [];
  for (let i = 0; i <= NX; i++) { const x = lerp(X0, X1, i / NX); for (const [s, p] of phis) { const v = bayPt(x, p, s); pos.push(v.x, v.y, v.z); } }
  for (let i = 0; i < NX; i++) for (let r = 0; r < RP - 1; r++) { const a = i * RP + r, b = a + 1, c = a + RP, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  add(new THREE.Mesh(g, bayMat), car, false);
  for (const i of [0, NX]) {
    const verts = [pos[i * RP * 3], .5, 0], fan = [];
    for (let r = 0; r < RP; r++) { const o = (i * RP + r) * 3; verts.push(pos[o], pos[o + 1], pos[o + 2]); }
    for (let r = 0; r < RP - 1; r++) fan.push(0, r + 1, r + 2);
    fan.push(0, RP, 1);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); cg.setIndex(fan); cg.computeVertexNormals();
    add(new THREE.Mesh(cg, bayMat), car, false);
  }
}

// panel animation + interaction
function setPanel(name, open) { PANELS[name].target = open ? 1 : 0; syncPanelButtons(); }
function togglePanel(name) { setPanel(name, PANELS[name].target < .5); }
function animatePanels(dt) {
  for (const k in PANELS) {
    const p = PANELS[k];
    p.t += (p.target - p.t) * Math.min(1, dt * 3.2);
    const e = p.t * p.t * (3 - 2 * p.t), a = p.sign * p.open * e;
    if (p.axis === 'y') p.pivot.rotation.y = a; else p.pivot.rotation.z = a;
  }
}
let syncPanelButtons = () => {};

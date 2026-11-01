function buildChassis(THREE, RoundedBoxGeometry, M) {
  const g = new THREE.Group();
  g.name = 'chassis';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const UPV = V(0, 1, 0);

  // ---------- materials ----------
  const std = (color, metalness, roughness) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const forged = std(0x30343a, 0.75, 0.48);
  const castAlu = std(0x9ea3a8, 0.85, 0.55);
  const rawAlu = std(0xb9bec3, 0.9, 0.38);
  const zinc = std(0xc7b86a, 0.8, 0.4);
  const steel = std(0x6d7176, 0.9, 0.4);
  const sprF = std(0xf0be10, 0.2, 0.45);
  const sprR = std(0xcf2118, 0.2, 0.45);
  const damperMat = std(0xc99a1e, 0.8, 0.35);
  const exhMat = std(0xa98a68, 1.0, 0.3);
  const exhBlue = std(0x7d8aa6, 1.0, 0.3);
  const trayMat = std(0x141516, 0.1, 0.9);
  const tankMat = std(0x232527, 0.3, 0.7);
  const rubber = M.rubber || std(0x111111, 0, 0.9);
  const black = M.blackTrim || trayMat;

  // ---------- helpers ----------
  const buckets = new Map();
  function add(geo, mat, p, q) {
    let b = buckets.get(mat);
    if (!b) { b = []; buckets.set(mat, b); }
    const mtx = new THREE.Matrix4().compose(p || V(0, 0, 0), q || new THREE.Quaternion(), V(1, 1, 1));
    b.push({ geo, mtx });
  }
  function mergeBucket(list) {
    let total = 0;
    const parts = list.map(({ geo, mtx }) => {
      const ng = geo.index ? geo.toNonIndexed() : geo.clone();
      ng.applyMatrix4(mtx);
      total += ng.attributes.position.count;
      return ng;
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    let o = 0;
    parts.forEach(pg => {
      const n = pg.attributes.position.count;
      pos.set(pg.attributes.position.array, o * 3);
      nor.set(pg.attributes.normal.array, o * 3);
      if (pg.attributes.uv) uv.set(pg.attributes.uv.array, o * 2);
      o += n;
    });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    mg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    list.forEach(({ geo }) => geo.dispose());
    return mg;
  }
  function rbox(w, h, d, r, mat, x, y, z) {
    r = Math.min(r, Math.min(w, h, d) * 0.45);
    return add(new RoundedBoxGeometry(w, h, d, 2, r), mat, V(x, y, z));
  }
  function qDir(a, b) {
    return new THREE.Quaternion().setFromUnitVectors(UPV, b.clone().sub(a).normalize());
  }
  // cylinder/cone from a (radius ra) to b (radius rb)
  function cyl(a, b, ra, rb, mat, seg) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(rb, ra, len, seg || 12, 1);
    return add(geo, mat, a.clone().add(b).multiplyScalar(0.5), qDir(a, b));
  }
  // flat forged arm (rounded box) between two points, width horizontal-ish
  function arm(a, b, w, t, mat) {
    const d = b.clone().sub(a);
    const len = d.length();
    d.normalize();
    const up = Math.abs(d.y) > 0.95 ? V(1, 0, 0) : V(0, 1, 0);
    const xa = up.clone().cross(d).normalize();
    const za = xa.clone().cross(d).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa, d, za));
    const r = Math.min(w, t) * 0.4;
    return add(new RoundedBoxGeometry(w, len, t, 2, r), mat, a.clone().add(b).multiplyScalar(0.5), q);
  }
  function tube(pts, r, mat, segs, radial) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    return add(new THREE.TubeGeometry(curve, segs || pts.length * 8, r, radial || 8, false), mat);
  }
  function ball(p, r, mat) {
    return add(new THREE.SphereGeometry(r, 10, 8), mat || rubber, p);
  }
  function spring(p0, p1, R, wire, turns, mat) {
    const len = p0.distanceTo(p1);
    const n = turns * 12;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * Math.PI * 2;
      pts.push(V(R * Math.cos(a), t * len, R * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return add(new THREE.TubeGeometry(curve, n * 2, wire, 5, false), mat, p0.clone(), qDir(p0, p1));
  }
  // ribbed CV boot from a to b, radius small at a, big at b
  function boot(a, b, rs, rb, ribs, mat) {
    const len = a.distanceTo(b);
    const prof = [];
    prof.push(new THREE.Vector2(rs * 0.6, 0));
    for (let i = 0; i <= ribs * 2; i++) {
      const t = i / (ribs * 2);
      const r = rs + (rb - rs) * t + (i % 2 ? -0.004 : 0.003);
      prof.push(new THREE.Vector2(r, t * len));
    }
    prof.push(new THREE.Vector2(rb * 0.6, len));
    return add(new THREE.LatheGeometry(prof, 14), mat, a.clone(), qDir(a, b));
  }
  const lerp = (a, b, t) => a.clone().lerp(b, t);

  // ---------- corners ----------
  function corner(xa, yh, s, front) {
    const hubZ = s * 0.615;
    // upright / hub carrier
    rbox(0.10, 0.25, 0.04, 0.012, forged, xa, yh, hubZ);
    add(new THREE.CylinderGeometry(0.046, 0.046, 0.05, 20), castAlu, V(xa, yh, s * 0.605), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 12), steel, V(xa, yh, s * 0.62), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));

    const lj = V(xa, 0.18, s * 0.595);          // lower ball joint
    const uj = V(xa, 0.49, s * 0.575);          // upper ball joint
    const lf = V(xa + 0.25, 0.20, s * 0.35);    // lower front pickup
    const lr = V(xa - (front ? 0.25 : 0.20), 0.20, s * 0.35);
    const uf = V(xa + 0.14, 0.46, s * 0.36);
    const ur = V(xa - 0.14, 0.46, s * 0.36);
    // brackets joining joints to upright
    rbox(0.04, 0.05, 0.035, 0.01, forged, xa, 0.18, s * 0.6);
    rbox(0.04, 0.05, 0.035, 0.01, forged, xa, 0.49, s * 0.595);
    // lower and upper wishbones
    arm(lf, lj, 0.034, 0.018, forged);
    arm(lr, lj, 0.034, 0.018, forged);
    arm(uf, uj, 0.028, 0.016, forged);
    arm(ur, uj, 0.028, 0.016, forged);
    [lf, lr, uf, ur].forEach(p => { add(new THREE.CylinderGeometry(0.019, 0.019, 0.04, 10), rubber, p, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2)); });
    ball(lj, 0.017, steel); ball(uj, 0.015, steel);
    // coil-over damper
    const low = lerp(lf, lj, 0.55); low.y += 0.03;
    const top = V(xa + 0.10, 0.68, s * 0.52);
    rbox(0.035, 0.04, 0.03, 0.008, forged, low.x, low.y - 0.015, low.z);
    ball(low, 0.016, steel);
    const dir = top.clone().sub(low);
    const dl = dir.length();
    const at = t => low.clone().addScaledVector(dir, t / dl);
    cyl(at(0.03), at(0.26), 0.022, 0.022, damperMat, 14);
    cyl(at(0.26), at(0.40), 0.014, 0.014, rawAlu, 10);
    cyl(at(0.40), at(dl - 0.03), 0.009, 0.009, M.chrome, 8);
    cyl(at(dl - 0.06), at(dl - 0.02), 0.026, 0.02, black, 12); // bump stop / dust cap
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 14), forged, top.clone().add(V(0, 0.005, 0)).add(dir.clone().normalize().multiplyScalar(0.0)));
    cyl(at(0.09), at(0.095), 0.045, 0.045, zinc, 14);          // lower spring perch
    spring(at(0.095), at(dl - 0.065), 0.038, 0.0055, 7, front ? sprF : sprR);

    // upper link to bracket brace
    cyl(V(xa, 0.205, s * 0.6), V(xa, 0.465, s * 0.6), 0.008, 0.008, forged, 6);
  }

  const fx = 1.31, fy = 0.345, rx = -1.32, ry = 0.35;
  [-1, 1].forEach(s => { corner(fx, fy, s, true); corner(rx, ry, s, false); });

  // ---------- anti-roll bars ----------
  function arb(xb, xLeg, zOffLeg, y, front) {
    // end link points on lower arm rear leg
    const pts = [];
    [-1, 1].forEach(s => {
      const xa = front ? fx : rx;
      const lrp = V(xa - (front ? 0.25 : 0.20), 0.20, s * 0.35);
      const ljp = V(xa, 0.18, s * 0.595);
      const e = lerp(lrp, ljp, 0.45);
      s < 0 ? pts.unshift(e) : pts.push(e);
      cyl(e, V(e.x, y, e.z), 0.005, 0.005, zinc, 6);
      ball(e, 0.009, steel);
    });
    const [eL, eR] = [pts[0], pts[1]];
    const bp = [
      V(eL.x, y, eL.z), V(xb, y + 0.005, eL.z * 0.82), V(xb, y + 0.01, -0.25),
      V(xb, y + 0.01, 0.25), V(xb, y + 0.005, eR.z * 0.82), V(eR.x, y, eR.z)
    ];
    tube(bp, 0.0105, forged, 60, 8);
    [-0.25, 0.25].forEach(z => rbox(0.03, 0.025, 0.045, 0.006, rubber, xb, y + 0.01, z));
  }
  arb(0.97, 0, 0, 0.25, true);
  arb(-1.67, 0, 0, 0.26, false);

  // ---------- front steering rack ----------
  {
    const rz = (z0, z1, r, mat) => cyl(V(1.18, 0.30, z0), V(1.18, 0.30, z1), r, r, mat, 16);
    rz(-0.28, 0.28, 0.031, castAlu);
    rz(-0.50, 0.50, 0.012, M.chrome);
    [-1, 1].forEach(s => {
      boot(V(1.18, 0.30, s * 0.28), V(1.18, 0.30, s * 0.40), 0.026, 0.020, 4, rubber);
      cyl(V(1.18, 0.30, s * 0.40), V(1.18, 0.30, s * 0.46), 0.022, 0.022, rubber, 10);
    });
    // pinion housing + column stub
    cyl(V(1.18, 0.30, 0.14), V(1.14, 0.37, 0.14), 0.026, 0.02, castAlu, 12);
    cyl(V(1.14, 0.37, 0.14), V(1.06, 0.50, 0.14), 0.01, 0.01, steel, 8);
    [-1, 1].forEach(s => {
      const inner = V(1.18, 0.30, s * 0.46), outer = V(1.22, 0.30, s * 0.615);
      cyl(inner, outer, 0.008, 0.008, zinc, 8);
      ball(inner, 0.012, steel); ball(outer, 0.012, steel);
      cyl(V(1.22, 0.30, s * 0.60), V(1.22, 0.30, s * 0.63), 0.016, 0.016, forged, 8);
    });
  }

  // ---------- rear driveshafts ----------
  [-1, 1].forEach(s => {
    const a = V(rx, 0.335, s * 0.26), b = V(rx, 0.35, s * 0.60);
    cyl(a, b, 0.0135, 0.0135, steel, 10);
    boot(V(rx, 0.336, s * 0.285), V(rx, 0.340, s * 0.37), 0.022, 0.036, 5, rubber);
    boot(V(rx, 0.348, s * 0.585), V(rx, 0.345, s * 0.50), 0.020, 0.034, 5, rubber);
    cyl(V(rx, 0.335, s * 0.25), V(rx, 0.335, s * 0.285), 0.05, 0.05, castAlu, 16);
  });

  // ---------- subframes ----------
  function subframe(x0, x1, y, front) {
    const cx = (x0 + x1) / 2, len = Math.abs(x1 - x0);
    [-1, 1].forEach(s => {
      rbox(len, 0.05, 0.04, 0.012, castAlu, cx, y, s * 0.37);
      // pickup posts to upper arms
      const xa = front ? fx : rx;
      [0.14, -0.14].forEach(dx => {
        arm(V(xa + dx, y + 0.02, s * 0.37), V(xa + dx, 0.45, s * 0.36), 0.03, 0.022, castAlu);
      });
      // engine-bay side bolts
      [x0 + 0.05, x1 - 0.05].forEach(x => cyl(V(x, y - 0.025, s * 0.37), V(x, y - 0.04, s * 0.37), 0.014, 0.014, steel, 8));
    });
  }
  subframe(0.95, 1.68, 0.22, true);
  subframe(-1.70, -0.95, 0.22, false);
  // front cross members
  rbox(0.06, 0.045, 0.78, 0.014, castAlu, 1.06, 0.22, 0);
  rbox(0.06, 0.045, 0.78, 0.014, castAlu, 1.58, 0.22, 0);
  rbox(0.10, 0.03, 0.30, 0.01, castAlu, 1.18, 0.245, 0); // rack mount plate
  rbox(0.05, 0.04, 0.24, 0.01, castAlu, 1.64, 0.245, 0);
  // rear cross member (above exhaust) and gearbox stubs
  rbox(0.06, 0.045, 0.78, 0.014, castAlu, -1.54, 0.245, 0);
  [-1, 1].forEach(s => rbox(0.05, 0.04, 0.14, 0.01, castAlu, -1.12, 0.26, s * 0.32));

  // ---------- drivetrain ----------
  // bell-housing / engine rear plate
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 28), castAlu, V(0.52, 0.27, 0), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2));
  add(new THREE.CylinderGeometry(0.11, 0.15, 0.08, 28), castAlu, V(0.46, 0.27, 0), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2));
  // torque tube
  cyl(V(0.44, 0.26, 0), V(-0.95, 0.26, 0), 0.05, 0.05, forged, 20);
  [0.10, -0.25, -0.60].forEach(x => cyl(V(x + 0.02, 0.26, 0), V(x - 0.02, 0.26, 0), 0.056, 0.056, steel, 20));
  // flanges on the tube
  cyl(V(0.40, 0.26, 0), V(0.34, 0.26, 0), 0.062, 0.062, castAlu, 20);
  cyl(V(-0.90, 0.26, 0), V(-0.95, 0.26, 0), 0.07, 0.07, castAlu, 20);
  // gearbox main case
  rbox(0.42, 0.30, 0.50, 0.06, castAlu, -1.15, 0.33, 0);
  // diff casing
  cyl(V(-1.33, 0.335, -0.25), V(-1.33, 0.335, 0.25), 0.15, 0.15, castAlu, 28);
  // tail housing
  rbox(0.30, 0.22, 0.36, 0.05, castAlu, -1.50, 0.34, 0);
  // diff cover (rear) plate and bolts
  cyl(V(-1.33, 0.335, 0.25), V(-1.33, 0.335, 0.265), 0.12, 0.12, rawAlu, 28);
  cyl(V(-1.33, 0.335, -0.25), V(-1.33, 0.335, -0.265), 0.12, 0.12, rawAlu, 28);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    [-1, 1].forEach(s => cyl(V(-1.33 + 0.1 * Math.cos(a), 0.335 + 0.1 * Math.sin(a), s * 0.265), V(-1.33 + 0.1 * Math.cos(a), 0.335 + 0.1 * Math.sin(a), s * 0.278), 0.008, 0.008, steel, 6));
  }
  // cooling ribs on gearbox and tail
  for (let i = 0; i < 5; i++) {
    const x = -1.03 - i * 0.06;
    rbox(0.02, 0.05, 0.52, 0.006, castAlu, x, 0.50, 0);
  }
  for (let i = 0; i < 4; i++) {
    rbox(0.018, 0.04, 0.38, 0.005, castAlu, -1.42 - i * 0.05, 0.465, 0);
  }
  // output flanges + oil drain plug + filler
  cyl(V(-1.15, 0.18, 0), V(-1.15, 0.165, 0), 0.016, 0.016, steel, 8);
  cyl(V(-1.50, 0.455, 0.08), V(-1.50, 0.50, 0.08), 0.014, 0.014, black, 8);
  // mounting arms to subframe
  [-1, 1].forEach(s => rbox(0.14, 0.03, 0.10, 0.008, castAlu, -1.12, 0.28, s * 0.30));

  // ---------- exhaust ----------
  const ex = (a, b, r, mat) => cyl(a, b, r, r, mat || exhMat, 16);
  [-1, 1].forEach(s => {
    const z = s * 0.30, y = 0.17;
    // manifold flange stub
    cyl(V(0.88, 0.215, z), V(0.86, 0.215, z), 0.035, 0.035, steel, 14);
    // header section to cat
    tube([V(0.87, 0.215, z), V(0.78, 0.19, z), V(0.68, y, z), V(0.42, y, z)], 0.022, exhMat, 24, 12);
    // catalytic converter
    cyl(V(0.42, y, z), V(0.37, y, z), 0.022, 0.048, exhBlue, 16);
    cyl(V(0.37, y, z), V(0.03, y, z), 0.048, 0.048, exhMat, 20);
    cyl(V(0.03, y, z), V(-0.02, y, z), 0.048, 0.022, exhBlue, 16);
    [0.34, 0.06].forEach(x => cyl(V(x + 0.01, y, z), V(x - 0.01, y, z), 0.051, 0.051, steel, 20));
    rbox(0.30, 0.008, 0.07, 0.003, steel, 0.20, 0.222, z); // heat shield
    // mid pipe to resonator
    ex(V(-0.02, y, z), V(-0.35, y, z), 0.022);
    cyl(V(-0.35, y, z), V(-0.40, y, z), 0.022, 0.05, exhBlue, 16);
    cyl(V(-0.40, y, z), V(-0.80, y, z), 0.05, 0.05, exhMat, 22);
    cyl(V(-0.80, y, z), V(-0.85, y, z), 0.05, 0.022, exhBlue, 16);
    cyl(V(-0.55, y, z), V(-0.56, y, z), 0.053, 0.053, steel, 22);
    // pipe to rear silencer
    tube([V(-0.85, y, z), V(-1.20, y, z), V(-1.55, y, z), V(-1.70, 0.18, s * 0.34), V(-1.80, 0.22, s * 0.44), V(-1.86, 0.25, s * 0.50)], 0.022, exhMat, 60, 12);
    // hangers
    [-0.30, -1.0, -1.40].forEach(x => {
      cyl(V(x, y + 0.02, z), V(x, 0.205, z * 0.9), 0.006, 0.006, steel, 6);
      rbox(0.03, 0.015, 0.02, 0.004, rubber, x, 0.205, z * 0.9);
    });
    // rear silencer
    const sz = s * 0.52;
    rbox(0.32, 0.15, 0.26, 0.055, exhMat, -2.0, 0.255, sz);
    rbox(0.325, 0.02, 0.265, 0.008, steel, -2.0, 0.255, sz);
    [-1.90, -2.10].forEach(x => rbox(0.012, 0.155, 0.268, 0.004, steel, x, 0.255, sz));
    // tail pipes to the existing chrome tips
    [s * 0.46, s * 0.58].forEach(tz => {
      cyl(V(-2.15, 0.235, tz), V(-2.23, 0.235, tz), 0.027, 0.027, exhBlue, 16);
    });
  });

  // ---------- underbody ----------
  const TY = 0.115;
  rbox(2.90, 0.012, 1.24, 0.005, trayMat, 0.45, TY, 0);
  // longitudinal ribs and cross strakes
  [-0.5, -0.2, 0.2, 0.5].forEach(z => rbox(2.7, 0.012, 0.018, 0.004, trayMat, 0.45, TY - 0.011, z));
  [-0.6, -0.1, 0.4, 0.9, 1.4].forEach(x => rbox(0.02, 0.012, 0.86, 0.004, trayMat, x, TY - 0.011, 0));
  // front lip / splitter lip
  rbox(0.06, 0.02, 1.14, 0.008, black, 1.88, TY - 0.004, 0);
  // central tunnel stiffener
  rbox(2.3, 0.02, 0.12, 0.008, black, 0.1, TY - 0.014, 0);
  // NACA-style ducts
  const nacaShape = new THREE.Shape();
  nacaShape.moveTo(0, -0.012); nacaShape.lineTo(0.17, -0.055); nacaShape.lineTo(0.17, 0.055); nacaShape.lineTo(0, 0.012); nacaShape.closePath();
  [[0.62, 0.24], [0.62, -0.24], [-0.05, 0.42], [-0.05, -0.42], [1.40, 0.18], [1.40, -0.18]].forEach(([x, z]) => {
    const geo = new THREE.ExtrudeGeometry(nacaShape, { depth: 0.006, bevelEnabled: false });
    add(geo, M.glossBlack || black, V(x - 0.085, TY - 0.006, z), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2));
    rbox(0.19, 0.008, 0.012, 0.003, black, x, TY - 0.012, z + 0.07);
    rbox(0.19, 0.008, 0.012, 0.003, black, x, TY - 0.012, z - 0.07);
  });
  // rear diffuser strakes
  [-0.4, -0.2, 0, 0.2, 0.4].forEach(z => rbox(0.35, 0.03, 0.012, 0.004, trayMat, -1.88, 0.14, z));

  // fuel tank (two saddles around transaxle plus bridging straps)
  [-1, 1].forEach(s => {
    rbox(0.27, 0.16, 0.25, 0.05, tankMat, -1.09, 0.37, s * 0.425);
    rbox(0.28, 0.035, 0.06, 0.01, tankMat, -1.09, 0.455, s * 0.42);
    [-0.99, -1.19].forEach(x => rbox(0.018, 0.03, 0.26, 0.005, steel, x, 0.37, s * 0.425));
  });
  rbox(0.18, 0.05, 0.26, 0.015, tankMat, -1.05, 0.44, 0);
  [-1, 1].forEach(s => cyl(V(-1.06, 0.45, s * 0.55), V(-1.02, 0.48, s * 0.62), 0.012, 0.012, steel, 8));

  // brake and fuel lines along the tunnel
  tube([V(1.30, 0.19, 0.10), V(0.8, 0.20, 0.10), V(-0.4, 0.20, 0.10), V(-1.0, 0.20, 0.10)], 0.0045, zinc, 80, 6);
  tube([V(1.30, 0.19, 0.12), V(0.8, 0.20, 0.12), V(-0.4, 0.20, 0.12), V(-1.0, 0.21, 0.12), V(-1.10, 0.30, 0.20)], 0.0045, zinc, 80, 6);
  tube([V(1.0, 0.19, -0.10), V(0.4, 0.20, -0.10), V(-0.4, 0.20, -0.10), V(-0.98, 0.205, -0.10), V(-1.05, 0.28, -0.20)], 0.006, black, 80, 6);
  tube([V(1.0, 0.19, -0.12), V(0.4, 0.20, -0.12), V(-0.4, 0.20, -0.12), V(-0.98, 0.205, -0.12)], 0.0045, steel, 80, 6);
  [0.9, 0.3, -0.3, -0.8].forEach(x => rbox(0.02, 0.012, 0.28, 0.003, black, x, 0.195, 0));
  // flexible hoses to corners
  [-1, 1].forEach(s => {
    tube([V(fx - 0.15, 0.20, s * 0.11), V(fx - 0.10, 0.25, s * 0.35), V(fx - 0.05, 0.32, s * 0.50), V(fx - 0.04, 0.30, s * 0.60)], 0.006, rubber, 24, 6);
    tube([V(rx + 0.15, 0.20, s * 0.11), V(rx + 0.12, 0.27, s * 0.38), V(rx + 0.09, 0.32, s * 0.52), V(rx + 0.07, 0.33, s * 0.60)], 0.006, rubber, 24, 6);
  });

  let idx = 0;
  buckets.forEach((list, mat) => {
    const m = new THREE.Mesh(mergeBucket(list), mat);
    m.name = 'chassis_part_' + (idx++);
    m.castShadow = false; m.receiveShadow = false;
    g.add(m);
  });
  return g;
}

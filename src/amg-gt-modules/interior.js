function buildInteriorExtras(THREE, RoundedBoxGeometry, M, DRIVER_Z) {
  const cabin = new THREE.Group(), doorR = new THREE.Group(), doorL = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mat = (c, r, m, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m || 0 }, o || {}));
  const webbing = mat(0x2a2c30, 0.9, 0, { side: THREE.DoubleSide });
  const redBtn = mat(0xc3141a, 0.4, 0);
  const stitch = mat(0xb81d24, 0.8, 0);
  const pedalAl = mat(0xb9bcc2, 0.35, 0.9);
  const alcantara = mat(0x1b1b1d, 1.0, 0);
  const redLed = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
  const rubber = M.rubber || mat(0x111111, 0.95, 0);

  function fin(m, g, p, r) {
    m.castShadow = false; m.receiveShadow = false;
    if (p) m.position.set(p[0], p[1], p[2]);
    if (r) m.rotation.set(r[0] || 0, r[1] || 0, r[2] || 0);
    g.add(m); return m;
  }
  const box = (g, w, h, d, m, p, r) => fin(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), g, p, r);
  const rbox = (g, w, h, d, rad, m, p, r) => {
    const rr = Math.min(rad, Math.min(w, h, d) * 0.45);
    return fin(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rr), m), g, p, r);
  };
  // cylinder with axis along 'x','y' or 'z'
  const cyl = (g, r, h, m, p, axis, seg) => {
    const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 16), m);
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : null;
    return fin(me, g, p, rot);
  };
  const cylBetween = (g, a, b, r, m) => {
    const d = b.clone().sub(a), len = d.length();
    const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
    me.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return fin(me, g, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
  };
  const torus = (g, R, t, m, p, r) => fin(new THREE.Mesh(new THREE.TorusGeometry(R, t, 8, 24), m), g, p, r);

  // flat ribbon along a curve; n = surface normal (width dir = t x n)
  function ribbon(g, pts, n, width, m, off) {
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const N = 28, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, p = c.getPoint(u), t = c.getTangent(u);
      const w = new THREE.Vector3().crossVectors(t, n).normalize().multiplyScalar(width / 2);
      p.addScaledVector(n, off);
      pos.push(p.x + w.x, p.y + w.y, p.z + w.z, p.x - w.x, p.y - w.y, p.z - w.z);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return fin(new THREE.Mesh(geo, m), g);
  }

  // ---------- 1. Pedal box ----------
  (function pedals() {
    const g = cabin, fy = 0.18;
    // accelerator (organ type)
    const az = DRIVER_Z + 0.09;
    rbox(g, 0.018, 0.23, 0.06, 0.006, M.blackTrim, [0.365, 0.30, az], [0, 0, -0.5]);
    box(g, 0.03, 0.03, 0.05, M.blackTrim, [0.335, fy + 0.012, az]);
    rbox(g, 0.006, 0.19, 0.045, 0.002, pedalAl, [0.352, 0.30, az], [0, 0, -0.5]);
    cylBetween(g, V(0.333, fy + 0.012, az), V(0.34, fy + 0.012, az), 0.012, M.satin);
    // brake pedal on arm from above
    const bz = DRIVER_Z - 0.01;
    cylBetween(g, V(0.42, 0.62, bz), V(0.335, 0.38, bz), 0.011, M.satin);
    rbox(g, 0.02, 0.09, 0.09, 0.006, M.blackTrim, [0.33, 0.35, bz], [0, 0, -0.45]);
    rbox(g, 0.006, 0.075, 0.075, 0.002, pedalAl, [0.318, 0.35, bz], [0, 0, -0.45]);
    // dead pedal
    const dz = DRIVER_Z - 0.10;
    rbox(g, 0.02, 0.15, 0.11, 0.008, M.blackTrim, [0.33, 0.26, dz], [0, 0, -0.75]);
    rbox(g, 0.006, 0.13, 0.095, 0.002, pedalAl, [0.318, 0.26, dz], [0, 0, -0.75]);
    // rubber studs on faces
    const stud = (cx, cy, cz, ang, off) => {
      const sx = cx - Math.sin(-ang) * 0 - off;
      box(g, 0.004, 0.006, 0.02, rubber, [cx - 0.006 - off, cy, cz], [0, 0, ang]);
    };
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * 0.04;
      // along tilted face: face direction (sin?, cos) for tilt -0.5
      const dx = -Math.sin(-0.5) * t * -1, dy = Math.cos(0.5) * t;
      box(g, 0.005, 0.008, 0.032, rubber, [0.347 + Math.sin(0.5) * t * -1 * -1 - 0.0, 0.30 + dy, az], [0, 0, -0.5]);
    }
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) * 0.025;
      for (let k = -1; k <= 1; k += 2) box(g, 0.005, 0.008, 0.025, rubber, [0.314 - Math.sin(0.45) * t * -1 * 0, 0.35 + t * Math.cos(0.45), bz + k * 0.02], [0, 0, -0.45]);
    }
    for (let i = 0; i < 3; i++) {
      const t = (i - 1) * 0.04;
      box(g, 0.005, 0.01, 0.07, rubber, [0.314 + (-Math.sin(0.75)) * 0, 0.26 + t * Math.cos(0.75), dz], [0, 0, -0.75]);
    }
    // driver-side floor mat edging
    box(g, 0.5, 0.004, 0.012, M.leatherDark, [0.12, 0.178, DRIVER_Z + 0.26]);
    box(g, 0.5, 0.004, 0.012, M.leatherDark, [0.12, 0.178, DRIVER_Z - 0.26]);
    box(g, 0.5, 0.004, 0.012, M.leatherDark, [0.12, 0.178, -DRIVER_Z + 0.26]);
    box(g, 0.5, 0.004, 0.012, M.leatherDark, [0.12, 0.178, -DRIVER_Z - 0.26]);
  })();

  // ---------- 2. Console controls ----------
  (function controls() {
    const g = cabin, ty = 0.476;
    // selector
    rbox(g, 0.15, 0.012, 0.095, 0.004, M.glossBlack, [-0.30, ty + 0.004, 0]);
    box(g, 0.152, 0.003, 0.003, M.satin, [-0.30, ty + 0.011, 0.048]);
    box(g, 0.152, 0.003, 0.003, M.satin, [-0.30, ty + 0.011, -0.048]);
    rbox(g, 0.05, 0.006, 0.02, 0.003, M.carbon, [-0.30, ty + 0.011, 0.0]); // gate slot
    const lv = new THREE.Group(); lv.position.set(-0.30, ty + 0.012, 0); lv.rotation.z = 0.18; g.add(lv);
    cyl(lv, 0.012, 0.02, M.satin, [0, 0.01, 0], 'y');
    rbox(lv, 0.034, 0.075, 0.052, 0.014, M.leatherDark, [0, 0.05, 0]);
    rbox(lv, 0.03, 0.012, 0.048, 0.005, M.satin, [0.0, 0.092, 0]);
    box(lv, 0.003, 0.05, 0.04, M.satin, [-0.018, 0.045, 0]);
    box(lv, 0.003, 0.05, 0.002, stitch, [0.0175, 0.05, 0.018]);
    box(lv, 0.003, 0.05, 0.002, stitch, [0.0175, 0.05, -0.018]);
    cyl(lv, 0.007, 0.01, M.chrome, [0.02, 0.08, 0], 'x'); // P button
    box(lv, 0.003, 0.004, 0.01, redBtn, [0.026, 0.08, 0]);
    // gate letters bar
    box(g, 0.1, 0.002, 0.006, M.chrome, [-0.38, ty + 0.011, 0]);
    // drive-mode rotary
    cyl(g, 0.03, 0.006, M.glossBlack, [-0.17, ty + 0.003, 0], 'y', 28);
    cyl(g, 0.022, 0.022, M.satin, [-0.17, ty + 0.014, 0], 'y', 28);
    cyl(g, 0.0235, 0.008, rubber, [-0.17, ty + 0.012, 0], 'y', 28);
    torus(g, 0.03, 0.0015, M.ambientLed, [-0.17, ty + 0.007, 0], [Math.PI / 2, 0, 0]);
    box(g, 0.003, 0.003, 0.014, redBtn, [-0.17, ty + 0.0265, 0.01]);
    // 4 toggle switches
    for (let i = 0; i < 4; i++) {
      const z = (i - 1.5) * 0.05;
      rbox(g, 0.026, 0.006, 0.03, 0.002, M.glossBlack, [-0.43, ty + 0.003, z]);
      cyl(g, 0.0035, 0.024, M.satin, [-0.43, ty + 0.015, z], 'y', 8).rotation.z = 0.35;
      fin(new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), M.chrome), g, [-0.43 - 0.004, ty + 0.0275, z]);
      box(g, 0.012, 0.0015, 0.0015, M.ambientLed, [-0.45, ty + 0.0065, z]);
    }
    // EPB switch
    rbox(g, 0.026, 0.006, 0.026, 0.003, M.glossBlack, [-0.22, ty + 0.003, 0.085]);
    rbox(g, 0.016, 0.007, 0.016, 0.003, M.satin, [-0.22, ty + 0.007, 0.085]);
    box(g, 0.006, 0.002, 0.006, redBtn, [-0.22, ty + 0.0115, 0.085]);
    // cup holders
    for (let s = -1; s <= 1; s += 2) {
      const z = s * 0.058;
      cyl(g, 0.039, 0.003, M.glossBlack, [-0.56, ty + 0.0015, z], 'y', 28);
      torus(g, 0.039, 0.0045, M.blackTrim, [-0.56, ty + 0.003, z], [Math.PI / 2, 0, 0]);
      torus(g, 0.043, 0.0015, M.chrome, [-0.56, ty + 0.0045, z], [Math.PI / 2, 0, 0]);
      cyl(g, 0.034, 0.004, rubber, [-0.56, ty - 0.001, z], 'y', 24);
    }
    // start/stop button on dash
    const sx = 0.058, sy = 0.66, sz = 0.12;
    cyl(g, 0.026, 0.006, M.glossBlack, [sx, sy, sz], 'x', 24);
    torus(g, 0.022, 0.0025, redBtn, [sx - 0.004, sy, sz], [0, Math.PI / 2, 0]);
    cyl(g, 0.018, 0.008, M.satin, [sx - 0.004, sy, sz], 'x', 24);
    box(g, 0.002, 0.006, 0.002, redBtn, [sx - 0.009, sy + 0.004, sz]);
  })();

  // ---------- 3/4. Belts, seat details ----------
  (function seatStuff() {
    const g = cabin;
    for (let s = -1; s <= 1; s += 2) {
      const bx = (y) => -0.69 - 0.24 * (y - 0.29) / 0.74;
      const back = V(0.97, 0.25, 0).normalize();
      const up = V(0, 1, 0);
      const A = V(-0.985, 1.0, s * 0.70);
      const S = V(bx(0.93) - 0.035, 0.93, s * 0.50);
      const mid = V(bx(0.6) - 0.035, 0.6, s * 0.34);
      const B = V(-0.68, 0.335, s * 0.18);
      ribbon(g, [A, V(bx(0.98) - 0.03, 0.98, s * 0.62), S, mid, V(-0.665, 0.42, s * 0.22), B], back, 0.048, webbing, 0.0);
      // lap
      const F = V(-0.70, 0.225, s * 0.60);
      ribbon(g, [F, V(-0.69, 0.29, s * 0.52), V(-0.665, 0.337, s * 0.36), B], up, 0.045, webbing, 0.004);
      // anchors
      rbox(g, 0.03, 0.02, 0.012, 0.004, M.satin, [-0.985, 1.0, s * 0.73]);
      rbox(g, 0.03, 0.022, 0.012, 0.004, M.satin, [-0.70, 0.22, s * 0.635]);
      // upper guide loop
      rbox(g, 0.035, 0.02, 0.05, 0.006, M.blackTrim, [bx(0.98) - 0.05, 0.98, s * 0.64]);
      // buckle: tongue + receptacle
      rbox(g, 0.05, 0.007, 0.034, 0.003, M.satin, [-0.68, 0.34, s * 0.22]);
      rbox(g, 0.075, 0.022, 0.034, 0.008, M.blackTrim, [-0.69, 0.335, s * 0.135]);
      box(g, 0.026, 0.004, 0.02, redBtn, [-0.69, 0.348, s * 0.135]);
      box(g, 0.075, 0.012, 0.01, webbing, [-0.66, 0.33, s * 0.095]);
      // slider on tongue
      // seat adjust panel
      const sz = s * (DRIVER_Z + 0.255);
      rbox(g, 0.11, 0.045, 0.012, 0.004, M.blackTrim, [-0.45, 0.26, sz]);
      for (let i = 0; i < 3; i++) box(g, 0.012, 0.012, 0.004, M.satin, [-0.49 + i * 0.03, 0.268, sz + s * 0.0075]);
      box(g, 0.1, 0.002, 0.003, M.chrome, [-0.45, 0.283, sz + s * 0.007]);
      cyl(g, 0.011, 0.012, M.leatherDark, [-0.49, 0.246, sz + s * 0.009], 'z', 14);
      cyl(g, 0.011, 0.012, M.leatherDark, [-0.45, 0.246, sz + s * 0.009], 'z', 14);
      // rails
      for (let k = -1; k <= 1; k += 2) {
        const rz = s * DRIVER_Z + k * 0.17;
        rbox(g, 0.6, 0.02, 0.032, 0.007, M.satin, [-0.50, 0.188, rz]);
        box(g, 0.6, 0.004, 0.01, M.glossBlack, [-0.50, 0.199, rz]);
      }
    }
  })();

  // ---------- 5. Visors, overhead console ----------
  (function roof() {
    const g = cabin;
    for (let s = -1; s <= 1; s += 2) {
      rbox(g, 0.15, 0.02, 0.32, 0.007, alcantara, [-0.105, 1.188, s * 0.32], [0, 0, 0.03]);
      box(g, 0.14, 0.0015, 0.30, M.leatherDark, [-0.105, 1.177, s * 0.32], [0, 0, 0.03]);
      cylBetween(g, V(-0.105, 1.19, s * 0.48), V(-0.105, 1.19, s * 0.62), 0.005, M.satin);
      rbox(g, 0.03, 0.014, 0.03, 0.004, M.blackTrim, [-0.105, 1.205, s * 0.64]);
      rbox(g, 0.026, 0.012, 0.03, 0.004, M.blackTrim, [-0.105, 1.205, s * 0.08]);
      rbox(g, 0.05, 0.004, 0.02, 0.002, M.satin, [-0.105, 1.176, s * 0.60]);
    }
    rbox(g, 0.2, 0.03, 0.24, 0.01, M.glossBlack, [-0.20, 1.215, 0]);
    for (let s = -1; s <= 1; s += 2) {
      rbox(g, 0.05, 0.004, 0.055, 0.002, lampMat, [-0.215, 1.1985, s * 0.075]);
      box(g, 0.062, 0.002, 0.003, M.chrome, [-0.215, 1.2, s * 0.075 + 0.032]);
      box(g, 0.062, 0.002, 0.003, M.chrome, [-0.215, 1.2, s * 0.075 - 0.032]);
    }
    cyl(g, 0.011, 0.005, redBtn, [-0.185, 1.2, 0], 'y');
    torus(g, 0.012, 0.0012, M.chrome, [-0.185, 1.1985, 0], [Math.PI / 2, 0, 0]);
    box(g, 0.012, 0.002, 0.024, M.satin, [-0.235, 1.1995, 0]);
    // mirror-side sensor window
    rbox(g, 0.04, 0.006, 0.04, 0.003, M.glossBlack, [-0.12, 1.21, 0.0]);
  })();

  // ---------- 6. Glovebox ----------
  (function glove() {
    const g = cabin, x = 0.04;
    box(g, 0.008, 0.005, 0.42, M.glossBlack, [x, 0.62, -0.41]);
    box(g, 0.008, 0.005, 0.42, M.glossBlack, [x, 0.50, -0.41]);
    box(g, 0.008, 0.12, 0.005, M.glossBlack, [x, 0.56, -0.20]);
    box(g, 0.008, 0.12, 0.005, M.glossBlack, [x, 0.56, -0.62]);
    rbox(g, 0.01, 0.014, 0.1, 0.004, M.satin, [x - 0.002, 0.60, -0.41]);
    box(g, 0.012, 0.004, 0.09, M.glossBlack, [x - 0.002, 0.60, -0.41]);
    rbox(g, 0.006, 0.026, 0.07, 0.003, M.chrome, [x - 0.001, 0.535, -0.31]);
    box(g, 0.007, 0.008, 0.05, M.glossBlack, [x - 0.002, 0.535, -0.31]);
    // stitching above/below shut line
    box(g, 0.004, 0.0015, 0.40, stitch, [x - 0.001, 0.633, -0.41]);
    box(g, 0.004, 0.0015, 0.40, stitch, [x - 0.001, 0.487, -0.41]);
  })();

  // ---------- 7. Cargo ----------
  (function cargo() {
    const g = cabin, fy = 0.64;
    for (let i = 0; i < 3; i++) box(g, 0.78, 0.004, 0.025, webbing, [-1.45, fy + 0.012, (i - 1) * 0.28]);
    for (let j = 0; j < 5; j++) box(g, 0.025, 0.004, 0.84, webbing, [-1.75 + j * 0.17, fy + 0.016, 0]);
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < 2; k++) {
        const x = k ? -1.5 : -1.15;
        rbox(g, 0.06, 0.006, 0.05, 0.002, M.satin, [x, fy + 0.003, s * 0.45]);
        torus(g, 0.02, 0.0035, M.chrome, [x, fy + 0.014, s * 0.45], [Math.PI / 2 - 0.3, 0, 0]);
      }
      box(g, 0.03, 0.02, 0.02, M.blackTrim, [-1.12, fy + 0.014, s * 0.4]);
      box(g, 0.03, 0.02, 0.02, M.blackTrim, [-1.8, fy + 0.014, s * 0.4]);
    }
  })();

  // ---------- 8. Doors ----------
  function door(g, s) {
    const wz = s * 0.80;
    rbox(g, 1.25, 0.045, 0.06, 0.016, M.leatherDark, [-0.225, 0.80, s * 0.79]);
    box(g, 1.2, 0.002, 0.003, stitch, [-0.225, 0.826, s * 0.768]);
    box(g, 1.2, 0.003, 0.003, M.chrome, [-0.225, 0.777, s * 0.765]);
    // stitched seam
    for (let i = 0; i < 2; i++) box(g, 1.15, 0.0025, 0.003, stitch, [-0.2, 0.765 - i * 0.02, s * 0.782 - 0], null);
    // memory panel
    rbox(g, 0.10, 0.05, 0.012, 0.005, M.blackTrim, [0.05, 0.665, s * 0.805]);
    for (let i = 0; i < 3; i++) {
      box(g, 0.018, 0.016, 0.004, i === 0 ? M.satin : M.chrome, [0.02 + i * 0.03, 0.668, s * 0.8115]);
      box(g, 0.012, 0.0015, 0.0015, M.ambientLed, [0.02 + i * 0.03, 0.683, s * 0.8115]);
    }
    // window switches on armrest top
    rbox(g, 0.14, 0.012, 0.045, 0.004, M.glossBlack, [0.0, 0.653, s * 0.83]);
    for (let i = 0; i < 4; i++) {
      rbox(g, 0.024, 0.008, 0.016, 0.003, M.satin, [-0.045 + i * 0.03, 0.661, s * 0.83]);
      box(g, 0.02, 0.0015, 0.002, M.chrome, [-0.045 + i * 0.03, 0.666, s * 0.83]);
    }
    // door lock / mirror knob
    cyl(g, 0.011, 0.008, M.satin, [0.12, 0.658, s * 0.825], 'y', 14);
    // map pocket
    rbox(g, 0.62, 0.07, 0.05, 0.012, M.leatherDark, [-0.1, 0.31, s * 0.815]);
    box(g, 0.56, 0.012, 0.012, M.glossBlack, [-0.1, 0.325, s * 0.788]);
    box(g, 0.56, 0.0025, 0.003, stitch, [-0.1, 0.299, s * 0.789]);
    box(g, 0.56, 0.0025, 0.003, stitch, [-0.1, 0.343, s * 0.789]);
    // opener lever
    rbox(g, 0.11, 0.03, 0.012, 0.005, M.blackTrim, [0.10, 0.72, s * 0.81]);
    rbox(g, 0.085, 0.012, 0.02, 0.005, M.satin, [0.10, 0.72, s * 0.795]);
    box(g, 0.012, 0.014, 0.016, M.chrome, [0.06, 0.72, s * 0.8]);
    box(g, 0.012, 0.014, 0.016, M.chrome, [0.14, 0.72, s * 0.8]);
    // red warning light on rear edge
    box(g, 0.012, 0.12, 0.012, redLed, [-0.85, 0.30, s * 0.835]);
    box(g, 0.02, 0.13, 0.008, M.glossBlack, [-0.85, 0.30, s * 0.842]);
    // ambient strip on the door
    box(g, 0.9, 0.006, 0.006, M.ambientLed, [-0.3, 0.74, s * 0.805]);
  }
  door(doorR, 1); door(doorL, -1);

  return { cabin, doorR, doorL };
}

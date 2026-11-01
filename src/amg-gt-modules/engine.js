function buildEngineBay(THREE, RoundedBoxGeometry, M) {
  const group = new THREE.Group();
  group.name = 'engineBay';
  const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

  // ---------- materials ----------
  const std = (c, m, r, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: c, metalness: m, roughness: r }, extra || {}));
  const cast = std(0x8d9096, 0.85, 0.5);
  const castDark = std(0x4b4e54, 0.8, 0.6);
  const blued = std(0x56668f, 0.92, 0.32);
  const steel = std(0x9a9ca2, 0.95, 0.28);
  const orange = std(0xe8651a, 0.0, 0.55);
  const yellow = std(0xf2c200, 0.0, 0.45);
  const blue = std(0x1f5fd0, 0.0, 0.45);
  const red = std(0xc4161c, 0.0, 0.45);
  const tankWhite = new THREE.MeshPhysicalMaterial({ color: 0xe9eee8, metalness: 0, roughness: 0.25, transparent: true, opacity: 0.72, transmission: 0.0 });
  const coolant = std(0x2aa5b8, 0, 0.3, { transparent: true, opacity: 0.8 });
  const siliconeBlue = std(0x1b3f9a, 0.0, 0.35);
  const shieldMat = std(0xb5b8be, 0.9, 0.35, { side: THREE.DoubleSide });
  const plaqueMat = std(0xc9ccd2, 0.95, 0.2);

  // ---------- helpers ----------
  function put(mesh, x, y, z, rx, ry, rz, parent) {
    mesh.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    (parent || group).add(mesh);
    return mesh;
  }
  function rbox(w, h, d, r, mat, x, y, z, rx, ry, rz, parent) {
    const rr = Math.min(r, Math.min(w, h, d) * 0.45);
    return put(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, rr), mat), x, y, z, rx, ry, rz, parent);
  }
  function cyl(rt, rb, h, mat, x, y, z, axis, seg, parent) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg || 20);
    const m = new THREE.Mesh(g, mat);
    put(m, x, y, z, 0, 0, 0, parent);
    if (axis === 'x') m.rotation.z = -Math.PI / 2;
    else if (axis === 'z') m.rotation.x = Math.PI / 2;
    return m;
  }
  function tube(pts, radius, mat, segs, closed, parent) {
    const curve = new THREE.CatmullRomCurve3(pts.map(V3), !!closed, 'catmullrom', 0.5);
    const g = new THREE.TubeGeometry(curve, segs || 24, radius, 8, !!closed);
    return put(new THREE.Mesh(g, mat), 0, 0, 0, 0, 0, 0, parent);
  }
  function torus(R, t, mat, x, y, z, axis, parent) {
    const m = put(new THREE.Mesh(new THREE.TorusGeometry(R, t, 10, 28), mat), x, y, z, 0, 0, 0, parent);
    if (axis === 'x') m.rotation.y = Math.PI / 2;
    else if (axis === 'y') m.rotation.x = Math.PI / 2;
    return m;
  }

  // ================= 1. ENGINE BLOCK, BANKS, COVERS =================
  const crankY = 0.34;
  rbox(0.70, 0.26, 0.34, 0.03, cast, 0.90, 0.38, 0);          // crankcase
  rbox(0.62, 0.08, 0.28, 0.025, castDark, 0.90, 0.26, 0);     // sump (bottom y = 0.22)
  rbox(0.60, 0.02, 0.30, 0.008, steel, 0.90, 0.225, 0);       // sump pan
  rbox(0.05, 0.30, 0.30, 0.02, cast, 0.585, 0.38, 0);         // rear bell housing flange
  cyl(0.15, 0.17, 0.06, castDark, 0.52, 0.40, 0, 'x', 28);    // bell housing stub
  cyl(0.045, 0.045, 0.06, steel, 1.26, crankY, 0, 'x', 20);   // crank snout

  [-1, 1].forEach((s) => {
    const bank = new THREE.Group();
    bank.position.set(0.90, crankY, 0);
    bank.rotation.x = s * Math.PI / 4;
    group.add(bank);
    rbox(0.66, 0.20, 0.22, 0.02, cast, 0, 0.17, 0, 0, 0, 0, bank);       // cylinder deck
    rbox(0.64, 0.10, 0.22, 0.02, castDark, 0, 0.31, 0, 0, 0, 0, bank);   // head
    rbox(0.62, 0.07, 0.17, 0.025, M.satin, 0, 0.395, 0, 0, 0, 0, bank);  // cam cover
    for (let i = 0; i < 8; i++) {
      rbox(0.022, 0.018, 0.15, 0.006, M.satin, -0.26 + i * 0.075, 0.44, 0, 0, 0, 0, bank); // ribs
    }
    for (let i = 0; i < 4; i++) {
      cyl(0.011, 0.011, 0.022, M.chrome, -0.21 + i * 0.14, 0.452, s * 0.06, 'y', 10, bank); // bolts
    }
    // ignition coil blobs on outer side of cover
    for (let i = 0; i < 4; i++) {
      rbox(0.04, 0.05, 0.03, 0.01, M.glossBlack, -0.21 + i * 0.14, 0.40, -0.1, 0, 0, 0, bank);
    }
    // exhaust-side flange plate on head (inner side)
    rbox(0.58, 0.06, 0.02, 0.008, steel, 0, 0.30, -0.12, 0, 0, 0, bank);
  });

  // oil filler cap (right bank) + dipstick
  const rb = group.children[group.children.length - 1];
  cyl(0.026, 0.028, 0.018, yellow, -0.20, 0.47, 0, 'y', 20, rb);
  cyl(0.018, 0.018, 0.02, M.blackTrim, -0.20, 0.485, 0, 'y', 16, rb);
  tube([[1.12, 0.30, -0.17], [1.14, 0.38, -0.205], [1.13, 0.48, -0.215], [1.10, 0.55, -0.21]], 0.004, steel, 14);
  torus(0.014, 0.004, yellow, 1.10, 0.57, -0.21, 'z');

  // centre carbon cover between banks + plaque
  rbox(0.52, 0.03, 0.30, 0.012, M.carbon, 0.90, 0.665, 0);
  rbox(0.46, 0.012, 0.26, 0.006, M.glossBlack, 0.90, 0.645, 0);
  rbox(0.14, 0.005, 0.04, 0.0018, plaqueMat, 0.88, 0.683, 0);
  for (let i = 0; i < 4; i++) {
    cyl(0.009, 0.009, 0.01, M.chrome, 0.68 + i * 0.44 / 3 * 1.0 + 0.0, 0.683, 0.12, 'y', 8);
    cyl(0.009, 0.009, 0.01, M.chrome, 0.68 + i * 0.44 / 3 * 1.0 + 0.0, 0.683, -0.12, 'y', 8);
  }

  // ================= 2. TURBOS, MANIFOLDS, HEAT SHIELDS =================
  [-1, 1].forEach((s) => {
    const tz = s * 0.095, ty = 0.50;
    // turbine (rear), compressor (front)
    torus(0.042, 0.024, blued, 0.745, ty, tz, 'x');
    cyl(0.028, 0.028, 0.045, blued, 0.745, ty, tz, 'x', 18);
    torus(0.036, 0.020, cast, 0.885, ty, tz, 'x');
    cyl(0.024, 0.024, 0.04, cast, 0.885, ty, tz, 'x', 18);
    cyl(0.014, 0.014, 0.17, steel, 0.815, ty, tz, 'x', 12);        // CHRA
    cyl(0.03, 0.03, 0.06, castDark, 0.815, ty, tz, 'x', 16);       // bearing housing
    cyl(0.026, 0.026, 0.03, M.glossBlack, 0.915, ty, tz, 'x', 16); // compressor inlet
    cyl(0.03, 0.03, 0.008, M.chrome, 0.931, ty, tz, 'x', 16);      // inlet clamp
    // wastegate actuator
    cyl(0.018, 0.018, 0.05, steel, 0.77, ty + 0.06, tz + s * 0.03, 'y', 12);
    // heat shield (half-pipe above turbo)
    const hs = put(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 16, 1, true, -Math.PI, Math.PI), shieldMat), 0.80, ty + 0.002, tz, 0, 0, -Math.PI / 2);
    // manifold runners from head ports to turbine inlet
    for (let i = 0; i < 4; i++) {
      const x0 = 0.67 + i * 0.15;
      tube([[x0, 0.57, s * 0.185], [x0 * 0.4 + 0.745 * 0.6, 0.55, s * 0.13], [0.745, ty + 0.03, tz + s * 0.02]], 0.014, blued, 12);
    }
    // downpipe
    tube([[0.70, ty, tz], [0.60, 0.44, s * 0.13], [0.55, 0.32, s * 0.18], [0.60, 0.24, s * 0.24]], 0.03, steel, 14);
    cyl(0.036, 0.036, 0.016, steel, 0.70, ty, tz, 'x', 16); // V-band
  });

  // ================= 3. INTAKE =================
  [-1, 1].forEach((s) => {
    const fz = s * 0.36;
    rbox(0.28, 0.16, 0.20, 0.03, M.blackTrim, 1.60, 0.50, fz);
    rbox(0.26, 0.012, 0.18, 0.005, M.glossBlack, 1.60, 0.585, fz);
    for (let i = 0; i < 5; i++) rbox(0.012, 0.01, 0.17, 0.004, M.blackTrim, 1.52 + i * 0.04, 0.59, fz);
    rbox(0.012, 0.12, 0.16, 0.004, M.mesh, 1.745, 0.50, fz);               // intake grille
    cyl(0.035, 0.035, 0.05, M.rubber, 1.43, 0.50, fz, 'x', 16);            // outlet stub
    tube([[1.42, 0.50, fz], [1.30, 0.50, s * 0.28], [1.14, 0.49, s * 0.17], [1.02, 0.50, s * 0.105], [0.94, 0.50, s * 0.095]], 0.029, M.rubber, 28);
    cyl(0.034, 0.034, 0.012, M.chrome, 1.30, 0.50, s * 0.28, 'x', 14);     // hose clamp
    // intercooler / charge pipe (compressor outlet down and forward to the radiator top)
    tube([[0.88, ty0(), s * 0.135], [0.94, 0.42, s * 0.16], [1.20, 0.30, s * 0.20], [1.55, 0.26, s * 0.20], [1.85, 0.30, s * 0.30], [1.92, 0.38, s * 0.42]], 0.022, siliconeBlue, 36);
    [1.20, 1.55].forEach((px) => cyl(0.026, 0.026, 0.01, M.chrome, px, px < 1.4 ? 0.30 : 0.26, s * 0.20, 'x', 12));
  });
  function ty0() { return 0.50; }

  // ================= 4. COOLING STACK =================
  rbox(0.05, 0.28, 1.04, 0.01, M.mesh, 1.99, 0.40, 0);          // core
  rbox(0.07, 0.31, 0.06, 0.015, M.satin, 1.99, 0.40, 0.52);     // side tanks
  rbox(0.07, 0.31, 0.06, 0.015, M.satin, 1.99, 0.40, -0.52);
  rbox(0.07, 0.025, 1.10, 0.008, M.satin, 1.99, 0.545, 0);      // top rail
  rbox(0.07, 0.025, 1.10, 0.008, M.satin, 1.99, 0.255, 0);      // bottom rail
  cyl(0.02, 0.02, 0.05, M.satin, 1.97, 0.50, 0.53, 'y', 12);    // hose necks
  cyl(0.02, 0.02, 0.05, M.satin, 1.97, 0.30, -0.53, 'y', 12);
  cyl(0.016, 0.016, 0.02, M.chrome, 1.99, 0.565, -0.40, 'y', 12); // rad cap
  rbox(0.02, 0.30, 0.60, 0.006, M.blackTrim, 1.93, 0.40, 0.29);  // fan shrouds
  rbox(0.02, 0.30, 0.60, 0.006, M.blackTrim, 1.93, 0.40, -0.29);
  [-1, 1].forEach((s) => {
    const fz = s * 0.27, fx = 1.915;
    torus(0.125, 0.009, M.glossBlack, 1.93, 0.40, fz, 'x');
    cyl(0.035, 0.035, 0.04, M.glossBlack, fx, 0.40, fz, 'x', 16);
    const fan = new THREE.Group();
    fan.position.set(fx, 0.40, fz);
    fan.rotation.x = s * 0.4;
    group.add(fan);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const holder = new THREE.Group();
      holder.rotation.x = a;
      fan.add(holder);
      const bl = rbox(0.008, 0.085, 0.034, 0.003, M.blackTrim, 0, 0.078, 0, 0, 0, 0, holder);
      bl.rotation.y = 0.5;
    }
    for (let k = 0; k < 4; k++) { // shroud motor struts
      const a = k * Math.PI / 2 + 0.4;
      rbox(0.01, 0.1, 0.012, 0.003, M.blackTrim, 1.925, 0.40 + Math.cos(a) * 0.075, fz + Math.sin(a) * 0.075, a, 0, 0);
    }
  });
  rbox(0.03, 0.04, 0.90, 0.01, M.blackTrim, 1.935, 0.585, 0); // upper air baffle

  // ================= 5. STRUT BRACE =================
  const braceY = 0.675;
  cyl(0.015, 0.015, 1.14, M.carbon, 1.31, braceY, 0, 'z', 16);
  [-1, 1].forEach((s) => {
    cyl(0.046, 0.05, 0.014, M.satin, 1.31, 0.66, s * 0.60, 'y', 28);
    cyl(0.018, 0.018, 0.012, M.chrome, 1.31, 0.672, s * 0.60, 'y', 6);
    rbox(0.05, 0.04, 0.04, 0.01, M.satin, 1.31, braceY, s * 0.565);
    rbox(0.05, 0.04, 0.04, 0.01, M.satin, 1.31, braceY, s * 0.15);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.78;
      cyl(0.006, 0.006, 0.01, M.chrome, 1.31 + Math.cos(a) * 0.034, 0.667, s * 0.60 + Math.sin(a) * 0.034, 'y', 6);
    }
  });
  rbox(0.07, 0.03, 0.09, 0.01, M.satin, 1.31, braceY, 0); // centre clamp

  // ================= 6. ANCILLARIES =================
  // coolant expansion tank (left rear of radiator, right side)
  rbox(0.10, 0.20, 0.13, 0.025, tankWhite, 1.80, 0.40, 0.68);
  rbox(0.088, 0.10, 0.118, 0.02, coolant, 1.80, 0.36, 0.68);
  cyl(0.032, 0.032, 0.03, blue, 1.80, 0.515, 0.68, 'y', 18);
  tube([[1.80, 0.31, 0.62], [1.84, 0.30, 0.56], [1.92, 0.30, 0.54]], 0.011, M.rubber, 12);
  // washer fluid tank
  rbox(0.10, 0.20, 0.12, 0.025, tankWhite, 0.74, 0.42, -0.74);
  cyl(0.026, 0.026, 0.026, blue, 0.74, 0.545, -0.74, 'y', 16);
  // brake booster, master cylinder, reservoir
  cyl(0.115, 0.115, 0.06, M.blackTrim, 0.50, 0.60, -0.38, 'x', 28);
  cyl(0.115, 0.10, 0.012, castDark, 0.538, 0.60, -0.38, 'x', 28);
  cyl(0.025, 0.025, 0.12, cast, 0.60, 0.60, -0.38, 'x', 16);
  rbox(0.07, 0.05, 0.11, 0.015, tankWhite, 0.63, 0.655, -0.38);
  cyl(0.024, 0.024, 0.022, yellow, 0.63, 0.69, -0.38, 'y', 16);
  rbox(0.02, 0.02, 0.05, 0.005, cast, 0.66, 0.60, -0.38);
  // battery / fuse box with lid
  rbox(0.22, 0.10, 0.20, 0.015, M.glossBlack, 0.67, 0.42, 0.48);
  rbox(0.22, 0.03, 0.20, 0.012, M.blackTrim, 0.67, 0.485, 0.48);
  cyl(0.014, 0.014, 0.02, red, 0.60, 0.51, 0.54, 'y', 10);
  cyl(0.014, 0.014, 0.02, M.blackTrim, 0.60, 0.51, 0.42, 'y', 10);
  rbox(0.05, 0.015, 0.05, 0.004, M.glossBlack, 0.74, 0.50, 0.48);
  tube([[0.60, 0.51, 0.54], [0.58, 0.55, 0.60], [0.55, 0.50, 0.70]], 0.008, red, 10);

  // alternator + AC compressor + accessory drive (front of engine, x ~ 1.27-1.34)
  cyl(0.058, 0.058, 0.09, castDark, 1.285, 0.44, -0.20, 'x', 20);
  cyl(0.060, 0.060, 0.012, M.satin, 1.335, 0.44, -0.20, 'x', 20);
  cyl(0.052, 0.052, 0.10, cast, 1.29, 0.27, 0.19, 'x', 20);
  cyl(0.05, 0.05, 0.02, M.glossBlack, 1.30, 0.27, 0.19, 'x', 20);
  const pulleys = [
    [0.00, 0.34, 0.055], [-0.20, 0.44, 0.032], [0.19, 0.27, 0.045], [0.14, 0.46, 0.035], [-0.10, 0.25, 0.025]
  ];
  pulleys.forEach((p) => {
    cyl(p[2], p[2], 0.028, M.satin, 1.345, p[1], p[0], 'x', 22);
    cyl(p[2] * 0.4, p[2] * 0.4, 0.034, M.chrome, 1.345, p[1], p[0], 'x', 10);
  });
  cyl(0.09, 0.09, 0.012, M.blackTrim, 1.32, crankY, 0, 'x', 28); // damper
  // belt as a closed loop around outside of pulleys
  (function () {
    const cx = 0.0, cy = 0.35;
    const order = [[0.00, 0.34, 0.055], [-0.20, 0.44, 0.032], [0.14, 0.46, 0.035], [0.19, 0.27, 0.045], [-0.10, 0.25, 0.025]];
    const pts = [];
    order.forEach((p, i) => {
      const dz = p[0] - cx, dy = p[1] - cy;
      let l = Math.hypot(dz, dy);
      let ux, uy;
      if (l < 0.001) { ux = 0; uy = -1; } else { ux = dz / l; uy = dy / l; }
      pts.push([1.345, p[1] + uy * (p[2] + 0.005), p[0] + ux * (p[2] + 0.005)]);
    });
    pts[0] = [1.345, 0.34 - 0.06, 0.0];
    tube(pts, 0.005, M.rubber, 60, true);
  })();

  // hoses
  tube([[1.97, 0.50, 0.53], [1.86, 0.57, 0.47], [1.62, 0.60, 0.42], [1.42, 0.55, 0.32], [1.25, 0.47, 0.20]], 0.020, M.rubber, 30);
  tube([[1.97, 0.30, -0.53], [1.84, 0.26, -0.44], [1.55, 0.26, -0.32], [1.30, 0.28, -0.22]], 0.020, M.rubber, 30);
  tube([[1.30, 0.50, 0.10], [1.20, 0.60, 0.00], [1.35, 0.60, -0.10]], 0.011, M.rubber, 16);
  tube([[0.62, 0.62, -0.30], [0.60, 0.50, -0.20], [0.58, 0.38, -0.12]], 0.008, M.rubber, 10);
  // washer hose to tank
  tube([[0.74, 0.48, -0.74], [0.72, 0.58, -0.62], [0.66, 0.70, -0.50]], 0.006, M.blackTrim, 10);
  // orange-sleeved wiring loom
  tube([[0.60, 0.50, 0.58], [0.66, 0.62, 0.46], [0.84, 0.70, 0.36], [1.08, 0.72, 0.31], [1.22, 0.62, 0.26], [1.26, 0.50, 0.20]], 0.013, orange, 40);
  tube([[0.66, 0.62, 0.46], [0.60, 0.62, 0.30], [0.58, 0.62, 0.10]], 0.009, orange, 14);
  // HV style secondary branch with clips
  [0.84, 1.08].forEach((x) => rbox(0.024, 0.012, 0.03, 0.004, M.blackTrim, x, x < 1 ? 0.715 : 0.735, 0.34));

  // engine mounts
  [-1, 1].forEach((s) => {
    rbox(0.10, 0.07, 0.07, 0.015, M.rubber, 0.78, 0.30, s * 0.22);
    rbox(0.12, 0.03, 0.12, 0.01, castDark, 0.78, 0.25, s * 0.28);
    cyl(0.02, 0.02, 0.18, M.rubber, 1.15, 0.27, s * 0.21, 'z', 12);
  });

  return group;
}

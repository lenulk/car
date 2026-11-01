function buildStudioEnvironment(THREE, renderer) {
  // ---------------------------------------------------------------------------
  // Automotive photo studio, modelled as emissive geometry only. Everything is
  // MeshBasicMaterial; HDR intensity comes from material.color (values >> 1),
  // soft edges / gradients come from per-vertex colours (no textures).
  // ---------------------------------------------------------------------------
  const scene = new THREE.Scene();

  // PMREM samples the scene from the origin, i.e. from the car's centre. The car
  // sits on the floor, so the whole studio (floor at y = 0 in studio coordinates,
  // lights at the heights given below) is lowered by EYE: the capture point is
  // then ~0.7 m above the floor and the floor is actually visible/reflectable.
  const EYE = 0.7;
  const studio = new THREE.Group();
  studio.position.y = -EYE;
  scene.add(studio);

  const smooth = (t) => {
    t = Math.min(1, Math.max(0, t));
    return t * t * (3 - 2 * t);
  };

  // --- room colour (linear RGB), by height: dark, cool, brighter at the horizon
  const FLOOR_GLOSS = 0.7;
  const ROOM_TOP = [0.0055, 0.0062, 0.0085];
  const ROOM_HOR = [0.034, 0.037, 0.046];
  function roomColor(y) {
    const w = Math.exp(-Math.pow(y / 5.0, 2));
    return [
      ROOM_TOP[0] + (ROOM_HOR[0] - ROOM_TOP[0]) * w,
      ROOM_TOP[1] + (ROOM_HOR[1] - ROOM_TOP[1]) * w,
      ROOM_TOP[2] + (ROOM_HOR[2] - ROOM_TOP[2]) * w,
    ];
  }

  // --- Room: big BackSide sphere with a vertical vertex-colour gradient --------
  {
    const R = 18;
    const geo = new THREE.SphereGeometry(R, 64, 48);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = roomColor(Math.abs(p.getY(i)));
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    studio.add(new THREE.Mesh(geo, mat));
  }

  // --- Floor: dark, slightly lighter than the walls, glossy-ish ------------------
  // Vertex alpha = 1 - Fresnel-like reflectance, so the mirrored copies of the
  // lights below the floor (added further down) shine through faintly, more at
  // grazing angles, like a polished dark studio floor.
  {
    const S = 40;
    const geo = new THREE.PlaneGeometry(S, S, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      // darker right around the car, a broad soft pool further out, meeting the wall at the rim
      const pool = 0.3 + 0.8 * Math.exp(-Math.pow((r - 7.0) / 4.5, 2));
      const m = 0.75 + pool * (1 - smooth((r - 11) / 7)) + 0.25 * smooth((r - 11) / 7);
      const sinPhi = EYE / Math.hypot(EYE, r);
      const refl = FLOOR_GLOSS * (0.06 + 0.94 * Math.pow(1 - sinPhi, 5));
      col[i * 4] = ROOM_HOR[0] * m;
      col[i * 4 + 1] = ROOM_HOR[1] * m;
      col[i * 4 + 2] = ROOM_HOR[2] * m;
      col[i * 4 + 3] = 1 - refl;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.renderOrder = 10;
    studio.add(floor);
  }

  // --- Soft-edged emissive panel (one mesh, non-uniform grid + vertex falloff) -
  // w,h   : size in metres (local X / Y)
  // soft  : [sx, sy] width of the smooth edge falloff on each side
  // tint  : colour balance, k: HDR multiplier
  // grad  : optional (u,v in -1..1) -> multiplier, for gradients across the panel
  // bg    : room colour behind the panel (so the falloff blends into the room)
  const PROFILE = [0, 0.1, 0.25, 0.45, 0.7, 1];
  function axisGrid(len, soft) {
    const s = Math.min(soft, len * 0.49);
    const lo = [];
    const f = [];
    for (let i = 0; i < PROFILE.length; i++) {
      lo.push(-len / 2 + s * PROFILE[i]);
      f.push(smooth(PROFILE[i]));
    }
    const pos = lo.slice();
    const fall = f.slice();
    for (let i = PROFILE.length - 1; i >= 0; i--) {
      pos.push(len / 2 - s * PROFILE[i]);
      fall.push(f[i]);
    }
    return { pos, fall };
  }

  function addPanel(o) {
    const mesh = buildPanel(o);
    studio.add(mesh);
    if (!o.noMirror) {
      // reflection of the light in the glossy floor (shares geometry + material)
      const mir = buildPanel(o, mesh);
      studio.add(mir);
    }
    return mesh;
  }

  function buildPanel(o, source) {
    if (source) {
      const m = new THREE.Mesh(source.geometry, source.material);
      m.position.set(o.position[0], -o.position[1], o.position[2]);
      if (o.faceDown) {
        m.rotation.x = Math.PI / 2;
      } else {
        const aim = o.aim || [0, o.position[1], 0];
        m.lookAt(aim[0], -aim[1], aim[2]);
        m.scale.y = -1;
      }
      return m;
    }
    const sx = Array.isArray(o.soft) ? o.soft[0] : o.soft;
    const sy = Array.isArray(o.soft) ? o.soft[1] : o.soft;
    const gx = axisGrid(o.w, sx);
    const gy = axisGrid(o.h, sy);
    const nx = gx.pos.length;
    const ny = gy.pos.length;
    const k = o.k;
    const tint = o.tint || [1.0, 0.98, 0.95];
    const bg = o.bg || roomColor(o.position[1]);
    const mc = [tint[0] * k, tint[1] * k, tint[2] * k];

    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = (j * nx + i) * 3;
        const x = gx.pos[i];
        const y = gy.pos[j];
        const f = gx.fall[i] * gy.fall[j];
        const m = o.grad ? o.grad((2 * x) / o.w, (2 * y) / o.h) : 1;
        pos[idx] = x;
        pos[idx + 1] = y;
        pos[idx + 2] = 0;
        // final = vc * material.color = f*m*tint*k + (1-f)*bg
        for (let c = 0; c < 3; c++) col[idx + c] = f * m + ((1 - f) * bg[c]) / mc[c];
      }
    }
    const index = [];
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.color.setRGB(mc[0], mc[1], mc[2]);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.position[0], o.position[1], o.position[2]);
    if (o.faceDown) {
      mesh.rotation.x = Math.PI / 2; // local +Z -> world -Y, local +Y -> world +Z
    } else {
      const aim = o.aim || [0, o.position[1], 0];
      mesh.lookAt(aim[0], aim[1], aim[2]); // local +Z points at the car
    }
    return mesh;
  }

  const NEUTRAL = [1.0, 0.98, 0.95];

  // --- Overhead key: 6 x 2.2 m softbox, y = 5 m, long side along X ------------
  addPanel({
    w: 6.0, h: 2.2, soft: [0.55, 0.75], tint: NEUTRAL, k: 8.0,
    position: [0, 5.0, 0], faceDown: true,
    // gentle roll-off towards the two ends of the box (long gradient on roof/hood)
    grad: (u) => 1.0 - 0.22 * u * u,
  });

  // --- Broad, dim ceiling bounce above the key (lifts the roof/hood gradient) --
  addPanel({
    w: 14.0, h: 9.0, soft: [3.5, 3.0], tint: [0.97, 0.98, 1.0], k: 2.0,
    position: [0, 6.6, 0], faceDown: true,
  });

  // --- Four tall vertical strip lights, |z| ~ 5.5 m, x = +-3.2 m, angled in ----
  [[3.2, 5.5], [-3.2, 5.5], [3.2, -5.5], [-3.2, -5.5]].forEach((p) => {
    addPanel({
      w: 0.5, h: 3.5, soft: [0.06, 0.55], tint: NEUTRAL, k: 5.0,
      position: [p[0], 2.0, p[1]],
      // slightly dimmer towards the top so the streak fades up the glass
      grad: (u, v) => 1.0 - 0.2 * Math.max(0, v),
    });
  });

  // --- Two long low "horizon" strips, ~10 x 0.25 m at y = 1 m, |z| = 8 m -------
  [8, -8].forEach((z) => {
    addPanel({
      w: 10.0, h: 0.28, soft: [1.8, 0.07], tint: NEUTRAL, k: 3.2,
      position: [0, 1.0, z],
    });
  });

  // --- Big dim side scrims with a vertical gradient (clean gradient on doors) --
  [13, -13].forEach((z) => {
    addPanel({
      w: 16.0, h: 5.0, soft: [3.0, 1.2], tint: [0.96, 0.98, 1.0], k: 1.5,
      position: [0, 3.2, z],
      grad: (u, v) => 0.06 + 0.94 * smooth((v + 1) / 2),
    });
  });

  // --- Rear scrim (warm, -X) and front fill (cool, +X) ------------------------
  addPanel({
    w: 6.0, h: 3.0, soft: [0.7, 0.7], tint: [1.0, 0.93, 0.84], k: 1.3,
    position: [-9.0, 1.8, 0],
  });
  addPanel({
    w: 6.0, h: 3.0, soft: [0.7, 0.7], tint: [0.86, 0.93, 1.0], k: 0.9,
    position: [9.0, 1.8, 0],
  });

  // --- Tiny hard kickers high in the corners (sparkle points) -----------------
  [[-6.0, 7.0, 6.5], [6.5, 7.2, -5.5], [-6.5, 6.5, -6.0]].forEach((p) => {
    addPanel({
      w: 0.3, h: 0.3, soft: 0.03, tint: [1.0, 0.99, 0.97], k: 25,
      position: p, aim: [0, 0, 0], noMirror: true,
    });
  });

  // --- Convert to a prefiltered environment map --------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  const envTexture = target.texture;
  pmrem.dispose();

  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  });

  return envTexture;
}

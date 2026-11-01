function makeRealismTextures(THREE, renderer) {
  'use strict';
  // All maps are tangent-space, OpenGL convention (R=+x right, G=+y up, B=z), flat = rgb(128,128,255).
  // They are meant for CanvasTexture with the default flipY=true: canvas row 0 is the TOP of the image
  // (V=1), so "up" (+y) means decreasing canvas row.  Every map wraps modulo its size.

  // ---------------------------------------------------------------- generic helpers
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mod = (i, n) => ((i % n) + n) % n;

  function rng(seed) { // mulberry32
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, img: ctx.createImageData(w, h) };
  }

  // write a (not necessarily unit) normal into RGBA ImageData at pixel index p
  function putNormal(data, p, nx, ny, nz) {
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    const i = p * 4;
    data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
    data[i + 3] = 255;
  }

  // Height field (row-major, Float32Array, w*h) -> tangent-space normal canvas.
  // Central differences with wrap-around.  strength scales dh/dx (heights and pixels in the same unit
  // give strength 1 = true slope); aspectY scales the y gradient relative to x for non-square texels.
  function heightToNormal(height, w, h, strength, aspectY) {
    const sy = strength * (aspectY === undefined ? 1 : aspectY);
    const c = makeCanvas(w, h);
    const d = c.img.data;
    for (let y = 0; y < h; y++) {
      const yu = mod(y - 1, h) * w, yc = y * w, yd = mod(y + 1, h) * w;
      for (let x = 0; x < w; x++) {
        const xl = mod(x - 1, w), xr = mod(x + 1, w);
        const gx = (height[yc + xr] - height[yc + xl]) * 0.5;
        const gy = (height[yd + x] - height[yu + x]) * 0.5; // d height / d row  (rows run DOWN)
        // n = (-dh/dx, -dh/dy_up, 1) and dy_up = -drow  =>  ny = +dh/drow
        putNormal(d, yc + x, -gx * strength, gy * sy, 1);
      }
    }
    c.ctx.putImageData(c.img, 0, 0);
    return c.canvas;
  }

  // 3x3 box blur with wrap (used lightly to anti-alias height fields)
  function blurWrap(src, w, h) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) {
          const row = mod(y + j, h) * w;
          for (let i = -1; i <= 1; i++) s += src[row + mod(x + i, w)];
        }
        out[y * w + x] = s / 9;
      }
    }
    return out;
  }

  // Jittered-grid weighted Voronoi feature points on a tileable n x n grid over a size x size canvas.
  function makeCells(n, size, seed, jitter, weightRange) {
    const rand = rng(seed), cell = size / n, count = n * n;
    const cells = { n, size, cell, x: new Float32Array(count), y: new Float32Array(count), w: new Float32Array(count), r: new Float32Array(count), r2: new Float32Array(count) };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        cells.x[k] = (i + 0.5 + (rand() - 0.5) * jitter) * cell;
        cells.y[k] = (j + 0.5 + (rand() - 0.5) * jitter) * cell;
        cells.w[k] = (rand() * 2 - 1) * weightRange;
        cells.r[k] = rand();
        cells.r2[k] = rand();
      }
    }
    return cells;
  }

  function finish(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  // ---------------------------------------------------------------- 1. metallic flakes
  function drawFlakeCanvas() {
    const S = 512, N = 168;                                 // ~3 px average cell
    const cells = makeCells(N, S, 1337, 0.7, 0.6);          // weight => cells range ~2..4 px
    const tiltX = new Float32Array(N * N), tiltY = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) {
      tiltX[k] = (cells.r[k] * 2 - 1) * 0.35;
      tiltY[k] = (cells.r2[k] * 2 - 1) * 0.35;
    }
    const c = makeCanvas(S, S), d = c.img.data, cs = cells.cell;
    for (let y = 0; y < S; y++) {
      const py = y + 0.5, gj = Math.floor(py / cs);
      for (let x = 0; x < S; x++) {
        const px = x + 0.5, gi = Math.floor(px / cs);
        let best = 1e9, bk = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = gj + dj, jw = Math.floor(jj / N) * S, jm = mod(jj, N);
          for (let di = -1; di <= 1; di++) {
            const ii = gi + di, iw = Math.floor(ii / N) * S, im = mod(ii, N);
            const k = jm * N + im;
            const ex = px - (cells.x[k] + iw), ey = py - (cells.y[k] + jw);
            const dist = Math.sqrt(ex * ex + ey * ey) - cells.w[k];
            if (dist < best) { best = dist; bk = k; }
          }
        }
        putNormal(d, y * S + x, tiltX[bk], tiltY[bk], 1);
      }
    }
    c.ctx.putImageData(c.img, 0, 0);
    return c.canvas;
  }

  // ---------------------------------------------------------------- 2. tyre tread / sidewall
  function drawTreadCanvas() {
    const W = 2048, H = 256;                // U (around) x V (across profile)
    const MM_U = 2170 / W, MM_V = 300 / H;  // ~1.06 mm / ~1.17 mm per pixel
    const REPEATS = 72, PITCH = 2170 / REPEATS;
    const K = 0.9, CURVE = 0.0065;          // chevron: phase = X + K|Y| - CURVE*Y^2 (flattens to lateral at shoulder)
    const RIBS = 512;                       // sidewall ribs per revolution (4 px period)
    const rand = rng(77);
    const TAU = Math.PI * 2;

    // per-column sidewall rib profiles (periodic in U, independent of V)
    const ribA = new Float32Array(W), ribB = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const amp = 0.7 + 0.3 * Math.sin(TAU * 37 * u + 1.3);
      ribA[x] = amp * Math.pow(0.5 + 0.5 * Math.sin(TAU * RIBS * u), 2.5);
      ribB[x] = amp * Math.pow(0.5 + 0.5 * Math.sin(TAU * RIBS * u + 1.9), 2.5);
    }

    const height = new Float32Array(W * H); // millimetres
    for (let r = 0; r < H; r++) {
      const v = 1 - (r + 0.5) / H;          // canvas row 0 = V 1 (flipY)
      const aY = Math.abs(v - 0.5) * 300;   // mm from tyre centre line
      const sv = v < 0.5 ? v : 1 - v;       // distance (in V) from nearest sidewall edge
      const ribs = v < 0.5 ? ribA : ribB;

      // tread: raised band with softly rounded shoulders
      const top = 1.4 * smoothstep(0.195, 0.222, v) * (1 - smoothstep(0.778, 0.805, v));
      // chevron geometry for this row
      const po = (K * aY - CURVE * aY * aY) / PITCH;
      const slope = K - 2 * CURVE * aY;
      const cosA = 1 / Math.sqrt(1 + slope * slope);
      const grooveMask = 1 - smoothstep(74, 80, aY);                 // lateral grooves stop short of the edge: solid outer rib
      const sipeMask = 1 - smoothstep(50, 57, aY);                   // sipes only in the central zone (shoulder blocks stay solid)
      const gw = 1.0 + 1.2 * smoothstep(35, 70, aY);                 // groove half width (flat bottom), wider at shoulder
      const EDGE = 2.2;

      // sidewall: fine radial ribbing + smooth rim-protector ridge
      const ribW = smoothstep(0.015, 0.04, sv) * (1 - smoothstep(0.125, 0.15, sv));
      const dr = (sv - 0.06) * 300 / 3.6;
      const ridge = 1.8 * Math.exp(-0.5 * dr * dr);

      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        let h = top;
        if (top > 0.01 && grooveMask + sipeMask > 0) {
          const t = u * REPEATS + po;                                // groove phase, periodic in U
          const fp = t - Math.floor(t);
          const dg = Math.min(fp, 1 - fp) * PITCH * cosA;            // perpendicular distance to groove centre (mm)
          const g = (1 - smoothstep(gw, gw + EDGE, dg)) * grooveMask;
          const ds = Math.min(Math.abs(fp - 1 / 3), Math.abs(fp - 2 / 3)) * PITCH * cosA;
          const s = (1 - smoothstep(0.4, 1.7, ds)) * sipeMask;
          h -= Math.max(1.0 * g, 0.35 * s) * (top / 1.4);
        }
        if (top > 0.01) h += (rand() - 0.5) * 0.08;                  // faint rubber micro-grain (white noise tiles trivially)
        h += ribs[x] * 0.1 * ribW + ridge;
        height[r * W + x] = h;
      }
    }
    // physically scaled: heights in mm, so gradient per mm = per-pixel gradient / mm-per-pixel
    return heightToNormal(height, W, H, 1 / MM_U, MM_U / MM_V);
  }

  // ---------------------------------------------------------------- 3. nappa leather pebble grain
  function drawLeatherCanvas() {
    const S = 512, N = 48;                                   // ~10.7 px average pebble
    const cells = makeCells(N, S, 4242, 0.9, 1);             // w in [-1,1] -> multiplicative size 0.7 .. 1.3 => ~6..14 px
    const cs = cells.cell, rand = rng(99);
    const scale = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) scale[k] = 1 + 0.3 * cells.w[k];
    const height = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      const py = y + 0.5, gj = Math.floor(py / cs);
      for (let x = 0; x < S; x++) {
        const px = x + 0.5, gi = Math.floor(px / cs);
        let d1 = 1e9, d2 = 1e9, k1 = 0;
        for (let dj = -2; dj <= 2; dj++) {
          const jj = gj + dj, jw = Math.floor(jj / N) * S, jm = mod(jj, N);
          for (let di = -2; di <= 2; di++) {
            const ii = gi + di, iw = Math.floor(ii / N) * S, im = mod(ii, N);
            const k = jm * N + im;
            const ex = px - (cells.x[k] + iw), ey = py - (cells.y[k] + jw);
            const dist = Math.sqrt(ex * ex + ey * ey) / scale[k];   // multiplicative weighting: round (Apollonian) borders
            if (dist < d1) { d2 = d1; d1 = dist; k1 = k; }
            else if (dist < d2) d2 = dist;
          }
        }
        const q = d1 / Math.max(d2, 1e-3);                   // 0 at pebble centre -> 1 on the crease between pebbles
        const dome = Math.pow(Math.max(0, 1 - q * q), 0.8);  // round pillow, falls into a fine crease
        height[y * S + x] = 3.0 * (0.8 + 0.2 * cells.r[k1]) * dome + (rand() - 0.5) * 0.08;
      }
    }
    return heightToNormal(blurWrap(blurWrap(height, S, S), S, S), S, S, 1.0); // two light blurs round the pebbles off
  }

  // ---------------------------------------------------------------- 4. carbon weave (aligned with colour tex)
  function drawCarbonCanvas() {
    const S = 128, T = 16, AMP = 3.0;
    const height = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const tx = Math.floor(x / T), ty = Math.floor(y / T);
        const horizontal = (((tx + ty) >> 1) & 1) === 0;     // same rule as the colour texture
        const px = x % T, py = y % T;
        const across = horizontal ? py : px;                 // horizontal tow runs along X => bulges across Y
        let h = Math.sin(Math.PI * (across + 0.5) / T);
        const dEdge = Math.min(px + 0.5, T - px - 0.5, py + 0.5, T - py - 0.5);
        h *= 1 - 0.3 * Math.exp(-(dEdge * dEdge) / 2.25);    // slight dip at tile borders
        height[y * S + x] = AMP * h;
      }
    }
    return heightToNormal(height, S, S, 1.0);
  }

  return {
    flakeNormal: finish(drawFlakeCanvas()),
    treadNormal: finish(drawTreadCanvas()),
    leatherNormal: finish(drawLeatherCanvas()),
    carbonNormal: finish(drawCarbonCanvas()),
  };
}

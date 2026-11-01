function makeCarTextures(THREE, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function mkTex(canvas, repeat) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
    }
    return t;
  }

  // ---------- 1. Quilted leather ----------
  function buildQuilt() {
    const S = 256, N = 4; // 4 diamonds across -> seamless tile
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, S, S);
    const step = S / N;
    // diamond centres on a lattice, offset lattice too for seamlessness
    for (let j = -1; j <= N; j++) {
      for (let i = -1; i <= N; i++) {
        for (let o = 0; o < 2; o++) {
          const cx = (i + 0.5 * o) * step + step / 2 * o;
          const cy = (j + 0.5 * o) * step + step / 2 * o;
          const hw = step / 2, hh = step / 2;
          const grad = g.createRadialGradient(cx - 4, cy - 5, 2, cx, cy, hw * 1.05);
          grad.addColorStop(0, '#b4b4b4');
          grad.addColorStop(0.6, '#9c9c9c');
          grad.addColorStop(1, '#6e6e6e');
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(cx, cy - hh);
          g.lineTo(cx + hw, cy);
          g.lineTo(cx, cy + hh);
          g.lineTo(cx - hw, cy);
          g.closePath();
          g.fill();
        }
      }
    }
    // stitch lines along diamond edges (diagonals)
    g.strokeStyle = '#c8c8c8';
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    for (let k = -N; k <= 2 * N; k++) {
      const off = k * step;
      g.beginPath(); g.moveTo(off, 0); g.lineTo(off + S, S); g.stroke();
      g.beginPath(); g.moveTo(off, S); g.lineTo(off + S, 0); g.stroke();
    }
    g.setLineDash([]);
    // dark seam shadows beside stitches
    g.strokeStyle = 'rgba(40,40,40,0.25)';
    g.lineWidth = 2.5;
    for (let k = -N; k <= 2 * N; k++) {
      const off = k * step + 2;
      g.beginPath(); g.moveTo(off, 0); g.lineTo(off + S, S); g.stroke();
      g.beginPath(); g.moveTo(off, S); g.lineTo(off + S, 0); g.stroke();
    }
    return mkTex(c, 3);
  }

  // ---------- 2. Carbon twill ----------
  function buildCarbon() {
    const S = 128, T = 16; // 8x8 tiles, 2x2 twill
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#0c0d0f';
    g.fillRect(0, 0, S, S);
    const n = S / T;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const horizontal = (((x + y) >> 1) & 1) === 0;
        const x0 = x * T, y0 = y * T;
        const gr = horizontal
          ? g.createLinearGradient(x0, y0, x0, y0 + T)
          : g.createLinearGradient(x0, y0, x0 + T, y0);
        gr.addColorStop(0, '#0c0d0f');
        gr.addColorStop(0.5, '#2a2c30');
        gr.addColorStop(1, '#0e0f11');
        g.fillStyle = gr;
        g.fillRect(x0, y0, T, T);
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 1;
        g.strokeRect(x0 + 0.5, y0 + 0.5, T - 1, T - 1);
      }
    }
    return mkTex(c, 10);
  }

  // ---------- 3. Instrument cluster ----------
  const CW = 768, CH = 272;
  const clusterCanvas = mkCanvas(CW, CH);
  const clusterTex = mkTex(clusterCanvas, 0);
  const MONO = "'IBM Plex Mono', ui-monospace, monospace";
  const deg = Math.PI / 180;

  function drawCluster(kmh) {
    kmh = Math.max(0, kmh || 0);
    const g = clusterCanvas.getContext('2d');
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = '#050608';
    g.fillRect(0, 0, CW, CH);
    const vg = g.createRadialGradient(CW / 2, CH / 2, 60, CW / 2, CH / 2, CW * 0.62);
    vg.addColorStop(0, 'rgba(30,36,44,0.35)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = vg;
    g.fillRect(0, 0, CW, CH);

    const gearNum = kmh === 0 ? 0 : Math.min(7, 1 + Math.floor(kmh / 42));
    let rpm = 850;
    if (kmh !== 0) rpm = Math.min(7000, 1800 + ((kmh % 42) / 42) * 4800);
    const inRed = rpm >= 6250;

    // RPM gauge
    const cx = 150, cy = 140, R = 108;
    const a0 = 135 * deg, sweep = 270 * deg;
    const aAt = (v) => a0 + sweep * (v / 7000);
    g.lineCap = 'butt';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.arc(cx, cy, R, a0, a0 + sweep); g.stroke();
    g.strokeStyle = 'rgba(255,50,50,0.35)';
    g.beginPath(); g.arc(cx, cy, R, aAt(6250), aAt(7000)); g.stroke();
    // progress
    g.lineWidth = 12;
    g.strokeStyle = inRed ? '#ff3b3b' : '#bff4ff';
    g.shadowColor = inRed ? '#ff3b3b' : '#3ad8ff';
    g.shadowBlur = 12;
    g.beginPath(); g.arc(cx, cy, R, a0, aAt(rpm)); g.stroke();
    g.shadowBlur = 0;
    // ticks + labels
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "600 16px " + MONO;
    for (let i = 0; i <= 7; i++) {
      const a = aAt(i * 1000);
      const red = i * 1000 >= 6250;
      g.strokeStyle = red ? '#ff4d4d' : '#e8eef2';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10));
      g.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      g.stroke();
      g.fillStyle = red ? '#ff6a6a' : '#dfe6ea';
      g.fillText(String(i), cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
      if (i < 7) {
        const am = aAt(i * 1000 + 500);
        g.strokeStyle = 'rgba(232,238,242,0.5)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(am) * (R - 10), cy + Math.sin(am) * (R - 10));
        g.lineTo(cx + Math.cos(am) * (R - 17), cy + Math.sin(am) * (R - 17));
        g.stroke();
      }
    }
    g.fillStyle = '#7f8a92';
    g.font = "600 13px " + MONO;
    g.fillText('x1000 rpm', cx, cy + 62);
    g.fillStyle = inRed ? '#ff6a6a' : '#cfd8dc';
    g.font = "600 22px " + MONO;
    g.fillText(String(Math.round(rpm / 10) * 10), cx, cy + 22);

    // Speed (centre)
    const mx = 440;
    g.fillStyle = '#ffffff';
    g.font = "600 92px " + MONO;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(120,220,255,0.55)';
    g.shadowBlur = 14;
    g.fillText(String(Math.round(kmh)), mx, 160);
    g.shadowBlur = 0;
    g.fillStyle = '#8fa0aa';
    g.font = "600 22px " + MONO;
    g.fillText('km/h', mx, 190);
    // gear
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(mx - 28, 206, 56, 44);
    g.fillStyle = '#3ad8ff';
    g.font = "600 34px " + MONO;
    g.textBaseline = 'middle';
    g.fillText(gearNum === 0 ? 'N' : String(gearNum), mx, 229);

    // Right column
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const rx = 590;
    g.fillStyle = '#ff9f1c';
    g.font = "600 24px " + MONO;
    g.fillText('SPORT+', rx, 100);
    g.fillStyle = '#d6dde1';
    g.font = "600 20px " + MONO;
    g.fillText('OIL 92°C', rx, 142);
    g.fillText('RANGE', rx, 184);
    g.fillStyle = '#8fa0aa';
    g.fillText('412 km', rx, 210);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(rx - 18, 70); g.lineTo(rx - 18, 230); g.stroke();

    clusterTex.needsUpdate = true;
  }
  drawCluster(0);

  // ---------- 4. Navigation screen ----------
  function buildNav() {
    const W = 512, H = 288;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#12171f';
    g.fillRect(0, 0, W, H);

    // minor streets: two skewed grids
    g.strokeStyle = '#2a323d';
    g.lineWidth = 1.5;
    for (let i = -10; i < 28; i++) {
      const x = i * 30;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 40, H); g.stroke();
    }
    for (let j = -2; j < 12; j++) {
      const y = j * 28;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 22); g.stroke();
    }
    // arterials
    g.strokeStyle = '#46505e';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(-10, 90); g.lineTo(200, 120); g.lineTo(522, 80); g.stroke();
    g.beginPath(); g.moveTo(330, -10); g.lineTo(300, 160); g.lineTo(340, 300); g.stroke();
    g.beginPath(); g.moveTo(-10, 230); g.lineTo(522, 200); g.stroke();

    // route
    const route = [[256, 250], [256, 205], [300, 160], [300, 118], [345, 82], [430, 70]];
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,229,255,0.25)';
    g.lineWidth = 14;
    g.beginPath(); route.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
    g.strokeStyle = '#19e3ff';
    g.lineWidth = 7;
    g.beginPath(); route.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();

    // position arrow
    g.save();
    g.translate(256, 244);
    g.beginPath();
    g.moveTo(0, -20); g.lineTo(14, 14); g.lineTo(0, 7); g.lineTo(-14, 14); g.closePath();
    g.fillStyle = '#19e3ff';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.restore();

    // top bar
    g.fillStyle = 'rgba(10,14,20,0.94)';
    g.fillRect(0, 0, W, 52);
    g.fillStyle = '#19e3ff';
    g.fillRect(0, 51, W, 2);
    // turn arrow glyph (right turn)
    g.save();
    g.translate(30, 26);
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineWidth = 6;
    g.lineCap = 'butt';
    g.beginPath(); g.moveTo(-8, 18); g.lineTo(-8, -2); g.lineTo(8, -2); g.stroke();
    g.beginPath(); g.moveTo(6, -14); g.lineTo(20, -2); g.lineTo(6, 10); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.font = "600 24px 'IBM Plex Sans Thai', Tahoma, sans-serif";
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('ถ.สุขุมวิท · 2.4 กม.', 64, 28);

    // ETA chip
    const cw = 150, ch = 34, cx = W - cw - 12, cy = H - ch - 12;
    g.fillStyle = 'rgba(10,14,20,0.92)';
    g.beginPath(); g.roundRect(cx, cy, cw, ch, 17); g.fill();
    g.strokeStyle = '#19e3ff';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = "600 20px 'IBM Plex Sans Thai', Tahoma, sans-serif";
    g.textAlign = 'center';
    g.fillText('ถึง 14:32', cx + cw / 2, cy + ch / 2 + 1);

    return mkTex(c, 0);
  }

  // ---------- 5. Tyre sidewall decal ----------
  function tyreDecalTex(text) {
    const S = 1024, R = 460;
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(150,150,150,0.85)';
    g.font = "700 38px 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const chars = Array.from(text);
    const spacing = 2;
    const widths = chars.map((ch) => g.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0);
    for (let rep = 0; rep < 2; rep++) {
      // centre of this repetition: top of circle (-90deg) then +180deg
      const centre = -Math.PI / 2 + rep * Math.PI;
      let a = centre - (total / R) / 2;
      chars.forEach((ch, i) => {
        const half = widths[i] / R / 2;
        a += half;
        g.save();
        g.translate(S / 2, S / 2);
        g.rotate(a + Math.PI / 2); // up-vector points outward from centre
        g.fillText(ch, 0, -R);
        g.restore();
        a += half;
      });
    }
    return mkTex(c, 0);
  }

  const quiltTex = buildQuilt();
  const carbonTex = buildCarbon();
  const navTex = buildNav();

  return { quiltTex, carbonTex, clusterTex, drawCluster, navTex, tyreDecalTex };
}

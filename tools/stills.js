const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const OUT = path.join(__dirname, '..', 'stills');
const SHOTS = [
  { name: '1-front-34', p: [5.7, .78, 4.15], t: [.15, .5, 0], fov: 28, lights: true },
  { name: '2-side', p: [0, .72, 8.3], t: [0, .55, 0], fov: 30, lights: false },
  { name: '3-rear-34', p: [-5.4, .58, -3.7], t: [-.3, .5, 0], fov: 28, lights: true },
  { name: '4-front', p: [6.7, .56, 0], t: [0, .52, 0], fov: 26, lights: true },
  { name: '5-aerial', p: [4.9, 5.3, 4.7], t: [0, .3, 0], fov: 30, lights: false },
  { name: '6-open', p: [4.7, 2.05, 3.9], t: [.4, .6, 0], fov: 32, lights: false, open: true },
];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.route('**/*', r => { const u = r.request().url();
    const m = u.match(/three@0\.160\.0\/(.*)$/); if (m) return r.fulfill({ path: path.join(__dirname, 'node_modules/three', m[1]), contentType: 'application/javascript' });
    const mm = u.match(/mp4-muxer@5\.2\.2\/(.*)$/); if (mm) return r.fulfill({ path: path.join(__dirname, 'node_modules/mp4-muxer', mm[1]), contentType: 'application/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:')) return r.continue(); return r.abort(); });
  await p.goto('file://' + path.join(__dirname, 'stills.html') + '#capture');
  await p.waitForFunction(() => window.__still, null, { timeout: 60000 });
  for (const s of SHOTS) {
    const t0 = Date.now();
    const b64 = await p.evaluate(s => {
      const d = window.__still, c = d.camera;
      d.controls.autoRotate = false; d.quality.high = true; d.gtao.enabled = true; d.applyFloorMode();
      if (!!d.toggles['t-lights'] !== s.lights) document.getElementById('t-lights').click();
      for (const k in d.PANELS) { const o = k === 'hood' || k.startsWith('door') ? !!s.open : false; d.setPanel(k, o); d.PANELS[k].t = o ? 1 : 0; }
      c.position.set(...s.p); d.controls.target.set(...s.t); c.fov = s.fov; c.aspect = 16 / 9; c.updateProjectionMatrix();
      for (let i = 0; i < 3; i++) d.simulate(1 / 30);
      c.fov = s.fov; c.updateProjectionMatrix();
      d.composer.render(1 / 30);
      const gl = d.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, buf = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
      const img = g.createImageData(W, H), row = W * 4;
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      g.putImageData(img, 0, 0);
      return cv.toDataURL('image/jpeg', .94).split(',')[1];
    }, s);
    fs.writeFileSync(path.join(OUT, `AMG-GT-${s.name}.jpg`), Buffer.from(b64, 'base64'));
    console.log('saved', s.name, Math.round((Date.now() - t0) / 1000) + 's');
  }
  await b.close();
})();

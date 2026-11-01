// injects a NaN-emitting quad, renders with and without the guard
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  const NM = path.join(__dirname, 'node_modules');
  await p.route('**/*', r => { const u = r.request().url();
    const m = u.match(/three@0\.160\.0\/(.*)$/); if (m) return r.fulfill({ path: path.join(NM, 'three', m[1]), contentType: 'application/javascript' });
    const mm = u.match(/mp4-muxer@5\.2\.2\/(.*)$/); if (mm) return r.fulfill({ path: path.join(NM, 'mp4-muxer', mm[1]), contentType: 'application/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:')) return r.continue(); return r.abort(); });
  await p.goto('file://' + path.join(__dirname, '..', 'z33-studio.html') + '#capture');
  await p.waitForFunction(() => window.__cine && window.__dbg && window.__nanGuard, null, { timeout: 90000 });
  for (const v of ['guard', 'noguard']) {
    const b64 = await p.evaluate(v => {
      const d = window.__dbg, T = d.THREE;
      if (!window.__nanq) {
        const m = new T.ShaderMaterial({ uniforms: { z: { value: 0 } }, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: 'uniform float z; void main(){ float n = z / z; gl_FragColor = vec4(n, n, n, 1.0); }' });
        const q = new T.Mesh(new T.PlaneGeometry(.06, .06), m); q.position.set(2.3, .7, .3); q.rotation.y = Math.PI / 2; d.car.add(q); window.__nanq = q;
      }
      window.__nanGuard.enabled = v === 'guard';
      return window.__cine.shot({ p: [5.7, .9, 4.2], t: [.15, .5, 0], fov: 28 });
    }, v);
    fs.writeFileSync(path.join(__dirname, '..', 'checks', 'nan_' + v + '.jpg'), Buffer.from(b64, 'base64'));
    console.log('saved', v);
  }
  await b.close();
})();

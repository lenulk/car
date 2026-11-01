// usage: node roadster_cine.js <page.html> <outDir> <W> <H> t1,t2,...   grabs cinematic frames (with overlays) at the given times
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const [page, outDir, W, H, times] = process.argv.slice(2);
const T = times.split(',').map(Number).sort((a, b) => a - b), dt = 1 / 30;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) console.log('console:', m.text()); });
  const NM = path.join(__dirname, 'node_modules');
  await p.route('**/*', r => { const u = r.request().url();
    const m = u.match(/three@0\.160\.0\/(.*)$/); if (m) return r.fulfill({ path: path.join(NM, 'three', m[1]), contentType: 'application/javascript' });
    const mm = u.match(/mp4-muxer@5\.2\.2\/(.*)$/); if (mm) return r.fulfill({ path: path.join(NM, 'mp4-muxer', mm[1]), contentType: 'application/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:')) return r.continue(); return r.abort(); });
  await p.goto('file://' + path.resolve(page) + '#capture');
  await p.waitForFunction(() => window.__cine && window.__cine.begin, null, { timeout: 90000 });
  await p.evaluate(() => window.__cine.begin());
  let t = 0;
  for (const tt of T) {
    const n = Math.max(0, Math.round((tt - t) / dt) - 1);
    await p.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__cine.step(dt, true); }, [n, dt]);
    const r = await p.evaluate(dt => window.__cine.stepAndGrab(dt), dt);
    t = r.t;
    const f = path.join(outDir, `cine-${tt.toFixed(2)}.jpg`);
    fs.writeFileSync(f, Buffer.from(r.jpg.split(',')[1], 'base64'));
    console.log('saved', f, 't=' + r.t.toFixed(2));
  }
  await b.close();
})();

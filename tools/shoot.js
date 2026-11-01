// Usage: node shoot.js <page.html> <outDir> <prefix> [W=960] [H=540] [shots.json]
// Renders still frames of a studio page in headless Chromium (software GL; ~5-20 s per frame).
// The page must expose window.__cine.shot(o) under #capture (base-studio.html does).
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const [page, outDir, prefix, W = 960, H = 540, shotsFile] = process.argv.slice(2);
const DEFAULT = [
  { name: 'front34', p: [5.7, .9, 4.2], t: [.15, .5, 0], fov: 28, lights: true },
  { name: 'side', p: [0, .72, 8.3], t: [0, .55, 0], fov: 30 },
  { name: 'rear34', p: [-5.4, .75, -3.7], t: [-.3, .5, 0], fov: 28, lights: true },
  { name: 'front', p: [6.4, .62, 0], t: [0, .5, 0], fov: 27 },
  { name: 'aerial', p: [3.6, 5.6, 5.4], t: [0, .3, 0], fov: 30 },
  { name: 'open', p: [4.7, 2.05, 3.9], t: [.4, .6, 0], fov: 32, open: ['doorL', 'doorR', 'hood'] },
];
const SHOTS = shotsFile ? (0, eval)('(' + fs.readFileSync(shotsFile, 'utf8') + ')') : DEFAULT;
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
  await p.waitForFunction(() => window.__cine && window.__cine.shot, null, { timeout: 90000 });
  for (const s of SHOTS) {
    const t0 = Date.now();
    const b64 = await p.evaluate(s => window.__cine.shot(s), s);
    const f = path.join(outDir, `${prefix}-${s.name}.jpg`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    console.log('saved', f, Math.round((Date.now() - t0) / 1000) + 's');
  }
  await b.close();
})();

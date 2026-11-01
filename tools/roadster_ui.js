// UI smoke test: clicks every control on the live page and reports page errors
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) console.log('console:', m.text()); });
  const NM = path.join(__dirname, 'node_modules');
  await p.route('**/*', r => { const u = r.request().url();
    const m = u.match(/three@0\.160\.0\/(.*)$/); if (m) return r.fulfill({ path: path.join(NM, 'three', m[1]), contentType: 'application/javascript' });
    const mm = u.match(/mp4-muxer@5\.2\.2\/(.*)$/); if (mm) return r.fulfill({ path: path.join(NM, 'mp4-muxer', mm[1]), contentType: 'application/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:')) return r.continue(); return r.abort(); });
  await p.goto('file://' + path.resolve(process.argv[2]), { waitUntil: 'commit', timeout: 120000 });
  await p.waitForSelector('#msg', { state: 'detached', timeout: 120000 });
  const ids = ['paint-1', 'paint-6', 'paint-0', 'int-1', 'int-2', 'int-0', 'p-doors', 'p-hood', 'p-hatch', 'p-roof', 't-xray', 't-xray', 't-lights', 't-drive', 't-drive', 't-quality', 't-quality',
    'v-34', 'v-front', 'v-side', 'v-rear', 'v-top', 'v-wheel', 'v-cabin', 'v-driver', 'v-engine', 'p-roof', 't-cine', 'cineStop', 'railToggle', 'railToggle'];
  for (const id of ids) { const ok = await p.evaluate(id => { const e = document.getElementById(id); if (!e) return false; e.click(); return true; }, id); if (!ok) console.log('missing', id); await p.waitForTimeout(400); }
  const st = await p.evaluate(() => ({ title: document.title, h1: document.querySelector('h1').textContent, label: document.getElementById('paintLabel').textContent,
    roof: document.getElementById('p-roof').getAttribute('aria-pressed'), paint: document.getElementById('paintLabel').textContent, int: document.getElementById('intLabel').textContent, cine: document.body.className, hood: document.getElementById('p-hood').textContent }));
  console.log(JSON.stringify(st));
  await b.close();
})();

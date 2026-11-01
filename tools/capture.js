#!/usr/bin/env node
/*
 * Deterministic frame capture for the cinematic car-reveal page.
 *
 *   node capture.js --fps 30 --width 1280 --height 720 --out frames_dir --page <html>
 *
 * Options (all optional):
 *   --fps N        frames per second                      (30)
 *   --width N      viewport width                         (1280)
 *   --height N     viewport height                        (720)
 *   --out DIR      output directory, files f_00000.jpg .. (./frames next to this script)
 *   --page FILE    html page to open as file://FILE#capture
 *                  (/tmp/claude-0/-home-user/d62dadb4-9074-5513-a1f3-e5c5bc7a6f8d/scratchpad/amg-gt-studio.html)
 *   --start N      resume at frame N: frames 0..N-1 are only stepped (no screenshot) so the
 *                  simulation state matches, frames N.. are (re)written
 *   --end N        stop before frame N (exclusive) -> render only a slice / smoke test
 *   --resume       auto --start = last existing frame in OUT (that one is re-rendered)
 *   --quality N    jpeg quality                           (92)
 *   --grab         use window.__cine.stepAndGrab(dt, q) (page renders + reads pixels itself and returns a
 *                  JPEG data-URL with the overlays composited) instead of step() + page.screenshot().
 *                  Much faster on software GL; falls back to screenshot if the page has no stepAndGrab.
 *   --full-skip    on resume, render the skipped frames too (default: step(dt, true) = simulate only,
 *                  pages that ignore the 2nd arg render anyway)
 *   --verbose      echo every console.log from the page, not only warnings/errors
 *
 * The page must expose window.__cine = { duration, begin(), step(dt) } (see task description).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const SCRATCH = '/tmp/claude-0/-home-user/d62dadb4-9074-5513-a1f3-e5c5bc7a6f8d/scratchpad';
const THREE_ROOT = path.join(SCRATCH, 't/node_modules/three');
const THREE_MARK = 'three@0.160.0/';

function parseArgs(argv) {
  const o = {
    fps: 30, width: 1280, height: 720,
    out: path.join(__dirname, 'frames'),
    page: path.join(SCRATCH, 'amg-gt-studio.html'),
    start: 0, end: null, resume: false, quality: 92, verbose: false, grab: false, fullSkip: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error('missing value for ' + a);
      return argv[++i];
    };
    switch (a) {
      case '--fps': o.fps = Number(val()); break;
      case '--width': o.width = parseInt(val(), 10); break;
      case '--height': o.height = parseInt(val(), 10); break;
      case '--out': o.out = path.resolve(val()); break;
      case '--page': o.page = path.resolve(val()); break;
      case '--start': o.start = parseInt(val(), 10); break;
      case '--end': o.end = parseInt(val(), 10); break;
      case '--quality': o.quality = parseInt(val(), 10); break;
      case '--resume': o.resume = true; break;
      case '--verbose': o.verbose = true; break;
      case '--grab': o.grab = true; break;
      case '--full-skip': o.fullSkip = true; break;
      case '-h': case '--help':
        console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
        process.exit(0);
      default: throw new Error('unknown argument ' + a);
    }
  }
  if (!(o.fps > 0) || !(o.width > 0) || !(o.height > 0)) throw new Error('bad fps/width/height');
  return o;
}

const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h, m, r].map((v) => String(v).padStart(2, '0')).join(':');
};
const frameName = (i) => 'f_' + String(i).padStart(5, '0') + '.jpg';

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(o.page)) throw new Error('page not found: ' + o.page);
  fs.mkdirSync(o.out, { recursive: true });
  const progressFile = path.join(o.out, 'progress.txt');
  const writeProgress = (s) => { try { fs.writeFileSync(progressFile, s + '\n'); } catch (e) { /* ignore */ } };

  if (o.resume) {
    let n = 0;
    while (fs.existsSync(path.join(o.out, frameName(n)))) n++;
    o.start = Math.max(0, n - 1);   // re-render the last file: it may be truncated by a kill
    console.log(`[resume] ${n} frames present, restarting at frame ${o.start}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let aborting = false;
  const shutdown = async (code) => {
    if (aborting) return;
    aborting = true;
    try { await browser.close(); } catch (e) { /* ignore */ }
    process.exit(code);
  };
  process.on('SIGINT', () => { console.log('\n[signal] SIGINT, closing browser (resume with --resume)'); shutdown(130); });
  process.on('SIGTERM', () => shutdown(143));

  try {
    const ctx = await browser.newContext({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    const seenAbort = new Set();
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const i = url.indexOf(THREE_MARK);
      if (i >= 0) {
        let rel = url.slice(i + THREE_MARK.length).split(/[?#]/)[0];
        try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw */ }
        const local = path.resolve(THREE_ROOT, rel);
        if (!local.startsWith(THREE_ROOT + path.sep) || !fs.existsSync(local) || !fs.statSync(local).isFile()) {
          console.error('[route] three file not found locally: ' + rel);
          return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: fs.readFileSync(local),
        });
      }
      if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
        return route.continue();
      }
      if (!seenAbort.has(url)) {
        seenAbort.add(url);
        console.log('[route] aborted external request: ' + url.slice(0, 160));
      }
      return route.abort();
    });

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error' || t === 'warning' || o.verbose) console.log(`[console.${t}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => console.error('[pageerror] ' + (err && err.stack ? err.stack : err)));

    const url = pathToFileURL(o.page).href + '#capture';
    console.log(`[open] ${url}  ${o.width}x${o.height} @ ${o.fps} fps -> ${o.out}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForFunction(() => typeof window.__cine !== 'undefined' && window.__cine !== null,
        null, { timeout: 60000, polling: 250 });
    } catch (e) {
      throw new Error('window.__cine did not appear within 60 s (page hook missing or script error above)');
    }

    await page.evaluate(() => window.__cine.begin());
    const duration = await page.evaluate(() => window.__cine.duration);
    if (!(duration > 0)) throw new Error('window.__cine.duration invalid: ' + duration);
    const total = Math.round(duration * o.fps);
    const end = Math.min(total, o.end == null ? total : o.end);
    const dt = 1 / o.fps;
    console.log(`[cine] duration ${duration} s -> ${total} frames; rendering ${o.start}..${end - 1}`);

    const hasGrab = await page.evaluate(() => typeof window.__cine.stepAndGrab === 'function');
    const useGrab = o.grab && hasGrab;
    if (o.grab && !hasGrab) console.log('[grab] page has no __cine.stepAndGrab, using page.screenshot');
    console.log(`[mode] ${useGrab ? 'stepAndGrab (in-page readback)' : 'step + page.screenshot'}`);

    const t0 = Date.now();
    let tShots = Date.now();   // timer for the screenshot phase (after silent warm-up steps)
    let shots = 0;
    const toShoot = Math.max(0, end - o.start);

    for (let i = 0; i < end; i++) {
      const tS = Date.now();
      if (i < o.start) {
        // skipped frame: advance the simulation only (2nd arg = skipRender; ignored by pages that don't know it)
        await page.evaluate(([d, sk]) => window.__cine.step(d, sk), [dt, !o.fullSkip]);
        if (i < 3) console.log(`[timing] frame ${i} step ${Date.now() - tS} ms (skipped, no screenshot)`);
        continue;
      }
      if (i === o.start) tShots = Date.now();
      let msStep = 0;
      const tP = Date.now();
      if (useGrab) {
        const r = await page.evaluate(([d, q]) => window.__cine.stepAndGrab(d, q), [dt, o.quality / 100]);
        msStep = Date.now() - tS;
        fs.writeFileSync(path.join(o.out, frameName(i)), Buffer.from(String(r.jpg).split(',')[1], 'base64'));
      } else {
        await page.evaluate((d) => window.__cine.step(d), dt);
        msStep = Date.now() - tS;
        await page.screenshot({
          type: 'jpeg', quality: o.quality,
          path: path.join(o.out, frameName(i)),
        });
      }
      shots++;
      if (shots <= 3 || shots % 30 === 1 && shots < 100) {
        console.log(`[timing] frame ${i} step ${msStep} ms, total ${Date.now() - tP} ms`);
      }
      if (shots % 30 === 0 || i === end - 1) {
        const el = (Date.now() - tShots) / 1000;
        const per = el / shots;
        const eta = per * (toShoot - shots);
        const line = `frame ${i + 1}/${total}  (${shots}/${toShoot} this run)  elapsed ${fmt((Date.now() - t0) / 1000)}  ` +
          `${per.toFixed(2)} s/frame  ETA ${fmt(eta)}`;
        console.log(line);
        writeProgress(line);
      }
    }
    const done = `DONE ${shots} frames (${o.start}..${end - 1}) of ${total} in ${fmt((Date.now() - t0) / 1000)} -> ${o.out}`;
    console.log(done);
    writeProgress(done);
    await shutdown(0);
  } catch (err) {
    console.error('[fatal] ' + (err && err.stack ? err.stack : err));
    writeProgress('FAILED ' + (err && err.message ? err.message : err));
    await shutdown(1);
  }
}

main().catch((e) => { console.error('[fatal] ' + (e && e.stack ? e.stack : e)); process.exit(1); });

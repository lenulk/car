/* ---------- MP4 export: the cinematic rendered frame by frame on the viewer's GPU ---------- */
let exporting = false, exportBlob = null, exportAbort = null;
// a viewer hands files over through the `downloads` capability; a top-level copy (no viewer) can use a plain link
const downloadsReady = window.claude && window.claude.use ? window.claude.use('downloads') : Promise.resolve(undefined);
const exEl = {
  dlg: document.getElementById('exportDlg'), bar: document.getElementById('exBar'), pct: document.getElementById('exPct'),
  phase: document.getElementById('exPhase'), cancel: document.getElementById('exCancel'), save: document.getElementById('exSave'),
  close: document.getElementById('exClose'), btn: document.getElementById('t-export'),
};
const EXPORT_NAME = 'AMG-GT-Studio-1080p60.mp4';
(() => {
  const sup = videoExportSupport();
  if (!sup.ok) { exEl.btn.disabled = true; exEl.btn.title = sup.reason; }
  downloadsReady.then(dl => { if (dl === null) { exEl.btn.disabled = true; exEl.btn.title = 'มุมมองนี้บันทึกไฟล์ไม่ได้'; } });
})();
function exShow(state) {
  exEl.dlg.hidden = false;
  exEl.cancel.hidden = state !== 'running';
  exEl.save.hidden = state !== 'ready';
  exEl.close.hidden = state === 'running';
}
function exProgress(p, t0) {
  const f = Math.max(0, Math.min(1, p.fraction || 0));
  exEl.bar.style.width = (f * 100).toFixed(1) + '%';
  exEl.pct.textContent = Math.floor(f * 100) + '%';
  if (p.phase === 'video') {
    const el = (performance.now() - t0) / 1000, eta = p.done > 10 ? el / p.done * (p.total - p.done) : 0;
    exEl.phase.textContent = `เรนเดอร์เฟรม ${p.done.toLocaleString()} / ${p.total.toLocaleString()}` + (eta > 1 ? ` · เหลือราว ${Math.ceil(eta)} วินาที` : '');
  } else if (p.phase === 'audio') exEl.phase.textContent = p.skipped ? p.reason || 'สร้างวิดีโอแบบไม่มีเสียง' : 'กำลังเข้ารหัสเสียง…';
  else if (p.phase === 'finish') exEl.phase.textContent = 'กำลังรวมไฟล์ MP4…';
  else exEl.phase.textContent = 'กำลังเตรียม…';
}
async function exSave() {
  if (!exportBlob) return;
  const dl = await downloadsReady;
  const mb = (exportBlob.size / 1048576).toFixed(1);
  if (dl === undefined) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(exportBlob); a.download = EXPORT_NAME; a.click();
    exEl.phase.textContent = `บันทึก ${EXPORT_NAME} (${mb} MB) แล้ว`; return;
  }
  if (!dl) { exEl.phase.textContent = 'มุมมองนี้บันทึกไฟล์ไม่ได้ ลองเปิด artifact ใน claude.ai'; return; }
  try {
    await dl.save({ filename: EXPORT_NAME, data: exportBlob });
    exEl.phase.textContent = `บันทึก ${EXPORT_NAME} (${mb} MB) แล้ว`;
    exShow('done');
  } catch (e) {
    const code = e && e.code;
    exEl.phase.textContent = code === 'declined' ? 'ยังไม่ได้บันทึก กด "บันทึกไฟล์" เพื่อลองอีกครั้ง'
      : code === 'rate_limited' ? 'มีหน้าต่างบันทึกเปิดอยู่ รอสักครู่แล้วกด "บันทึกไฟล์" อีกครั้ง'
      : code === 'too_large' ? 'ไฟล์ใหญ่เกินกว่าที่ปลายทางรับได้'
      : 'บันทึกไฟล์ไม่สำเร็จในมุมมองนี้';
    exShow('ready');
  }
}
async function runExport() {
  const sup = videoExportSupport();
  if (!sup.ok) { exShow('done'); exEl.phase.textContent = sup.reason; return; }
  const W = 1920, H = 1080, FPS = 60, N = Math.round(cine.duration * FPS);
  if (cine.active) cineEnd();
  exporting = true; exportBlob = null; exportAbort = new AbortController();
  exEl.bar.style.width = '0%'; exEl.pct.textContent = '0%'; exEl.phase.textContent = 'กำลังเตรียม…'; exShow('running');
  const wasHigh = quality.high;
  quality.high = true; gtao.enabled = true; applyFloorMode();
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  composer.setPixelRatio(1); composer.setSize(W, H);
  try { await document.fonts.ready; } catch (e) {}
  const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
  const g = comp.getContext('2d');
  cineBegin(true);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  const t0 = performance.now();
  try {
    exportBlob = await exportMp4({
      width: W, height: H, fps: FPS, frameCount: N, signal: exportAbort.signal,
      audioBase64: CINE_AUDIO.split(',')[1] || null,
      renderFrame: () => {
        simulate(1 / FPS); camera.aspect = W / H; camera.updateProjectionMatrix();
        composer.render(1 / FPS);
        g.drawImage(renderer.domElement, 0, 0, W, H);
        drawCineOverlays(g, W, H);
        return comp;
      },
      onProgress: p => exProgress(p, t0),
    });
    exEl.bar.style.width = '100%'; exEl.pct.textContent = '100%';
    exEl.phase.textContent = `เสร็จแล้ว · ${(exportBlob.size / 1048576).toFixed(1)} MB ใน ${Math.round((performance.now() - t0) / 1000)} วินาที`;
    exShow('ready');
  } catch (e) {
    exEl.phase.textContent = e && e.name === 'AbortError' ? 'ยกเลิกแล้ว' : 'สร้างวิดีโอไม่สำเร็จ: ' + ((e && e.message) || e);
    exShow('done');
  } finally {
    cineEnd();
    exporting = false; quality.high = wasHigh; applyQuality();
  }
  if (exportBlob) exSave();
}
exEl.btn.onclick = runExport;
exEl.cancel.onclick = () => exportAbort && exportAbort.abort();
exEl.save.onclick = exSave;
exEl.close.onclick = () => { exEl.dlg.hidden = true; };

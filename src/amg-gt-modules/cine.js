/* ---------- cinematic reveal: 10 shots, 32 s ---------- */
const cine = { active: false, t: 0, duration: 32, kmh: 0, steer: 0, shot: -1, capture: false };
const easeIO = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeO = k => 1 - Math.pow(1 - k, 3);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LV = (a, b, k) => a.clone().lerp(b, k);
const clamp01 = x => Math.min(1, Math.max(0, x));
const ramp = (t, a, b) => clamp01((t - a) / (b - a));
function shakeVec(t, amp) {
  return V3(Math.sin(t * 37.1) * .6 + Math.sin(t * 61.7) * .4, Math.sin(t * 43.3) * .5 + Math.sin(t * 71.9) * .5, Math.sin(t * 29.3) * .8).multiplyScalar(amp);
}
function ensureToggle(id, want) { if (!!toggles[id] !== want) document.getElementById(id).click(); }
function panelNow(name, open) { setPanel(name, open); PANELS[name].t = open ? 1 : 0; }
function closeAllNow() { for (const k in PANELS) panelNow(k, false); }
const orbit = (deg, r, y) => V3(Math.cos(deg * D) * r, y, Math.sin(deg * D) * r);

const SHOTS = [
  { t0: 0, t1: 3.2, // ignition: headlight wakes up in the dark
    enter() { closeAllNow(); ensureToggle('t-xray', false); ensureToggle('t-lights', false); cine.kmh = 0; },
    update(lt) {
      drl.emissiveIntensity = lt < .8 ? 0 : lt < 1.08 ? (Math.sin(lt * 95) > 0 ? 4 : .25) : 4;
      if (lt >= 1.6) ensureToggle('t-lights', true);
    },
    cam: k => ({ p: LV(V3(3.05, .56, 1.38), V3(2.84, .52, 1.06), easeO(k)), t: LV(V3(2.12, .5, .66), V3(2.16, .5, .69), k), fov: 22 - 3 * k }) },
  { t0: 3.2, t1: 6.0, cap: ['PERFORMANCE', 'ขับเคลื่อนล้อหลัง · เกียร์คลัตช์คู่ 7 สปีดด้านท้าย'], // low tracking pass
    enter() { drl.emissiveIntensity = 4; cine.kmh = 150; },
    cam: (k, lt) => { const x = lerp(4.4, -4.4, k); return { p: V3(x, .28, 2.35), t: V3(x * .32, .46, 0), fov: 36, roll: -.035, shake: .006 }; } },
  { t0: 6.0, t1: 8.0, cap: ['WHEELS', 'ล้อหน้า 19 นิ้ว · ล้อหลัง 20 นิ้ว · จานเบรกเจาะรู'], // wheel close-up
    enter() { cine.kmh = 60; },
    cam: k => ({ p: LV(V3(1.95, .43, 1.78), V3(1.56, .38, 1.52), easeIO(k)), t: V3(1.31, .34, .8), fov: 30 - 4 * k, roll: .06, shake: .002 }) },
  { t0: 8.0, t1: 10.4, cap: ['SOUND', 'ท่อไอเสียคู่ 4 ปลาย · ไฟท้าย LED'], // exhaust low angle
    enter() { cine.kmh = 150; },
    cam: k => ({ p: LV(V3(-3.95, .3, -1.95), V3(-3.12, .36, -1.18), easeO(k)), t: LV(V3(-2.25, .33, -.45), V3(-2.18, .4, -.28), k), fov: 28, roll: .03, shake: .004 }) },
  { t0: 10.4, t1: 13.2, // drone
    enter() { cine.kmh = 150; },
    cam: k => ({ p: orbit(lerp(25, 95, easeIO(k)), 2.6, lerp(7.6, 6.1, k)), t: V3(0, .3, 0), fov: 38 }) },
  { t0: 13.2, t1: 16.4, cap: ['ACCESS', 'ประตูและฝาทุกบานเปิดได้จริง'], // stop + doors
    update(lt) { cine.kmh = 150 * (1 - easeO(ramp(lt, 0, .5))); if (lt >= .6 && PANELS.doorR.target < .5) { setPanel('doorR', true); setPanel('doorL', true); } },
    cam: k => ({ p: orbit(lerp(-38, 32, easeIO(k)), 5.9, lerp(1.25, 1.75, k)), t: V3(.1, .62, 0), fov: 32 }) },
  { t0: 16.4, t1: 19.6, cap: ['COCKPIT', 'พวงมาลัยขวา · หน้าปัดดิจิทัล'], // launch from the driver's seat
    enter() { closeAllNow(); cine.kmh = 0; },
    update(lt) { cine.kmh = 265 * Math.pow(ramp(lt, .2, 3.2), 1.25); cine.steer = Math.sin(lt * 2.1) * .03; },
    cam: (k, lt) => ({ p: LV(V3(-.63, 1.03, .37), V3(-.52, 1.0, .37), easeO(k)), t: V3(.6, .85, .37), fov: 52, shake: .0012 + cine.kmh / 265 * .004 }) },
  { t0: 19.6, t1: 22.8, cap: ['ENGINE', '4.0 ลิตร V8 เทอร์โบคู่ แบบ hot-V'], // bonnet opens, crane over the V8
    enter() { cine.kmh = 0; cine.steer = 0; setPanel('hood', true); },
    cam: k => ({ p: LV(V3(3.0, 2.65, 1.45), V3(2.25, 1.8, .92), easeIO(k)), t: LV(V3(1.1, .55, 0), V3(.98, .5, 0), k), fov: 34 }) },
  { t0: 22.8, t1: 25.6, cap: ['X-RAY', 'ปีกนกคู่ทั้ง 4 ล้อ · ทรานแอกเซิลด้านหลัง'], // x-ray reveal
    enter() { closeAllNow(); },
    update(lt) { ensureToggle('t-xray', lt >= .3 && lt < 2.65); },
    cam: k => { const x = lerp(1.3, -1.3, easeIO(k)); return { p: V3(x, .95, 5.5), t: V3(x * .55, .5, 0), fov: 32 }; } },
  { t0: 25.6, t1: 32, // hero, title, fade
    enter() { ensureToggle('t-xray', false); closeAllNow(); ensureToggle('t-lights', true); cine.kmh = 0; },
    cam: k => { const kk = easeO(clamp01(k / .69)); return { p: LV(V3(5.3, .27, 3.7), V3(4.15, .32, 2.38), kk), t: LV(V3(0, .45, 0), V3(.35, .5, 0), kk), fov: 30 - 4 * kk }; } },
];
const cineEl = document.getElementById('cine'), cineCap = document.getElementById('cineCap'), cineFade = document.getElementById('cineFade'), cineTitle = document.getElementById('cineTitle');
function cineBegin(capture = false) {
  cine.active = true; cine.capture = capture; cine.t = 0; cine.shot = -1; cine.kmh = 0; cine.steer = 0;
  ensureToggle('t-spin', false); tween = null; controls.enabled = false;
  document.body.classList.add('cine'); cineEl.hidden = false;
}
function cineEnd() {
  if (!cine.active) return;
  cine.active = false; cine.kmh = 0; cine.steer = 0; drl.emissiveIntensity = 4;
  ensureToggle('t-xray', false); closeAllNow();
  document.body.classList.remove('cine'); cineEl.hidden = true;
  controls.enabled = true; camera.fov = stage.clientWidth / stage.clientHeight < .9 ? 46 : 30;
  jumpToView('34');
}
function cineUpdate(dt) {
  cine.t += dt;
  if (cine.t >= cine.duration) { cineEnd(); return; }
  const t = cine.t, i = SHOTS.findIndex(s => t >= s.t0 && t < s.t1), s = SHOTS[i];
  if (i !== cine.shot) { cine.shot = i; s.enter && s.enter(); }
  const lt = t - s.t0, k = lt / (s.t1 - s.t0);
  s.update && s.update(lt, k);
  const c = s.cam(k, lt);
  camera.position.copy(c.p);
  if (c.shake) camera.position.add(shakeVec(t, c.shake));
  camera.fov = c.fov; camera.updateProjectionMatrix();
  camera.up.set(0, 1, 0); camera.lookAt(c.t);
  if (c.roll) camera.rotateZ(c.roll);
  // overlays (driven by the clock so capture and live playback match)
  const capOn = s.cap ? clamp01(Math.min((lt - .25) / .25, (s.t1 - s.t0 - .2 - lt) / .25)) : 0;
  if (s.cap) cineCap.innerHTML = `<b>${s.cap[0]}</b><span>${s.cap[1]}</span>`;
  cineCap.style.opacity = capOn;
  cineCap.style.transform = `translateX(${(1 - capOn) * -14}px)`;
  const fade = t < 1 ? 1 - ramp(t, .1, 1) : t > 29.4 ? ramp(t, 29.4, 30) : 0;
  cineFade.style.opacity = fade;
  const title = ramp(t, 28.5, 29.2) * (1 - ramp(t, 31.3, 31.95));
  cineTitle.style.opacity = title;
  cineTitle.style.transform = `translate(-50%, -50%) scale(${1.06 - .06 * easeO(ramp(t, 28.5, 31.5))})`;
  cineTitle.style.letterSpacing = `${.3 - .18 * easeO(ramp(t, 28.5, 30))}em`;
}
document.getElementById('cineStop').onclick = cineEnd;
document.getElementById('t-cine').onclick = () => cineBegin(false);

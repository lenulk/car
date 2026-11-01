/* ===========================================================================
   MP4 exporter  -  WebCodecs (H.264 + AAC/Opus) + mp4-muxer (global `Mp4Muxer`)
   Public API:  videoExportSupport()   exportMp4(opts)
   Everything else is private (prefix _vx) and is declared as a function so the
   whole block can be pasted verbatim into an ES module.
   =========================================================================== */

/* ---------- public: synchronous feature check ---------- */
function videoExportSupport() {
  try {
    const hasAudioCtx = typeof OfflineAudioContext !== 'undefined' ||
      typeof webkitOfflineAudioContext !== 'undefined' || typeof AudioContext !== 'undefined';
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' ||
        typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined' || !hasAudioCtx) {
      if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
        return { ok: false, reason: 'การสร้างวิดีโอ (WebCodecs) ใช้ได้เฉพาะหน้าเว็บที่เปิดผ่าน HTTPS — ลองใช้ Chrome หรือ Edge เวอร์ชันล่าสุด' };
      }
      return { ok: false, reason: 'เบราว์เซอร์นี้ไม่รองรับการสร้างวิดีโอ (WebCodecs) — ลองใช้ Chrome หรือ Edge เวอร์ชันล่าสุด' };
    }
    if (typeof Mp4Muxer === 'undefined' || !Mp4Muxer || typeof Mp4Muxer.Muxer !== 'function' ||
        typeof Mp4Muxer.ArrayBufferTarget !== 'function') {
      return { ok: false, reason: 'โหลดไลบรารีรวมไฟล์ MP4 (mp4-muxer) ไม่สำเร็จ — ลองรีเฟรชหน้าเว็บแล้วลองใหม่อีกครั้ง' };
    }
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: 'เบราว์เซอร์นี้ไม่รองรับการสร้างวิดีโอ (WebCodecs) — ลองใช้ Chrome หรือ Edge เวอร์ชันล่าสุด' };
  }
}

/* ---------- public: render -> encode -> mux ---------- */
async function exportMp4(opts) {
  const o = _vxNormalizeOpts(opts);
  const signal = o.signal;
  if (signal && signal.aborted) throw _vxAbortError();
  const sup = videoExportSupport();
  if (!sup.ok) throw new Error(sup.reason);

  const emit = _vxMakeEmitter(o.onProgress);
  emit('prepare', 0, 3, true);

  // ---- prepare: pick codecs, decode audio ----
  const pctx = _vxMakeCtx(signal);
  let vcands = null, audio = null, audioSkip = null;
  try {
    vcands = await pctx.guard(_vxPickVideoConfigs(o.width, o.height, o.fps));
    pctx.check();
    if (!vcands.length) {
      throw new Error('เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับการเข้ารหัสวิดีโอ H.264 จึงสร้างไฟล์ MP4 ไม่ได้ — ลองใช้ Chrome หรือ Edge เวอร์ชันล่าสุดบนคอมพิวเตอร์ หรือลดความละเอียดลง');
    }
    emit('prepare', 1, 3, true);

    if (!o.audioBase64) {
      audioSkip = { reason: 'ไม่มีไฟล์เสียง — สร้างวิดีโอแบบไม่มีเสียง', noAudio: true };
    } else {
      try {
        const pick = await pctx.guard(_vxPickAudioConfig());
        if (!pick) {
          audioSkip = { reason: 'เบราว์เซอร์นี้เข้ารหัสเสียง (AAC/Opus) ไม่ได้ — สร้างวิดีโอแบบไม่มีเสียง' };
        } else {
          emit('prepare', 2, 3, true);
          const pcm = await _vxDecodeAudio(o.audioBase64, pctx);
          if (!pcm.length) audioSkip = { reason: 'ไฟล์เสียงว่างเปล่า — สร้างวิดีโอแบบไม่มีเสียง' };
          else audio = { kind: pick.kind, config: pick.config, chunkFrames: pick.chunkFrames, l: pcm.l, r: pcm.r, length: pcm.length };
        }
      } catch (e) {
        if (pctx.failed) throw pctx.failed;
        audioSkip = { reason: 'ถอดรหัสไฟล์เสียงไม่สำเร็จ — สร้างวิดีโอแบบไม่มีเสียง', detail: String((e && e.message) || e) };
      }
    }
    emit('prepare', 3, 3, true);
  } catch (e) {
    if (signal && signal.aborted) throw _vxAbortError();
    throw e;
  } finally {
    pctx.dispose();
  }

  // ---- encode: try each supported video config until one actually works ----
  let lastErr = null;
  for (let k = 0; k < vcands.length; k++) {
    const res = await _vxRunAttempt(o, emit, vcands[k], audio, audioSkip);
    if (res.blob) return res.blob;
    lastErr = res.retry;                       // encoder died before producing anything -> next candidate
  }
  throw lastErr || new Error('การเข้ารหัสวิดีโอ H.264 ล้มเหลว');
}

/* ---------- one full encode attempt with one video config ---------- */
async function _vxRunAttempt(o, emit, vcand, audio, audioSkip) {
  const width = o.width, height = o.height, fps = o.fps, frameCount = o.frameCount, signal = o.signal;
  const ctx = _vxMakeCtx(signal);
  const yielder = _vxMakeYielder();
  let venc = null, aenc = null, muxer = null, target = null;
  let vOut = 0;
  try {
    ctx.check();
    target = new Mp4Muxer.ArrayBufferTarget();
    const mopts = {
      target,
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    };
    if (audio) mopts.audio = { codec: audio.kind, numberOfChannels: 2, sampleRate: 48000 };
    muxer = new Mp4Muxer.Muxer(mopts);

    venc = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); vOut++; } catch (e) { ctx.fail(e); }
      },
      error: (e) => {
        ctx.vencFailed = true;
        ctx.fail(_vxEncErr('การเข้ารหัสวิดีโอ H.264 ล้มเหลว', e));
      },
    });
    try { venc.configure(vcand.config); } catch (e) { ctx.vencFailed = true; throw e; }

    if (audio) {
      aenc = new AudioEncoder({
        output: (chunk, meta) => {
          try { muxer.addAudioChunk(chunk, meta); } catch (e) { ctx.fail(e); }
        },
        error: (e) => ctx.fail(_vxEncErr('การเข้ารหัสเสียงล้มเหลว', e)),
      });
      aenc.configure(audio.config);
    }

    // ---- audio feeding (lock-step with the video so the MP4 is properly interleaved) ----
    const SR = 48000;
    const aTotal = audio ? Math.round(frameCount / fps * SR) : 0;
    const aChunks = audio ? Math.ceil(aTotal / audio.chunkFrames) : 0;
    const aLead = Math.round(SR * 0.5);
    let aPos = 0, aFed = 0;
    async function feedAudio(untilSample) {
      const stop = Math.min(aTotal, untilSample);
      while (aPos < stop) {
        ctx.check();
        const n = Math.min(audio.chunkFrames, aTotal - aPos);
        const data = new Float32Array(n * 2);                    // planar: L block, then R block (zero = silence padding)
        const lim = Math.min(n, audio.length - aPos);
        if (lim > 0) {
          data.set(audio.l.subarray(aPos, aPos + lim), 0);
          data.set(audio.r.subarray(aPos, aPos + lim), n);
        }
        const ad = new AudioData({
          format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2,
          timestamp: Math.round(aPos * 1e6 / SR), data,
        });
        try { aenc.encode(ad); } finally { ad.close(); }
        aPos += n; aFed++;
        if (aenc.encodeQueueSize > 24) await _vxWaitQueue(ctx, aenc, 12);
      }
    }

    // ---- video ----
    emit('video', 0, frameCount, true);
    const kfEvery = Math.max(1, Math.round(fps * 2));
    const frameDur = Math.round(1e6 / fps);
    for (let i = 0; i < frameCount; i++) {
      ctx.check();
      if (venc.encodeQueueSize > 6) await _vxWaitQueue(ctx, venc, 6);
      ctx.check();

      let canvas = o.renderFrame(i);
      if (canvas && typeof canvas.then === 'function') canvas = await ctx.guard(canvas);
      ctx.check();
      if (!canvas || canvas.width !== width || canvas.height !== height) {
        throw new Error('renderFrame(' + i + ') ต้องคืน canvas ขนาด ' + width + '×' + height + ' แต่ได้ ' +
          (canvas ? canvas.width + '×' + canvas.height : String(canvas)));
      }
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: frameDur });
      try {
        venc.encode(frame, { keyFrame: i % kfEvery === 0 });
      } catch (e) {
        ctx.vencFailed = true;
        throw e;
      } finally {
        frame.close();
      }

      if (audio) await feedAudio(Math.round((i + 1) / fps * SR) + aLead);
      emit('video', i + 1, frameCount, false);
      await yielder.next();
    }
    ctx.check();
    await ctx.guard(venc.flush());
    ctx.check();
    emit('video', frameCount, frameCount, true);

    // ---- audio tail + report ----
    if (audio) {
      emit('audio', aFed, aChunks, true);
      await feedAudio(aTotal);
      await ctx.guard(aenc.flush());
      ctx.check();
      emit('audio', aChunks, aChunks, true);
    } else {
      emit('audio', 0, 0, true, Object.assign({ skipped: true }, audioSkip));
    }

    // ---- finish ----
    emit('finish', 0, 1, true);
    await yielder.paint();                       // let the UI show "finishing" before the (synchronous) finalize
    ctx.check();
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    emit('finish', 1, 1, true);
    return { blob };
  } catch (e) {
    if (signal && signal.aborted) throw _vxAbortError();
    if (ctx.vencFailed && vOut === 0) return { retry: e };   // hardware/unsupported encoder died before output: retry elsewhere
    throw e;
  } finally {
    _vxClose(venc);
    _vxClose(aenc);
    ctx.dispose();
    yielder.close();
    muxer = null; target = null;
  }
}

/* ---------- options ---------- */
function _vxNormalizeOpts(opts) {
  const o = opts || {};
  const width = o.width, height = o.height, fps = o.fps, frameCount = o.frameCount;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width % 2 || height % 2) {
    throw new Error('ความกว้างและความสูงของวิดีโอต้องเป็นเลขคู่ (เช่น 1920×1080)');
  }
  if (!(typeof fps === 'number' && isFinite(fps) && fps > 0)) throw new Error('ค่า fps ไม่ถูกต้อง');
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error('จำนวนเฟรมต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  if (typeof o.renderFrame !== 'function') throw new Error('ต้องระบุฟังก์ชัน renderFrame');
  return {
    width, height, fps, frameCount,
    renderFrame: o.renderFrame,
    audioBase64: (typeof o.audioBase64 === 'string' && o.audioBase64.length) ? o.audioBase64 : null,
    onProgress: typeof o.onProgress === 'function' ? o.onProgress : null,
    signal: o.signal || null,
  };
}

/* ---------- codec selection ---------- */
async function _vxPickVideoConfigs(w, h, fps) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);        // macroblocks per frame
  const mbps = mbs * fps;                                    // macroblocks per second
  const huge = mbps > 983040;                                // beyond level 5.1 (e.g. 4K60) -> level 5.2
  const bitrate = Math.round(Math.min(40e6, Math.max(4e6, 0.14 * w * h * fps)));
  const codecs = [].concat(
    huge ? ['avc1.640034'] : [],
    ['avc1.640033', 'avc1.64002A',      // High 5.1 / 4.2
     'avc1.4D402A',                     // Main 4.2
     'avc1.42E02A', 'avc1.42001F'],     // Baseline 4.2 / 3.1
    huge ? ['avc1.4D4034', 'avc1.42E034'] : []
  );
  const found = [];
  for (const codec of codecs) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const config = {
        codec, width: w, height: h, framerate: fps, bitrate,
        hardwareAcceleration: hw, avc: { format: 'avc' }, latencyMode: 'quality',
      };
      try {
        const r = await VideoEncoder.isConfigSupported(config);
        if (r && r.supported) found.push({ codec, hardwareAcceleration: hw, config });
      } catch (e) { /* unsupported / malformed for this browser: skip */ }
      if (found.length >= 4) return found;
    }
  }
  return found;
}

async function _vxPickAudioConfig() {
  const cands = [
    { kind: 'aac', chunkFrames: 1024, config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 } },
    { kind: 'opus', chunkFrames: 960, config: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 } },
  ];
  for (const c of cands) {
    try {
      const r = await AudioEncoder.isConfigSupported(c.config);
      if (r && r.supported) return c;
    } catch (e) { /* try next */ }
  }
  return null;
}

/* ---------- audio decode (base64 MP3 -> 48 kHz stereo Float32 arrays) ---------- */
async function _vxDecodeAudio(b64, ctx) {
  let s = String(b64);
  if (s.slice(0, 5) === 'data:') s = s.slice(s.indexOf(',') + 1);
  s = s.replace(/\s+/g, '');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  let ac = null, ownsContext = false;
  const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
    : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);
  try { if (OAC) ac = new OAC(2, 48000, 48000); } catch (e) { ac = null; }
  if (!ac && typeof AudioContext !== 'undefined') { ac = new AudioContext({ sampleRate: 48000 }); ownsContext = true; }
  if (!ac) throw new Error('ไม่มี AudioContext');
  let ab;
  try {
    ab = await ctx.guard(new Promise((resolve, reject) => {
      const p = ac.decodeAudioData(bytes.buffer, resolve, reject);   // callback form for old Safari, promise form otherwise
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    }));
  } finally {
    if (ownsContext) { try { ac.close(); } catch (e) {} }
  }
  ctx.check();

  const sr = ab.sampleRate;
  let l = ab.getChannelData(0);
  let r = ab.numberOfChannels > 1 ? ab.getChannelData(1) : null;
  if (sr !== 48000) {                                    // decodeAudioData normally resamples already; this is only a safety net
    l = _vxResample(l, sr, 48000);
    r = r ? _vxResample(r, sr, 48000) : null;
  }
  return { l, r: r || l, length: l.length };
}

function _vxResample(src, from, to) {
  const n = Math.floor(src.length * to / from);
  const out = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * k, i0 = Math.floor(x), i1 = Math.min(src.length - 1, i0 + 1), f = x - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

/* ---------- plumbing ---------- */
function _vxAbortError() {
  return new DOMException('ยกเลิกการสร้างวิดีโอแล้ว', 'AbortError');
}

function _vxEncErr(prefix, e) {
  const err = new Error(prefix + ((e && (e.message || e.name)) ? ' (' + (e.name ? e.name + ': ' : '') + (e.message || '') + ')' : ''));
  err.cause = e;
  return err;
}

// Per-run failure channel: encoder errors and abort both land in ctx.fail(); every await goes through ctx.guard().
function _vxMakeCtx(signal) {
  const ctx = { failed: null, vencFailed: false };
  let rejectFn = null;
  ctx.failPromise = new Promise((_, rej) => { rejectFn = rej; });
  ctx.failPromise.catch(() => {});
  ctx.fail = (e) => { if (!ctx.failed) { ctx.failed = e; rejectFn(e); } };
  ctx.check = () => { if (ctx.failed) throw ctx.failed; };
  ctx.guard = (p) => Promise.race([p, ctx.failPromise]);
  const onAbort = () => ctx.fail(_vxAbortError());
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  ctx.dispose = () => { if (signal) signal.removeEventListener('abort', onAbort); };
  return ctx;
}

function _vxClose(enc) {
  try { if (enc && enc.state !== 'closed') enc.close(); } catch (e) {}
}

// Wait until enc.encodeQueueSize <= max (woken by 'dequeue', with a polling safety net).
function _vxWaitQueue(ctx, enc, max) {
  return ctx.guard(new Promise((resolve) => {
    let timer = 0;
    const finish = () => {
      clearInterval(timer);
      try { enc.removeEventListener('dequeue', check); } catch (e) {}
      resolve();
    };
    const check = () => { if (ctx.failed || enc.state === 'closed' || enc.encodeQueueSize <= max) finish(); };
    try { enc.addEventListener('dequeue', check); } catch (e) {}
    timer = setInterval(check, 15);
    check();
  }));
}

// next(): cheap macrotask yield (MessageChannel is not clamped to 4 ms and not throttled in background tabs).
// paint(): a real timer tick so the page can repaint before a long synchronous step.
function _vxMakeYielder() {
  let ch = null, pending = null;
  if (typeof MessageChannel !== 'undefined') {
    try {
      ch = new MessageChannel();
      ch.port1.onmessage = () => { const r = pending; pending = null; if (r) r(); };
    } catch (e) { ch = null; }
  }
  return {
    next() {
      if (!ch) return new Promise((r) => setTimeout(r, 0));
      return new Promise((r) => { pending = r; ch.port2.postMessage(0); });
    },
    paint() {
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      return new Promise((r) => setTimeout(r, visible ? 16 : 0));
    },
    close() {
      if (pending) { const r = pending; pending = null; r(); }
      if (ch) { try { ch.port1.close(); ch.port2.close(); } catch (e) {} ch = null; }
    },
  };
}

// `fraction` is OVERALL progress (0..1, monotonic across phases); done/total are per phase.
function _vxMakeEmitter(cb) {
  const RANGE = { prepare: [0, 0.03], video: [0.03, 0.95], audio: [0.95, 0.97], finish: [0.97, 1] };
  let last = -1e9;
  return function emit(phase, done, total, force, extra) {
    if (!cb) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && now - last < 100) return;
    last = now;
    const f = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
    const rg = RANGE[phase];
    const p = { phase, done, total, fraction: rg[0] + (rg[1] - rg[0]) * f };
    if (extra) Object.assign(p, extra);
    try { cb(p); } catch (e) { /* a broken progress callback must not break the export */ }
  };
}

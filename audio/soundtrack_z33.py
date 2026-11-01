#!/usr/bin/env python3
"""
Car-reveal soundtrack, variant for a tuned twin-turbo V6 (modified Nissan 350Z,
VQ35 + two turbos).   Usage:   python3 soundtrack_z33.py out.wav

Same 32.0 s / 48 kHz / 16-bit stereo programme as soundtrack.py: same timeline,
cut points, shift times, music bed, SFX, perspective filters, per-shot engine
levels and master chain.  This file imports soundtrack.py (which must sit next
to it, and is not modified) and swaps out only the *car sound*:

  * V8 burble -> V6 note.  3 firings per crank revolution (4-stroke 6-cyl), an
    evenly spaced, smoother pulse train than the cross-plane V8 (much less
    sub-harmonic lope, smaller cylinder-to-cylinder spread), a shallower spectral
    slope plus a rising intake/exhaust "howl" formant, and a harder, raspier
    edge (more drive + gated high-band rasp) as rpm climbs.  The rpm curve is
    stretched ~7 % above idle (VQ with turbos: 6.9 k at the shift points) but all
    times are untouched.
  * Twin-turbo spool whistle: two slightly detuned compressor whistles (one per
    bank, panned) whose pitch follows a lagged shaft-speed model (spools with rpm
    and throttle, coasts down slowly), and whose level follows boost pressure
    (drops fast when the throttle closes).
  * Blow-off valve "pssh + flutter" (air rush, compressor-surge chatter, falling
    surge whoop, small pressure thump) right after each upshift (5.60, 17.40,
    18.30, 19.20) and on the throttle lifts at 13.2 and 19.6.
  * A few exhaust crackles/pops on overrun (after the 13.2 lift, after the 19.6
    lift and after the two bay blips).  The V8's pops on shifts are removed.

Everything else in soundtrack.py (intro drone, light stingers, doors, scan,
hero hits, music) is byte-for-byte the same code path and RNG order.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import soundtrack as S
from soundtrack import (SR, N, TT, TWO_PI, DUR, tarr, filt, noise, smoothstep, smooth_sym,
                        lpnoise, tv_filter, pan_gains, db)

RPM_STRETCH = 1.07          # rpm above idle (900) multiplied by this
IDLE_RPM = 900.0
WHISTLE_DB = -7.0           # turbo whistle level re. engine RMS (full boost)
WHISTLE_RUSH_DB = -22.0     # airy compressor rush riding on the whistle

_STATE = {}


# ----------------------------------------------------------------------------
# rpm: original curve (shift/lift times untouched), stretched above idle
# ----------------------------------------------------------------------------
_orig_build_rpm = S.build_rpm


def build_rpm_v6():
    rpm_dop, rpm = _orig_build_rpm()
    _STATE['dop'] = rpm_dop / rpm                    # exterior pass-by doppler factor

    def stretch(r):
        return IDLE_RPM + (r - IDLE_RPM) * RPM_STRETCH

    return stretch(rpm) * _STATE['dop'], stretch(rpm)


# ----------------------------------------------------------------------------
# Turbo model (control rate 500 Hz, interpolated up to the sample rate)
# ----------------------------------------------------------------------------
def turbo_state(rpm, load):
    """Return (shaft speed 0..1, boost pressure 0..1) as sample-rate arrays.
    Boost rises with rpm and throttle, collapses fast on a lift (BOV/closed
    throttle); the shaft keeps spinning and coasts down with its inertia."""
    dt = 0.002
    tc = np.arange(0.0, DUR + dt, dt)
    r = np.interp(tc, TT, rpm)
    ld = np.interp(tc, TT, load)
    thr = np.clip((ld - 0.12) / 0.70, 0.0, 1.0)
    b_t = smoothstep((r - 2200.0) / 2300.0) * thr ** 0.8
    s_t = 0.08 + 0.92 * smoothstep((r - 1800.0) / 5200.0) * (0.25 + 0.75 * thr)
    b = np.zeros_like(tc)
    s = np.zeros_like(tc)
    s[0] = 0.08
    ka_up, ka_dn = 1 - np.exp(-dt / 0.16), 1 - np.exp(-dt / 0.055)
    ks_up, ks_dn = 1 - np.exp(-dt / 0.30), 1 - np.exp(-dt / 0.50)
    for i in range(1, len(tc)):
        b[i] = b[i - 1] + (b_t[i] - b[i - 1]) * (ka_up if b_t[i] > b[i - 1] else ka_dn)
        s[i] = s[i - 1] + (s_t[i] - s[i - 1]) * (ks_up if s_t[i] > s[i - 1] else ks_dn)
    return np.interp(TT, tc, s), np.interp(TT, tc, b)


def whistle_hz(s):
    return 1600.0 + 4600.0 * np.power(np.clip(s, 0, 1), 1.15)


def turbo_voice(rpm, load, seed):
    """Twin detuned compressor whistles + airy rush, stereo (2, N)."""
    rng = np.random.default_rng(seed)
    s, b = turbo_state(rpm, load)
    _STATE['s'], _STATE['b'] = s, b
    dop = _STATE['dop']
    amp = smoothstep((s - 0.26) / 0.34) * (0.14 + 0.86 * np.power(b, 1.1))
    amp = smooth_sym(amp, 0.02)
    out = np.zeros((2, N))
    for k, (detune, wl, wr) in enumerate(((1.0, 1.0, 0.50), (1.047, 0.50, 1.0))):
        jit = 1 + 0.004 * lpnoise(25.0, rng) + 0.0015 * lpnoise(160.0, rng)
        f = whistle_hz(s) * detune * dop * jit
        ph = TWO_PI * np.cumsum(f) / SR
        wob = 1 + 0.18 * lpnoise(14.0, rng)
        tone = np.sin(ph) + 0.28 * np.sin(2 * ph + 0.6) + 0.07 * np.sin(3 * ph + 1.1)
        tone *= amp * np.clip(wob, 0.3, 2.0)
        # airy narrow-band rush at the whistle frequency (the "whooo" around the tone)
        fr = whistle_hz(s) * detune * dop
        rush = tv_filter(noise(N, rng=rng), 'bp', lambda tt, fr=fr: np.interp(tt, TT, fr), 9.0)
        rush /= (np.std(rush) + 1e-12)
        rush *= amp * db(WHISTLE_RUSH_DB - WHISTLE_DB)
        out[0] += (tone + rush) * wl
        out[1] += (tone + rush) * wr
    # tone RMS normalisation so WHISTLE_DB is meaningful
    on = amp > 0.6
    ref = np.sqrt(np.mean(out[:, on] ** 2)) if np.any(on) else 1.0
    return out / (ref + 1e-12)


# ----------------------------------------------------------------------------
# V6 engine voice
# ----------------------------------------------------------------------------
def v6_voice(rpm, load, seed, K=None):
    rng = np.random.default_rng(seed)
    K = 40
    f_fire = rpm / 60.0 * 3.0                       # V6 4-stroke: 3 firings / crank rev
    ph = TWO_PI * np.cumsum(f_fire) / SR
    idle_w = np.clip((2600.0 - rpm) / 1700.0, 0, 1)
    hi_w = np.clip((rpm - 3500.0) / 3400.0, 0, 1)    # 0 below 3.5 k, 1 at ~6.9 k

    # per-firing amplitude spread (small: even firing) + 6-firing cycle lumps
    nf = ph / TWO_PI
    idx = np.floor(nf).astype(np.int64)
    fr = nf - idx
    tab = rng.standard_normal(idx[-1] + 3)
    rnd = tab[idx] * (1 - fr) + tab[idx + 1] * fr
    am = 1.0 + 0.035 * (1 + 2.5 * idle_w) * rnd
    depth = 0.30 + 0.55 * idle_w
    amm = np.array([0.12, 0.08, 0.10, 0.06, 0.05])
    psi = rng.uniform(0, TWO_PI, 5)
    for m in range(1, 6):
        am += depth * amm[m - 1] * np.cos(m * ph / 6.0 + psi[m - 1])
    am = np.maximum(am, 0.10)

    bright = 0.55 + 0.45 * load
    fc = 700.0 + 0.30 * rpm                          # howl formant, tracks rpm (970 .. 2.8 kHz)
    form_amt = (0.35 + 0.65 * hi_w) * (0.5 + 0.5 * load)
    ph0 = [np.random.default_rng(seed * 31 + ch).uniform(-0.8, 0.8, K) for ch in range(2)]
    chans = [np.zeros(N), np.zeros(N)]
    for k in range(1, K + 1):
        fk = k * f_fire
        w = k ** -0.62 * (1.0 if k % 2 else 0.78 + 0.22 * load)
        wt = np.power(bright, 0.26 * (k - 1)) * np.clip((13000.0 - fk) / 3500.0, 0, 1)
        lg = np.log2(np.maximum(fk, 1.0) / fc) / 0.75
        wt = wt * (1.0 + 1.1 * form_amt * np.exp(-0.5 * lg * lg))
        a = w * wt
        for ch in range(2):
            chans[ch] += a * np.sin(k * ph + ph0[ch][k - 1])
    # a little idle "cam lope" below the firing frequency, weak compared with the V8
    for ch in range(2):
        r = np.random.default_rng(seed * 43 + ch)
        burble = np.clip(1 + 0.5 * lpnoise(6.0, r), 0.1, 3)
        chans[ch] = chans[ch] * am + 0.20 * burble * idle_w * np.sin(0.5 * ph + r.uniform(0, TWO_PI))

    sd = np.std(chans[0][int(3.2 * SR):int(30 * SR)])
    drive = 1.0 + 1.0 * load + 1.3 * hi_w ** 1.2      # harder clipping edge at high rpm
    sp = np.clip(rpm / 6900.0, 0.15, 1.3)
    out = []
    for ch in range(2):
        r = np.random.default_rng(seed * 57 + ch)
        h = chans[ch] / sd * 0.75
        h = h + 0.10 * hi_w * h * np.abs(h)            # asymmetric grit
        y = np.tanh(drive * h) / np.sqrt(drive)
        nz = r.standard_normal(N)
        gate = ((1 + np.cos(ph + 0.4 + 0.6 * ch)) / 2) ** 3.0
        rasp = filt(filt(nz * gate, 'bp', 2300, 0.6), 'hp', 900, 0.7)
        rasp /= np.std(rasp)
        rush = filt(r.standard_normal(N), 'bp', 3600, 0.6)
        rush /= np.std(rush)
        y = (y + (0.06 + 0.42 * load) * (0.25 + 0.75 * hi_w) * sp ** 1.4 * rasp * 0.6
             + (0.012 + 0.05 * load) * sp ** 2 * rush)
        out.append(y)
    # (+3.5 dB at idle: the V6 idle is much less lumpy/sub-heavy than the V8's, so
    #  without this it sits well below the V8 idle relative to the revving parts)
    lvl = smooth_sym((0.30 + 0.70 * load) * (0.55 + 0.45 * np.clip(rpm / 6900.0, 0, 1.1)) * (1 + 0.5 * idle_w), 0.03)
    eng = np.stack(out) * lvl

    # ---- turbo whistle on top (rpm here carries the pass-by doppler; the turbo
    # model wants the clean rpm, the doppler is re-applied to the whistle pitch)
    clean = rpm / _STATE['dop']
    eng_rms = np.sqrt(np.mean(eng[:, int(3.2 * SR):int(13.2 * SR)] ** 2))
    tv = turbo_voice(clean, load, seed + 1000)
    return eng + tv * (eng_rms * db(WHISTLE_DB))


# ----------------------------------------------------------------------------
# Blow-off valve and exhaust crackle
# ----------------------------------------------------------------------------
def bov(strength, f_w0, rng, dur=0.95):
    """Blow-off valve: air rush ('pssh'), compressor-surge flutter, falling surge
    whoop, valve/pressure thump.  Returns (2, n)."""
    n = int(dur * SR)
    t = tarr(n)
    # -- air rush: fast attack, two-stage decay, centre sweeping down
    pssh = []
    for _ in range(2):
        z = tv_filter(noise(n, rng=rng), 'bp', lambda tt: 1900.0 + 3800.0 * np.exp(-tt / 0.25), 0.7)
        z /= np.std(z)
        z += 0.45 * filt(noise(n, rng=rng), 'hp', 6000, 0.7)
        pssh.append(z)
    e_p = (1 - np.exp(-t / 0.004)) * (0.75 * np.exp(-t / 0.10) + 0.25 * np.exp(-t / 0.30))
    # -- flutter: chatter gate that slows as the pressure bleeds off
    f_fl = 7.5 + 17.0 * np.exp(-t / 0.30)
    gate = ((1 + np.cos(TWO_PI * np.cumsum(f_fl) / SR + np.pi)) / 2) ** 2.4
    e_f = smoothstep((t - 0.015) / 0.03) * np.exp(-t / 0.26)
    flut = []
    for _ in range(2):
        z = filt(noise(n, rng=rng), 'bp', 1700.0, 0.7)
        z /= np.std(z)
        flut.append(z * gate * e_f)
    # -- surge whoop: compressor tone falling in pitch, chopped by the same gate
    fw = f_w0 * (0.32 + 0.60 * np.exp(-t / 0.30))
    whoop = (np.sin(TWO_PI * np.cumsum(fw) / SR) + 0.25 * np.sin(TWO_PI * 2 * np.cumsum(fw) / SR)) \
        * (0.35 + 0.65 * gate) * e_f * 0.8
    # -- valve thump
    thump = np.sin(TWO_PI * np.cumsum(55 + 75 * np.exp(-t / 0.012)) / SR) * np.exp(-t / 0.035) \
        * (1 - np.exp(-t / 0.002))
    y = np.stack([pssh[c] * e_p * 1.0 + flut[c] * 0.95 + whoop * 0.30 + thump * 0.55 for c in range(2)])
    return y * strength * 0.30


def crackle_pop(rng, amp):
    n = int(0.12 * SR)
    t = tarr(n)
    nz = noise(n, rng=rng)
    body = filt(nz, 'bp', rng.uniform(1500, 3300), 1.0) + 0.7 * filt(nz, 'lp', 450)
    env = (1 - np.exp(-t / 0.0003)) * np.exp(-t / rng.uniform(0.004, 0.010))
    crack = filt(noise(n, rng=rng), 'hp', 3500, 0.7) * np.exp(-t / 0.0025)
    thump = np.sin(TWO_PI * np.cumsum(80 + 70 * np.exp(-t / 0.009)) / SR) * np.exp(-t / 0.025)
    return (body * env / 2.0 + 0.35 * crack + 0.45 * thump) * amp * 0.70 * rng.choice([-1, 1])


BOV_EVENTS = (          # (time, strength): just after each upshift, and on the two lifts
    (5.60 + 0.030, 0.90),
    (13.20 + 0.020, 0.85),
    (17.40 + 0.030, 0.90),
    (18.30 + 0.030, 0.90),
    (19.20 + 0.030, 0.90),
    (19.60 + 0.025, 0.50),
)

CRACKLE_EVENTS = (      # overrun only
    [(13.40 + d, a) for d, a in ((0.00, 0.9), (0.07, 0.55), (0.13, 0.8), (0.27, 0.45), (0.36, 0.5))]
    + [(19.86 + d, a) for d, a in ((0.00, 0.7), (0.07, 0.45), (0.20, 0.5))]
    + [(20.85 + d, a) for d, a in ((0, 0.8), (0.07, 0.5))]
    + [(22.10 + d, a) for d, a in ((0, 0.9), (0.06, 0.6), (0.14, 0.5))]
)


def make_pops_z33(events, rng):
    """Replacement for soundtrack.make_pops: BOVs + overrun crackle, (2, N).
    (engine_bus multiplies this bus by 5 and keeps it out of the dull blends.)"""
    out = np.zeros((2, N))
    brng = np.random.default_rng(4242)
    for t0, st in BOV_EVENTS:
        f_w0 = float(whistle_hz(np.interp(t0, TT, _STATE['s'])))
        y = bov(st, f_w0, brng)
        i0 = int(round(t0 * SR))
        m = min(y.shape[1], N - i0)
        w = brng.uniform(-0.3, 0.3)
        l, r_ = pan_gains(w)
        out[0, i0:i0 + m] += y[0, :m] * l * 1.4142
        out[1, i0:i0 + m] += y[1, :m] * r_ * 1.4142
    for t0, a in events:
        sig = crackle_pop(rng, a)
        i0 = int(round(t0 * SR))
        m = min(len(sig), N - i0)
        w = rng.uniform(-0.5, 0.5)
        l, r_ = pan_gains(w)
        out[0, i0:i0 + m] += sig[:m] * l * 1.4142
        out[1, i0:i0 + m] += sig[:m] * r_ * 1.4142
    return out


# ----------------------------------------------------------------------------
# Per-shot loudness trim.  engine_bus() normalises every shot to a fixed RMS, but a
# V6 with a howl formant, rasp and a whistle carries more energy in the K-weighted
# (ear-sensitive) band than the V8 at the same RMS.  These trims (dB, measured once
# against the original V8 stem, K-weighted per shot) bring each shot back to the
# V8's loudness so the engine sits in the mix exactly as before.
# ----------------------------------------------------------------------------
SEG_TRIM_DB = {'ext1': -1.0, 'ext2': -1.1, 'door': -3.2, 'cab': -1.6, 'bay': -1.9, 'xray': 0.1, 'hero': 0.1}
TRIM_SEGS = (('ext1', 3.2, 6.0), ('ext2', 6.0, 13.2), ('door', 13.2, 16.4), ('cab', 16.4, 19.6),
             ('bay', 19.6, 22.8), ('xray', 22.8, 25.6), ('hero', 25.6, 32.0))
_orig_engine_bus = S.engine_bus


def engine_bus_z33():
    out, rpm, load = _orig_engine_bus()
    g = np.ones(N)
    for name, a, b in TRIM_SEGS:
        g += S.seg_mask(a, b) * (db(SEG_TRIM_DB[name]) - 1.0)
    return out * g, rpm, load


# ----------------------------------------------------------------------------
# Patch the shared programme and run it
# ----------------------------------------------------------------------------
S.engine_bus = engine_bus_z33
S.build_rpm = build_rpm_v6
S.engine_voice = v6_voice
S.make_pops = make_pops_z33
S.POP_EVENTS = CRACKLE_EVENTS


# Final output trim.  The shared master chain peak-normalises to 0.8913 (-1.0 dBFS,
# and ~0 dBTP on the V6 mix); 0.3 dB of extra headroom keeps the sample peak safely
# below -1 dBFS (-1.3 dBFS), at ~-14.4 LUFS, i.e. within ~0.3 LU of the original.
OUTPUT_TRIM_DB = -0.3


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack_z33.wav'
    y, info = S.main(out)
    y = y * db(OUTPUT_TRIM_DB)
    S.write_wav(out, y)
    print("wrote", out)
    S.summary(y, info)

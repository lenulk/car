#!/usr/bin/env python3
"""
Car-reveal soundtrack, variant for an electric hypercar (three motors).
Usage:   python3 soundtrack_ev.py out.wav

Same 32.0 s / 48 kHz / 16-bit stereo programme as soundtrack.py: same timeline,
cut points, music bed, SFX, shot perspectives (exterior / cockpit / bay / ducked),
pass-by pan + loudness shape + Doppler, and master chain.  This file imports
soundtrack.py (which must sit next to it, and is not modified) and replaces only
the *car sound*.  There is no combustion sound, no gear shift and no exhaust pop.

Electric drive sound (everything keyed to ROAD SPEED, see build_speed()):
  * Motor/inverter whine: three motors (rear-left, rear-right, front; the two rear motors detuned by 0.15 %, the front motor geared 0.84x) x four pure-ish tone layers at NON-INTEGER ratios 1 : 2.3 : 3.4 : 4.7 of
    a base of 5.4 Hz per km/h  (810 Hz at 150 km/h, so the top layer reaches
    ~3.8 kHz).  Higher layers come in with power.  Doppler on the 4.6 s pass-by
    is applied to every tonal layer exactly as in the original.
  * Gear-reduction hum (1.6 Hz per km/h + harmonics), faint inverter PWM hiss
    (~9-11 kHz band + weak carrier), tyre roar (~v^1.7) and wind rush (~v^3.2).
    All of these grow with speed.
  * 0.8-1.6 s "ignition" -> soft rising electronic power-up: contactor thunk,
    spin-up sweep, rising bell arpeggio that lands on the 1.6 s light stinger
    (the stinger's crack/noise is softened; its sub-weight is unchanged).
  * 13.2-13.8: the whine glides down with the speed (regen "wind-down"), then a
    quiet standby hum (HV hum + coolant pump + air) replaces the idling engine.
  * 16.4-19.6 launch: 0 -> 100 km/h in 1.9 s (reached at 18.3 s), 143 km/h at 19.6.
  * 19.6-22.8 bay: quiet hum, two motor blips (short whine sweeps) at 20.6 / 21.8.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import soundtrack as S
from soundtrack import (SR, N, TT, TWO_PI, tarr, filt, noise, smoothstep, smooth_sym,
                        lpnoise, tv_filter, pan_gains, db, curve, seg_mask)

HZ_PER_KMH = 5.4                          # base whine: 810 Hz @ 150 km/h
RATIOS = (1.0, 2.3, 3.4, 4.7)             # non-integer layer ratios (top = ~3.8 kHz)
LAYER_AMP = (1.0, 0.65, 0.28, 0.40)
MOTORS = ((1.000, -0.40, 1.0), (1.0015, 0.40, 1.0), (0.840, 0.0, 0.75))   # (freq ratio, pan, level): RL, RR, front (own gearing)

# component levels re. the whine (RMS, at 150 km/h / 0.8 power)
GEAR_DB, ROAR_DB, WIND_DB, HISS_DB, HUM_DB = -9.0, -12.0, -16.0, -25.0, -11.0

# Per-shot engine-stem RMS targets (dBFS), same mechanism as soundtrack.engine_bus
# (original V8 values: -15 / -16 / -24 / -12.5 / -17.5 / -36 / -30).  Each is the V8
# value corrected so that the K-weighted (BS.1770) loudness of the shot equals the
# V8 stem's, except door (-3 dB) and bay (-2 dB), which are deliberately quieter:
# a standby hum instead of an idling engine.
SEG_DB = {
    'ext1': -15.3, 'ext2': -16.5, 'door': -28.7, 'cab': -13.9, 'bay': -19.8,
    'xray': -37.8, 'hero': -31.7,
}

BLIPS = ((20.6, 85.0), (21.8, 115.0))      # (time s, km/h-equivalent peak of the motor sweep)


# ----------------------------------------------------------------------------
# Intro: ignition -> soft electronic power-up
# ----------------------------------------------------------------------------
def _bell(f, amp, dur=1.3):
    m = int(dur * SR)
    t = tarr(m)
    env = (1 - np.exp(-t / 0.008)) * np.exp(-t / 0.50)
    y = np.sin(TWO_PI * f * t + 1.1 * np.exp(-t / 0.07) * np.sin(TWO_PI * f * 3.5 * t))
    y += 0.30 * np.sin(TWO_PI * f * 2.76 * t) * np.exp(-t / 0.20)
    return y * env * amp


def ev_powerup():
    """Replacement for soundtrack.zap(): placed at 0.8 s, so the sweep rises over
    0.8-1.6 s and the chime chord lands on the 1.6 s stinger."""
    rng = np.random.default_rng(81)
    n = int(1.9 * SR)
    t = tarr(n)
    y = np.zeros(n)
    # soft HV-contactor thunk
    thunk = np.sin(TWO_PI * np.cumsum(55 + 70 * np.exp(-t / 0.018)) / SR) * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.002))
    tick = filt(noise(n, rng=rng), 'bp', 2400, 1.2) * np.exp(-t / 0.006) * (1 - np.exp(-t / 0.0004))
    y += 0.34 * thunk + 0.07 * tick
    # inverter spin-up: E3 -> E6 over 0.8 s, with a fifth coming in later
    T = 0.80
    x = np.clip(t / T, 0, 1)
    f = 164.8 * 8.0 ** (x ** 1.35)
    ph = TWO_PI * np.cumsum(f) / SR
    env = smoothstep(t / 0.35) * (0.15 + 0.85 * x ** 1.5) * (1 - smoothstep((t - T) / 0.14))
    trem = 1 + 0.07 * np.sin(TWO_PI * 11.0 * t)
    tone = np.sin(ph) + 0.30 * np.sin(2 * ph + 0.5) + 0.10 * np.sin(3 * ph)
    fifth = np.sin(1.5 * ph + 0.3) * x ** 2.2
    y += 0.36 * filt(tone + 0.45 * fifth, 'lp', 6500, 0.7) * env * trem
    # air shimmer rising with it
    sh = tv_filter(noise(n, rng=rng), 'bp', lambda tt: 700.0 * (7000.0 / 700.0) ** np.clip(tt / T, 0, 1), 3.0)
    sh /= np.std(sh)
    y += 0.07 * sh * (x ** 2.0) * smoothstep(t / 0.2) * (1 - smoothstep((t - T) / 0.25))
    # rising bell arpeggio (A minor, like the bass) landing on the stinger at t = 0.80
    for tn, fn, an in ((0.34, 440.0, 0.20), (0.50, 523.25, 0.25), (0.65, 659.25, 0.30)):
        b = _bell(fn, an, 1.0)
        i0 = int(tn * SR)
        y[i0:i0 + len(b)] += b[:n - i0]
    for fn, an in ((440.0, 0.20), (880.0, 0.34), (1318.5, 0.27), (2637.0, 0.06)):
        b = _bell(fn, an, 1.1)
        i0 = int(T * SR)
        y[i0:i0 + len(b)] += b[:n - i0]
    y *= 1 - smoothstep((t - 1.6) / 0.3)
    return y


_orig_boom = S.boom


def boom_soft_intro(dur, f0, f1, tau_f, tau_a, noise_amt=0.35, crack=0.25, drive=1.8, rng=None):
    """The 3.0 s boom is the 1.6 s light stinger (the only call with that duration).
    Same sub weight and RNG consumption, but without the explosive crack/noise."""
    if abs(dur - 3.0) < 1e-9:
        noise_amt, crack, drive = noise_amt * 0.45, crack * 0.15, min(drive, 1.4)
    return _orig_boom(dur, f0, f1, tau_f, tau_a, noise_amt=noise_amt, crack=crack, drive=drive, rng=rng)


# ----------------------------------------------------------------------------
# Speed / power profiles
# ----------------------------------------------------------------------------
def _blip_shape(tb):
    x = TT - tb
    return np.where(x < 0, 0.0, smoothstep(x / 0.10) * np.exp(-np.maximum(x - 0.10, 0) / 0.17))


def build_speed():
    """Road speed (km/h) per sample."""
    pts = [
        (0.0, 0.0), (3.19, 76.0), (3.2, 78.0), (4.2, 95.0), (4.6, 101.0), (5.0, 105.0), (6.0, 113.0),
        (8.0, 127.0), (10.4, 140.0), (13.2, 150.0),
        (13.30, 136.0), (13.45, 92.0), (13.62, 40.0), (13.80, 0.0), (16.39, 0.0),     # wind-down / stop
        (16.40, 0.0), (16.70, 17.0), (17.00, 38.0), (17.30, 58.0), (17.60, 76.0), (17.90, 89.0),
        (18.30, 100.0),                                                                # 100 km/h in 1.9 s
        (18.90, 120.0), (19.59, 143.0), (19.60, 143.0),
        (19.62, 0.0), (32.0, 0.0),
    ]
    v = curve(pts, 0.015)
    cruise = smoothstep((TT - 9.0) / 1.0) * (1 - smoothstep((TT - 13.2) / 0.05))
    v = v * (1 + cruise * (0.006 * np.sin(TWO_PI * (TT - 9.5) / 1.9) + 0.002 * np.sin(TWO_PI * (TT - 9.5) / 0.73)))
    return v


def build_power():
    """Drive power 0..1 (inverter load): drives brightness of the whine and the hiss."""
    pts = [(0, 0.10), (3.2, 0.75), (5.0, 0.80), (9.5, 0.85), (13.2, 0.85), (13.22, 0.70), (13.5, 0.50), (13.8, 0.05),
           (16.38, 0.05), (16.40, 1.0), (19.6, 1.0), (19.62, 0.12), (22.8, 0.12), (28.4, 0.15), (32, 0.10)]
    p = curve(pts, 0.02)
    for tb, _ in BLIPS:
        p = np.maximum(p, 0.9 * _blip_shape(tb))
    return p


# ----------------------------------------------------------------------------
# Electric drive voice
# ----------------------------------------------------------------------------
def _fcurve(arr):
    return lambda tt: np.interp(tt, TT, arr)


def ev_voice(v_road, P, dop, seed=21):
    rng = np.random.default_rng(seed)
    v_m = v_road.copy()
    for tb, pk in BLIPS:
        v_m = v_m + pk * _blip_shape(tb)              # unloaded motor blips (car stationary)
    sp = np.clip(v_m / 150.0, 0, 1.3)
    gv = smoothstep(v_m / 9.0) * (0.40 + 0.60 * np.clip(v_m / 110.0, 0, 1.2))

    # ---- motor/inverter whine: 3 motors x 4 layers ----
    la = (0.35 + 0.65 * P, 0.15 + 0.85 * P, 0.10 + 0.90 * P, 0.05 + 0.95 * P ** 1.3)
    whine = np.zeros((2, N))
    for mi, (det, pan, mlev) in enumerate(MOTORS):
        m = np.zeros(N)
        jit = 1 + 0.0015 * lpnoise(40.0, rng)
        for li, ratio in enumerate(RATIOS):
            f = HZ_PER_KMH * v_m * dop * ratio * det * jit
            ph = TWO_PI * np.cumsum(f) / SR + rng.uniform(0, TWO_PI)
            flut = 1 + 0.05 * lpnoise(7.0, rng)
            m += LAYER_AMP[li] * la[li] * flut * (np.sin(ph) + 0.05 * np.sin(2 * ph + 0.4))
        l, r = pan_gains(pan)
        whine[0] += m * mlev * gv * l * 1.4142
        whine[1] += m * mlev * gv * r * 1.4142
    on = (TT > 9.5) & (TT < 13.2)
    ref = np.sqrt(np.mean(whine[:, on] ** 2))
    whine = whine / ref                                # whine RMS = 1.0 at cruise

    # ---- gear-reduction hum (one reduction per motor, slightly different) ----
    gear = np.zeros((2, N))
    gg = smoothstep(v_m / 12.0) * (0.30 + 0.70 * P) * (0.40 + 0.60 * sp)
    for det, pan, _ in MOTORS:
        f = 1.6 * v_m * dop * det
        ph = TWO_PI * np.cumsum(f) / SR + rng.uniform(0, TWO_PI)
        g = np.sin(ph) + 0.55 * np.sin(2 * ph + 0.7) + 0.25 * np.sin(3.05 * ph + 1.3)
        l, r = pan_gains(pan)
        gear[0] += g * l * 1.4142
        gear[1] += g * r * 1.4142
    gear *= gg
    gear *= db(GEAR_DB) / (np.sqrt(np.mean(gear[:, on] ** 2)) + 1e-12)

    # ---- inverter switching hiss (+ faint spread-spectrum carrier) ----
    carrier = 9200.0 * (1 + 0.03 * lpnoise(3.0, rng))
    cph = TWO_PI * np.cumsum(carrier) / SR
    hiss = np.stack([filt(filt(noise(N, rng=rng), 'bp', 10000, 0.6), 'hp', 6500, 0.7) for _ in range(2)])
    hiss /= np.std(hiss)
    hiss += 0.35 * np.stack([np.sin(cph), np.sin(cph + 1.1)])
    hg = smoothstep(v_m / 20.0) * (0.15 + 0.85 * P) * (0.35 + 0.65 * sp)
    hiss *= hg
    hiss *= db(HISS_DB) / (np.sqrt(np.mean(hiss[:, on] ** 2)) + 1e-12)

    # ---- tyre roar and wind rush: physical road speed ----
    sr_ = np.clip(v_road / 150.0, 0, 1.3)
    fr_roar = 300.0 + 3.0 * v_road
    roar = np.stack([tv_filter(noise(N, 'pink', rng=rng), 'bp', _fcurve(fr_roar), 0.5) for _ in range(2)])
    roar /= np.std(roar)
    roar *= sr_ ** 1.7 * np.clip(1 + 0.20 * lpnoise(11.0, rng), 0.3, 2.0)
    roar *= db(ROAR_DB) / (np.sqrt(np.mean(roar[:, on] ** 2)) + 1e-12)
    fr_wind = 700.0 + 9.0 * v_road
    wind = np.stack([tv_filter(noise(N, rng=rng), 'bp', _fcurve(fr_wind), 0.35) for _ in range(2)])
    wind /= np.std(wind)
    wind *= sr_ ** 3.2 * np.clip(1 + 0.30 * lpnoise(3.0, rng), 0.2, 2.5)
    wind *= db(WIND_DB) / (np.sqrt(np.mean(wind[:, on] ** 2)) + 1e-12)

    # ---- standby hum when the car is parked (HV hum + coolant pump + air) ----
    t = TT
    hum = (0.50 * np.sin(TWO_PI * 100.0 * t) + 0.30 * np.sin(TWO_PI * 200.4 * t + 0.8)
           + 0.15 * np.sin(TWO_PI * 301.3 * t + 2.1))
    hum *= 1 + 0.10 * np.sin(TWO_PI * 0.45 * t)
    pump = (np.sin(TWO_PI * np.cumsum(143.7 * (1 + 0.004 * lpnoise(2.0, rng))) / SR)
            + 0.5 * np.sin(TWO_PI * np.cumsum(287.9 * (1 + 0.004 * lpnoise(2.0, rng))) / SR + 1.0)
            + 0.2 * np.sin(TWO_PI * np.cumsum(433.2 * (1 + 0.004 * lpnoise(2.0, rng))) / SR + 2.0))
    air = np.stack([filt(noise(N, rng=rng), 'bp', 2400, 0.7) for _ in range(2)])
    air /= np.std(air)
    stat = np.stack([hum * 1.0 + 0.45 * pump, hum * 1.0 + 0.45 * np.roll(pump, 60)]) + 0.10 * air
    park = curve([(0, 0.0), (13.2, 0.0), (13.6, 0.35), (13.9, 1.0), (16.38, 1.0), (16.4, 0.0), (19.6, 0.0),
                  (19.62, 1.0), (32, 1.0)], 0.03)
    drive_h = 0.12 * (1 - park)                       # a trace of it under the drive
    stat = stat * (park + drive_h) * (1 + 0.08 * np.stack([lpnoise(0.7, rng), lpnoise(0.7, rng)]))
    stat *= db(HUM_DB) / (np.sqrt(np.mean(stat[:, (TT > 14.0) & (TT < 16.3)] ** 2)) + 1e-12)

    ev_voice.parts = dict(whine=whine, gear=gear, hiss=hiss, roar=roar, wind=wind, hum=stat)   # for inspection
    return whine + gear + hiss + roar + wind + stat


# ----------------------------------------------------------------------------
# Engine bus (same structure as soundtrack.engine_bus; no pops)
# ----------------------------------------------------------------------------
def engine_bus_ev():
    rpm_dop, rpm_clean = S.build_rpm()                # only used for the exterior pass-by Doppler factor
    dop = rpm_dop / rpm_clean
    v = build_speed()
    P = build_power()
    core = ev_voice(v, P, dop)

    def per_ch(fn):
        return lambda x: np.stack([fn(c) for c in x])

    ext = per_ch(lambda c: filt(filt(filt(c, 'peak', 230, 1.0, 3.0), 'peak', 1500, 1.0, 2.0), 'hs', 7000, 0.7, -3.0))
    # cockpit: same low-mid weight, but a quiet EV cabin is less muffled up top
    cab = per_ch(lambda c: filt(filt(filt(filt(filt(c, 'ls', 140, 0.7, 3.0), 'peak', 90, 1.2, 2.5),
                                           'peak', 340, 1.0, 2.0), 'lp', 4800, 0.8), 'lp', 6500, 0.7))
    bay = per_ch(lambda c: filt(filt(filt(c, 'hp', 60, 0.7), 'peak', 800, 1.0, 3.0), 'hs', 4000, 0.7, 2.0))
    dull = per_ch(lambda c: filt(filt(c, 'lp', 520, 0.8), 'hp', 40, 0.7))

    E_ext = ext(core)
    E_ext_dull = per_ch(lambda c: filt(c, 'lp', 1800, 0.7))(E_ext)
    E_cab = cab(core)
    E_bay = bay(core)
    E_dull = dull(core)

    wd = curve([(3.2, 0), (4.5, 0), (5.4, 0.75), (6.0, 0.75)], 0.05)
    E1 = E_ext * (1 - wd) + E_ext_dull * wd
    mono = 0.5 * (E1[0] + E1[1])
    pan = np.where(TT < 4.2, 0.30 + 0.55 * smoothstep((TT - 3.2) / 1.0),
                   np.where(TT < 5.0, 0.85 - 1.70 * smoothstep((TT - 4.2) / 0.8), -0.85 + 0.55 * smoothstep((TT - 5.0) / 1.0)))
    gl = np.cos((pan + 1) * np.pi / 4) * 1.4142
    gr = np.sin((pan + 1) * np.pi / 4) * 1.4142
    E1 = np.stack([0.85 * mono * gl + 0.15 * E1[0], 0.85 * mono * gr + 0.15 * E1[1]])

    rear = np.stack([filt(c, 'ls', 120, 0.7, 3.0) for c in E_ext])
    front = np.stack([filt(c, 'hs', 3500, 0.7, 2.5) for c in E_ext])
    E2 = E_ext * seg_mask(6.0, 8.0) + rear * seg_mask(8.0, 10.4) + front * seg_mask(10.4, 13.2)

    segs = [
        ('ext1', 3.2, 6.0, E1), ('ext2', 6.0, 13.2, E2), ('door', 13.2, 16.4, E_ext),
        ('cab', 16.4, 19.6, E_cab), ('bay', 19.6, 22.8, E_bay),
        ('xray', 22.8, 25.6, E_dull), ('hero', 25.6, 30.0, E_dull),
    ]
    shape = curve([(3.2, 0.45), (4.0, 0.70), (4.45, 1.0), (4.6, 1.25), (4.78, 1.0), (5.2, 0.62), (6.0, 0.60),
                   (6.01, 1.0), (30, 1.0)], 0.05)
    out = np.zeros((2, N))
    for name, a, b, sig in segs:
        m = seg_mask(a, b)
        part = sig * shape * m
        i0, i1 = int(a * SR), int(b * SR)
        rms = np.sqrt(np.mean(part[:, i0:i1] ** 2))
        out += part * (db(SEG_DB[name]) / rms)
    out *= (1 - smoothstep((TT - 30.0) / 0.8))
    return out, v, P


# ----------------------------------------------------------------------------
# Patch the shared programme and run it
# ----------------------------------------------------------------------------
S.zap = ev_powerup
S.boom = boom_soft_intro
S.engine_bus = engine_bus_ev


# Final output trim.  The shared master chain peak-normalises to 0.8913 (-1.0 dBFS,
# and ~0 dBTP on the V6 mix); 0.3 dB of extra headroom keeps the sample peak safely
# below -1 dBFS (-1.3 dBFS), at ~-14.4 LUFS, i.e. within ~0.3 LU of the original.
OUTPUT_TRIM_DB = -0.3


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack_ev.wav'
    y, info = S.main(out)
    y = y * db(OUTPUT_TRIM_DB)
    S.write_wav(out, y)
    print("wrote", out)
    S.summary(y, info)

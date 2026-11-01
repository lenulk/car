#!/usr/bin/env python3
"""
Fully synthesised 32.0 s / 48 kHz / 16-bit stereo soundtrack for the car-reveal
video.  Pure numpy, no scipy.  Usage:   python3 soundtrack.py out.wav

Timeline (s)
  0.0-3.2   Ignition   sub drone, zap @0.8 (DRLs), boom @1.6 (main beams)
  3.2-13.2  Driving    V8 + doppler pass-by @4.6, shift @5.6
  13.2-16.4 Doors      engine settles to idle by 13.8, latch clicks @13.8/13.9
  16.4-19.6 Cockpit    launch, upshifts 17.4 / 18.3 / 19.2, cabin low-pass
  19.6-22.8 Engine bay hiss @19.6, revving idle, blips @20.6 / 21.8
  22.8-25.6 X-ray      everything ducks, digital scan sweep 23.0-24.8
  25.6-30.0 Hero       low hits 25.6 / 26.7 / 27.6, riser -> BIG hit 28.5
  30.0-32.0 Tail       fade/reverb tail, silent by 31.8
Music bed: 128 BPM pulse from 3.2 to 28.5, whoosh+impact on every cut.
"""
import sys
import wave
import numpy as np

SR = 48000
DUR = 32.0
N = int(SR * DUR)
TT = np.arange(N) / SR
TWO_PI = 2.0 * np.pi
RNG = np.random.default_rng(20240607)

CUTS = [3.2, 6.0, 8.0, 10.4, 13.2, 16.4, 19.6, 22.8, 25.6, 30.0]
BPM = 128.0
BEAT = 60.0 / BPM


# ----------------------------------------------------------------------------
# DSP primitives (no scipy)
# ----------------------------------------------------------------------------
def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def db(x):
    return 10.0 ** (x / 20.0)


def biquad_coefs(kind, f, q=0.70710678, gain_db=0.0):
    """RBJ cookbook biquads. Returns (b, a) normalised so a[0] == 1."""
    f = float(np.clip(f, 8.0, SR * 0.45))
    w0 = TWO_PI * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2.0 * q)
    A = 10.0 ** (gain_db / 40.0)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bp':   # constant 0 dB peak gain
        b = [alpha, 0.0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'notch':
        b = [1.0, -2 * cw, 1.0]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'ls':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw),
             A * ((A + 1) - (A - 1) * cw - s)]
        a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw),
             (A + 1) + (A - 1) * cw - s]
    elif kind == 'hs':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw),
             A * ((A + 1) + (A - 1) * cw - s)]
        a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw),
             (A + 1) - (A - 1) * cw - s]
    else:
        raise ValueError(kind)
    b = np.array(b, float)
    a = np.array(a, float)
    return b / a[0], a / a[0]


def fftconv(x, h):
    """Causal convolution, output truncated to len(x). Works along last axis."""
    n = x.shape[-1] + len(h) - 1
    L = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, L, axis=-1) * np.fft.rfft(h, L), L, axis=-1)
    return y[..., :x.shape[-1]]


def iir(x, b, a, tol=1e-7):
    """Filter x with biquad (b,a) by FFT-convolving with its (truncated) impulse response."""
    M = 1 << 17
    h = np.fft.irfft(np.fft.rfft(b, M) / np.fft.rfft(a, M), M)
    big = np.nonzero(np.abs(h) > tol * np.max(np.abs(h)))[0]
    h = h[:big[-1] + 1] if len(big) else h[:1]
    return fftconv(x, h)


def filt(x, kind, f, q=0.70710678, gain_db=0.0):
    b, a = biquad_coefs(kind, f, q, gain_db)
    return iir(x, b, a)


def smooth_sym(x, win_s):
    """Zero-phase Hann smoothing."""
    m = max(3, int(win_s * SR) | 1)
    k = np.hanning(m + 2)[1:-1]
    k /= k.sum()
    xp = np.pad(x, (m, m), mode='edge')
    y = fftconv(xp, k)
    s = m + (m - 1) // 2
    return y[s:s + len(x)]


def tv_filter(x, kind, f_of_t, q=0.8, gain_db=0.0, W=2048):
    """
    Time-varying biquad via windowed overlap-add (Hann, 50 %).  f_of_t / q may be
    callables of time-in-seconds (evaluated at block centres) or scalars.
    """
    H = W // 2
    n = len(x)
    nb = -(-n // H) + 1
    xp = np.zeros((nb + 4) * H)
    xp[H:H + n] = x
    centres = np.arange(nb) * H / SR
    f = f_of_t(centres) if callable(f_of_t) else np.full(nb, f_of_t)
    qq = q(centres) if callable(q) else np.full(nb, q)
    w = np.arange(W + 1) * np.pi / W
    z1 = np.exp(-1j * w)
    z2 = z1 * z1
    Hf = np.empty((nb, W + 1), complex)
    for i in range(nb):
        b, a = biquad_coefs(kind, f[i], qq[i], gain_db)
        Hf[i] = (b[0] + b[1] * z1 + b[2] * z2) / (1 + a[1] * z1 + a[2] * z2)
    win = 0.5 - 0.5 * np.cos(TWO_PI * np.arange(W) / W)
    idx = np.arange(nb)[:, None] * H + np.arange(W)[None, :]
    B = xp[idx] * win
    Y = np.fft.irfft(np.fft.rfft(B, 2 * W, axis=1) * Hf, 2 * W, axis=1)  # nb x 2W
    out = np.zeros((nb + 4) * H)
    o2 = out.reshape(-1, H)
    for p in range(4):
        o2[p:p + nb] += Y[:, p * H:(p + 1) * H]
    return out[H:H + n]


def noise(n, color='white', rng=None):
    rng = RNG if rng is None else rng
    w = rng.standard_normal(n)
    if color != 'white':
        F = np.fft.rfft(w)
        f = np.fft.rfftfreq(n)
        f[0] = f[1]
        F = F / (np.sqrt(f / f[1]) if color == 'pink' else (f / f[1]))
        w = np.fft.irfft(F, n)
    return w / (np.std(w) + 1e-12)


def tarr(n):
    return np.arange(n) / SR


def env_exp(n, tau, atk=0.002):
    t = tarr(n)
    return (1 - np.exp(-t / (atk / 4.0))) * np.exp(-t / tau)


def gliss_sine(n, f0, f1, tau_f):
    t = tarr(n)
    f = f1 + (f0 - f1) * np.exp(-t / tau_f)
    return np.sin(TWO_PI * np.cumsum(f) / SR)


def curve(points, smooth=0.0):
    p = np.array(points, float)
    c = np.interp(TT, p[:, 0], p[:, 1])
    return smooth_sym(c, smooth) if smooth > 0 else c


def lpnoise(f, rng, n=N):
    """slow random control signal, unit-ish std"""
    z = rng.standard_normal(n)
    z = filt(z, 'lp', f, 0.7)
    return z / (np.std(z) + 1e-12)


# ----------------------------------------------------------------------------
# Reverb: parallel damped feedback combs + series allpasses (block-vectorised)
# ----------------------------------------------------------------------------
def _comb(x, D, g, w=(0.45, 0.35, 0.20)):
    n = len(x)
    P = D + 3
    y = np.zeros(P + n)
    for s in range(0, n, D):
        e = min(s + D, n)
        a = P + s - D
        b = P + e - D
        y[P + s:P + e] = x[s:e] + g * (w[0] * y[a:b] + w[1] * y[a - 1:b - 1] + w[2] * y[a - 2:b - 2])
    return y[P:]


def _allpass(x, D, g=0.5):
    n = len(x)
    P = D + 1
    v = np.zeros(P + n)
    for s in range(0, n, D):
        e = min(s + D, n)
        v[P + s:P + e] = x[s:e] + g * v[P + s - D:P + e - D]
    vv = v[P:]
    d = np.zeros(n)
    d[D:] = vv[:-D]
    return -g * vv + d


class Reverb:
    def __init__(self, rt60, delays_ms, ap_ms=(12.7, 10.0, 7.7, 5.1), pre_ms=20.0,
                 hp=100.0, lp=7500.0, damp=(0.45, 0.35, 0.20), wet=0.30):
        self.rt60, self.d, self.ap, self.pre = rt60, delays_ms, ap_ms, pre_ms
        self.hp, self.lp, self.damp, self.wet = hp, lp, damp, wet

    def process(self, x):
        n = len(x)
        pre = int(self.pre * SR / 1000)
        xin = np.concatenate([np.zeros(pre), x])[:n]
        xin = filt(filt(xin, 'hp', self.hp, 0.6), 'lp', self.lp, 0.6)
        out = np.zeros((2, n))
        for ch in range(2):
            acc = np.zeros(n)
            for i, dm in enumerate(self.d):
                D = int(round(dm * SR / 1000 * (1.0 if ch == 0 else 1.0137))) + (7 * ch)
                g = 10 ** (-3.0 * D / (SR * self.rt60))
                acc += _comb(xin, D, g, self.damp) * (1.0 if i % 2 == 0 else -1.0)
            for j, am in enumerate(self.ap):
                D = int(round(am * SR / 1000 * (1.0 + 0.09 * ch)))
                acc = _allpass(acc, D, 0.5)
            out[ch] = acc
        return out * self.wet / np.sqrt(len(self.d))


# ----------------------------------------------------------------------------
# Mix buses
# ----------------------------------------------------------------------------
FX = np.zeros((2, N))     # transients / sfx (dry)
ENG = np.zeros((2, N))    # engine (final, post-perspective)
MUS = np.zeros((2, N))    # musical bed
HALL = np.zeros(N)        # mono send -> large hall
ROOM = np.zeros(N)        # mono send -> small room
STEMS = {}                # debug: final stems before master


def pan_gains(p):
    a = (np.clip(p, -1, 1) + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


def put(sig, t0, gain=1.0, pan=0.0, hall=0.0, room=0.0, bus=None):
    """Add mono (n,) or stereo (2,n) signal at time t0 to a bus, with optional sends."""
    bus = FX if bus is None else bus
    sig = np.asarray(sig, float)
    i0 = int(round(t0 * SR))
    n = sig.shape[-1]
    s0 = max(0, -i0)
    i0 = max(0, i0)
    i1 = min(N, i0 + n - s0)
    if i1 <= i0:
        return
    s = sig[..., s0:s0 + (i1 - i0)]
    if s.ndim == 1:
        l, r = pan_gains(pan)
        bus[0, i0:i1] += s * gain * l
        bus[1, i0:i1] += s * gain * r
        mono = s
    else:
        bus[0, i0:i1] += s[0] * gain
        bus[1, i0:i1] += s[1] * gain
        mono = 0.5 * (s[0] + s[1])
    if hall:
        HALL[i0:i1] += mono * gain * hall
    if room:
        ROOM[i0:i1] += mono * gain * room


def stereo_noise_filtered(n, kind, f, q, rng):
    """two decorrelated filtered-noise channels -> (2,n)"""
    return np.stack([filt(noise(n, rng=rng), kind, f, q) for _ in range(2)])


# ----------------------------------------------------------------------------
# SFX building blocks
# ----------------------------------------------------------------------------
def boom(dur, f0, f1, tau_f, tau_a, noise_amt=0.35, crack=0.25, drive=1.8, rng=None):
    rng = RNG if rng is None else rng
    n = int(dur * SR)
    t = tarr(n)
    s = gliss_sine(n, f0, f1, tau_f)
    s = np.tanh(drive * s) / np.tanh(drive)
    env = (1 - np.exp(-t / 0.003)) * np.exp(-t / tau_a)
    body = filt(noise(n, rng=rng), 'lp', 500, 0.7) * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.002))
    ck = filt(noise(n, rng=rng), 'hp', 2200, 0.7) * np.exp(-t / 0.012) * (1 - np.exp(-t / 0.0005))
    thump = filt(noise(n, rng=rng), 'lp', 140, 0.9) * np.exp(-t / 0.05)
    return s * env + noise_amt * body + crack * ck + 0.5 * thump


def whoosh(dur, f0, f1, q, shape, rng, rising=True, width=0.7):
    """Stereo swept-noise whoosh. shape: 'swell' (rises to end) or 'decay'."""
    n = int(dur * SR)
    t = tarr(n)
    fofs = (lambda tt: f0 * (f1 / f0) ** (tt / dur))
    chans = []
    for _ in range(2):
        chans.append(tv_filter(noise(n, rng=rng), 'bp', fofs, q))
    y = np.stack(chans)
    y /= (np.std(y) + 1e-12)
    if shape == 'swell':
        e = (t / dur) ** 2.2 * (1 - smoothstep((t - (dur - 0.01)) / 0.01))
    else:
        e = np.exp(-t / (dur / 3.2)) * (1 - np.exp(-t / 0.01))
    y *= e
    p = (np.linspace(-width, width, n) if rising else np.linspace(width, -width, n))
    l = np.cos((p + 1) * np.pi / 4)
    r = np.sin((p + 1) * np.pi / 4)
    y[0] *= l * 1.4142
    y[1] *= r * 1.4142
    return y


def cut_hit(T, level=1.0, rng=None, pre=0.30, post=0.5, f_pre=(260, 6500), f_post=(5000, 420)):
    """Whoosh into the cut + impact at the cut."""
    rng = RNG if rng is None else rng
    L = level
    put(whoosh(pre, f_pre[0], f_pre[1], 1.6, 'swell', rng), T - pre, gain=0.36 * L, room=0.10)
    put(whoosh(post, f_post[0], f_post[1], 1.2, 'decay', rng, rising=False), T, gain=0.28 * L, room=0.12)
    imp = boom(1.0, 95, 34, 0.09, 0.28, noise_amt=0.55, crack=0.45, drive=1.6, rng=rng)
    put(imp, T, gain=0.80 * L, hall=0.10 * L)


# ----------------------------------------------------------------------------
# Intro: drone, zap, boom
# ----------------------------------------------------------------------------
def intro_drone():
    n = int(3.2 * SR)
    t = tarr(n)
    A = (t / 3.2) ** 1.8
    # duck briefly at the 1.6 s boom, then swell again
    A *= 1.0 - 0.45 * np.exp(-np.maximum(t - 1.6, 0) / 0.35) * (t >= 1.6)
    vib = 1 + 0.004 * np.sin(TWO_PI * 0.37 * t)
    ph1 = TWO_PI * np.cumsum(38.0 * vib) / SR
    ph2 = TWO_PI * np.cumsum(38.8 * vib) / SR
    y = np.sin(ph1) + 0.8 * np.sin(ph2) + 0.35 * np.sin(2 * ph1 + 0.7) + 0.18 * np.sin(3 * ph2)
    y = np.tanh(1.3 * y) * 0.6
    rumble = filt(noise(n, 'brown'), 'lp', 90, 0.8) * 0.5
    y = (y + rumble) * A
    # rising air / tension shimmer toward the first cut
    air = tv_filter(noise(n, 'pink'), 'bp', lambda tt: 1500 + 3500 * (tt / 3.2) ** 1.5, 1.2)
    air *= (t / 3.2) ** 3.5 * 0.10
    out = np.stack([y + air * 0.8, y + np.roll(air, 700)]) * 1.0
    return out


def zap():
    rng = np.random.default_rng(77)
    n = int(1.0 * SR)
    t = tarr(n)
    y = np.zeros(n)
    nz = filt(noise(n, rng=rng), 'hp', 2500)
    g = np.zeros(n)
    for tb in np.sort(rng.uniform(0, 0.09, 10)):
        i = int(tb * SR)
        L = int(rng.uniform(0.001, 0.004) * SR)
        g[i:i + L] += rng.uniform(0.4, 1.0) * np.exp(-np.arange(L) / (L / 3.0))
    y += 0.75 * nz * g
    f = 900 + 5200 * np.exp(-t / 0.022)
    y += 0.55 * np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.03) * (1 - np.exp(-t / 0.0003))
    y[:4] += np.array([0.9, -0.9, 0.6, -0.3])
    thunk = np.sin(TWO_PI * np.cumsum(55 + 85 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.05)
    y += 0.9 * thunk
    # second LED bar tick
    i2 = int(0.055 * SR)
    y[i2:] += 0.45 * y[:n - i2] * 0.8
    buzz = filt(np.sign(np.sin(TWO_PI * 120 * t)), 'lp', 2200) * np.exp(-t / 0.10) * (1 - np.exp(-t / 0.004))
    y += 0.22 * buzz
    ping = (np.sin(TWO_PI * 2093 * t) + 0.6 * np.sin(TWO_PI * 3136 * t) + 0.3 * np.sin(TWO_PI * 4186 * t))
    y += 0.10 * ping * np.exp(-t / 0.25) * (1 - np.exp(-t / 0.004))
    return y


# ----------------------------------------------------------------------------
# Doors, bonnet, scan, hero
# ----------------------------------------------------------------------------
def latch_click(rng):
    n = int(0.3 * SR)
    t = tarr(n)
    y = np.zeros(n)
    tick = filt(noise(n, rng=rng), 'bp', 3500, 1.5) * np.exp(-t / 0.004)
    tick += 0.6 * np.sin(TWO_PI * 4200 * t) * np.exp(-t / 0.005)
    y += tick * (1 - np.exp(-t / 0.0003))
    i2 = int(0.040 * SR)
    t2 = tarr(n - i2)
    clunk = np.sin(TWO_PI * np.cumsum(170 - 80 * (1 - np.exp(-t2 / 0.02))) / SR) * np.exp(-t2 / 0.03)
    clunk += 0.8 * filt(noise(n - i2, rng=rng), 'bp', 700, 1.0) * np.exp(-t2 / 0.02)
    y[i2:] += 0.9 * clunk * (1 - np.exp(-t2 / 0.0005))
    return y


def hydraulic_open(rng, dur=0.85):
    n = int(dur * SR)
    t = tarr(n)
    fofs = lambda tt: 500 * (1500 / 500) ** (tt / dur)
    y = tv_filter(noise(n, rng=rng), 'bp', fofs, 1.4)
    y /= np.std(y)
    env = smoothstep(t / 0.25) * np.exp(-np.maximum(t - 0.25, 0) / 0.30)
    y *= env
    servo = np.sin(TWO_PI * np.cumsum(140 + 55 * smoothstep(t / 0.6)) / SR) * env * 0.25
    # damped soft thud at the end
    te = max(0, int((dur - 0.3) * SR))
    th = np.zeros(n)
    m = n - te
    tm = tarr(m)
    th[te:] = np.sin(TWO_PI * 85 * tm) * np.exp(-tm / 0.05) * (1 - np.exp(-tm / 0.004))
    return y + servo + 0.9 * th


def bonnet_hiss(rng, dur=1.9):
    n = int(dur * SR)
    t = tarr(n)
    hiss = tv_filter(noise(n, rng=rng), 'bp', lambda tt: 4200 - 800 * tt / dur, 0.7)
    hiss += 0.6 * filt(noise(n, rng=rng), 'hp', 7000, 0.7)
    hiss /= np.std(hiss)
    pulses = 0.75 + 0.25 * np.sin(TWO_PI * 5.5 * t + 1.0)
    env = smoothstep(t / 0.05) * (0.45 + 0.55 * np.exp(-t / 0.5)) * (1 - smoothstep((t - 1.1) / 0.7))
    hiss *= env * pulses
    servo = np.sin(TWO_PI * np.cumsum(380 + 220 * smoothstep(t / 1.0)) / SR) * env * 0.12
    servo += 0.5 * np.sin(TWO_PI * np.cumsum(190 + 110 * smoothstep(t / 1.0)) / SR) * env * 0.12
    # lock-in clunk at the end
    te = int(1.05 * SR)
    m = n - te
    tm = tarr(m)
    lock = np.sin(TWO_PI * 120 * tm) * np.exp(-tm / 0.04) + 0.6 * filt(noise(m, rng=rng), 'bp', 900, 1) * np.exp(-tm / 0.015)
    out = hiss + servo
    out[te:] += 0.8 * lock
    return out


def scan_sweep(rng):
    t0, t1 = 23.0, 24.8
    dur = t1 - t0
    n = int(dur * SR)
    t = tarr(n)
    x = t / dur
    fs = lambda tt: 220 * (7000 / 220) ** ((tt / dur) ** 1.15)
    qs = lambda tt: 5 + 7 * (tt / dur)
    L = tv_filter(noise(n, rng=rng), 'bp', fs, qs)
    R = tv_filter(noise(n, rng=rng), 'bp', fs, qs)
    sw = np.stack([L, R])
    sw /= np.std(sw)
    env = smoothstep(x / 0.08) * (0.12 + 0.88 * x ** 1.5) * (1 - smoothstep((x - 0.97) / 0.03))
    sw *= env
    # digital synth tone gliding up (decimated for grit)
    f = 140 * (3600 / 140) ** (x ** 1.2)
    ph = TWO_PI * np.cumsum(f * (1 + 0.006 * np.sin(TWO_PI * 11 * t))) / SR
    tone = np.sin(ph) + 0.5 * np.sin(2 * ph + 0.4) + 0.25 * np.sign(np.sin(3 * ph))
    hold = 6
    tone = np.repeat(tone[::hold], hold)[:n]
    tone = filt(tone, 'lp', 9000, 0.7) * env * (0.25 + 0.55 * x)
    # auto-pan left -> right
    p = np.linspace(-0.85, 0.85, n)
    l, r = np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)
    out = np.stack([sw[0] * 0.9 + tone * l * 1.2, sw[1] * 0.9 + tone * r * 1.2])
    return out


def glitch_ticks(rng):
    """sparse digital data ticks on a 16th grid (23.0 - 25.4)"""
    step = BEAT / 4
    k = 0
    t = 23.0
    while t < 25.4:
        if rng.random() < 0.55:
            nrep = 1 if rng.random() < 0.7 else int(rng.integers(2, 4))
            for r_ in range(nrep):
                tt = t + r_ * step / 3.0
                kind = rng.integers(0, 3)
                n = int(0.03 * SR)
                tm = tarr(n)
                if kind == 0:
                    s = filt(noise(n, rng=rng), 'hp', 4500) * np.exp(-tm / 0.0015)
                elif kind == 1:
                    f = rng.uniform(1200, 4800)
                    s = np.sign(np.sin(TWO_PI * f * tm)) * np.exp(-tm / 0.006) * 0.35
                    s = filt(s, 'lp', 7000)
                else:
                    f = rng.uniform(2500, 7000)
                    s = np.sin(TWO_PI * f * tm * (1 + 2 * tm)) * np.exp(-tm / 0.004)
                put(s, tt, gain=rng.uniform(0.09, 0.22), pan=rng.uniform(-0.9, 0.9), room=0.5)
        t += step
        k += 1


def orch_hit(T, level, pitch, rng, tail=2.4):
    n = int(tail * SR)
    t = tarr(n)
    s = gliss_sine(n, pitch * 2.2, pitch, 0.07)
    s = np.tanh(1.7 * s) / np.tanh(1.7)
    sub = s * (1 - np.exp(-t / 0.004)) * np.exp(-t / (tail / 3.0))
    drum = (np.sin(TWO_PI * np.cumsum(pitch * 1.9 + 70 * np.exp(-t / 0.04)) / SR)
            + 0.7 * np.sin(TWO_PI * np.cumsum(pitch * 2.6 + 90 * np.exp(-t / 0.04)) / SR))
    drum *= np.exp(-t / 0.28) * (1 - np.exp(-t / 0.002))
    burst = filt(noise(n, rng=rng), 'lp', 1000, 0.7) * np.exp(-t / 0.13) * (1 - np.exp(-t / 0.002))
    air = filt(noise(n, rng=rng), 'hp', 3500, 0.7) * np.exp(-t / 0.45) * (1 - np.exp(-t / 0.002))
    crack = filt(noise(n, rng=rng), 'hp', 1800, 0.7) * np.exp(-t / 0.010)
    # dark orchestral-ish swell underneath (low string/brass-like)
    sw = np.zeros(n)
    for m_, a_ in ((1, 1.0), (2, 0.7), (3, 0.45), (4, 0.25)):
        ph = TWO_PI * np.cumsum(np.full(n, pitch * 2 * m_) * (1 + 0.003 * np.sin(TWO_PI * 5 * t))) / SR
        sw += a_ * np.sin(ph)
    sw = filt(sw, 'lp', 700, 0.7) * smoothstep(t / 0.15) * np.exp(-t / 0.9)
    y = 1.0 * sub + 0.55 * drum + 0.5 * burst + 0.12 * air + 0.22 * crack + 0.16 * sw
    put(y, T, gain=0.80 * level, hall=0.30 * level)


def riser(T0, T1, rng):
    dur = T1 - T0
    n = int(dur * SR)
    t = tarr(n)
    x = t / dur
    fofs = lambda tt: 300 * (9500 / 300) ** ((tt / dur) ** 1.3)
    L = tv_filter(noise(n, rng=rng), 'bp', fofs, 1.6)
    R = tv_filter(noise(n, rng=rng), 'bp', fofs, 1.6)
    nz = np.stack([L, R])
    nz /= np.std(nz)
    f = 90 * (14.0) ** (x ** 1.5)
    ph = TWO_PI * np.cumsum(f) / SR
    tone = sum(np.sin(k * ph + k) / k for k in range(1, 8))
    tone = filt(tone, 'lp', 5000, 0.7)
    env = x ** 2.2
    gate = 1 - smoothstep((t - (dur - 0.07)) / 0.02)
    env = env * gate
    out = nz * env * 0.8 + tone * env * 0.55
    return out


def big_hit(T, rng):
    tail = 3.6
    n = int(tail * SR)
    t = tarr(n)
    s = gliss_sine(n, 150, 27.5, 0.12)
    s = np.tanh(1.9 * s) / np.tanh(1.9)
    sub = s * (1 - np.exp(-t / 0.004)) * np.exp(-t / 1.25)
    sub2 = np.sin(TWO_PI * 55 * t + 0.3) * np.exp(-t / 1.1) * (1 - np.exp(-t / 0.01)) * 0.5
    drum = (np.sin(TWO_PI * np.cumsum(55 * 1.9 + 90 * np.exp(-t / 0.05)) / SR)) * np.exp(-t / 0.35) * (1 - np.exp(-t / 0.002))
    burst = filt(noise(n, rng=rng), 'lp', 1400, 0.7) * np.exp(-t / 0.2) * (1 - np.exp(-t / 0.002))
    crack = filt(noise(n, rng=rng), 'hp', 1500, 0.7) * np.exp(-t / 0.014)
    shimmer = tv_filter(noise(n, rng=rng), 'hp', lambda tt: 4500 - 1500 * np.minimum(tt / 3.0, 1), 0.7)
    shimmer *= np.exp(-t / 1.1) * (1 - np.exp(-t / 0.01))
    # minor power-chord bloom (A1 / A2 / E3) for weight, dark, not melodic
    chord = np.zeros(n)
    for f0, a_ in ((55.0, 1.0), (110.0, 0.7), (164.8, 0.45), (220.0, 0.3)):
        for det in (-0.004, 0.0, 0.004):
            ph = TWO_PI * f0 * (1 + det) * t
            chord += a_ * sum(np.sin(k * ph + 0.5 * k) / k ** 1.2 for k in range(1, 7)) / 3.0
    chord = filt(chord, 'lp', 900, 0.7) * (1 - np.exp(-t / 0.02)) * np.exp(-t / 1.6)
    y = 1.0 * sub + 0.7 * sub2 + 0.65 * drum + 0.55 * burst + 0.28 * crack + 0.10 * shimmer + 0.14 * chord
    put(y, T, gain=0.95, hall=0.40)
    put(shimmer, T, gain=0.12, hall=0.9)


# ----------------------------------------------------------------------------
# Engine
# ----------------------------------------------------------------------------
def build_rpm():
    pts = [
        (0.0, 900), (3.2, 4200), (4.2, 5500), (5.0, 5540), (5.50, 6200), (5.57, 6280), (5.74, 4600),
        (7.4, 5450), (9.5, 6000), (13.2, 6000),
        (13.30, 4300), (13.45, 2500), (13.65, 1250), (13.80, 900), (16.38, 900),
        (16.40, 2500), (17.36, 6500), (17.52, 5000), (18.28, 6500), (18.42, 5000),
        (19.16, 6500), (19.32, 5000), (19.60, 6000),
        (19.62, 1100), (22.78, 1100), (22.9, 900), (25.6, 900), (25.7, 850), (27.6, 850),
        (28.46, 1500), (28.50, 850), (32.0, 850),
    ]
    p = np.array(pts, float)
    rpm = np.interp(TT, p[:, 0], p[:, 1])
    # blips in the engine-bay idle
    for tb, pk in ((20.6, 4800.0), (21.8, 5600.0)):
        x = TT - tb
        add = np.where(x < 0, 0.0, (pk - 1100.0) * smoothstep(x / 0.11) * np.exp(-np.maximum(x - 0.11, 0) / 0.20))
        rpm = rpm + add
    # slow wobble around the 6000 rpm cruise
    cruise = smoothstep((TT - 9.0) / 1.0) * (1 - smoothstep((TT - 13.2) / 0.05))
    rpm = rpm + cruise * 170 * np.sin(TWO_PI * (TT - 9.5) / 1.9) + cruise * 60 * np.sin(TWO_PI * (TT - 9.5) / 0.73)
    rpm = smooth_sym(rpm, 0.012)
    r = np.random.default_rng(5)
    idle_w = np.clip((2600.0 - rpm) / 1700.0, 0, 1)
    wob = lpnoise(5.0, r)
    rpm = rpm * (1 + (0.004 + 0.022 * idle_w) * wob)
    # doppler on the exterior pass-by shot (camera passes the car at 4.6 s)
    dop = 1.0 + 0.04 * np.tanh((4.6 - TT) / 0.20)
    dop = np.where(TT < 4.0, 1.0 + 0.04 * smoothstep((TT - 3.2) / 0.8), dop)
    dop = np.where(TT > 5.0, 1.0 - 0.04 * (1 - smoothstep((TT - 5.0) / 1.0)), dop)
    dop = np.where(TT > 6.0, 1.0, dop)
    return rpm * dop, rpm


def build_load():
    pts = [(0, 0.2), (3.2, 0.95), (5.5, 1.0), (5.8, 0.85), (13.2, 0.8), (13.25, 0.15), (13.8, 0.15),
           (16.38, 0.2), (16.40, 1.0), (19.6, 1.0), (19.62, 0.25), (22.8, 0.25), (28.4, 0.3), (32, 0.2)]
    p = np.array(pts, float)
    ld = np.interp(TT, p[:, 0], p[:, 1])
    for ts in (5.60, 17.40, 18.30, 19.20):
        x = (TT - ts) / 0.11
        ld *= 1 - 0.8 * np.exp(-(x - 0.4) ** 2)
    for tb in (20.6, 21.8):
        x = TT - tb
        ld = np.maximum(ld, np.where((x > -0.02) & (x < 0.35), 1.0, 0) * (1 - smoothstep((x - 0.1) / 0.25)))
    return smooth_sym(np.clip(ld, 0.05, 1.0), 0.03)


def engine_voice(rpm, load, seed, K=28):
    rng = np.random.default_rng(seed)
    f_fire = rpm / 60.0 * 4.0                    # V8 4-stroke: 4 firings / crank rev
    ph = TWO_PI * np.cumsum(f_fire) / SR
    idle_w = np.clip((2600.0 - rpm) / 1700.0, 0, 1)
    # per-firing random amplitude (smooth) + cross-plane lumpy cycle (8 firings / 720 deg)
    nf = ph / TWO_PI
    idx = np.floor(nf).astype(np.int64)
    fr = nf - idx
    tab = rng.standard_normal(idx[-1] + 3)
    rnd = tab[idx] * (1 - fr) + tab[idx + 1] * fr
    am = 1.0 + 0.08 * (1 + 2.5 * idle_w) * rnd
    depth = 0.55 + 0.9 * idle_w
    amm = np.array([0.22, 0.16, 0.12, 0.20, 0.09, 0.11, 0.07])
    psi = rng.uniform(0, TWO_PI, 7)
    for m in range(1, 8):
        am += depth * amm[m - 1] * np.cos(m * ph / 8.0 + psi[m - 1])
    am = np.maximum(am, 0.08)
    bright = 0.52 + 0.48 * load
    burble = np.clip(1 + 0.6 * lpnoise(6.0, rng), 0.1, 3)
    chans = []
    for ch in range(2):
        r = np.random.default_rng(seed * 31 + ch)
        h = np.zeros(N)
        for k in range(1, K + 1):
            w = k ** -0.85 * (1.0 if k % 2 else 0.62 + 0.38 * load)
            wt = np.power(bright, 0.33 * (k - 1)) * np.clip((11000 - k * f_fire) / 3000, 0, 1)
            h += (w * wt) * np.sin(k * ph + r.uniform(-0.8, 0.8))
        h *= am
        for j, wj in ((0.5, 0.55), (0.25, 0.42)):
            h += wj * burble * (0.45 + 0.55 * idle_w + 0.4 * load) * np.sin(j * ph + r.uniform(0, TWO_PI))
        chans.append(h)
    sd = np.std(chans[0][int(3.2 * SR):int(30 * SR)])
    drive = 1.0 + 1.1 * load
    out = []
    for ch in range(2):
        r = np.random.default_rng(seed * 57 + ch)
        h = chans[ch] / sd * 0.75
        y = np.tanh(drive * h) / np.sqrt(drive)
        nz = r.standard_normal(N)
        gate = ((1 + np.cos(ph + 0.6 + 0.5 * ch)) / 2) ** 2.2
        rasp = filt(filt(nz * gate, 'bp', 1300, 0.7), 'hp', 450, 0.7)
        rasp /= np.std(rasp)
        rush = filt(r.standard_normal(N), 'bp', 2800, 0.6)
        rush /= np.std(rush)
        sp = np.clip(rpm / 6000.0, 0.15, 1.3)
        y = y + (0.10 + 0.32 * load) * sp ** 1.2 * rasp * 0.55 + (0.015 + 0.06 * load) * sp ** 2 * rush
        out.append(y)
    lvl = smooth_sym((0.30 + 0.70 * load) * (0.55 + 0.45 * np.clip(rpm / 6500.0, 0, 1.1)), 0.03)
    return np.stack(out) * lvl


def make_pops(events, rng):
    out = np.zeros((2, N))
    for t, a in events:
        n = int(0.14 * SR)
        tt = tarr(n)
        nz = noise(n, rng=rng)
        b = filt(nz, 'bp', rng.uniform(900, 2300), 0.8) + 0.6 * filt(nz, 'lp', 380)
        env = (1 - np.exp(-tt / 0.0004)) * np.exp(-tt / rng.uniform(0.006, 0.014))
        thump = np.sin(TWO_PI * np.cumsum(65 + 70 * np.exp(-tt / 0.01)) / SR) * np.exp(-tt / 0.03)
        sig = (b * env / 2.0 + 0.5 * thump) * a * rng.choice([-1, 1])
        i0 = int(t * SR)
        w = rng.uniform(-0.5, 0.5)
        l, r_ = pan_gains(w)
        out[0, i0:i0 + n] += sig * l * 1.4142
        out[1, i0:i0 + n] += sig * r_ * 1.4142
    return out


POP_EVENTS = (
    [(5.60 + d, a) for d, a in ((0, 1.0), (0.030, 0.55), (0.085, 0.8), (0.125, 0.4), (0.19, 0.5))]
    + [(13.30 + d, a) for d, a in ((0, 0.8), (0.09, 0.6), (0.17, 0.75), (0.27, 0.45), (0.36, 0.35))]
    + [(17.40 + d, a) for d, a in ((0, 1.0), (0.04, 0.6), (0.11, 0.7))]
    + [(18.30 + d, a) for d, a in ((0, 1.0), (0.05, 0.65), (0.12, 0.55))]
    + [(19.20 + d, a) for d, a in ((0, 1.0), (0.04, 0.7), (0.10, 0.6), (0.17, 0.4))]
    + [(20.85 + d, a) for d, a in ((0, 0.8), (0.07, 0.55), (0.15, 0.5))]
    + [(22.10 + d, a) for d, a in ((0, 0.9), (0.06, 0.6), (0.13, 0.7), (0.22, 0.4))]
)


def seg_mask(a, b, edge=0.02):
    m = ((TT >= a) & (TT < b)).astype(float)
    return smooth_sym(m, edge)


def engine_bus():
    rpm_dop, rpm_clean = build_rpm()
    load = build_load()
    core = engine_voice(rpm_dop, load, seed=11)
    pops = make_pops(POP_EVENTS, np.random.default_rng(99)) * 5.0   # exhaust pops stay outside the "dull" blends

    # -- perspective versions ------------------------------------------------
    def per_ch(fn):
        return lambda x: np.stack([fn(c) for c in x])

    ext = per_ch(lambda c: filt(filt(filt(c, 'peak', 230, 1.0, 3.0), 'peak', 1500, 1.0, 2.0), 'hs', 7000, 0.7, -3.0))
    # cockpit: low-mid heavy, cabin muffling ~3 kHz
    cab = per_ch(lambda c: filt(filt(filt(filt(filt(c, 'ls', 140, 0.7, 4.5), 'peak', 90, 1.2, 3.5),
                                           'peak', 340, 1.0, 2.5), 'lp', 3000, 0.8), 'lp', 4200, 0.7))
    # bay: close mechanical, bit brighter
    bay = per_ch(lambda c: filt(filt(filt(c, 'hp', 60, 0.7), 'peak', 800, 1.0, 3.0), 'hs', 4000, 0.7, 2.0))
    # muffled / far (x-ray ducked, hero idle)
    dull = per_ch(lambda c: filt(filt(c, 'lp', 520, 0.8), 'hp', 40, 0.7))

    E_ext, P_ext = ext(core), ext(pops)
    E_ext_dull = per_ch(lambda c: filt(c, 'lp', 1800, 0.7))(E_ext)
    E_cab, P_cab = cab(core), cab(pops)
    E_bay, P_bay = bay(core), bay(pops)
    E_dull = dull(core)

    # pass-by: dull blend after the pass, pan right->left across 4.2-5.0
    wd = curve([(3.2, 0), (4.5, 0), (5.4, 0.75), (6.0, 0.75)], 0.05)
    E1 = E_ext * (1 - wd) + E_ext_dull * wd + P_ext
    mono = 0.5 * (E1[0] + E1[1])
    pan = np.where(TT < 4.2, 0.30 + 0.55 * smoothstep((TT - 3.2) / 1.0),
                   np.where(TT < 5.0, 0.85 - 1.70 * smoothstep((TT - 4.2) / 0.8), -0.85 + 0.55 * smoothstep((TT - 5.0) / 1.0)))
    gl = np.cos((pan + 1) * np.pi / 4) * 1.4142
    gr = np.sin((pan + 1) * np.pi / 4) * 1.4142
    E1 = np.stack([0.85 * mono * gl + 0.15 * E1[0], 0.85 * mono * gr + 0.15 * E1[1]])

    # shot-specific tone for the exterior shots after 6.0
    rear = np.stack([filt(c, 'ls', 120, 0.7, 3.0) for c in E_ext])    # 8.0: lower angle, more bass
    front = np.stack([filt(c, 'hs', 3500, 0.7, 2.5) for c in E_ext])  # 10.4: more bite
    E2 = (E_ext * seg_mask(6.0, 8.0) + rear * seg_mask(8.0, 10.4) + front * seg_mask(10.4, 13.2)) + P_ext * seg_mask(6.0, 13.2)

    segs = [
        # name, t0, t1, signal, target RMS (dBFS), shape curve
        ('ext1', 3.2, 6.0, E1, -15.0),
        ('ext2', 6.0, 13.2, E2, -16.0),
        ('door', 13.2, 16.4, E_ext + P_ext, -24.0),
        ('cab', 16.4, 19.6, E_cab + P_cab, -12.5),
        ('bay', 19.6, 22.8, E_bay + P_bay, -17.5),
        ('xray', 22.8, 25.6, E_dull, -36.0),
        ('hero', 25.6, 30.0, E_dull, -30.0),
    ]
    # loudness shape for the pass-by
    shape = curve([(3.2, 0.45), (4.0, 0.70), (4.45, 1.0), (4.6, 1.25), (4.78, 1.0), (5.2, 0.62), (6.0, 0.60), (6.01, 1.0), (30, 1.0)], 0.05)
    out = np.zeros((2, N))
    for name, a, b, sig, tgt in segs:
        m = seg_mask(a, b)
        part = sig * shape * m
        i0, i1 = int(a * SR), int(b * SR)
        rms = np.sqrt(np.mean(part[:, i0:i1] ** 2))
        scale = db(tgt) / rms
        out += part * scale
    # fade the idle engine out after 30.0 (hero tail)
    out *= (1 - smoothstep((TT - 30.0) / 0.8))
    return out, rpm_clean, load


# ----------------------------------------------------------------------------
# Music bed (128 BPM)
# ----------------------------------------------------------------------------
def kick_sample(rng, vol=1.0):
    n = int(0.40 * SR)
    t = tarr(n)
    f = 46 + 120 * np.exp(-t / 0.026)
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / 0.15) * (1 - np.exp(-t / 0.0007))
    y = np.tanh(1.5 * y)
    click = filt(noise(n, rng=rng), 'bp', 2800, 0.9) * np.exp(-t / 0.0025) * 0.35
    return (y + click) * vol


def hat_sample(rng, vol=1.0, open_=False):
    n = int(0.12 * SR)
    t = tarr(n)
    y = filt(noise(n, rng=rng), 'hp', 7500, 0.8) * np.exp(-t / (0.06 if open_ else 0.022)) * (1 - np.exp(-t / 0.0006))
    return y * vol


def bass_note(f, dur):
    n = int((dur + 0.06) * SR)
    t = tarr(n)
    env = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.22)
    gate = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.010))
    ph = TWO_PI * f * t
    y = np.sin(ph) + 0.22 * np.sin(2 * ph)
    for k in range(2, 12):
        y = y + (0.9 / k) * np.sin(k * ph + 0.3 * k) * np.exp(-t * (k - 1) ** 0.8 / 0.10)
    return y * env * gate


def music_bed():
    rng = np.random.default_rng(321)
    mus_k = np.zeros(N)      # kick
    mus_b = np.zeros(N)      # bass
    mus_h = np.zeros(N)      # hats
    kdip = np.zeros(N)       # sidechain dip 0..1
    t_end = 28.5
    kick_vars = [kick_sample(rng) for _ in range(2)]
    hat_vars = [hat_sample(rng) for _ in range(4)]
    ohat = hat_sample(rng, open_=True)
    k = 0
    while True:
        tb = 3.2 + k * BEAT
        if tb >= t_end - 0.01:
            break
        riser_phase = tb >= 27.6 - 1e-6
        # kick on every beat (drops out in the riser)
        if not riser_phase:
            ks = kick_vars[k % 2]
            i0 = int(round(tb * SR))
            mus_k[i0:i0 + len(ks)] += ks[:N - i0]
            n = int(0.30 * SR)
            tt = tarr(n)
            dip = (1 - np.exp(-tt / 0.004)) * np.exp(-tt / 0.11)
            kdip[i0:i0 + n] = np.maximum(kdip[i0:i0 + n], dip[:N - i0])
        # off-beat closed hat
        th = tb + 0.5 * BEAT
        if th < t_end - 0.01 and not riser_phase:
            hv = 0.85 if (k % 2 == 0) else 1.0
            hs = hat_vars[k % 4] * hv
            i0 = int(round(th * SR))
            mus_h[i0:i0 + len(hs)] += hs[:N - i0]
            # ghost 16ths, thin
            if (k // 4) % 2 == 1:
                for q_ in (0.25, 0.75):
                    tg = tb + q_ * BEAT
                    g = hat_vars[(k + int(q_ * 4)) % 4] * 0.22
                    i1 = int(round(tg * SR))
                    mus_h[i1:i1 + len(g)] += g[:N - i1]
        k += 1
    # bass: 8ths. pedal on A1 with octave jumps; bar 3 = F, bar 4 turn-around
    step = BEAT / 2
    i8 = 0
    A1 = 55.0
    notes_cache = {}
    while True:
        tn = 3.2 + i8 * step
        if tn >= t_end - 0.12 or tn >= 27.6 - 1e-6:
            break
        bar = int((tn - 3.2) / (4 * BEAT)) % 4
        pos = i8 % 8
        semis = 0
        if bar == 2:
            semis = -4
        octv = 12 if pos in (2, 5) else 0
        if bar == 3 and pos == 6:
            semis = 1
        if bar == 3 and pos == 7:
            semis = -2
        key = (semis + octv)
        if key not in notes_cache:
            notes_cache[key] = bass_note(A1 * 2 ** (key / 12.0), step * 0.82)
        nb = notes_cache[key] * (1.0 if pos % 2 == 0 else 0.82)
        i0 = int(round(tn * SR))
        mus_b[i0:i0 + len(nb)] += nb[:N - i0]
        i8 += 1
    # riser hat roll (27.6 -> 28.45), accelerating, rising velocity
    t = 27.6
    gap = 0.2344
    j = 0
    while t < 28.44:
        v = 0.25 + 0.75 * ((t - 27.6) / 0.85) ** 1.2
        hs = hat_vars[j % 4] * v * 1.1
        i0 = int(round(t * SR))
        mus_h[i0:i0 + len(hs)] += hs[:N - i0]
        gap = max(0.045, gap * 0.82)
        t += gap
        j += 1
    # pad: detuned additive saws, dark minor open voicing
    pad = np.zeros(N)
    for f0, a_ in ((110.0, 1.0), (164.81, 0.8), (220.0, 0.55), (261.63, 0.35)):
        for det in (-0.0035, 0.0, 0.0035):
            ph = TWO_PI * f0 * (1 + det) * TT
            pad += a_ * sum(np.sin(k_ * ph + 0.7 * k_) / k_ ** 1.3 for k_ in range(1, 9))
    pad = tv_filter(pad, 'lp', lambda tt: 500 + 2200 * np.clip((tt - 3.2) / 25.0, 0, 1) ** 1.3, 0.8)
    pad *= (1 + 0.15 * np.sin(TWO_PI * TT / (BEAT * 8)))

    # level automation for the whole bed
    lvl = curve([(0, 0), (3.19, 0), (3.2, 1.0), (22.74, 1.0), (22.80, 0.0), (25.6, 0.0), (25.62, 0.65),
                 (27.6, 0.9), (28.44, 1.0), (28.5, 0.0), (32, 0)], 0.012)
    bass_g = 1 - 0.88 * kdip
    hat_g = 1 - 0.45 * kdip
    pad_g = 1 - 0.70 * kdip
    mono = (mus_k * 0.95 + mus_b * 0.55 * bass_g + mus_h * 0.20 * hat_g + pad * 0.020 * pad_g) * lvl
    # tiny stereo spread on hats/pad only
    hat_st = np.roll(mus_h, 40)
    padw = np.roll(pad, 90)
    L = mono + 0.0 * hat_st
    R = mono
    L = L + (mus_h * 0.05 * hat_g - hat_st * 0.05 * hat_g) * lvl + (pad * 0.004 * pad_g - padw * 0.004 * pad_g) * lvl
    R = R - (mus_h * 0.05 * hat_g - hat_st * 0.05 * hat_g) * lvl - (pad * 0.004 * pad_g - padw * 0.004 * pad_g) * lvl
    # absolute level target for the music bed: -27 dBFS RMS over its active range
    on = (TT > 3.5) & (TT < 22.7)
    rms = np.sqrt(np.mean(np.stack([L, R])[:, on] ** 2))
    g = db(-24.0) / rms
    return np.stack([L, R]) * g, kdip


# ----------------------------------------------------------------------------
# Loudness / master
# ----------------------------------------------------------------------------
KW1 = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
       np.array([1.0, -1.69065929318241, 0.73248077421585]))
KW2 = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))


def lufs(y, return_blocks=False):
    k = np.stack([iir(iir(c, *KW1), *KW2) for c in y])
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    cs = np.concatenate([np.zeros((2, 1)), np.cumsum(k ** 2, axis=1)], axis=1)
    starts = np.arange(0, k.shape[1] - blk + 1, hop)
    z = (cs[:, starts + blk] - cs[:, starts]) / blk
    zs = z.sum(axis=0)
    l = -0.691 + 10 * np.log10(zs + 1e-12)
    g1 = zs[l > -70]
    ref = -0.691 + 10 * np.log10(g1.mean()) - 10.0
    g2 = zs[(l > -70) & (l > ref)]
    integ = -0.691 + 10 * np.log10(g2.mean())
    if return_blocks:
        return integ, l, starts / SR
    return integ


def compress(y, thr_db=-18.0, ratio=2.0, tau=0.08):
    lev = smooth_sym(np.mean(y ** 2, axis=0), tau)
    d = 10 * np.log10(lev + 1e-12)
    gr = -np.maximum(d - thr_db, 0) * (1 - 1 / ratio)
    return y * (10 ** (gr / 20.0))


def limiter(y, ceil=0.80, look=3):
    blk = 48
    n = y.shape[1]
    nb = n // blk
    pk = np.max(np.abs(y[:, :nb * blk]).reshape(2, nb, blk), axis=(0, 2))
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    L = look + 1
    padn = np.pad(need, (L, L), mode='edge')
    mn = padn[0:nb].copy()
    for s in range(1, 2 * L + 1):
        mn = np.minimum(mn, padn[s:s + nb])
    kern = np.hanning(2 * L + 3)[1:-1]
    kern /= kern.sum()
    g = np.convolve(np.pad(mn, (L + 1, L + 1), mode='edge'), kern, mode='same')[L + 1:L + 1 + nb]
    gs = np.interp(np.arange(n), (np.arange(nb) + 0.5) * blk, g)
    return y * gs


def softclip(y, knee=0.70):
    a = np.abs(y)
    over = a > knee
    out = y.copy()
    out[over] = np.sign(y[over]) * (knee + (1 - knee) * np.tanh((a[over] - knee) / (1 - knee)))
    return out


def master_chain(mix, gain):
    y = mix * gain
    y = np.stack([filt(c, 'hp', 24, 0.7) for c in y])
    y = compress(y, thr_db=-19.0, ratio=2.2, tau=0.09)
    y = limiter(y, 0.80)
    y = softclip(y)
    fade = 1 - smoothstep((TT - 30.0) / 1.8)
    fade *= smoothstep(TT / 0.004)
    fade[TT >= 31.8] = 0.0
    return y * fade


def write_wav(path, y):
    pcm = np.clip(np.round(y.T * 32767.0), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ----------------------------------------------------------------------------
# Assembly
# ----------------------------------------------------------------------------
def main(out_path):
    global ENG, MUS
    rng = np.random.default_rng(2024)

    # ---- intro ----
    d = intro_drone()
    put(d, 0.0, gain=0.32, bus=FX)
    put(zap(), 0.80, gain=0.55, pan=0.0, room=0.55, hall=0.25)
    # pre-boom suck-in + boom @1.6
    sw = whoosh(0.45, 400, 7000, 1.2, 'swell', rng)
    put(sw, 1.15, gain=0.16, hall=0.2)
    put(boom(3.0, 120, 29, 0.20, 0.95, noise_amt=0.6, crack=0.35, drive=2.0, rng=rng), 1.60, gain=1.0, hall=0.30)

    # ---- cuts ----
    lv = {3.2: 1.35, 6.0: 0.85, 8.0: 0.75, 10.4: 0.70, 13.2: 0.85, 16.4: 1.2, 19.6: 0.9, 22.8: 0.9, 25.6: 0.0, 30.0: 0.8}
    for T in CUTS:
        if lv[T] > 0:
            cut_hit(T, lv[T], rng)
    # 25.6: dedicated hero transition (whoosh in, hits below)
    put(whoosh(0.35, 250, 7500, 1.5, 'swell', rng), 25.6 - 0.35, gain=0.30, room=0.1)
    put(whoosh(0.5, 5200, 400, 1.2, 'decay', rng, rising=False), 25.6, gain=0.20, room=0.1)

    # ---- pass-by wind rush @4.6 (R -> L) ----
    n = int(1.6 * SR)
    t = tarr(n)
    wind = np.stack([tv_filter(noise(n, rng=rng), 'bp', lambda tt: 650 + 900 * np.exp(-((tt - 0.8) / 0.25) ** 2), 0.55)
                     for _ in range(2)])
    wind /= np.std(wind)
    envw = np.exp(-((t - 0.8) / 0.26) ** 2)
    p = 0.9 - 1.8 * smoothstep((t - 0.45) / 0.7)
    wl, wr = np.cos((p + 1) * np.pi / 4) * 1.4142, np.sin((p + 1) * np.pi / 4) * 1.4142
    wind = np.stack([wind[0] * envw * wl, wind[1] * envw * wr])
    put(wind, 4.6 - 0.8, gain=0.30, room=0.1)

    # ---- driving road/wind bed ----
    bed = filt(noise(N, 'pink', rng=rng), 'bp', 450, 0.45)
    bed_env = curve([(3.2, 0.0), (3.4, 1.0), (13.0, 1.0), (13.4, 0.15), (16.39, 0.15), (16.4, 1.1), (19.6, 1.1),
                     (19.62, 0.0), (32, 0)], 0.05)
    FX[0] += bed * bed_env * 0.050
    FX[1] += np.roll(bed, 300) * bed_env * 0.050

    # ---- doors @13.8 / 13.9 ----
    for tc, pn in ((13.80, -0.55), (13.90, 0.55)):
        put(latch_click(rng), tc, gain=0.90, pan=pn, room=0.35)
        put(hydraulic_open(rng), tc + 0.03, gain=0.17, pan=pn * 0.6, room=0.40, hall=0.05)

    # ---- bonnet hiss @19.6 ----
    put(bonnet_hiss(rng), 19.6, gain=0.20, pan=0.0, room=0.30)

    # ---- X-ray scan ----
    put(scan_sweep(rng), 23.0, gain=0.22, room=0.25, hall=0.10)
    glitch_ticks(rng)
    ping_n = int(1.0 * SR)
    pt = tarr(ping_n)
    ping = (np.sin(TWO_PI * 1760 * pt) + 0.55 * np.sin(TWO_PI * 2637 * pt) + 0.25 * np.sin(TWO_PI * 3520 * pt)) * np.exp(-pt / 0.35) * (1 - np.exp(-pt / 0.003))
    put(ping, 24.8, gain=0.13, room=0.5, hall=0.5)
    # tension swell 24.8 -> 25.6 (sub + reversed air)
    tn = int(0.8 * SR)
    tt = tarr(tn)
    swell = np.sin(TWO_PI * (40 + 18 * (tt / 0.8) ** 2) * tt) * (tt / 0.8) ** 2
    put(swell, 24.8, gain=0.35)
    put(whoosh(0.8, 3000, 9000, 2.0, 'swell', rng), 24.8, gain=0.12, hall=0.2)

    # ---- hero hits ----
    orch_hit(25.6, 1.00, 55.0, rng)
    orch_hit(26.7, 1.05, 55.0, rng)
    orch_hit(27.6, 1.10, 49.0, rng)
    # riser 27.6 -> 28.5 with a short vacuum before the BIG hit
    put(riser(27.6, 28.5, rng), 27.6, gain=0.40, hall=0.18)
    big_hit(28.5, rng)

    # ---- engine + music ----
    eng, rpm_dbg, load_dbg = engine_bus()
    mus, kdip = music_bed()
    # sidechain: tiny pump on the engine while the bed runs
    eng_p = eng * (1 - 0.10 * kdip * (TT > 3.2) * (TT < 22.8))
    # brief vacuum before the big hit
    vac = 1 - smoothstep((TT - 28.43) / 0.01) * (1 - smoothstep((TT - 28.5) / 0.004))
    eng_p *= vac
    mus = mus * vac
    # engine room-send for a bit of air
    ROOM[:] += 0.14 * 0.5 * (eng_p[0] + eng_p[1]) * ((TT > 3.2) & (TT < 22.8))
    HALL[:] += 0.10 * 0.5 * (eng_p[0] + eng_p[1]) * ((TT > 25.6) & (TT < 30.5))

    # ---- reverbs ----
    hall = Reverb(3.4, [41.3, 47.9, 53.9, 61.7, 67.3, 73.1, 79.7, 89.3], pre_ms=28.0, hp=70.0, lp=6500.0, wet=0.65)
    room = Reverb(0.70, [17.3, 19.9, 23.1, 26.3, 29.9, 31.7, 35.3, 37.9], ap_ms=(5.3, 3.9, 2.7, 1.7), pre_ms=6.0,
                  hp=150.0, lp=9000.0, wet=0.75)
    H = hall.process(HALL)
    R = room.process(ROOM)

    mix = eng_p + mus + FX + H + R
    STEMS.update(eng=eng_p, mus=mus, fx=FX, hall=H, room=R)

    # ---- master: search makeup gain for ~ -14 LUFS with limiter doing the rest ----
    target = -14.0
    gain = 1.0
    best = None
    for it in range(5):
        y = master_chain(mix, gain)
        pk = np.max(np.abs(y))
        pk_scale = 0.8913 / pk
        L = lufs(y * pk_scale)
        best = (y * pk_scale, L, gain)
        if abs(L - target) < 0.4:
            break
        gain *= 10 ** ((target - L) / 20.0) * (0.85 if it == 0 else 1.0)
    y, L, gain = best
    write_wav(out_path, y)
    return y, dict(rpm=rpm_dbg, load=load_dbg, gain=gain, lufs=L)


def summary(y, info):
    pk = np.max(np.abs(y))
    q = np.round(y * 32767.0)
    clipped = int(np.sum(np.abs(q) >= 32767))
    rms = np.sqrt(np.mean(y ** 2))
    integ, l_blocks, ts = lufs(y, True)
    print("---- soundtrack summary ----")
    print("duration: %.3f s  rate: %d Hz  channels: 2  16-bit" % (y.shape[1] / SR, SR))
    print("sample peak: %.2f dBFS   overall RMS: %.2f dBFS   crest: %.1f dB" % (20 * np.log10(pk), 20 * np.log10(rms), 20 * np.log10(pk / rms)))
    print("integrated loudness (BS.1770 approx): %.1f LUFS   max momentary(400ms): %.1f LUFS" % (integ, l_blocks.max()))
    print("clipped samples (|x| >= 32767): %d" % clipped)
    print("L/R correlation: %.3f" % np.corrcoef(y[0], y[1])[0, 1])
    print("RMS per shot (dBFS):")
    for a, b, name in ((0, 3.2, 'ignition'), (3.2, 13.2, 'driving'), (13.2, 16.4, 'doors'), (16.4, 19.6, 'cockpit'),
                       (19.6, 22.8, 'engine bay'), (22.8, 25.6, 'x-ray'), (25.6, 30.0, 'hero'), (30.0, 32.0, 'tail')):
        seg = y[:, int(a * SR):int(b * SR)]
        print("  %5.1f-%5.1f  %-10s rms %6.1f  peak %6.1f" % (a, b, name, 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9), 20 * np.log10(np.max(np.abs(seg)) + 1e-9)))
    tail = y[:, int(31.8 * SR):]
    print("max |x| after 31.8 s: %.6f" % np.max(np.abs(tail)))


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav'
    y, info = main(out)
    print("wrote", out)
    summary(y, info)

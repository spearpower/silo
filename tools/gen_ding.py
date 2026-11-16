"""Synthesizes the original PicknPlay "your turn" chime -> public/sounds/turn.wav
Two bell-like notes (C6 then G6) with inharmonic partials and exponential decay.
Usage: python tools/gen_ding.py
"""
import math, struct, wave, os

RATE = 22050
DUR = 0.95
NOTES = [(1046.5, 0.00, 1.0), (1568.0, 0.13, 0.85)]          # (Hz, start s, level)
PARTIALS = [(1.0, 1.0, 3.2), (2.76, 0.35, 5.5), (5.40, 0.12, 9.0)]  # (ratio, amp, decay rate)

n = int(RATE * DUR)
buf = [0.0] * n
for f0, t0, lvl in NOTES:
    s0 = int(t0 * RATE)
    for i in range(s0, n):
        t = (i - s0) / RATE
        attack = min(1.0, t / 0.004)          # 4 ms attack: no click
        v = sum(a * math.exp(-d * t) * math.sin(2 * math.pi * f0 * r * t) for r, a, d in PARTIALS)
        buf[i] += lvl * attack * v
tail = int(0.05 * RATE)                        # 50 ms fade-out at the very end
for k in range(tail):
    buf[n - 1 - k] *= k / tail
peak = max(abs(x) for x in buf)
scale = 0.6 * 32767 / peak                     # about -4.4 dBFS: friendly, not loud
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'sounds', 'turn.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(x * scale)) for x in buf))
print('wrote', out, os.path.getsize(out), 'bytes')

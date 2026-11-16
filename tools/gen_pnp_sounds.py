"""Synthesizes PicknPlay's game sounds into public/sounds/ (mono 22.05 kHz, 16-bit WAV, all original).
  deal.wav      cards dealt: a quick run of flicks           play.wav     a card slapped on the pile
  draw.wav      a card slid off the draw pile                shuffle.wav  discard pile reshuffled (riffle)
  penalty.wav   a 2 / 3 / Joker played: "dun-dun" hit        hit.wav      a penalty lands on YOU (heavier, buzzy)
  cancel.wav    an Ace stops a penalty: shield ring          suit.wav     an Ace names a suit: two-note chime
  skip.wav      an 8 skips someone: descending "womp"        reverse.wav  a Jack reverses play: swoosh up and back
  cut.wav       a cut: scissor snips + drum hit              lastcard.wav someone is down to one card: alert ding
  win.wav       you win: fanfare + applause                  lose.wav     someone else wins: "wah-wah" trombone
  tick.wav      last seconds of your turn                    error.wav    that card can't be played: soft bonk
The turn chime (turn.wav) comes from tools/gen_ding.py and the chat pop (chat.wav) from tools/gen_sounds.py.
Usage: python tools/gen_pnp_sounds.py [name ...]
"""
import math, os, random, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_sounds import RATE, silence, mix, bell, brass, noise_burst, write, applause, fanfare  # noqa: E402

random.seed(42)


def tone(f0, f1, dur, level=1.0, harmonics=((1, 1),), attack=0.005, decay=4.0):
    """A gliding tone from f0 to f1 Hz with an exponential decay."""
    out, ph = [], 0.0
    for i in range(int(dur * RATE)):
        t = i / RATE
        f = f0 + (f1 - f0) * (t / dur)
        ph += 2 * math.pi * f / RATE
        env = min(1.0, t / attack) * math.exp(-decay * t)
        out.append(level * env * sum(a * math.sin(k * ph) for k, a in harmonics))
    return out


def sweep_noise(dur, f0, f1, level=1.0):
    """Noise through a moving one-pole low-pass: a 'whoosh'."""
    out, prev = [], 0.0
    for i in range(int(dur * RATE)):
        t = i / RATE
        f = f0 + (f1 - f0) * (t / dur)
        a = math.exp(-2 * math.pi * f / RATE)
        prev = a * prev + (1 - a) * random.uniform(-1, 1)
        env = math.sin(math.pi * t / dur) ** 1.5
        out.append(level * env * prev)
    return out


def flick(level=1.0):
    part = noise_burst(0.045, 90, level, smooth=0.35)
    mix(part, bell(260, 0.04, 0.2 * level, ((1, 1, 60),)), 0.0)
    return part


def deal():
    buf = silence(0.75)
    for k in range(7):
        mix(buf, flick(0.7 + 0.3 * random.random()), k * 0.085 + random.uniform(0, 0.01))
    write('deal.wav', buf, 0.45)


def play():
    buf = silence(0.2)
    mix(buf, noise_burst(0.06, 45, 0.6, smooth=0.6), 0.0)      # air
    mix(buf, noise_burst(0.04, 110, 1.0, smooth=0.15), 0.045)  # slap
    mix(buf, bell(150, 0.1, 0.4, ((1, 1, 35),)), 0.045)        # table thump
    write('play.wav', buf, 0.5)


def draw():
    buf = silence(0.3)
    mix(buf, sweep_noise(0.22, 2500, 700, 1.0), 0.0)
    mix(buf, flick(0.4), 0.2)
    write('draw.wav', buf, 0.4)


def shuffle():
    buf = silence(1.0)
    t = 0.0
    while t < 0.8:
        mix(buf, flick(0.35 + 0.4 * random.random()), t)
        t += random.uniform(0.012, 0.03)
    mix(buf, flick(1.0), 0.85)
    write('shuffle.wav', buf, 0.45)


def penalty():
    buf = silence(0.6)
    mix(buf, sweep_noise(0.18, 600, 3000, 0.5), 0.0)
    for k, f in enumerate([196.0, 146.83]):                  # G3 then D3: "dun-dun"
        mix(buf, brass(f, 0.18, 1.0), 0.12 + k * 0.17)
        mix(buf, bell(f / 2, 0.25, 0.6, ((1, 1, 12),)), 0.12 + k * 0.17)
    write('penalty.wav', buf, 0.55)


def hit():
    buf = silence(0.75)
    mix(buf, sweep_noise(0.2, 400, 2600, 0.6), 0.0)
    mix(buf, tone(220, 110, 0.5, 1.0, ((1, 1), (2, .6), (3, .4), (5, .25)), decay=3.0), 0.15)   # buzzy fall
    mix(buf, noise_burst(0.12, 30, 0.6, smooth=0.7), 0.15)                                       # thud
    write('hit.wav', buf, 0.6)


def cancel():
    buf = silence(1.0)
    shimmer = ((1, 1, 3.0), (2.76, .5, 4.5), (5.4, .25, 7.0))                                   # metallic partials
    mix(buf, bell(1318.5, 0.9, 1.0, shimmer), 0.0)
    mix(buf, bell(1975.5, 0.8, 0.6, shimmer), 0.06)
    for k in range(5):
        mix(buf, bell(3000 + random.uniform(-300, 600), 0.2, 0.12, ((1, 1, 16),)), 0.15 + k * 0.05)
    write('cancel.wav', buf, 0.5)


def suit():
    buf = silence(0.6)
    mix(buf, bell(659.25, 0.45, 0.9), 0.0)     # E5
    mix(buf, bell(987.77, 0.5, 0.8), 0.11)     # B5
    write('suit.wav', buf, 0.45)


def reverse():
    buf = silence(0.7)
    mix(buf, sweep_noise(0.3, 400, 4000, 0.8), 0.0)
    mix(buf, sweep_noise(0.3, 4000, 400, 0.8), 0.3)
    mix(buf, tone(500, 900, 0.3, 0.25, decay=2), 0.0)
    mix(buf, tone(900, 500, 0.3, 0.25, decay=2), 0.3)
    write('reverse.wav', buf, 0.45)


def skip_():
    buf = silence(0.7)
    mix(buf, tone(392, 330, 0.3, 1.0, ((1, 1), (2, .35)), decay=3.5), 0.0)
    mix(buf, tone(311, 220, 0.34, 1.0, ((1, 1), (2, .35)), decay=3.5), 0.3)
    write('skip.wav', buf, 0.5)


def snip(level=1.0):
    part = noise_burst(0.03, 160, level, smooth=0.05)
    mix(part, bell(3400, 0.03, 0.3 * level, ((1, 1, 90),)), 0.0)
    return part


def cut():
    buf = silence(1.4)
    mix(buf, snip(0.8), 0.0)
    mix(buf, snip(1.0), 0.14)
    mix(buf, bell(70, 0.6, 1.0, ((1, 1, 6), (1.5, .4, 9))), 0.32)                  # drum
    mix(buf, noise_burst(0.3, 12, 0.5, smooth=0.6), 0.32)
    for k, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        mix(buf, bell(f, 0.6, 0.55), 0.42 + k * 0.07)
    write('cut.wav', buf, 0.6)


def lastcard():
    buf = silence(0.55)
    mix(buf, bell(1760, 0.25, 1.0, ((1, 1, 12), (2, .3, 18))), 0.0)
    mix(buf, bell(1760, 0.3, 1.0, ((1, 1, 10), (2, .3, 16))), 0.16)
    write('lastcard.wav', buf, 0.42)


def win():
    buf = silence(3.4)
    fanfare(0.0, buf, 1.0)
    for f, lv in ((1046.5, .5), (1318.5, .4), (1567.98, .35)):
        mix(buf, bell(f, 1.2, lv), 0.52)
    mix(buf, applause(2.8, 0.55), 0.45)
    write('win.wav', buf, 0.6)


def lose():
    buf = silence(2.2)
    t = 0.0
    for f0, f1, d in ((311.13, 293.66, 0.32), (293.66, 277.18, 0.32), (277.18, 261.63, 0.32), (261.63, 233.08, 0.9)):
        part = []
        ph = 0.0
        for i in range(int(d * RATE)):
            tt = i / RATE
            wob = 1 + (0.03 * math.sin(2 * math.pi * 6 * tt) if d > 0.5 else 0)
            f = (f0 + (f1 - f0) * tt / d) * wob
            ph += 2 * math.pi * f / RATE
            env = min(1.0, tt / 0.03) * min(1.0, (d - tt) / 0.08)
            part.append(env * (math.sin(ph) + .5 * math.sin(2 * ph) + .3 * math.sin(3 * ph) + .15 * math.sin(4 * ph)))
        mix(buf, part, t)
        t += d + 0.04
    write('lose.wav', buf, 0.5)


def tick():
    buf = silence(0.09)
    mix(buf, bell(2000, 0.05, 1.0, ((1, 1, 80),)), 0.0)
    mix(buf, noise_burst(0.01, 300, 0.5, smooth=0.0), 0.0)
    write('tick.wav', buf, 0.35)


def error():
    buf = silence(0.25)
    mix(buf, tone(180, 140, 0.2, 1.0, ((1, 1), (2, .3)), decay=9), 0.0)
    write('error.wav', buf, 0.4)


ALL = [('deal', deal), ('play', play), ('draw', draw), ('shuffle', shuffle), ('penalty', penalty), ('hit', hit),
       ('cancel', cancel), ('suit', suit), ('reverse', reverse), ('skip', skip_), ('cut', cut),
       ('lastcard', lastcard), ('win', win), ('lose', lose), ('tick', tick), ('error', error)]

if __name__ == '__main__':
    only = sys.argv[1:]
    for name, fn in ALL:
        if not only or name in only:
            fn()

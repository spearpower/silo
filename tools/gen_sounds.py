"""Synthesizes the original PicknPlay game sounds into public/sounds/ (all mono 22.05 kHz, 16-bit WAV).
  discard.wav  soft card swish/slap
  phase.wav    rising sparkle arpeggio (a player completed a phase)
  round.wav    short fanfare (a player went out and won the round)
  win.wav      fanfare + crowd applause (someone won the game)
  skip.wav     descending "womp" (you were skipped)
  chat.wav     soft two-tone pop (a new chat message)
The turn chime (turn.wav) comes from tools/gen_ding.py.
Usage: python tools/gen_sounds.py
"""
import math, os, random, struct, wave

RATE = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'sounds')
random.seed(10)


def silence(sec):
	return [0.0] * int(RATE * sec)


def mix(buf, part, at):
	start = int(at * RATE)
	need = start + len(part)
	if need > len(buf):
		buf.extend([0.0] * (need - len(buf)))
	for i, v in enumerate(part):
		buf[start + i] += v


def bell(freq, dur, level=1.0, partials=((1, 1, 4.0), (2.0, .3, 7.0), (3.0, .12, 10.0))):
	out = []
	for i in range(int(dur * RATE)):
		t = i / RATE
		att = min(1.0, t / 0.005)
		out.append(level * att * sum(a * math.exp(-d * t) * math.sin(2 * math.pi * freq * r * t) for r, a, d in partials))
	return out


def brass(freq, dur, level=1.0):
	"""Bright, slightly buzzy note for fanfares (a few harmonics, soft attack and release)."""
	out = []
	n = int(dur * RATE)
	for i in range(n):
		t = i / RATE
		env = min(1.0, t / 0.025) * min(1.0, (dur - t) / 0.08)
		vib = 1 + 0.004 * math.sin(2 * math.pi * 5.5 * t)
		v = sum(a * math.sin(2 * math.pi * freq * k * vib * t) for k, a in ((1, 1), (2, .5), (3, .33), (4, .18), (5, .1)))
		out.append(level * env * v)
	return out


def noise_burst(dur, decay, level=1.0, smooth=0.0):
	out, prev = [], 0.0
	for i in range(int(dur * RATE)):
		t = i / RATE
		x = random.uniform(-1, 1)
		prev = smooth * prev + (1 - smooth) * x  # simple low-pass
		out.append(level * math.exp(-decay * t) * prev)
	return out


def write(name, buf, peak_level=0.6):
	tail = int(0.03 * RATE)
	for k in range(min(tail, len(buf))):
		buf[len(buf) - 1 - k] *= k / tail
	peak = max(abs(x) for x in buf) or 1
	scale = peak_level * 32767 / peak
	path = os.path.join(OUT, name)
	with wave.open(path, 'wb') as w:
		w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
		w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * scale / 32767)) * 32767)) for x in buf))
	print(f'{name:12s} {len(buf) / RATE:.2f}s {os.path.getsize(path) // 1024} KB')


def discard():
	buf = silence(0.22)
	mix(buf, noise_burst(0.09, 38, 0.8, smooth=0.55), 0.0)       # swish
	mix(buf, noise_burst(0.05, 80, 1.0, smooth=0.25), 0.075)     # soft slap on the pile
	mix(buf, bell(180, 0.12, 0.25, ((1, 1, 30),)), 0.075)        # tiny thump
	write('discard.wav', buf, 0.45)


def phase():
	buf = silence(1.0)
	for k, f in enumerate([783.99, 987.77, 1174.66, 1567.98]):     # G5 B5 D6 G6
		mix(buf, bell(f, 0.7, 1.0 - k * 0.08), k * 0.085)
	for k in range(6):                                             # sparkle
		mix(buf, bell(2637 + random.uniform(-200, 300), 0.25, 0.18, ((1, 1, 14),)), 0.36 + k * 0.05)
	write('phase.wav', buf, 0.55)


def fanfare(at, buf, level=1.0):
	notes = [(523.25, 0.13), (659.25, 0.13), (783.99, 0.13), (1046.5, 0.5)]   # C5 E5 G5 C6
	t = at
	for f, d in notes:
		mix(buf, brass(f, d + 0.04, level), t)
		mix(buf, brass(f / 2, d + 0.04, level * 0.35), t)
		t += d
	return t


def round_win():
	buf = silence(1.1)
	end = fanfare(0.0, buf)
	for k in range(5):
		mix(buf, bell(2093 + k * 220, 0.3, 0.2, ((1, 1, 10),)), end - 0.35 + k * 0.05)
	write('round.wav', buf, 0.55)


def applause(dur, start_level=1.0):
	buf = silence(dur)
	n_claps = int(dur * 55)
	for _ in range(n_claps):
		t = random.uniform(0, dur - 0.05)
		fade = 1.0 if t < dur * 0.6 else max(0.0, 1 - (t - dur * 0.6) / (dur * 0.4))
		clap = noise_burst(0.035, random.uniform(70, 120), random.uniform(0.4, 1.0) * fade * start_level, smooth=random.uniform(0.1, 0.45))
		mix(buf, clap, t)
	return buf


def win():
	buf = silence(3.4)
	fanfare(0.0, buf, 1.0)
	fanfare(0.55, buf, 0.0)  # (keeps the buffer long enough; silent)
	mix(buf, bell(1046.5, 1.2, 0.5), 0.52)
	mix(buf, bell(1318.5, 1.2, 0.4), 0.52)
	mix(buf, bell(1567.98, 1.2, 0.35), 0.52)
	claps = applause(2.8, 0.55)
	mix(buf, claps, 0.45)
	write('win.wav', buf, 0.6)


def skip():
	buf = silence(0.75)
	for k, (f0, f1) in enumerate([(392, 330), (311, 220)]):        # two falling "womp" notes
		part = []
		dur = 0.32
		phase_acc = 0.0
		for i in range(int(dur * RATE)):
			t = i / RATE
			f = f0 + (f1 - f0) * (t / dur)
			phase_acc += 2 * math.pi * f / RATE
			env = min(1.0, t / 0.01) * math.exp(-3.5 * t)
			part.append(env * (math.sin(phase_acc) + 0.35 * math.sin(2 * phase_acc)))
		mix(buf, part, k * 0.3)
	write('skip.wav', buf, 0.5)


def chat():
	buf = silence(0.32)
	mix(buf, bell(880, 0.18, 0.8, ((1, 1, 22), (2, .2, 30))), 0.0)
	mix(buf, bell(1318.5, 0.22, 0.7, ((1, 1, 18), (2, .2, 26))), 0.07)
	write('chat.wav', buf, 0.4)


if __name__ == '__main__':
	import sys
	os.makedirs(OUT, exist_ok=True)
	only = sys.argv[1:]
	for name, fn in [('discard', discard), ('phase', phase), ('round', round_win), ('win', win), ('skip', skip), ('chat', chat)]:
		if not only or name in only:
			fn()

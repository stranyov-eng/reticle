/* OSC traffic generator, for exercising Reticle without TouchDesigner at hand.
 *
 *   node scripts/osc-blast.mjs [port] [Hz] [addresses]
 *   node scripts/osc-blast.mjs 9000 60 100     ← 6000 messages per second
 *
 * Three kinds of traffic, so the statistics have something to chew on:
 *   /pos/N        — three floats, a sine sweeping -1..1 (min/max should settle)
 *   /level/N      — one float, 0..1
 *   /cue/fire     — a rare impulse every ~2 seconds (to exercise "silence")
 */

import dgram from 'node:dgram';

const port = Number(process.argv[2] || 9000);
const hz = Number(process.argv[3] || 60);
const addrCount = Number(process.argv[4] || 100);

const sock = dgram.createSocket('udp4');

/** Minimal OSC encoder: strings and floats are padded to 4 bytes. */
function oscString(s) {
  const buf = Buffer.from(s, 'ascii');
  const padded = Buffer.alloc(Math.ceil((buf.length + 1) / 4) * 4);
  buf.copy(padded);
  return padded;
}

function oscMessage(addr, floats) {
  const tags = oscString(',' + 'f'.repeat(floats.length));
  const args = Buffer.alloc(floats.length * 4);
  floats.forEach((f, i) => args.writeFloatBE(f, i * 4));
  return Buffer.concat([oscString(addr), tags, args]);
}

let tick = 0;
let sent = 0;

setInterval(() => {
  const t = tick / hz;

  for (let i = 0; i < addrCount; i++) {
    const phase = t + i * 0.1;
    sock.send(oscMessage(`/pos/${i}`, [Math.sin(phase), Math.cos(phase), Math.sin(phase * 2)]), port, '127.0.0.1');
    sent++;
  }

  for (let i = 0; i < Math.min(8, addrCount); i++) {
    sock.send(oscMessage(`/level/${i}`, [(Math.sin(t + i) + 1) / 2]), port, '127.0.0.1');
    sent++;
  }

  // a rare address, to exercise the "silence" column
  if (tick % (hz * 2) === 0) {
    sock.send(oscMessage('/cue/fire', [1]), port, '127.0.0.1');
    sent++;
  }

  tick++;
}, 1000 / hz);

setInterval(() => {
  console.log(`sent ${sent} messages (${Math.round(sent / (tick / hz))} msg/s)`);
}, 2000);

console.log(`sending OSC to 127.0.0.1:${port} — ${addrCount} addresses at ${hz} Hz. Ctrl+C to stop.`);

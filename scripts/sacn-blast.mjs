/* sACN (E1.31) generator, for exercising the DMX view without a lighting desk.
 *
 *   node scripts/sacn-blast.mjs [universes] [Hz]
 *   node scripts/sacn-blast.mjs 1-4 44
 *
 * Sends to the standard multicast groups 239.255.0.N:5568.
 * Channels carry a travelling wave, so per-channel min/max mean something.
 * Every ~5 seconds one sequence number is skipped deliberately, so the loss
 * counter can be seen working.
 */

import dgram from 'node:dgram';

const spec = process.argv[2] || '1-4';
const hz = Number(process.argv[3] || 44);
const CHANNELS = 512;
const PORT = 5568;

const universes = [];
for (const part of spec.split(',')) {
  const [a, b] = part.split('-').map((s) => Number(s.trim()));
  for (let u = a; u <= (b ?? a); u++) universes.push(u);
}

const ACN_ID = Buffer.from('ASC-E1.17\0\0\0', 'ascii');
const CID = Buffer.alloc(16, 0x5a);
const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

function buildPacket(universe, sequence, values) {
  const b = Buffer.alloc(126 + values.length);

  // Root layer
  b.writeUInt16BE(0x0010, 0);           // preamble size
  ACN_ID.copy(b, 4);
  b.writeUInt16BE(0x7000 | (110 + values.length), 16);
  b.writeUInt32BE(0x00000004, 18);      // VECTOR_ROOT_E131_DATA
  CID.copy(b, 22);

  // Framing layer
  b.writeUInt16BE(0x7000 | (88 + values.length), 38);
  b.writeUInt32BE(0x00000002, 40);      // VECTOR_E131_DATA_PACKET
  b.write('Reticle test', 44, 'ascii');
  b.writeUInt8(100, 108);               // priority
  b.writeUInt8(sequence, 111);
  b.writeUInt16BE(universe, 113);

  // DMP layer
  b.writeUInt16BE(0x7000 | (11 + values.length), 115);
  b.writeUInt8(0x02, 117);              // VECTOR_DMP_SET_PROPERTY
  b.writeUInt8(0xa1, 118);
  b.writeUInt16BE(0x0000, 119);         // first property address
  b.writeUInt16BE(0x0001, 121);         // address increment
  b.writeUInt16BE(values.length + 1, 123);
  b.writeUInt8(0, 125);                 // START code
  Buffer.from(values).copy(b, 126);

  return b;
}

const sequences = new Map(universes.map((u) => [u, 0]));
let frame = 0;
let sent = 0;

setInterval(() => {
  const t = frame / hz;

  for (const universe of universes) {
    const values = new Uint8Array(CHANNELS);
    for (let i = 0; i < CHANNELS; i++) {
      values[i] = Math.round(127 + 127 * Math.sin(t * 2 + i * 0.05 + universe));
    }

    let seq = (sequences.get(universe) + 1) & 0xff;
    // roughly every 5 seconds, drop a packet number on purpose
    if (frame % (hz * 5) === 0 && universe === universes[0]) seq = (seq + 1) & 0xff;
    sequences.set(universe, seq);

    const group = `239.255.${universe >> 8}.${universe & 0xff}`;
    sock.send(buildPacket(universe, seq, values), PORT, group);
    sent++;
  }

  frame++;
}, 1000 / hz);

setInterval(() => console.log(`sent ${sent} packets across ${universes.length} universes`), 2000);

console.log(`sending sACN: universes ${universes.join(', ')} at ${hz} Hz. Ctrl+C to stop.`);

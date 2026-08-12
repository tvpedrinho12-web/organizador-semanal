// Gera ícones PNG (sem dependências externas) para o PWA.
// Desenha um fundo escuro arredondado + um "check" no tom de destaque.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [11, 11, 13];      // #0B0B0D
const CARD = [21, 21, 24];    // superfície do "cartão"
const ACCENT = [110, 110, 247]; // #6E6EF7

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// distância de um ponto a um segmento
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundedAlpha(x, y, w, h, r) {
  // alpha suave para um retângulo arredondado
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, (r - d) + 0.5));
}

function genIcon(size, opts = {}) {
  const { padded = true } = opts;
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  const pad = padded ? Math.round(S * 0.14) : 0;
  const cardX = pad, cardY = pad, cardW = S - pad * 2, cardH = S - pad * 2;
  const cardR = Math.round(cardW * 0.24);

  // geometria do check (dentro do cartão)
  const ax = cardX + cardW * 0.28, ay = cardY + cardH * 0.53;
  const bx = cardX + cardW * 0.43, by = cardY + cardH * 0.68;
  const ccx = cardX + cardW * 0.74, ccy = cardY + cardH * 0.34;
  const stroke = Math.max(2, S * 0.075);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let col = BG.slice();

      // cartão arredondado
      const ca = roundedAlpha(x - cardX, y - cardY, cardW, cardH, cardR);
      if (ca > 0) col = mix(col, CARD, ca);

      // check (duas linhas)
      const d = Math.min(
        distSeg(x, y, ax, ay, bx, by),
        distSeg(x, y, bx, by, ccx, ccy)
      );
      const ca2 = Math.max(0, Math.min(1, (stroke / 2 - d) + 0.5));
      if (ca2 > 0) col = mix(col, ACCENT, ca2 * ca);

      buf[i] = Math.round(col[0]);
      buf[i + 1] = Math.round(col[1]);
      buf[i + 2] = Math.round(col[2]);
      buf[i + 3] = 255;
    }
  }
  return encodePNG(buf, S, S);
}

function encodePNG(rgba, width, height) {
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // filtro 0 por linha
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'icon-192.png'), genIcon(192, { padded: true }));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), genIcon(512, { padded: true }));
// maskable: sem padding (o SO recorta)
fs.writeFileSync(path.join(outDir, 'icon-512-maskable.png'), genIcon(512, { padded: false }));
// apple touch: fundo cheio, cantos são arredondados pelo iOS
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), genIcon(180, { padded: false }));
console.log('icones gerados em', outDir);

// Zero-Dependency ISO 18004 QR Code SVG Generator (Byte Mode, EC Level L, Versions 1..10)

const QR_VERSION_PARAMS: Record<
  number,
  { size: number; totalCodewords: number; ecCodewordsPerBlock: number; numBlocks: number; align: number[] }
> = {
  1: { size: 21, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1, align: [] },
  2: { size: 25, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1, align: [6, 18] },
  3: { size: 29, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1, align: [6, 22] },
  4: { size: 33, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1, align: [6, 26] },
  5: { size: 37, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1, align: [6, 30] },
  6: { size: 41, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2, align: [6, 34] },
  7: { size: 45, totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks: 2, align: [6, 22, 38] },
  8: { size: 49, totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks: 2, align: [6, 24, 42] },
  9: { size: 53, totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks: 2, align: [6, 26, 46] },
  10: { size: 57, totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks: 4, align: [6, 28, 50] },
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

export function generateQrMatrix(text: string): Uint8Array[] {
  const bytes = Buffer.from(String(text), "utf8");
  let ver = 1;
  for (; ver <= 10; ver++) {
    const p = QR_VERSION_PARAMS[ver];
    const dataCap = p.totalCodewords - p.ecCodewordsPerBlock * p.numBlocks;
    const lenBits = ver <= 9 ? 8 : 16;
    const neededBytes = Math.ceil((4 + lenBits + bytes.length * 8) / 8);
    if (neededBytes <= dataCap) break;
  }
  if (ver > 10) ver = 10;
  const p = QR_VERSION_PARAMS[ver];
  const dataCap = p.totalCodewords - p.ecCodewordsPerBlock * p.numBlocks;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
  const maxBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords = new Uint8Array(dataCap);
  let byteIdx = 0;
  for (let i = 0; i < bits.length && byteIdx < dataCap; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    dataWords[byteIdx++] = b;
  }
  let padToggle = true;
  while (byteIdx < dataCap) {
    dataWords[byteIdx++] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const blockSize = Math.floor(dataCap / p.numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < p.numBlocks; b++) {
    const len = b === p.numBlocks - 1 ? dataCap - offset : blockSize;
    const block = dataWords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, p.ecCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  const maxDataBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (let b = 0; b < p.numBlocks; b++) {
      if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < p.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < p.numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  const size = p.size;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r: number, c: number, dark: boolean | number, isReserved = true) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    if (isReserved) reserved[r][c] = 1;
  };

  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(row + r, col + c, inOuter && (onBorder || inInner), true);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  const align = p.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const ar = align[i];
      const ac = align[j];
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 8) || (ar >= size - 8 && ac <= 8)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
          setModule(ar + r, ac + c, dark, true);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  setModule(size - 8, 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = 1;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = 1;
  }

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setModule(b, a, bit, true);
      setModule(a, b, bit, true);
    }
  }

  const streamBits: number[] = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) streamBits.push((cw >>> i) & 1);
  }
  let bitPtr = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          const bit = bitPtr < streamBits.length ? streamBits[bitPtr++] : 0;
          const masked = (r + c) % 2 === 0 ? bit ^ 1 : bit;
          grid[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Format Info for EC Level L (01) + Mask 0 (000) -> 0x77c4
  const fmtBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = ((fmtBits >>> i) & 1) === 1;
    if (i < 6) setModule(i, 8, bit, true);
    else if (i < 8) setModule(i + 1, 8, bit, true);
    else setModule(size - 15 + i, 8, bit, true);

    if (i < 8) setModule(8, size - 1 - i, bit, true);
    else if (i < 9) setModule(8, 15 - i, bit, true);
    else setModule(8, 15 - i - 1, bit, true);
  }

  return grid;
}

export function generateQrSvg(text: string, opts: { margin?: number } = {}): string {
  const matrix = generateQrMatrix(text);
  const n = matrix.length;
  const margin = opts.margin ?? 2;
  const total = n + margin * 2;
  let pathData = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${total}" height="${total}" fill="#ffffff" rx="1.5"/><path d="${pathData}" fill="#0f172a"/></svg>`;
}

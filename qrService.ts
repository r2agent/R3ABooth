export type QrResult = {
  qrDataUrl: string;
  resultUrl: string;
};

export type QrProvider = {
  generate: (payload: string) => Promise<QrResult>;
};

function generateLocalQr(text: string): string {
  const size = 400;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  const matrix = encodeQrMatrix(text);
  if (!matrix) return '';

  const n = matrix.length;
  const cellSize = Math.floor(size / n);
  const offset = Math.floor((size - cellSize * n) / 2);

  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
      }
    }
  }

  return canvas.toDataURL('image/png');
}

function encodeQrMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 271) return null;

  const version = pickVersion(bytes.length);
  if (!version) return null;

  const data = encodeText(text, version);
  if (!data) return null;

  const n = 17 + version * 4;
  const matrix: (boolean | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));

  placeFinderPatterns(matrix, n);
  placeAlignmentPatterns(matrix, version);
  placeTimingPatterns(matrix, n);

  const reserved = matrix.map((row) => row.map((cell) => cell !== null));
  placeFormatInfoMask(matrix, reserved, n, 0);
  placeData(matrix, data, n);
  applyMask(matrix, reserved, n, 0);
  setFormatInfo(matrix, n, 0);

  return matrix.map((row) => row.map((cell) => cell === true));
}

function pickVersion(byteLen: number): number | null {
  const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  for (let v = 1; v <= 10; v++) {
    if (byteLen <= capacities[v - 1]) return v;
  }
  return null;
}

const VERSION_DATA_BITS: Record<number, number> = {
  1: 128, 2: 224, 3: 272, 4: 368, 5: 448, 6: 512, 7: 592, 8: 672, 9: 768, 10: 864,
};

function encodeText(text: string, version: number): Uint8Array | null {
  const bytes = new TextEncoder().encode(text);
  const totalDataBits = VERSION_DATA_BITS[version] || 128;

  const bits: number[] = [];
  bits.push(0, 1, 0, 0);
  const ccBits = version <= 9 ? 8 : 16;
  const len = bytes.length;
  for (let i = ccBits - 1; i >= 0; i--) bits.push((len >> i) & 1);
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  for (let i = 0; i < 4 && bits.length < totalDataBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < totalDataBits) {
    const pb = padBytes[padIdx % 2];
    for (let i = 7; i >= 0; i--) bits.push((pb >> i) & 1);
    padIdx++;
  }

  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out[i] = v;
  }
  return out;
}

function placeFinderPatterns(matrix: (boolean | null)[][], n: number) {
  const positions = [[0, 0], [0, n - 7], [n - 7, 0]];
  for (const [r, c] of positions) {
    for (let dr = 0; dr < 7; dr++) {
      for (let dc = 0; dc < 7; dc++) {
        const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        matrix[r + dr][c + dc] = isBorder || isInner;
      }
    }
    // Separator
    for (let i = 0; i < 8; i++) {
      if (r + 7 < n) matrix[r + 7][c + i] = matrix[r + 7][c + i] ?? false;
      if (c + 7 < n) matrix[r + i][c + 7] = matrix[r + i][c + 7] ?? false;
    }
  }
}

const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function placeAlignmentPatterns(matrix: (boolean | null)[][], version: number) {
  if (version < 2) return;
  const centers = ALIGNMENT_CENTERS[version] || ALIGNMENT_CENTERS[4];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === centers[centers.length - 1]) ||
          (r === centers[centers.length - 1] && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const absDR = Math.abs(dr);
          const absDC = Math.abs(dc);
          const isOuter = absDR === 2 || absDC === 2;
          const isCenter = absDR === 0 && absDC === 0;
          matrix[r + dr][c + dc] = isOuter || isCenter;
        }
      }
    }
  }
}

function placeTimingPatterns(matrix: (boolean | null)[][], n: number) {
  for (let i = 8; i < n - 8; i++) {
    matrix[6][i] = matrix[6][i] ?? (i % 2 === 0);
    matrix[i][6] = matrix[i][6] ?? (i % 2 === 0);
  }
}

function placeFormatInfoMask(matrix: (boolean | null)[][], reserved: boolean[][], n: number, mask: number) {
  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) reserved[8][i] = true;
    if (matrix[i][8] === null) reserved[i][8] = true;
  }
  for (let i = 0; i < 7; i++) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }
  void mask;
}

function placeData(matrix: (boolean | null)[][], data: Uint8Array, n: number) {
  let bitIdx = 0;
  const totalBits = data.length * 8;
  let dirUp = true;
  let col = n - 1;

  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const row = dirUp ? n - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const actualCol = col - c;
        if (matrix[row][actualCol] === null) {
          const bit = bitIdx < totalBits ? ((data[Math.floor(bitIdx / 8)] >> (7 - (bitIdx % 8))) & 1) === 1 : false;
          matrix[row][actualCol] = bit;
          bitIdx++;
        }
      }
    }
    col -= 2;
    dirUp = !dirUp;
  }
}

function applyMask(matrix: (boolean | null)[][], reserved: boolean[][], n: number, maskId: number) {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!reserved[r][c] && matrix[r][c] !== null) {
        let maskBit = false;
        switch (maskId) {
          case 0: maskBit = (r + c) % 2 === 0; break;
          case 1: maskBit = r % 2 === 0; break;
          case 2: maskBit = c % 3 === 0; break;
          case 3: maskBit = (r + c) % 3 === 0; break;
          case 4: maskBit = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
          case 5: maskBit = ((r * c) % 2) + ((r * c) % 3) === 0; break;
          case 6: maskBit = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
          case 7: maskBit = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        }
        if (maskBit) matrix[r][c] = !matrix[r][c];
      }
    }
  }
}

function setFormatInfo(matrix: (boolean | null)[][], n: number, mask: number) {
  const ecc = 0b01; // L
  const formatInfo = ((ecc << 3) | mask) << 10;
  const gf = 0b10100110111;
  let fi = formatInfo;
  for (let i = 14; i >= 10; i--) {
    if ((fi >> i) & 1) fi ^= gf << (i - 10);
  }
  const bits = ((formatInfo | fi) ^ 0b101010000010010) & 0x7FFF;

  for (let i = 0; i <= 5; i++) matrix[8][i] = ((bits >> i) & 1) === 1;
  matrix[8][7] = ((bits >> 6) & 1) === 1;
  matrix[8][8] = ((bits >> 7) & 1) === 1;
  matrix[7][8] = ((bits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = ((bits >> i) & 1) === 1;

  for (let i = 0; i < 8; i++) matrix[n - 1 - i][8] = ((bits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) matrix[8][n - 15 + i] = ((bits >> i) & 1) === 1;
  matrix[n - 8][8] = true; // Dark module
}

const LOCAL_PROVIDER: QrProvider = {
  generate: async (payload: string): Promise<QrResult> => {
    const qrDataUrl = generateLocalQr(payload);
    return { qrDataUrl, resultUrl: payload };
  },
};

let activeProvider: QrProvider = LOCAL_PROVIDER;

export function setQrProvider(provider: QrProvider): void {
  activeProvider = provider;
}

export async function generateQrCode(payload: string): Promise<QrResult> {
  const result = await activeProvider.generate(payload);
  if (!result.qrDataUrl) {
    const localQr = generateLocalQr(payload);
    if (localQr) return { qrDataUrl: localQr, resultUrl: payload };
    return { qrDataUrl: '', resultUrl: payload };
  }
  return result;
}

export function buildResultPayload(resultId: string, eventId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  if (base && base !== 'null' && base !== 'file://') {
    return `${base}/#result/${resultId}`;
  }
  return `r3a-booth://result/${resultId}?event=${eventId}`;
}

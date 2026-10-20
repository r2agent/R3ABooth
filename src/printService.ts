/* eslint-disable @typescript-eslint/no-explicit-any */
/* ============================================================
   PRINT SERVICE — NATIVE BLUETOOTH (SPP) v2
   - pakai window.bluetoothSerial langsung (bukan wrapper Observable)
   - connect benar-benar di-await + dicek isConnected
   - data dikirim sebagai Uint8Array per chunk (anti buffer penuh)
   - gambar di-dither (Floyd-Steinberg), dipecah per 255 baris
   - kalau native gagal, otomatis fallback ke RawBT
   ============================================================ */

export type PrintOptions = {
  copies: number;
  paperSize: string;
  dataUrl: string;
  layout: string;
  printerName?: string;
  mode?: 'image' | 'text';
  textPayload?: string;
  chunkSize?: number; // default 128 byte
  delayMs?: number; // default 15 ms antar chunk
  onProgress?: (pct: number) => void;
};

export type PrintProvider = {
  name: string;
  isAvailable: (opts: PrintOptions) => Promise<boolean>;
  print: (opts: PrintOptions) => Promise<boolean>;
};

const providers: PrintProvider[] = [];

export function registerProvider(p: PrintProvider): void {
  if (providers.find((x) => x.name === p.name)) return;
  providers.push(p);
}

function isNativePlatform(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function safeBase64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/* ------------------------------------------------------------
   BLUETOOTH SERIAL HELPERS (callback -> Promise)
   ------------------------------------------------------------ */

type BtDevice = { name?: string; address: string; id?: string };

function getBt(): any {
  const bt = (window as any).bluetoothSerial;
  if (!bt) {
    throw new Error(
      'Plugin bluetoothSerial tidak terdeteksi. Pastikan sudah npx cap sync android dan APK ter-update.'
    );
  }
  return bt;
}

const errToString = (e: unknown) => (typeof e === 'string' ? e : JSON.stringify(e));

const btIsEnabled = () =>
  new Promise<boolean>((res) => getBt().isEnabled(() => res(true), () => res(false)));

const btEnable = () =>
  new Promise<void>((res, rej) => getBt().enable(() => res(), (e: unknown) => rej(new Error(errToString(e)))));

const btList = () =>
  new Promise<BtDevice[]>((res, rej) =>
    getBt().list((d: BtDevice[]) => res(d || []), (e: unknown) => rej(new Error(errToString(e))))
  );

const btIsConnected = () =>
  new Promise<boolean>((res) => getBt().isConnected(() => res(true), () => res(false)));

const btConnect = (addr: string) =>
  new Promise<void>((res, rej) =>
    getBt().connect(addr, () => res(), (e: unknown) => rej(new Error('Connect gagal: ' + errToString(e))))
  );

const btDisconnect = () =>
  new Promise<void>((res) => {
    try {
      getBt().disconnect(() => res(), () => res());
    } catch {
      res();
    }
  });

const btWrite = (chunk: Uint8Array) =>
  new Promise<void>((res, rej) => {
    const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    getBt().write(buf, () => res(), (e: unknown) => rej(new Error('Write gagal: ' + errToString(e))));
  });

// Android 12+ butuh izin BLUETOOTH_CONNECT / SCAN saat runtime.
// Plugin bluetooth-serial lawas nggak minta, jadi numpang plugin BLE yang sudah terpasang.
async function ensureBtPermission(): Promise<void> {
  try {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    await BleClient.initialize({ androidNeverForLocation: true });
  } catch (e) {
    console.warn('[Print] Gagal minta izin Bluetooth:', e);
  }
}

// Kirim data per chunk, tunggu tiap write selesai, retry kalau gagal
export async function writeChunked(
  data: Uint8Array,
  chunkSize = 128,
  delayMs = 15,
  onProgress?: (pct: number) => void
): Promise<void> {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));

    let lastErr: unknown;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await btWrite(chunk);
        ok = true;
      } catch (e) {
        lastErr = e;
        await sleep(60);
      }
    }
    if (!ok) throw lastErr instanceof Error ? lastErr : new Error('Write gagal');

    onProgress?.(Math.min(100, Math.round(((i + chunk.length) / data.length) * 100)));
    if (delayMs > 0) await sleep(delayMs);
  }
}

/* ------------------------------------------------------------
   KONVERSI DATA
   ------------------------------------------------------------ */

// string ESC/POS -> byte (char code < 256 dipakai apa adanya)
function stringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c < 256 ? c : 0x3f; // '?'
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar'));
    img.src = src;
  });
}

// Gambar -> ESC/POS raster (GS v 0), dithering, dipecah per 255 baris
async function convertImageToEscPosBitmap(dataUrl: string, targetWidth: number = 576): Promise<Uint8Array> {
  const img = await loadImage(dataUrl);

  const width = targetWidth;
  const height = Math.max(1, Math.floor(img.height * (targetWidth / img.width)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);

  // grayscale
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Floyd-Steinberg dithering
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const nw = old < 128 ? 0 : 255;
      const err = old - nw;
      gray[i] = nw;
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16;
        gray[i + width] += (err * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += err / 16;
      }
    }
  }

  const bytesPerRow = Math.ceil(width / 8);
  const BAND = 255;
  const bands = Math.ceil(height / BAND);

  const init = [0x1b, 0x40]; // ESC @
  const tail = [0x0a, 0x0a, 0x0a]; // feed
  const total = init.length + tail.length + bands * 8 + bytesPerRow * height;

  const out = new Uint8Array(total);
  let p = 0;
  out.set(init, p);
  p += init.length;

  for (let by = 0; by < height; by += BAND) {
    const bh = Math.min(BAND, height - by);

    // GS v 0 m xL xH yL yH
    out[p++] = 0x1d;
    out[p++] = 0x76;
    out[p++] = 0x30;
    out[p++] = 0x00;
    out[p++] = bytesPerRow & 0xff;
    out[p++] = (bytesPerRow >> 8) & 0xff;
    out[p++] = bh & 0xff;
    out[p++] = (bh >> 8) & 0xff;

    for (let y = by; y < by + bh; y++) {
      for (let x = 0; x < width; x += 8) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          if (x + bit < width && gray[y * width + (x + bit)] < 128) {
            byte |= 1 << (7 - bit);
          }
        }
        out[p++] = byte;
      }
    }
  }

  out.set(tail, p);
  return out;
}

/* ------------------------------------------------------------
   TEST PRINT TEKS
   ------------------------------------------------------------ */

function buildEscPosTestPrint(opts: any): string {
  const { deviceId, version, paperSize, appName = 'R3A BOOTH' } = opts;
  const now = new Date().toLocaleString('id-ID');
  const W = paperSize === '58mm' ? 32 : 48;
  const line = '-'.repeat(W);
  const center = (t: string) => {
    const cleanT = t.substring(0, W);
    const pad = Math.max(0, Math.floor((W - cleanT.length) / 2));
    return ' '.repeat(pad) + cleanT;
  };

  return [
    '\x1B\x40',
    '\x1B\x61\x01',
    '\x1B\x21\x11',
    center('TEST PRINT') + '\n',
    '\x1B\x21\x00',
    center(appName) + '\n',
    '\x1B\x61\x00',
    line + '\n',
    `Device  : ${String(deviceId ?? '').slice(-8)}\n`,
    `Time    : ${now}\n`,
    `Paper   : ${paperSize}\n`,
    `Version : ${version}\n`,
    line + '\n',
    '\x1B\x61\x01',
    'PRINTER OK\n',
    'siap beroperasi\n',
    '\n\n\n',
  ].join('');
}

/* ------------------------------------------------------------
   PROVIDERS
   ------------------------------------------------------------ */

const NATIVE_BT_PROVIDER: PrintProvider = {
  name: 'native-bt',
  isAvailable: async (opts) => {
    return isNativePlatform() && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    const chunkSize = opts.chunkSize ?? 128;
    const delayMs = opts.delayMs ?? 15;

    try {
      await ensureBtPermission();

      if (!(await btIsEnabled())) {
        await btEnable();
        await sleep(1000);
      }

      const printerId = opts.printerName?.replace('BT:', '').trim() || '';
      const devices = await btList();

      const target = devices.find(
        (d) =>
          (d.name && d.name.toLowerCase().includes(printerId.toLowerCase())) ||
          d.address === printerId
      );
      if (!target) {
        throw new Error(`Printer "${printerId}" tidak ditemukan. Pastikan sudah di-pair di pengaturan Bluetooth.`);
      }

      // bersihkan koneksi lama, lalu connect betulan
      await btDisconnect();
      await sleep(300);
      await withTimeout(btConnect(target.address), 10000, 'Timeout connect ke printer');

      const connected = await btIsConnected();
      console.log('[Print] connected?', connected, target.name, target.address);
      if (!connected) throw new Error('Gagal terhubung ke printer');

      // siapkan data
      let bytes: Uint8Array;
      if (opts.mode === 'text' && opts.textPayload) {
        bytes = stringToBytes(opts.textPayload);
      } else {
        if (!opts.dataUrl) throw new Error('Gambar kosong');
        const targetW = opts.paperSize.includes('58') ? 384 : 576;
        bytes = await convertImageToEscPosBitmap(opts.dataUrl, targetW);
      }
      console.log('[Print] kirim', bytes.length, 'byte, chunk', chunkSize, 'delay', delayMs);

      await writeChunked(bytes, chunkSize, delayMs, opts.onProgress);

      // tunggu printer selesai mencetak sebelum disconnect (sebanding ukuran data)
      const waitMs = Math.min(30000, 1500 + Math.ceil(bytes.length / 25));
      console.log('[Print] Menunggu printer mencetak...', waitMs, 'ms');
      await sleep(waitMs);

      return true;
    } catch (err) {
      console.error('[Print] ❌ Error Native BT:', err);
      throw err;
    } finally {
      await btDisconnect();
    }
  },
};

const RAWBT_PROVIDER: PrintProvider = {
  name: 'rawbt',
  isAvailable: async (opts) => isNativePlatform() && !!opts.printerName?.startsWith('BT:'),
  print: async (opts) => {
    const base64 =
      opts.mode === 'text'
        ? safeBase64Encode(opts.textPayload || '')
        : opts.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url =
      opts.mode === 'text'
        ? `rawbt:base64,${base64}`
        : `intent:base64,${base64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      await AppLauncher.openUrl({ url });
      return true;
    } catch {
      return false;
    }
  },
};

const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async () => true,
  print: async () => false,
};

registerProvider(NATIVE_BT_PROVIDER);
registerProvider(RAWBT_PROVIDER);
registerProvider(BROWSER_PRINT_PROVIDER);

/* ------------------------------------------------------------
   ENTRY POINT
   ------------------------------------------------------------ */

export async function printResult(opts: PrintOptions): Promise<boolean> {
  // kumpulkan semua provider yang tersedia, urut sesuai prioritas
  const available: PrintProvider[] = [];
  for (const p of providers) {
    if (await p.isAvailable(opts)) available.push(p);
  }
  if (available.length === 0) return false;

  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    let ok = false;

    // coba provider satu per satu; kalau gagal/throw, lanjut ke berikutnya
    for (const p of available) {
      try {
        ok = await p.print(opts);
      } catch (e) {
        console.warn(`[Print] Provider ${p.name} gagal:`, e);
        ok = false;
      }
      if (ok) break;
    }

    if (!ok) success = false;
    if (i < copies - 1) await sleep(1500);
  }

  return success;
}

export { buildEscPosTestPrint };
/* ============================================================
   PRINT SERVICE — NATIVE BLUETOOTH + RAWBT FALLBACK
   ============================================================ */

import { BluetoothSerial } from '@awesome-cordova-plugins/bluetooth-serial';

export type PrintOptions = {
  copies: number;
  paperSize: string;
  dataUrl: string;
  layout: string;
  printerName?: string;
  mode?: 'image' | 'text';
  textPayload?: string;
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

function safeBase64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// =========================================================================
// FUNGSI 1: KONVERSI TEKS KE ESC/POS (Untuk Test Print)
// =========================================================================
function buildEscPosTestPrint(opts: {
  deviceId: string;
  version: string;
  paperSize: '58mm' | '80mm';
  appName?: string;
}): string {
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
    `Device  : ${deviceId.slice(-8)}\n`,
    `Time    : ${now}\n`,
    `Paper   : ${paperSize}\n`,
    `Version : ${version}\n`,
    line + '\n',
    '\x1B\x61\x01',             
    'PRINTER OK\n',
    'siap beroperasi\n',
    '\n\n\n',                   
    '\x1D\x56\x00',             
  ].join('');
}

// =========================================================================
// FUNGSI 2: KONVERSI GAMBAR JPG KE ESC/POS BITMAP (Bagian Paling Berat!)
// =========================================================================
async function convertImageToEscPosBitmap(dataUrl: string, targetWidth: number = 576): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = targetWidth / img.width;
      canvas.width = targetWidth;
      canvas.height = Math.floor(img.height * scale);
      
      const ctx = canvas.getContext('2d')!;
      // Background putih biar transparan jadi putih
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      
      // ESC/POS Header untuk Gambar (GS v 0)
      const xL = width % 256;
      const xH = Math.floor(width / 256);
      const yL = height % 256;
      const yH = Math.floor(height / 256);
      
      let command = `\x1D\x76\x30\x00${String.fromCharCode(xL, xH, yL, yH)}`;
      
      // Looping pixel per baris (8 pixel jadi 1 byte)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x += 8) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (x + bit < width) {
              const idx = (y * width + (x + bit)) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              // Konversi ke Grayscale (Hitam/Putih)
              const gray = 0.299 * r + 0.587 * g + 0.114 * b;
              // Jika gelap, bit jadi 1 (hitam)
              if (gray < 128) {
                byte |= (1 << (7 - bit));
              }
            }
          }
          command += String.fromCharCode(byte);
        }
      }
      // Perintah potong kertas (optional)
      command += '\n\n\n\x1D\x56\x00'; 
      
      resolve(command);
    };
    img.src = dataUrl;
  });
}

/* ============ NATIVE BLUETOOTH PROVIDER ============ */
const NATIVE_BT_PROVIDER: PrintProvider = {
  name: 'native-bt',
  isAvailable: async (opts) => {
    // Cek apakah di APK dan punya printer name (format: BT: MAC_ADDRESS atau BT: Name)
    return isNativePlatform() && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    try {
      const printerId = opts.printerName?.replace('BT:', '').trim() || '';
      console.log(`[Print] Native BT → Menghubungkan ke ${printerId}...`);

      // 1. Coba Connect (Kalau gagal, coba scan nama)
      try {
        await BluetoothSerial.connect(printerId);
      } catch (err) {
        console.log('[Print] Connect langsung gagal, coba cari via list...', err);
        const devices = await BluetoothSerial.list();
        const target = devices.find(d => d.name === printerId || d.address === printerId);
        if (!target) throw new Error('Printer tidak ditemukan di daftar BT.');
        await BluetoothSerial.connect(target.address);
      }

      console.log('[Print] Bluetooth Terhubung!');

      // 2. Siapkan Data ESC/POS
      let dataToWrite = '';

      if (opts.mode === 'text' && opts.textPayload) {
        dataToWrite = opts.textPayload;
      } else {
        if (!opts.dataUrl) throw new Error('Gambar tidak ada');
        console.log('[Print] Mengonversi gambar ke Bitmap ESC/POS...');
        const targetW = opts.paperSize.includes('58') ? 384 : 576;
        dataToWrite = await convertImageToEscPosBitmap(opts.dataUrl, targetW);
      }

      // 3. Kirim Data ke Printer
      console.log('[Print] Mengirim data ke printer...');
      await BluetoothSerial.write(dataToWrite);

      // 4. Putuskan Koneksi
      await new Promise(r => setTimeout(r, 1000));
      await BluetoothSerial.disconnect();
      
      console.log('[Print] ✅ Cetak Selesai!');
      return true;
    } catch (err) {
      console.error(`[Print] ❌ Native BT Error:`, err);
      return false;
    }
  }
};

// (Opsional) Bawa RawBT sebagai cadangan
const RAWBT_PROVIDER: PrintProvider = {
  name: 'rawbt',
  isAvailable: async (opts) => isNativePlatform() && !!opts.printerName?.startsWith('BT:'),
  print: async (opts) => {
    const base64 = opts.mode === 'text' ? safeBase64Encode(opts.textPayload || '') : opts.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    const url = opts.mode === 'text' ? `rawbt:base64,${base64}` : `intent:base64,${base64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      await AppLauncher.openUrl({ url });
      return true;
    } catch { return false; }
  }
};

const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async () => true,
  print: async () => false,
};

// DAFTARKAN PROVIDER (Native di paling atas)
registerProvider(NATIVE_BT_PROVIDER);
registerProvider(RAWBT_PROVIDER);
registerProvider(BROWSER_PRINT_PROVIDER);

/* ============ PUBLIC API ============ */
export async function printResult(opts: PrintOptions): Promise<boolean> {
  let selectedProvider: PrintProvider | null = null;

  for (const p of providers) {
    if (await p.isAvailable(opts)) {
      selectedProvider = p;
      break;
    }
  }

  if (!selectedProvider) return false;

  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    const ok = await selectedProvider.print(opts);
    if (!ok) success = false;
    if (i < copies - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return success;
}

export { buildEscPosTestPrint };
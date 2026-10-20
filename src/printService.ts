/* ============================================================
   PRINT SERVICE — NATIVE BLUETOOTH (FIXED DELAY & NO CUT)
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

// Fungsi Test Print Teks
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
    `Device  : ${deviceId.slice(-8)}\n`,
    `Time    : ${now}\n`,
    `Paper   : ${paperSize}\n`,
    `Version : ${version}\n`,
    line + '\n',
    '\x1B\x61\x01',             
    'PRINTER OK\n',
    'siap beroperasi\n',
    '\n\n\n',
    // ⚡ PERINTAH CUT DIHAPUS DULU BIAR GAK HANG
  ].join('');
}

// Fungsi Konversi Gambar
async function convertImageToEscPosBitmap(dataUrl: string, targetWidth: number = 576): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = targetWidth / img.width;
      canvas.width = targetWidth;
      canvas.height = Math.floor(img.height * scale);
      
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      
      const xL = width % 256;
      const xH = Math.floor(width / 256);
      const yL = height % 256;
      const yH = Math.floor(height / 256);
      
      let command = `\x1D\x76\x30\x00${String.fromCharCode(xL, xH, yL, yH)}`;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x += 8) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (x + bit < width) {
              const idx = (y * width + (x + bit)) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const gray = 0.299 * r + 0.587 * g + 0.114 * b;
              if (gray < 128) byte |= (1 << (7 - bit));
            }
          }
          command += String.fromCharCode(byte);
        }
      }
      command += '\n\n\n'; 
      resolve(command);
    };
    img.src = dataUrl;
  });
}

const NATIVE_BT_PROVIDER: PrintProvider = {
  name: 'native-bt',
  isAvailable: async (opts) => {
    return isNativePlatform() && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    try {
      if (!BluetoothSerial) throw new Error('Plugin Bluetooth tidak terdeteksi.');

      const isEnabled = await BluetoothSerial.isEnabled();
      if (!isEnabled) {
        await BluetoothSerial.enable();
        await new Promise(r => setTimeout(r, 1000)); 
      }

      const printerId = opts.printerName?.replace('BT:', '').trim() || '';
      const devices = await BluetoothSerial.list();
      
      const target = devices.find(d => 
        (d.name && d.name.toLowerCase().includes(printerId.toLowerCase())) || 
        d.address === printerId
      );

      if (!target) throw new Error(`Printer "${printerId}" tidak ditemukan.`);

      await BluetoothSerial.connect(target.address);
      
      let dataToWrite = '';
      if (opts.mode === 'text' && opts.textPayload) {
        dataToWrite = opts.textPayload;
      } else {
        if (!opts.dataUrl) throw new Error('Gambar kosong');
        const targetW = opts.paperSize.includes('58') ? 384 : 576;
        dataToWrite = await convertImageToEscPosBitmap(opts.dataUrl, targetW);
      }

      await BluetoothSerial.write(dataToWrite);
      
      // ⚡ FIX: Kasih waktu printer buat mikir dan mencetak (3 detik)
      console.log('[Print] Menunggu printer mencetak...');
      await new Promise(r => setTimeout(r, 3000)); 
      
      await BluetoothSerial.disconnect();
      return true;
    } catch (err) {
      console.error(`[Print] ❌ Error Native BT:`, err);
      throw err; 
    }
  }
};

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

registerProvider(NATIVE_BT_PROVIDER);
registerProvider(RAWBT_PROVIDER);
registerProvider(BROWSER_PRINT_PROVIDER);

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
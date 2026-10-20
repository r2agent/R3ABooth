/* ============================================================
   PRINT SERVICE — Modular Print Provider System (FIXED RAWBT)
   ============================================================ */

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

// Resize gambar agar tidak crash (limit memori Android Intent)
function resizeImageForThermal(dataUrl: string, paperSize: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const targetWidth = paperSize.includes('58') ? 384 : 576;
      const scale = targetWidth / img.width;
      canvas.width = targetWidth;
      canvas.height = img.height * scale;
      
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ============ RAWTBT ============ */
const RAWBT_PROVIDER: PrintProvider = {
  name: 'rawbt',
  isAvailable: async (opts) => {
    return isNativePlatform() && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    try {
      if (opts.mode === 'text' && opts.textPayload) {
        // === MODE TEXT (Test Print ESC/POS) ===
        const base64Data = safeBase64Encode(opts.textPayload);
        // Teks pakai skema rawbt:
        window.location.href = `rawbt:base64,${base64Data}`;
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      } 
      
      // === MODE IMAGE (Foto / Struk) ===
      if (!opts.dataUrl) return false;
      
      const resizedUrl = await resizeImageForThermal(opts.dataUrl, opts.paperSize);
      const base64Data = resizedUrl.replace(/^data:image\/[a-z]+;base64,/, '');
      
      // ⚡ GAMBAR WAJIB PAKAI INTENT SCHEME AGAR DIKONVERSI KE BITMAP
      const intentUrl = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
      
      // Gunakan AppLauncher via dynamic import (Anti-Block WebView)
      const { AppLauncher } = await import('@capacitor/app-launcher');
      await AppLauncher.openUrl({ url: intentUrl });
      
      // Tunggu user selesai print di aplikasi RawBT
      await new Promise((r) => setTimeout(r, 3000));
      return true;
    } catch (err) {
      console.error(`[Print] ❌ Gagal RawBT:`, err);
      return false;
    }
  }
};

/* ============ NETWORK & BROWSER ============ */
const NETWORK_PROVIDER: PrintProvider = {
  name: 'network',
  isAvailable: async (opts) => !!opts.printerName?.startsWith('LAN:'),
  print: async () => {
    console.warn('[Print] LAN belum diimplementasi');
    return false;
  },
};

const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async () => true, // Fallback untuk Web
  print: async (opts) => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      iframe.onload = () => {
        const doc = iframe.contentWindow?.document;
        if (!doc) { resolve(false); return; }
        doc.open();
        doc.write(`
          <html>
            <head><title>Print</title>
              <style>@page { size: auto; margin: 0; } body { margin:0; padding:0; text-align:center; }</style>
            </head>
            <body><img src="${opts.dataUrl}" /></body>
          </html>
        `);
        doc.close();
        iframe.contentWindow?.focus();
        setTimeout(() => {
          try { iframe.contentWindow?.print(); } catch { /* ignore */ }
          setTimeout(() => { iframe.remove(); resolve(true); }, 1000);
        }, 500);
      };
      iframe.onerror = () => { iframe.remove(); resolve(false); };
      document.body.appendChild(iframe);
    });
  },
};

registerProvider(NETWORK_PROVIDER);
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

export function buildEscPosTestPrint(opts: {
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
    '\x1B\x40', '\x1B\x61\x01', '\x1B\x21\x11',
    center('TEST PRINT') + '\n',
    '\x1B\x21\x00', center(appName) + '\n',
    '\x1B\x61\x00', line + '\n',
    `Device  : ${deviceId.slice(-8)}\n`,
    `Time    : ${now}\n`,
    `Paper   : ${paperSize}\n`,
    `Version : ${version}\n`,
    line + '\n', '\x1B\x61\x01',
    'PRINTER OK\n', 'siap beroperasi\n',
    '\n\n\n', '\x1D\x56\x00',
  ].join('');
}
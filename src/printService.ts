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

// Helper: String ke Base64 yang aman untuk karakter kontrol (ESC/POS)
function safeBase64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/* ============ NETWORK (LAN/IP) ============ */
const NETWORK_PROVIDER: PrintProvider = {
  name: 'network',
  isAvailable: async (opts) => !!opts.printerName?.startsWith('LAN:'),
  print: async (opts) => {
    // Placeholder: LAN raw TCP (Port 9100) butuh plugin native.
    console.warn('[Print] LAN print belum diimplementasi sempurna');
    return false;
  },
};

/* ============ RAWTBT (BT Classic via RawBT app) ============ */
const RAWBT_PROVIDER: PrintProvider = {
  name: 'rawbt',
  isAvailable: async (opts) => {
    return isNativePlatform() && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    try {
      console.log(`[Print] RawBT → mode=${opts.mode || 'image'}`);

      // === MODE TEXT (Test Print) ===
      if (opts.mode === 'text' && opts.textPayload) {
        const base64Data = safeBase64Encode(opts.textPayload);
        
        // Format URI resmi RawBT untuk base64
        const url = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
        
        window.location.href = url;
        await new Promise((r) => setTimeout(r, 2500));
        return true;
      }

      // === MODE IMAGE (Cetak Foto / Struk) ===
      if (!opts.dataUrl) return false;
      const base64Data = opts.dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
      const url = `intent:base64,${base64Data}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
      
      window.location.href = url;
      await new Promise((r) => setTimeout(r, 2500));
      return true;
    } catch (err) {
      console.error(`[Print] ❌ Gagal RawBT:`, err);
      return false;
    }
  },
};

/* ============ BROWSER (Fallback untuk Web/Desktop) ============ */
const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async (opts) => !opts.printerName,
  print: async (opts): Promise<boolean> => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      iframe.onload = () => {
        const doc = iframe.contentWindow?.document;
        if (!doc) { resolve(false); return; }
        doc.open();
        doc.write(`
          <html>
            <head><title>R3A Booth Print</title>
              <style>
                @page { size: auto; margin: 0; }
                body { margin:0; padding:0; display:flex; align-items:center; justify-content:center; height:100vh; overflow:hidden; }
                img { max-width:100%; max-height:100%; object-fit:contain; }
              </style>
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

/* ============ PUBLIC API ============ */
export async function printResult(opts: PrintOptions): Promise<boolean> {
  let selectedProvider: PrintProvider | null = null;

  for (const p of providers) {
    if (await p.isAvailable(opts)) {
      selectedProvider = p;
      break;
    }
  }

  if (!selectedProvider) {
    console.warn('[Print] Tidak ada provider yang tersedia untuk printer ini.');
    return false;
  }

  console.log(`[Print] Provider: ${selectedProvider.name} (Target: ${opts.printerName || 'default'})`);

  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    console.log(`[Print] Copy ${i + 1}/${copies}...`);
    const ok = await selectedProvider.print(opts);
    if (!ok) success = false;
    if (i < copies - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  return success;
}

/* ============ ESC/POS TEXT BUILDER (MURNI ASCII) ============ */
export function buildEscPosTestPrint(opts: {
  deviceId: string;
  version: string;
  paperSize: '58mm' | '80mm';
  appName?: string;
}): string {
  const { deviceId, version, paperSize, appName = 'R3A BOOTH' } = opts;
  const now = new Date().toLocaleString('id-ID');
  
  // Lebar printer: 58mm = 32 karakter, 80mm = 48 karakter
  const W = paperSize === '58mm' ? 32 : 48; 

  const line = '-'.repeat(W);
  const center = (t: string) => {
    const cleanT = t.substring(0, W); // Potong kalau kepanjangan
    const pad = Math.max(0, Math.floor((W - cleanT.length) / 2));
    return ' '.repeat(pad) + cleanT;
  };

  return [
    '\x1B\x40',                 // INIT (Reset printer)
    '\x1B\x61\x01',             // CENTER (Tengah)
    '\x1B\x21\x11',             // DOUBLE W+H (Huruf besar)
    center('TEST PRINT') + '\n',
    '\x1B\x21\x00',             // NORMAL (Huruf normal)
    center(appName) + '\n',
    '\x1B\x61\x00',             // LEFT (Kiri)
    line + '\n',
    `Device  : ${deviceId.slice(-8)}\n`,
    `Time    : ${now}\n`,
    `Paper   : ${paperSize}\n`,
    `Version : ${version}\n`,
    line + '\n',
    '\x1B\x61\x01',             // CENTER
    'PRINTER OK\n',
    'siap beroperasi\n',
    '\n\n\n',                   // Feed kertas
    '\x1D\x56\x00',             // CUT (Potong kertas - kalau support)
  ].join('');
}
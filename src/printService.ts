/* ============================================================
   PRINT SERVICE — Modular Print Provider System
   ============================================================ */

export type PrintOptions = {
  copies: number;
  paperSize: string;
  dataUrl: string;
  layout: string;
  printerName?: string;
};

export type PrintProvider = {
  name: string;
  isAvailable: (opts: PrintOptions) => Promise<boolean>;
  print: (opts: PrintOptions) => Promise<boolean>;
};

/* ============================================================
   REGISTRY
   ============================================================ */
const providers: PrintProvider[] = [];

export function registerProvider(p: PrintProvider): void {
  if (providers.find((x) => x.name === p.name)) return;
  providers.push(p);
}

/* ============================================================
   PROVIDER 1: SILENT PRINT NETWORK / LAN (Port 9100)
   ============================================================ */
const NETWORK_PROVIDER: PrintProvider = {
  name: 'network',
  isAvailable: async (opts) => {
    return !!opts.printerName?.startsWith('LAN:');
  },
  print: async (opts) => {
    const ip = opts.printerName?.replace('LAN:', '').trim();
    if (!ip) return false;

    try {
      console.log(`[Print] Mengirim gambar ke IP ${ip} (Port 9100)...`);
      const res = await fetch(opts.dataUrl);
      const blob = await res.blob();
      
      const response = await fetch(`http://${ip}:9100/print`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'application/octet-stream' },
      });

      if (response.ok) {
        console.log(`[Print] ✅ Network Print Berhasil`);
        return true;
      }
      throw new Error(`Printer IP HTTP Status: ${response.status}`);
    } catch (err) {
      console.error(`[Print] ❌ Gagal Network Print:`, err);
      return false;
    }
  }
};

/* ============================================================
   PROVIDER 2: SILENT PRINT BLUETOOTH (Via RawBT Intent)
   ============================================================ */
const RAWBT_PROVIDER: PrintProvider = {
  name: 'rawbt',
  isAvailable: async (opts) => {
    const isNative = (window as any).Capacitor?.isNativePlatform?.();
    return isNative && !!opts.printerName?.startsWith('BT:');
  },
  print: async (opts) => {
    try {
      console.log(`[Print] Mengirim ke RawBT (Bluetooth)...`);
      const base64Data = opts.dataUrl.replace(/^data:[^;]+;base64,/, '');
      
      // Panggil intent RawBT
      window.location.href = `rawbt:base64,${base64Data}`;
      
      // Jeda agar OS bisa melempar intent ke aplikasi RawBT
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return true;
    } catch (err) {
      console.error(`[Print] ❌ Gagal RawBT:`, err);
      return false;
    }
  }
};

/* ============================================================
   PROVIDER 3: FALLBACK BROWSER / OS PRINT
   ============================================================ */
const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async () => true, // Selalu tersedia sebagai fallback
  print: async (opts): Promise<boolean> => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      
      iframe.onload = () => {
        const doc = iframe.contentWindow?.document;
        if (!doc) { resolve(false); return; }

        doc.open();
        doc.write(`
          <html>
            <head>
              <title>R3A Booth Print</title>
              <style>
                @page { size: auto; margin: 0; }
                body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
                img { max-width: 100%; max-height: 100%; object-fit: contain; }
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

/* ============================================================
   REGISTER ALL PROVIDERS
   ============================================================ */
registerProvider(NETWORK_PROVIDER);
registerProvider(RAWBT_PROVIDER);
registerProvider(BROWSER_PRINT_PROVIDER);

/* ============================================================
   PUBLIC API
   ============================================================ */
export async function printResult(opts: PrintOptions): Promise<boolean> {
  let selectedProvider: PrintProvider | null = null;

  // Cari provider yang cocok dengan target printer
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

  console.log(`[Print] Menggunakan provider: ${selectedProvider.name} (Target: ${opts.printerName})`);

  // Lakukan perulangan cetak sesuai jumlah copies
  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    console.log(`[Print] Mencetak copy ke-${i + 1} dari ${copies}...`);
    const ok = await selectedProvider.print(opts);
    if (!ok) success = false;
    
    // Jeda antar copy
    if (i < copies - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  
  return success;
}
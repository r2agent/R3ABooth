/* ============================================================
   PRINT SERVICE — Modular Print Provider System
   
   Setiap platform punya provider sendiri:
   - Browser (window.print) — sekarang
   - Android APK (native) — nanti
   - Electron EXE (native) — nanti
   - QZ Tray (web silent) — opsional nanti
   
   Fungsi:
   - Auto-detect provider yang available
   - Fallback berlapis
   - Modular: tinggal registerProvider() untuk platform baru
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
  isAvailable: () => Promise<boolean>;
  print: (opts: PrintOptions) => Promise<boolean>;
};

/* ============================================================
   REGISTRY — kumpulan provider
   ============================================================ */
const providers: PrintProvider[] = [];
let activeProvider: PrintProvider | null = null;

export function registerProvider(p: PrintProvider): void {
  // Hindari duplikat
  if (providers.find((x) => x.name === p.name)) return;
  providers.push(p);
}

export function getRegisteredProviders(): string[] {
  return providers.map((p) => p.name);
}

export async function detectProvider(): Promise<PrintProvider | null> {
  // Prioritas: dari paling atas (yang didaftarkan terakhir)
  const sorted = [...providers].reverse();
  for (const p of sorted) {
    try {
      if (await p.isAvailable()) {
        activeProvider = p;
        console.log(`[Print] Provider aktif: ${p.name}`);
        return p;
      }
    } catch {
      // Skip provider yang error
    }
  }
  activeProvider = null;
  console.warn('[Print] Tidak ada provider yang available');
  return null;
}

/* ============================================================
   BROWSER PROVIDER — pakai window.print() (dialog OS)
   ============================================================ */
const PAPER_SIZES_MM: Record<string, { w: number; h: number }> = {
  '4 × 6 in': { w: 102, h: 152 },
  '2 × 6 in': { w: 51, h: 152 },
  '5 × 7 in': { w: 127, h: 178 },
  'A4': { w: 210, h: 297 },
  'Letter': { w: 216, h: 279 },
};

function getPaperSize(paperSize: string, layout: string): { w: number; h: number } {
  const base = PAPER_SIZES_MM[paperSize] || PAPER_SIZES_MM['4 × 6 in'];
  if (layout === 'LANDSCAPE') {
    return { w: base.h, h: base.w };
  }
  return base;
}

const BROWSER_PRINT_PROVIDER: PrintProvider = {
  name: 'browser',
  isAvailable: async () => {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  },
  print: async (opts: PrintOptions): Promise<boolean> => {
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

        const paper = getPaperSize(opts.paperSize, opts.layout);

        doc.open();
        doc.write(`
          <html>
            <head>
              <title>R3A Booth Print</title>
              <style>
                @page {
                  size: ${paper.w}mm ${paper.h}mm;
                  margin: 0;
                }
                body {
                  margin: 0;
                  padding: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: ${paper.w}mm;
                  height: ${paper.h}mm;
                  overflow: hidden;
                }
                img {
                  width: 100%;
                  height: 100%;
                  object-fit: contain;
                  display: block;
                }
              </style>
            </head>
            <body>
              <img src="${opts.dataUrl}" />
            </body>
          </html>
        `);
        doc.close();

        iframe.contentWindow?.focus();
        setTimeout(() => {
          try {
            iframe.contentWindow?.print();
          } catch { /* ignore */ }
          setTimeout(() => { iframe.remove(); resolve(true); }, 500);
        }, 300);
      };
      iframe.onerror = () => { iframe.remove(); resolve(false); };
      document.body.appendChild(iframe);
    });
  },
};

/* ============================================================
   REGISTER DEFAULT PROVIDER
   ============================================================ */
registerProvider(BROWSER_PRINT_PROVIDER);

/* ============================================================
   PUBLIC API
   ============================================================ */
export async function printResult(opts: PrintOptions): Promise<boolean> {
  // Detect provider kalau belum
  let provider = activeProvider;
  if (!provider) {
    provider = await detectProvider();
  }
  if (!provider) return false;

  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    const ok = await provider.print(opts);
    if (!ok) success = false;
    if (i < copies - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return success;
}

export function getActiveProviderName(): string | null {
  return activeProvider?.name ?? null;
}

export function setPrintProvider(provider: PrintProvider): void {
  // Keep backward compat — register manual
  registerProvider(provider);
  activeProvider = provider;
}

export function getAvailablePaperSizes(): string[] {
  return Object.keys(PAPER_SIZES_MM);
}
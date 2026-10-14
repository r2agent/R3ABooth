export type PrintOptions = {
  copies: number;
  paperSize: string;
  dataUrl: string;
  layout: string;         // 'POTRAIT' | 'LANDSCAPE'
  printerName?: string;
};

export type PrintProvider = {
  print: (opts: PrintOptions) => Promise<boolean>;
};

/* Ukuran kertas dalam mm */
const PAPER_SIZES_MM: Record<string, { w: number; h: number }> = {
  '4 × 6 in': { w: 102, h: 152 },
  '2 × 6 in': { w: 51, h: 152 },
  '5 × 7 in': { w: 127, h: 178 },
  'A4': { w: 210, h: 297 },
  'Letter': { w: 216, h: 279 },
};

function getPaperSize(paperSize: string, layout: string): { w: number; h: number } {
  const base = PAPER_SIZES_MM[paperSize] || PAPER_SIZES_MM['4 × 6 in'];
  // Kalau landscape, swap width/height
  if (layout === 'LANDSCAPE') {
    return { w: base.h, h: base.w };
  }
  return base;
}

const BROWSER_PRINT_PROVIDER: PrintProvider = {
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

let activeProvider: PrintProvider = BROWSER_PRINT_PROVIDER;

export function setPrintProvider(provider: PrintProvider): void {
  activeProvider = provider;
}

export async function printResult(opts: PrintOptions): Promise<boolean> {
  let success = true;
  const copies = Math.max(1, Math.min(5, opts.copies || 1));

  for (let i = 0; i < copies; i++) {
    const ok = await activeProvider.print(opts);
    if (!ok) success = false;
    // Jeda antar copy
    if (i < copies - 1) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return success;
}

export function getAvailablePaperSizes(): string[] {
  return Object.keys(PAPER_SIZES_MM);
}
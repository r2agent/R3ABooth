export type PrintOptions = {
  copies: number;
  paperSize: string;
  dataUrl: string;
  printerName?: string;
};

export type PrintProvider = {
  print: (opts: PrintOptions) => Promise<boolean>;
};

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
        doc.open();
        doc.write(`<html><head><title>R3A Booth Print</title><style>@page{margin:0}body{margin:0;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${opts.dataUrl}"/></body></html>`);
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
  for (let i = 0; i < opts.copies; i++) {
    const ok = await activeProvider.print(opts);
    if (!ok) success = false;
  }
  return success;
}

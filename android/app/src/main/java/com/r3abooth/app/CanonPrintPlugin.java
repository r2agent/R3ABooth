import { registerPlugin, Capacitor } from '@capacitor/core';

export interface CanonPrintPlugin {
  printPhoto(options: { imageBase64: string; paperSize?: string }): Promise<{ success: boolean }>;
}

const CanonPrint = registerPlugin<CanonPrintPlugin>('CanonPrint');

export async function printWithCanonSDK(dataUrl: string, paperSize: string = '4 × 6 in'): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      // === JALUR APK ANDROID (Universal Print OS) ===
      const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
      console.log(`[Print] Membuka dialog Print Android (Ukuran: ${paperSize})...`);
      
      const result = await CanonPrint.printPhoto({ imageBase64: base64Data, paperSize });
      return result.success;
      
    } else {
      // === JALUR WEB (VERCEL) ===
      console.log('[Print] Mode Web, membuka Print Dialog Browser...');
      return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        iframe.onload = () => {
          const doc = iframe.contentWindow?.document;
          if (!doc) { resolve(false); return; }
          doc.open();
          doc.write(`
            <html>
              <head><title>Print Photo</title>
              <style>@page { size: auto; margin: 0; } body { margin:0; padding:0; text-align:center; }</style>
            </head>
            <body><img src="${dataUrl}" /></body>
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
    }
  } catch (error) {
    console.error('[Canon] Gagal ngeprint:', error);
    return false;
  }
}
import { registerPlugin, Capacitor } from '@capacitor/core';

export interface CanonPrintPlugin {
  printPhoto(options: {
    imageBase64: string;
    paperSize?: string;
    orientation?: 'portrait' | 'landscape';
  }): Promise<{ success: boolean }>;
}

const CanonPrint = registerPlugin<CanonPrintPlugin>('CanonPrint');

function detectOrientation(dataUrl: string): Promise<'portrait' | 'landscape'> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > img.naturalHeight ? 'landscape' : 'portrait');
    img.onerror = () => resolve('portrait');
    img.src = dataUrl;
  });
}

function printViaBrowser(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      resolve(false);
      return;
    }

    doc.open();
    doc.write(`
      <html>
        <head>
          <title>Print Photo</title>
          <style>
            @page { size: auto; margin: 0; }
            body { margin: 0; text-align: center; }
            img { max-width: 100%; max-height: 100vh; }
          </style>
        </head>
        <body><img id="p" src="${dataUrl}" /></body>
      </html>`);
    doc.close();

    const img = doc.getElementById('p') as HTMLImageElement | null;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        iframe.remove();
        resolve(true);
      }, 1000);
    };

    if (!img) {
      iframe.remove();
      resolve(false);
    } else if (img.complete) {
      go();
    } else {
      img.onload = go;
      img.onerror = () => {
        iframe.remove();
        resolve(false);
      };
    }
  });
}

export async function printWithCanonSDK(
  dataUrl: string,
  paperSize: string = '4 × 6 in',
  orientation: 'portrait' | 'landscape' | 'auto' = 'auto'
): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const finalOrientation =
        orientation === 'auto' ? await detectOrientation(dataUrl) : orientation;
      const base64Data = dataUrl.replace(/^data:image\/[a-z+.-]+;base64,/, '');
      console.log(`[Print] Dialog Print Android (kertas: ${paperSize}, orientasi: ${finalOrientation})`);

      const result = await CanonPrint.printPhoto({
        imageBase64: base64Data,
        paperSize,
        orientation: finalOrientation,
      });
      return result.success;
    }

    console.log('[Print] Mode Web, membuka Print Dialog Browser...');
    return await printViaBrowser(dataUrl);
  } catch (error) {
    console.error('[Print] Gagal ngeprint:', error);
    return false;
  }
}
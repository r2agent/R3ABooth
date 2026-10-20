import { registerPlugin } from '@capacitor/core';

export interface CanonPrintPlugin {
  printPhoto(options: { imageBase64: string }): Promise<{ success: boolean }>;
}

const CanonPrint = registerPlugin<CanonPrintPlugin>('CanonPrint');

export async function printWithCanonSDK(dataUrl: string): Promise<boolean> {
  try {
    // Hapus header base64 (data:image/jpeg;base64,) karena Java cuma butuh datanya aja
    const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
    
    console.log('[Canon] Mengirim gambar ke Native SDK...');
    const result = await CanonPrint.printPhoto({ imageBase64: base64Data });
    
    return result.success;
  } catch (error) {
    console.error('[Canon] Gagal ngeprint:', error);
    return false;
  }
}
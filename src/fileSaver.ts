/* ============================================================
   FILE SAVER — support Web + Android APK
   Web: <a download>
   APK: Simpan langsung ke Galeri + Backup ke Documents
   ============================================================ */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Media } from '@capacitor-community/media';

const APK_FOLDER = 'R3ABooth';

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

export async function saveFileFromDataUrl(dataUrl: string, fileName: string): Promise<boolean> {
  // ================= APK (NATIVE) =================
  if (isNativePlatform()) {
    try {
      // 1. Simpan ke GALERI BAWAAN ANDROID (Hanya untuk gambar)
      if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        try {
          await Media.savePhoto({
            path: dataUrl,
            albumIdentifier: 'R3ABooth', // Membuat folder album otomatis di Galeri
          });
          console.log(`[FileSaver/APK] ✅ Masuk Galeri: ${fileName}`);
        } catch (mediaErr) {
          console.warn('[FileSaver/APK] Gagal masuk galeri, lanjut backup ke File Manager', mediaErr);
        }
      }

      // 2. Backup ke File Manager (Documents/R3ABooth) - Bisa untuk JPG & Video
      await Filesystem.writeFile({
        path: `${APK_FOLDER}/${fileName}`,
        data: dataUrlToBase64(dataUrl),
        directory: Directory.Documents,
        recursive: true,
      });
      console.log(`[FileSaver/APK] ✅ Backup tersimpan: Documents/${APK_FOLDER}/${fileName}`);
      
      return true;
    } catch (err) {
      console.error('[FileSaver/APK] ❌ Gagal total:', err);
      return false;
    }
  }

  // ================= WEB (BROWSER) =================
  try {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log(`[FileSaver/Web] ✅ Downloaded: ${fileName}`);
    return true;
  } catch (err) {
    console.error('[FileSaver/Web] ❌ Failed:', err);
    return false;
  }
}
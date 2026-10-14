/* ============================================================
   FILE SAVER — support Web + Android APK
   Web: <a download>
   APK: Capacitor Filesystem → Documents/R3ABooth/
   ============================================================ */

import { Filesystem, Directory } from '@capacitor/filesystem';

const APK_FOLDER = 'R3ABooth';

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

/**
 * Simpan file dari dataURL
 * - Web: download ke folder Downloads browser
 * - APK: simpan ke Documents/R3ABooth/ di Android
 */
export async function saveFileFromDataUrl(dataUrl: string, fileName: string): Promise<boolean> {
  // APK
  if (isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: `${APK_FOLDER}/${fileName}`,
        data: dataUrlToBase64(dataUrl),
        directory: Directory.Documents,
        recursive: true,
      });
      console.log(`[FileSaver/APK] ✅ Saved: Documents/${APK_FOLDER}/${fileName}`);
      return true;
    } catch (err) {
      console.error('[FileSaver/APK] ❌ Failed:', err);
      return false;
    }
  }

  // Web
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
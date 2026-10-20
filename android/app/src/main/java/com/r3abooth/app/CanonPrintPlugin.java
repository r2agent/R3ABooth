package com.r3abooth.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import androidx.print.PrintHelper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CanonPrint")
public class CanonPrintPlugin extends Plugin {

    @PluginMethod
    public void printPhoto(PluginCall call) {
        String imageBase64 = call.getString("imageBase64");
        String orientation = call.getString("orientation", "portrait"); // "portrait" | "landscape"

        if (imageBase64 == null || imageBase64.isEmpty()) {
            call.reject("Gambar kosong!");
            return;
        }

        // buang prefix data URL kalau ada
        int comma = imageBase64.indexOf(",");
        if (imageBase64.startsWith("data:") && comma != -1) {
            imageBase64 = imageBase64.substring(comma + 1);
        }

        final Bitmap bitmap;
        try {
            byte[] decoded = Base64.decode(imageBase64, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
        } catch (Exception | OutOfMemoryError e) {
            call.reject("Gagal decode gambar: " + e.getMessage());
            return;
        }

        if (bitmap == null) {
            call.reject("Gagal mengonversi gambar!");
            return;
        }

        if (getActivity() == null) {
            call.reject("Activity tidak tersedia");
            return;
        }

        final boolean landscape = "landscape".equalsIgnoreCase(orientation);

        getActivity().runOnUiThread(() -> {
            try {
                PrintHelper printHelper = new PrintHelper(getActivity());
                printHelper.setScaleMode(PrintHelper.SCALE_MODE_FIT);
                printHelper.setColorMode(PrintHelper.COLOR_MODE_COLOR);
                printHelper.setOrientation(
                    landscape ? PrintHelper.ORIENTATION_LANDSCAPE : PrintHelper.ORIENTATION_PORTRAIT
                );
                // memunculkan dialog Print bawaan Android
                printHelper.printBitmap("R3A Booth Photo", bitmap);

                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error print: " + e.getMessage());
            }
        });
    }
}
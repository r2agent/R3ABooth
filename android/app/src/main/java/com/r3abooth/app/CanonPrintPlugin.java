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

        if (imageBase64 == null) {
            call.reject("Gambar kosong!");
            return;
        }

        try {
            // 1. Ubah Base64 dari React menjadi Bitmap Java
            byte[] decodedString = Base64.decode(imageBase64, Base64.DEFAULT);
            Bitmap decodedByte = BitmapFactory.decodeByteArray(decodedString, 0, decodedString.length);

            if (decodedByte == null) {
                call.reject("Gagal mengonversi gambar!");
                return;
            }

            // 2. Panggil Dialog Print bawaan Android
            getActivity().runOnUiThread(() -> {
                PrintHelper printHelper = new PrintHelper(getActivity());
                printHelper.setScaleMode(PrintHelper.SCALE_MODE_FIT);
                // Ini akan memunculkan pop-up Print di layar tablet
                printHelper.printBitmap("R3A Booth Photo", decodedByte);
            });

            // Anggap sukses (karena dialog sedang terbuka)
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
            
        } catch (Exception e) {
            call.reject("Error: " + e.getMessage());
        }
    }
}
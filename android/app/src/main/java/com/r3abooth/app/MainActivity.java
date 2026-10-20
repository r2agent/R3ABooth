package com.r3abooth.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // WAJIB sebelum super.onCreate
        registerPlugin(CanonPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
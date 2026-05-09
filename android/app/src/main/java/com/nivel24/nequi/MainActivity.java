package com.nivel24.nequi;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();

        // 🔥 No cachea archivos HTML/JS/CSS — siempre carga desde assets
        // Los datos del usuario (localStorage) SÍ persisten normalmente
        WebSettings settings = webView.getSettings();
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // 🧹 Limpia caché de archivos del WebView (HTML, JS, CSS)
        // No afecta localStorage — los datos del usuario se conservan
        webView.clearCache(true);
        webView.clearHistory();
    }
}
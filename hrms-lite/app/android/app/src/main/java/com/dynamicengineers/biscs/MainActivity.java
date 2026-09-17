package com.dynamicengineers.biscs;

import android.Manifest;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.content.Intent;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * The whole app: the HRMS in a WebView, with the two things a WebView does not
 * do on its own — ask Android for the location permission, and then hand that
 * permission through to the page when it calls navigator.geolocation.
 *
 * Miss either half and the punch screen sits there saying it cannot find you,
 * which is why both are handled explicitly below.
 */
public class MainActivity extends AppCompatActivity {

    private static final int LOCATION_REQUEST = 4201;

    private WebView web;
    private SwipeRefreshLayout refresh;

    /** Held while the page waits for us to answer its geolocation request. */
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);

        refresh = findViewById(R.id.refresh);
        web = findViewById(R.id.web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // the app keeps its session here
        s.setGeolocationEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                // Our own site stays in the app; anything else opens in the browser.
                if (host.equals(Uri.parse(getString(R.string.site_url)).getHost())
                        || host.endsWith("script.google.com")
                        || host.endsWith("googleusercontent.com")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                refresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    refresh.setRefreshing(false);
                    Toast.makeText(MainActivity.this, R.string.offline, Toast.LENGTH_LONG).show();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            /**
             * The page asked for the location. If Android has already given it
             * to us, say yes straight away; otherwise ask the user first and
             * answer once they have decided.
             */
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback cb) {
                if (hasLocation()) {
                    cb.invoke(origin, true, false);
                    return;
                }
                pendingOrigin = origin;
                pendingCallback = cb;
                ActivityCompat.requestPermissions(MainActivity.this,
                        new String[]{ Manifest.permission.ACCESS_FINE_LOCATION,
                                      Manifest.permission.ACCESS_COARSE_LOCATION },
                        LOCATION_REQUEST);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.deny();          // the app needs no camera or microphone
            }
        });

        refresh.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override public void onRefresh() { web.reload(); }
        });

        // Back goes back through the app, and only leaves it at the first page.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        // Ask once at startup, so the first punch of the day is not the moment
        // somebody discovers a permission dialog.
        if (!hasLocation()) {
            ActivityCompat.requestPermissions(this,
                    new String[]{ Manifest.permission.ACCESS_FINE_LOCATION,
                                  Manifest.permission.ACCESS_COARSE_LOCATION },
                    LOCATION_REQUEST);
        }

        if (state == null) web.loadUrl(getString(R.string.site_url));
        else web.restoreState(state);
    }

    private boolean hasLocation() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, @NonNull String[] perms,
                                           @NonNull int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != LOCATION_REQUEST) return;

        boolean granted = hasLocation();

        // Answer the page if it is still waiting on us.
        if (pendingCallback != null) {
            pendingCallback.invoke(pendingOrigin, granted, false);
            pendingCallback = null;
            pendingOrigin = null;
        }

        if (!granted) {
            // Refused for good: the punch cannot work, so say so and offer the
            // one place it can be put right.
            boolean askAgain = ActivityCompat.shouldShowRequestPermissionRationale(
                    this, Manifest.permission.ACCESS_FINE_LOCATION);
            if (askAgain) {
                Toast.makeText(this, R.string.need_location, Toast.LENGTH_LONG).show();
            } else {
                new AlertDialog.Builder(this)
                    .setTitle(R.string.app_name)
                    .setMessage(R.string.need_location)
                    .setPositiveButton("Open settings", (d, w) -> {
                        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.fromParts("package", getPackageName(), null));
                        startActivity(i);
                    })
                    .setNegativeButton("Not now", null)
                    .show();
            }
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}

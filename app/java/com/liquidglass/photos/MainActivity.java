package com.liquidglass.photos;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends Activity {

    private static final String TAG = "LGP";
    private static final String HOST = "https://app.local/";
    private static final int REQ_PERM = 1001;
    private static final int REQ_DEL = 1002;
    private static final int REQ_PICK = 1003;

    private WebView web;
    private FrameLayout root;
    private SharedPreferences prefs;

    private final Map<Long, String> mimeCache = Collections.synchronizedMap(new HashMap<Long, String>());
    private final Map<Long, Long> sizeCache = Collections.synchronizedMap(new HashMap<Long, Long>());
    private final Map<Long, String> kindCache = Collections.synchronizedMap(new HashMap<Long, String>());

    // tiny in-memory thumbnail cache (bytes)
    private final LinkedHashMap<Long, byte[]> thumbCache = new LinkedHashMap<Long, byte[]>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Long, byte[]> eldest) {
            return size() > 220;
        }
    };

    private int insetTop = 0, insetBottom = 0, imeBottom = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("lgp", MODE_PRIVATE);

        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
            w.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0B0B1A);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0B1A);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);

        web.addJavascriptInterface(new Bridge(), "AndroidNative");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient());
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets ins) {
                int top, bottom, ime = 0;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = ins.getInsets(WindowInsets.Type.systemBars());
                    top = bars.top;
                    bottom = bars.bottom;
                    ime = ins.getInsets(WindowInsets.Type.ime()).bottom;
                } else {
                    top = ins.getSystemWindowInsetTop();
                    bottom = ins.getSystemWindowInsetBottom();
                }
                int newIme = Math.max(0, ime - bottom);
                boolean imeChanged = newIme != imeBottom;
                insetTop = top;
                insetBottom = bottom;
                imeBottom = newIme;
                web.setPadding(0, 0, 0, imeBottom);
                pushInsets();
                if (imeChanged) {
                    final String js = "window.__native&&window.__native.ime&&window.__native.ime(" + imeBottom + ")";
                    runOnUiThread(new Runnable() {
                        public void run() {
                            if (web != null) web.evaluateJavascript(js, null);
                        }
                    });
                }
                return ins;
            }
        });

        web.loadUrl(HOST + "index.html");
    }

    private void pushInsets() {
        final String js = "window.__native&&window.__native.insets&&window.__native.insets("
                + insetTop + "," + insetBottom + ")";
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    private void eval(final String js) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        // let the web app handle back (close viewer / leave album) first
        web.evaluateJavascript("(function(){return window.__native&&window.__native.back?window.__native.back():false})()",
                new android.webkit.ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        if (value == null || !value.contains("true")) {
                            finish();
                        }
                    }
                });
    }

    /* ------------------------------------------------------------------ */
    /* permissions                                                        */
    /* ------------------------------------------------------------------ */

    private String[] neededPerms() {
        if (Build.VERSION.SDK_INT >= 34) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO,
                    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"};
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES,
                    Manifest.permission.READ_MEDIA_VIDEO};
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private boolean granted(String p) {
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= 34) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES)
                    || granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
                    || granted(Manifest.permission.READ_MEDIA_VIDEO);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES)
                    || granted(Manifest.permission.READ_MEDIA_VIDEO);
        }
        return granted(Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERM) {
            boolean ok = hasAccess();
            eval("window.__native&&window.__native.onPermission&&window.__native.onPermission(" + ok + ")");
        }
    }

    /* ------------------------------------------------------------------ */
    /* media store                                                        */
    /* ------------------------------------------------------------------ */

    private static class Item {
        long id;
        boolean video;
        String name, bucket, mime;
        long date, size;
        int w, h;
    }

    private List<Item> queryMedia() {
        List<Item> out = new ArrayList<>();
        if (!hasAccess()) return out;
        queryOne(out, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, false);
        queryOne(out, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true);
        Collections.sort(out, new Comparator<Item>() {
            public int compare(Item a, Item b) {
                return Long.compare(b.date, a.date);
            }
        });
        return out;
    }

    private void queryOne(List<Item> out, Uri base, boolean video) {
        String[] proj = {
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.DATE_MODIFIED,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                "bucket_display_name"
        };
        Cursor c = null;
        try {
            c = getContentResolver().query(base, proj, null, null,
                    MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
            if (c == null) return;
            int iId = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int iDate = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
            int iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
            int iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
            int iW = c.getColumnIndex(MediaStore.MediaColumns.WIDTH);
            int iH = c.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
            int iB = c.getColumnIndex("bucket_display_name");
            while (c.moveToNext() && out.size() < 6000) {
                Item it = new Item();
                it.id = c.getLong(iId);
                it.video = video;
                it.name = iName >= 0 && !c.isNull(iName) ? c.getString(iName) : "IMG_" + it.id;
                it.date = (iDate >= 0 && !c.isNull(iDate) ? c.getLong(iDate) : 0L) * 1000L;
                it.size = iSize >= 0 && !c.isNull(iSize) ? c.getLong(iSize) : 0L;
                it.mime = iMime >= 0 && !c.isNull(iMime) ? c.getString(iMime)
                        : (video ? "video/mp4" : "image/jpeg");
                it.w = iW >= 0 && !c.isNull(iW) ? c.getInt(iW) : 0;
                it.h = iH >= 0 && !c.isNull(iH) ? c.getInt(iH) : 0;
                it.bucket = iB >= 0 && !c.isNull(iB) ? c.getString(iB) : "";
                out.add(it);
                mimeCache.put(it.id, it.mime);
                sizeCache.put(it.id, it.size);
                kindCache.put(it.id, video ? "v" : "i");
            }
        } catch (Exception e) {
            Log.w(TAG, "query failed", e);
        } finally {
            if (c != null) c.close();
        }
    }

    private String itemsJson(List<Item> list) {
        StringBuilder sb = new StringBuilder(64 + list.size() * 140);
        sb.append("{\"count\":").append(list.size()).append(",\"items\":[");
        for (int i = 0; i < list.size(); i++) {
            Item it = list.get(i);
            if (i > 0) sb.append(',');
            sb.append("{\"id\":").append(it.id)
                    .append(",\"v\":").append(it.video ? 1 : 0)
                    .append(",\"n\":").append(q(it.name))
                    .append(",\"b\":").append(q(it.bucket))
                    .append(",\"m\":").append(q(it.mime))
                    .append(",\"d\":").append(it.date)
                    .append(",\"s\":").append(it.size)
                    .append(",\"w\":").append(it.w)
                    .append(",\"h\":").append(it.h)
                    .append('}');
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String q(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder(s.length() + 8).append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) sb.append(String.format(Locale.US, "\\u%04x", (int) ch));
                    else sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }

    private Uri uriFor(long id, boolean video) {
        Uri base = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        return ContentUris.withAppendedId(base, id);
    }

    /* ------------------------------------------------------------------ */
    /* thumbnails                                                         */
    /* ------------------------------------------------------------------ */

    private byte[] thumbnail(long id, boolean video) {
        long key = video ? -id : id;
        synchronized (thumbCache) {
            byte[] hit = thumbCache.get(key);
            if (hit != null) return hit;
        }
        Bitmap bmp = null;
        try {
            Uri uri = uriFor(id, video);
            if (video) {
                MediaMetadataRetriever r = new MediaMetadataRetriever();
                try {
                    r.setDataSource(this, uri);
                    bmp = r.getFrameAtTime(1_000_000L,
                            MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    if (bmp == null) bmp = r.getFrameAtTime();
                } finally {
                    try { r.release(); } catch (Exception ignored) {}
                }
            } else {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                InputStream in1 = getContentResolver().openInputStream(uri);
                try { BitmapFactory.decodeStream(in1, null, bounds); } finally { close(in1); }
                int target = 420;
                int sample = 1;
                int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
                while (maxDim / (sample * 2) >= target) sample *= 2;
                BitmapFactory.Options o = new BitmapFactory.Options();
                o.inSampleSize = sample;
                o.inPreferredConfig = Bitmap.Config.RGB_565;
                InputStream in2 = getContentResolver().openInputStream(uri);
                try { bmp = BitmapFactory.decodeStream(in2, null, o); } finally { close(in2); }
            }
            if (bmp == null) return null;
            int max = 520;
            int wd = bmp.getWidth(), ht = bmp.getHeight();
            if (Math.max(wd, ht) > max) {
                float f = max / (float) Math.max(wd, ht);
                Bitmap sc = Bitmap.createScaledBitmap(bmp,
                        Math.max(1, (int) (wd * f)), Math.max(1, (int) (ht * f)), true);
                if (sc != bmp) bmp.recycle();
                bmp = sc;
            }
            ByteArrayOutputStream bo = new ByteArrayOutputStream(24 * 1024);
            bmp.compress(Bitmap.CompressFormat.JPEG, 82, bo);
            byte[] bytes = bo.toByteArray();
            synchronized (thumbCache) { thumbCache.put(key, bytes); }
            return bytes;
        } catch (Throwable t) {
            Log.w(TAG, "thumb fail " + id, t);
            return null;
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    private static void close(InputStream s) {
        try { if (s != null) s.close(); } catch (IOException ignored) {}
    }

    /* ------------------------------------------------------------------ */
    /* web client: serve assets + media from the device                   */
    /* ------------------------------------------------------------------ */

    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u == null || !"app.local".equals(u.getHost())) return null;
            String path = u.getPath() == null ? "/" : u.getPath();
            try {
                if (path.startsWith("/thumb/")) {
                    String rest = path.substring(7);
                    boolean video = rest.startsWith("v/");
                    long id = Long.parseLong(rest.substring(2));
                    byte[] bytes = thumbnail(id, video);
                    if (bytes == null) return notFound();
                    Map<String, String> h = new HashMap<>();
                    h.put("Content-Type", "image/jpeg");
                    h.put("Cache-Control", "public, max-age=86400");
                    h.put("Content-Length", String.valueOf(bytes.length));
                    return new WebResourceResponse("image/jpeg", null, 200, "OK", h,
                            new ByteArrayInputStream(bytes));
                }
                if (path.startsWith("/media/")) {
                    String rest = path.substring(7);
                    boolean video = rest.startsWith("v/");
                    long id = Long.parseLong(rest.substring(2));
                    return streamMedia(id, video, req);
                }
                return asset(path);
            } catch (Exception e) {
                Log.w(TAG, "intercept " + path, e);
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u != null && "app.local".equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {}
            return true;
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse asset(String path) throws IOException {
        String name = path.startsWith("/") ? path.substring(1) : path;
        if (name.isEmpty()) name = "index.html";
        int q = name.indexOf('?');
        if (q >= 0) name = name.substring(0, q);
        AssetManager am = getAssets();
        InputStream in;
        try {
            in = am.open(name);
        } catch (IOException e) {
            in = am.open("index.html");
            name = "index.html";
        }
        String mime = "text/plain";
        if (name.endsWith(".html")) mime = "text/html";
        else if (name.endsWith(".js")) mime = "application/javascript";
        else if (name.endsWith(".css")) mime = "text/css";
        else if (name.endsWith(".svg")) mime = "image/svg+xml";
        else if (name.endsWith(".png")) mime = "image/png";
        else if (name.endsWith(".json")) mime = "application/json";
        Map<String, String> h = new HashMap<>();
        h.put("Content-Type", mime + "; charset=utf-8");
        h.put("Cache-Control", "no-cache");
        return new WebResourceResponse(mime, "utf-8", 200, "OK", h, in);
    }

    private WebResourceResponse streamMedia(long id, boolean video, WebResourceRequest req) {
        try {
            Uri uri = uriFor(id, video);
            String mime = mimeCache.get(id);
            if (mime == null) mime = video ? "video/mp4" : "image/jpeg";

            AssetFileDescriptor afd = getContentResolver().openAssetFileDescriptor(uri, "r");
            if (afd == null) return notFound();
            long start = afd.getStartOffset();
            long len = afd.getLength();
            if (len < 0) {
                Long s = sizeCache.get(id);
                len = s != null ? s : -1;
            }
            ParcelFileDescriptor pfd = afd.getParcelFileDescriptor();
            final AssetFileDescriptor afdRef = afd;
            FileInputStream fis = new FileInputStream(pfd.getFileDescriptor()) {
                @Override
                public void close() throws IOException {
                    try {
                        super.close();
                    } finally {
                        try { afdRef.close(); } catch (IOException ignored) {}
                    }
                }
            };
            FileChannel ch = fis.getChannel();

            String range = null;
            if (req != null && req.getRequestHeaders() != null) {
                range = req.getRequestHeaders().get("Range");
            }

            Map<String, String> h = new HashMap<>();
            h.put("Accept-Ranges", "bytes");
            h.put("Content-Type", mime);
            h.put("Cache-Control", "public, max-age=3600");

            if (range != null && range.startsWith("bytes=") && len > 0) {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                long from, to;
                if (dash == 0) {
                    long suffix = Long.parseLong(spec.substring(1));
                    from = Math.max(0, len - suffix);
                    to = len - 1;
                } else {
                    from = Long.parseLong(spec.substring(0, dash));
                    String endPart = spec.substring(dash + 1);
                    to = endPart.isEmpty() ? len - 1 : Long.parseLong(endPart);
                }
                if (to >= len) to = len - 1;
                if (from > to) from = 0;
                long count = to - from + 1;
                ch.position(start + from);
                h.put("Content-Range", "bytes " + from + "-" + to + "/" + len);
                h.put("Content-Length", String.valueOf(count));
                return new WebResourceResponse(mime, null, 206, "Partial Content", h,
                        new LimitedStream(fis, count));
            }

            if (len > 0) {
                ch.position(start);
                h.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mime, null, 200, "OK", h,
                        new LimitedStream(fis, len));
            }
            ch.position(start);
            return new WebResourceResponse(mime, null, 200, "OK", h, fis);
        } catch (Exception e) {
            Log.w(TAG, "media " + id, e);
            return notFound();
        }
    }

    private static class LimitedStream extends InputStream {
        private final InputStream in;
        private long left;

        LimitedStream(InputStream in, long limit) {
            this.in = in;
            this.left = limit;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }

    /* ------------------------------------------------------------------ */
    /* JS bridge                                                          */
    /* ------------------------------------------------------------------ */

    public class Bridge {

        @JavascriptInterface
        public String meta() {
            JSONObject o = new JSONObject();
            try {
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("android", Build.VERSION.RELEASE);
                o.put("access", hasAccess());
                o.put("insetTop", insetTop);
                o.put("insetBottom", insetBottom);
                o.put("light", prefs.getBoolean("light", false));
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public boolean access() {
            return hasAccess();
        }

        @JavascriptInterface
        public void requestAccess() {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (Build.VERSION.SDK_INT >= 23) {
                        requestPermissions(neededPerms(), REQ_PERM);
                    }
                }
            });
        }

        @JavascriptInterface
        public String photos() {
            return itemsJson(queryMedia());
        }

        @JavascriptInterface
        public String favs() {
            JSONArray a = new JSONArray();
            for (String s : prefs.getStringSet("fav", new HashSet<String>())) {
                try { a.put(Long.parseLong(s)); } catch (Exception ignored) {}
            }
            return a.toString();
        }

        @JavascriptInterface
        public void setFav(String idsJson, boolean on) {
            Set<String> cur = new HashSet<>(prefs.getStringSet("fav", new HashSet<String>()));
            try {
                JSONArray a = new JSONArray(idsJson);
                for (int i = 0; i < a.length(); i++) {
                    String id = String.valueOf(a.getLong(i));
                    if (on) cur.add(id); else cur.remove(id);
                }
            } catch (Exception ignored) {}
            prefs.edit().putStringSet("fav", cur).apply();
        }

        @JavascriptInterface
        public void share(String idsJson) {
            try {
                JSONArray a = new JSONArray(idsJson);
                ArrayList<Uri> uris = new ArrayList<>();
                for (int i = 0; i < a.length(); i++) {
                    long id = a.getLong(i);
                    String k = kindCache.get(id);
                    uris.add(uriFor(id, "v".equals(k)));
                }
                if (uris.isEmpty()) return;
                Intent i;
                if (uris.size() == 1) {
                    i = new Intent(Intent.ACTION_SEND);
                    i.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                    i.setType(mimeCache.containsKey(a.getLong(0))
                            ? mimeCache.get(a.getLong(0)) : "*/*");
                } else {
                    i = new Intent(Intent.ACTION_SEND_MULTIPLE);
                    i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                    i.setType("*/*");
                }
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "Share"));
            } catch (Exception e) {
                Log.w(TAG, "share", e);
            }
        }

        @JavascriptInterface
        public void delete(String idsJson) {
            try {
                JSONArray a = new JSONArray(idsJson);
                ArrayList<Uri> uris = new ArrayList<>();
                for (int i = 0; i < a.length(); i++) {
                    long id = a.getLong(i);
                    uris.add(uriFor(id, "v".equals(kindCache.get(id))));
                }
                if (uris.isEmpty()) return;
                if (Build.VERSION.SDK_INT >= 30) {
                    PendingIntent pi = MediaStore.createDeleteRequest(getContentResolver(), uris);
                    startIntentSenderForResult(pi.getIntentSender(), REQ_DEL, null, 0, 0, 0);
                } else {
                    int n = 0;
                    for (Uri u : uris) {
                        try {
                            n += getContentResolver().delete(u, null, null);
                        } catch (Exception ignored) {}
                    }
                    eval("window.__native&&window.__native.onDeleted&&window.__native.onDeleted(" + n + ")");
                }
            } catch (Exception e) {
                Log.w(TAG, "delete", e);
                eval("window.__native&&window.__native.onDeleted&&window.__native.onDeleted(0)");
            }
        }

        @JavascriptInterface
        public void playVideo(long id) {
            final long vid = id;
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                        i.setData(uriFor(vid, true));
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(i);
                    } catch (Exception e) {
                        Log.w(TAG, "playVideo", e);
                    }
                }
            });
        }

        @JavascriptInterface
        public void pick() {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivityForResult(i, REQ_PICK);
                    } catch (Exception e) {
                        Log.w(TAG, "pick", e);
                    }
                }
            });
        }

        @JavascriptInterface
        public void theme(boolean light) {
            prefs.edit().putBoolean("light", light).apply();
            final boolean l = light;
            runOnUiThread(new Runnable() {
                public void run() {
                    int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
                    if (Build.VERSION.SDK_INT >= 30) {
                        getWindow().getDecorView().setSystemUiVisibility(flags);
                        android.view.WindowInsetsController c = getWindow().getInsetsController();
                        if (c != null) {
                            c.setSystemBarsAppearance(
                                    l ? android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                        }
                    } else {
                        int f = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
                        if (l) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                        getWindow().getDecorView().setSystemUiVisibility(f);
                    }
                }
            });
        }

        @JavascriptInterface
        public void info(String msg) {
            Log.i(TAG, msg == null ? "" : msg);
        }
    }

    /* ------------------------------------------------------------------ */
    /* activity results                                                   */
    /* ------------------------------------------------------------------ */

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_DEL) {
            int n = res == RESULT_OK ? -1 : 0;
            eval("window.__native&&window.__native.onDeleted&&window.__native.onDeleted(" + n + ")");
            return;
        }
        if (req == REQ_PICK) {
            if (res != RESULT_OK || data == null) {
                eval("window.__native&&window.__native.onPicked&&window.__native.onPicked(0)");
                return;
            }
            final ArrayList<Uri> src = new ArrayList<>();
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                for (int i = 0; i < n; i++) src.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) {
                src.add(data.getData());
            }
            new Thread(new Runnable() {
                public void run() {
                    int ok = 0;
                    for (Uri u : src) {
                        try {
                            if (importUri(u)) ok++;
                        } catch (Exception e) {
                            Log.w(TAG, "import failed", e);
                        }
                    }
                    eval("window.__native&&window.__native.onPicked&&window.__native.onPicked(" + ok + ")");
                }
            }).start();
        }
    }

    private boolean importUri(Uri src) throws IOException {
        ContentResolver cr = getContentResolver();
        String type = cr.getType(src);
        if (type == null) type = "image/jpeg";
        boolean video = type.startsWith("video");
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US)
                .format(new java.util.Date());
        String name = "LGP_" + stamp + (video ? ".mp4" : ".jpg");

        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
        if (Build.VERSION.SDK_INT >= 29) {
            v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    video ? "Movies/LiquidGlass" : "Pictures/LiquidGlass");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        }
        Uri coll = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        Uri dst = cr.insert(coll, v);
        if (dst == null) return false;
        InputStream in = cr.openInputStream(src);
        java.io.OutputStream out = cr.openOutputStream(dst);
        try {
            if (in == null || out == null) return false;
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        } finally {
            close(in);
            try { if (out != null) out.close(); } catch (IOException ignored) {}
        }
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(dst, done, null, null);
        }
        return true;
    }

    private long lastResumeRefresh = 0L;

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            long now = System.currentTimeMillis();
            if (hasAccess() && now - lastResumeRefresh > 2500L) {
                lastResumeRefresh = now;
                eval("window.__native&&window.__native.onResume&&window.__native.onResume()");
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}

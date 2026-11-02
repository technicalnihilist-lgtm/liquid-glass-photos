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
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Size;
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

    // in-memory thumbnail cache, bounded by bytes rather than entry count
    private static final long THUMB_CACHE_BYTES = 12L * 1024 * 1024;
    // longest side of a thumbnail, and the size the BitmapFactory sample loop aims above
    private static final int THUMB_MAX_PX = 520;
    private static final int THUMB_SAMPLE_TARGET_PX = 420;
    private final LinkedHashMap<Long, byte[]> thumbCache =
            new LinkedHashMap<Long, byte[]>(64, 0.75f, true);
    private long thumbCacheBytes = 0L;

    // id -> {width, height} straight from MediaStore, so a thumbnail needs one stream open
    private final Map<Long, int[]> dimCache = Collections.synchronizedMap(new HashMap<Long, int[]>());

    private void cacheThumb(long key, byte[] bytes) {
        synchronized (thumbCache) {
            byte[] old = thumbCache.put(key, bytes);
            if (old != null) thumbCacheBytes -= old.length;
            thumbCacheBytes += bytes.length;
            java.util.Iterator<Map.Entry<Long, byte[]>> it = thumbCache.entrySet().iterator();
            while (thumbCacheBytes > THUMB_CACHE_BYTES && it.hasNext()) {
                Map.Entry<Long, byte[]> e = it.next();
                thumbCacheBytes -= e.getValue().length;
                it.remove();
            }
        }
    }

    private int insetTop = 0, insetBottom = 0, imeBottom = 0;

    // ---- depth / 4D tilt ----
    private SensorManager sensors;
    private Sensor accel;
    private boolean tiltOn = true;
    private long lastTiltPush = 0L;
    private float baseX = Float.NaN, baseY = Float.NaN;

    private final SensorEventListener tiltListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            long now = System.currentTimeMillis();
            if (now - lastTiltPush < 33) return;
            lastTiltPush = now;
            float ax = e.values[0];
            float ay = e.values[1];
            // calibrate against how the phone is being held when depth is switched on
            if (Float.isNaN(baseX)) {
                baseX = ax;
                baseY = ay;
            }
            float x = -(ax - baseX) / 4.2f;
            float y = (ay - baseY) / 4.2f;
            if (x > 1f) x = 1f;
            if (x < -1f) x = -1f;
            if (y > 1f) y = 1f;
            if (y < -1f) y = -1f;
            final String js = String.format(Locale.US,
                    "window.__native&&window.__native.tilt&&window.__native.tilt(%.3f,%.3f)", x, y);
            eval(js);
        }

        @Override
        public void onAccuracyChanged(Sensor s, int a) {
        }
    };

    private void startTilt() {
        if (sensors == null) {
            sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
            if (sensors != null) accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        }
        if (sensors != null && accel != null && tiltOn) {
            baseX = Float.NaN;
            baseY = Float.NaN;
            sensors.registerListener(tiltListener, accel, SensorManager.SENSOR_DELAY_GAME);
        }
    }

    private void stopTilt() {
        if (sensors != null) {
            try {
                sensors.unregisterListener(tiltListener);
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("lgp", MODE_PRIVATE);
        tiltOn = prefs.getBoolean("tilt", true);

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
                    "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"};
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES};
        }
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private boolean granted(String p) {
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAccess() {
        if (Build.VERSION.SDK_INT >= 34) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES)
                    || granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
        }
        if (Build.VERSION.SDK_INT >= 33) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES);
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
        String name, bucket, mime;
        long date, size;
        int w, h;
    }

    private List<Item> cachedMedia = null;
    private long cachedMediaAt = 0L;
    private static final long MEDIA_CACHE_MS = 1500L;

    /** MediaStore is expensive; a resume right after a permission callback must not query twice. */
    private List<Item> queryMediaCached() {
        long now = System.currentTimeMillis();
        if (cachedMedia != null && now - cachedMediaAt < MEDIA_CACHE_MS) return cachedMedia;
        List<Item> list = queryMedia();
        cachedMedia = list;
        cachedMediaAt = now;
        return list;
    }

    private void invalidateMediaCache() {
        cachedMedia = null;
        cachedMediaAt = 0L;
    }

    private List<Item> queryMedia() {
        List<Item> out = new ArrayList<>();
        if (!hasAccess()) return out;
        queryOne(out, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        Collections.sort(out, new Comparator<Item>() {
            public int compare(Item a, Item b) {
                return Long.compare(b.date, a.date);
            }
        });
        return out;
    }

    private void queryOne(List<Item> out, Uri base) {
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
                it.name = iName >= 0 && !c.isNull(iName) ? c.getString(iName) : "IMG_" + it.id;
                it.date = (iDate >= 0 && !c.isNull(iDate) ? c.getLong(iDate) : 0L) * 1000L;
                it.size = iSize >= 0 && !c.isNull(iSize) ? c.getLong(iSize) : 0L;
                it.mime = iMime >= 0 && !c.isNull(iMime) ? c.getString(iMime) : "image/jpeg";
                it.w = iW >= 0 && !c.isNull(iW) ? c.getInt(iW) : 0;
                it.h = iH >= 0 && !c.isNull(iH) ? c.getInt(iH) : 0;
                it.bucket = iB >= 0 && !c.isNull(iB) ? c.getString(iB) : "";
                out.add(it);
                mimeCache.put(it.id, it.mime);
                sizeCache.put(it.id, it.size);
                if (it.w > 0 && it.h > 0) dimCache.put(it.id, new int[]{it.w, it.h});
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
                    .append(",\"v\":0")
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

    private Uri uriFor(long id) {
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
    }

    /* ------------------------------------------------------------------ */
    /* thumbnails                                                         */
    /* ------------------------------------------------------------------ */

    private byte[] thumbnail(long id) {
        long key = id;
        synchronized (thumbCache) {
            byte[] hit = thumbCache.get(key);
            if (hit != null) return hit;
        }
        Bitmap bmp = null;
        try {
            Uri uri = uriFor(id);
            int max = THUMB_MAX_PX;
            int[] dims = dimCache.get(id);
            int maxDim = dims != null ? Math.max(dims[0], dims[1]) : 0;
            bmp = decodeThumb(uri, maxDim, max);
            if (bmp == null) return null;
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
            cacheThumb(key, bytes);
            return bytes;
        } catch (Throwable t) {
            Log.w(TAG, "thumb fail " + id, t);
            return null;
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    /* Decode one thumbnail, no larger than `max` px on its longest side. ImageDecoder is the
       primary path on API 28+: it applies the EXIF rotation (so the grid matches the viewer)
       and does the downscale inside the decode. Anything it cannot read, and every device below
       API 28, falls back to the BitmapFactory path. */
    private Bitmap decodeThumb(Uri uri, int maxDim, int max) throws Exception {
        if (Build.VERSION.SDK_INT >= 28) {
            Bitmap b = decodeThumbImageDecoder(uri, max);
            if (b != null) return b;
        }
        return decodeThumbFactory(uri, maxDim, max);
    }

    private Bitmap decodeThumbImageDecoder(Uri uri, final int max) {
        try {
            ImageDecoder.Source src = ImageDecoder.createSource(getContentResolver(), uri);
            return ImageDecoder.decodeBitmap(src, new ImageDecoder.OnHeaderDecodedListener() {
                @Override
                public void onHeaderDecoded(ImageDecoder decoder, ImageDecoder.ImageInfo info,
                                           ImageDecoder.Source source) {
                    /* Software + low-RAM: a mutable RGB_565 bitmap, which is what compress() needs
                       and the same config the BitmapFactory path asks for. */
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                    decoder.setMemorySizePolicy(ImageDecoder.MEMORY_POLICY_LOW_RAM);
                    Size sz = info.getSize();
                    int longest = Math.max(sz.getWidth(), sz.getHeight());
                    if (longest > max) {
                        float f = max / (float) longest;
                        decoder.setTargetSize(Math.max(1, Math.round(sz.getWidth() * f)),
                                Math.max(1, Math.round(sz.getHeight() * f)));
                    }
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "ImageDecoder thumb fail " + uri, e);
            return null;
        }
    }

    private Bitmap decodeThumbFactory(Uri uri, int maxDim, int max) throws Exception {
        int sample = 1;
        if (maxDim <= 0) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            /* Nothing may survive the bounds pass: no reuse target coming in, and no
               pixel buffer left behind afterwards. */
            bounds.inBitmap = null;
            InputStream in1 = getContentResolver().openInputStream(uri);
            try {
                Bitmap probe = BitmapFactory.decodeStream(in1, null, bounds);
                maxDim = Math.max(bounds.outWidth, bounds.outHeight);
                /* Bounds mode should not allocate, but a few platform decoders still
                   hand back a bitmap (a 1x1 placeholder or a thumb-sized frame). Drop it
                   the moment the dimensions are read so it is not alive while the real
                   decode below allocates its own buffer. */
                if (probe != null && !probe.isRecycled()) probe.recycle();
            } finally { close(in1); }
        }
        while (maxDim > 0 && maxDim / (sample * 2) >= THUMB_SAMPLE_TARGET_PX) sample *= 2;
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        o.inPreferredConfig = Bitmap.Config.RGB_565;
        /* Ask the decoder to land on the final size itself: with inDensity set to the
           post-sample width and inTargetDensity to the cap, the scale happens inside
           the decode and the full-size bitmap is never materialised. */
        int decodedMax = maxDim > 0 ? Math.max(1, maxDim / sample) : 0;
        if (decodedMax > max) {
            o.inScaled = true;
            o.inDensity = decodedMax;
            o.inTargetDensity = max;
        }
        InputStream in2 = getContentResolver().openInputStream(uri);
        try { return BitmapFactory.decodeStream(in2, null, o); } finally { close(in2); }
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
                    long id = Long.parseLong(rest);
                    byte[] bytes = thumbnail(id);
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
                    long id = Long.parseLong(rest);
                    return streamMedia(id, req);
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

    private WebResourceResponse streamMedia(long id, WebResourceRequest req) {
        try {
            Uri uri = uriFor(id);
            String mime = mimeCache.get(id);
            if (mime == null) mime = "image/jpeg";

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
            return itemsJson(queryMediaCached());
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
                    uris.add(uriFor(a.getLong(i)));
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
                    uris.add(uriFor(a.getLong(i)));
                }
                if (uris.isEmpty()) return;
                invalidateMediaCache();
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
        public void setTilt(boolean on) {
            tiltOn = on;
            prefs.edit().putBoolean("tilt", on).apply();
            runOnUiThread(new Runnable() {
                public void run() {
                    if (tiltOn) startTilt();
                    else stopTilt();
                }
            });
        }

        @JavascriptInterface
        public void pick() {
            runOnUiThread(new Runnable() {
                public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("image/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*"});
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
                    invalidateMediaCache();
                    eval("window.__native&&window.__native.onPicked&&window.__native.onPicked(" + ok + ")");
                }
            }).start();
        }
    }

    private boolean importUri(Uri src) throws IOException {
        ContentResolver cr = getContentResolver();
        String type = cr.getType(src);
        if (type == null || !type.startsWith("image/")) type = "image/jpeg";
        String stamp = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US)
                .format(new java.util.Date());
        String name = "LGP_" + stamp + ".jpg";

        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, type);
        if (Build.VERSION.SDK_INT >= 29) {
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/LiquidGlass");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        }
        Uri dst = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
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
        startTilt();
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
        stopTilt();
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

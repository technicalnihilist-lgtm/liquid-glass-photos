package com.liquidglass.photos;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ComponentCallbacks2;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Log;
import android.util.Size;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.Arrays;
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
    /* One shared empty string. A row whose BUCKET_DISPLAY_NAME is null points at this constant
       instead of a fresh literal, so a library of rows with no album allocates nothing. */
    private static final String EMPTY = "";
    private static final int REQ_PERM = 1001;
    private static final int REQ_DEL = 1002;
    private static final int REQ_PICK = 1003;
    /* The colour the surface is painted before the page has drawn anything, once per theme. The
       window background, the root FrameLayout and the WebView all take it, so a frame shown
       before the HTML paints — a cold start, a reload, or a surface handed back on resume — is
       the page's own background instead of the other theme's. Must match body / body.light in
       app/assets/index.html. */
    private static final int BG_DARK = 0xFF0B0B1A;
    private static final int BG_LIGHT = 0xFFE9ECFF;

    private WebView web;
    private FrameLayout root;
    private SharedPreferences prefs;
    /* Set in onDestroy before the WebView is destroyed. Every call into the page is asynchronous —
       a Runnable on the UI queue, an insets callback, a back-press — so one can run after the
       activity has torn its view down, and evaluateJavascript() on a destroyed WebView throws
       inside the framework. The flag makes that window visible to evalOn(); the field itself is
       cleared once the destroy returns, so the null check answers on its own from then on. */
    private boolean webGone;

    private final Map<Long, String> mimeCache = Collections.synchronizedMap(new HashMap<Long, String>());
    private final Map<Long, Long> sizeCache = Collections.synchronizedMap(new HashMap<Long, Long>());
    /* Ceiling for the two metadata maps above, at twice the 6000-row media ceiling: they are keyed
       by media id, so a library that only ever grows would otherwise grow them forever. */
    private static final int MEDIA_META_CACHE_MAX = 2 * 6000;

    /* The one name the page knows the bridge by. It is injected in createWeb() and dropped in
       both teardown paths from this same constant, so the removal can never name an interface
       other than the one that was injected. */
    private static final String BRIDGE_NAME = "AndroidNative";

    /* Fixed response headers, built once instead of per request. A WebView reads the header map
       off the UI thread while the response is being consumed, so a map may only be shared when
       nothing can write to it afterwards: every map below is unmodifiable and holds only values
       that never vary for its response shape. The responses whose headers depend on the request
       (a thumb's Content-Length, a media range's Content-Range) still build their own map. */
    private static final Map<String, String> NOT_FOUND_HEADERS =
            fixedHeaders("Cache-Control", "no-store", "Content-Length", "0");
    /* The 204 that answers a favicon request: no body, no content type, and the same pair of
       headers every time, so it shares one unmodifiable map like the shapes above. */
    private static final Map<String, String> NO_CONTENT_HEADERS =
            fixedHeaders("Cache-Control", "no-store", "Content-Length", "0");
    /* asset() can only answer with one of these mimes, so each gets its map at class load and
       every asset response shares it — index.html on launch, and the 404 fallback that serves it
       for an unknown path, stop allocating a HashMap per request. */
    private static final Map<String, Map<String, String>> ASSET_HEADERS = assetHeaders();
    /* Media responses share one base map per mime for the two headers that never vary; the length
       and range variants copy it before adding their own value. */
    private static final Map<String, Map<String, String>> MEDIA_HEADERS =
            Collections.synchronizedMap(new HashMap<String, Map<String, String>>());

    // in-memory thumbnail cache, bounded by bytes rather than entry count
    private static final long THUMB_CACHE_BYTES = 12L * 1024 * 1024;
    // longest side of a thumbnail, and the size the BitmapFactory sample loop aims above
    private static final int THUMB_MAX_PX = 520;
    private static final int THUMB_SAMPLE_TARGET_PX = 420;
    /* Longest side below which a decode is not a photo at all. Corrupt or half-written media used
       to come back as a degenerate frame that got scaled up into a 1x1 JPEG and cached, so the
       tile painted as a flat grey square and stayed wrong on every later run. Those are skipped
       (404) instead, so the tile simply stays empty. */
    private static final int THUMB_MIN_PX = 48;
    private final LinkedHashMap<Long, byte[]> thumbCache =
            new LinkedHashMap<Long, byte[]>(64, 0.75f, true);
    private long thumbCacheBytes = 0L;
    /* 61. A byte budget nobody measures is a budget nobody holds. Both thumbnail caches keep the
       peak they have reached (the high-water mark) next to their current size, and log it as it
       climbs — once per MiB in memory, once per trim on disk — so the number that matters when a
       device starts to struggle (how close the app really came to the ceiling) is in logcat
       instead of being guessed at. Nothing is logged per thumbnail and nothing is logged twice
       for the same level. */
    private long thumbCacheHighBytes = 0L;
    private long thumbCacheHighLogged = 0L;
    private long thumbDiskHighBytes = 0L;
    private static final long HIGH_WATER_LOG_STEP = 1024L * 1024;

    // id -> {width, height} straight from MediaStore, so a thumbnail needs one stream open
    private final Map<Long, int[]> dimCache = Collections.synchronizedMap(new HashMap<Long, int[]>());
    /* Media ids already known to be HEIC/HEIF that this device cannot decode. Bounded, because it
       only ever holds the HEIF rows of the current library. */
    private final Set<Long> heifUnsupported = Collections.synchronizedSet(new HashSet<Long>());
    private static final int HEIF_UNSUPPORTED_MAX = 512;
    // id -> DATE_MODIFIED, so an edited photo does not keep serving its old thumbnail from disk
    private final Map<Long, Long> dateCache = Collections.synchronizedMap(new HashMap<Long, Long>());

    /* The decoded thumbnail is already a small JPEG in memory, so it is cheap to keep on disk as
       well: a byte-bounded LRU directory in getCacheDir() that a fresh process can read back
       without opening MediaStore or waking the decoder. That is what stops a cold start from
       painting an empty grid while the first few hundred thumbs are decoded. */
    private static final long THUMB_DISK_BYTES = 12L * 1024 * 1024;
    private static final int THUMB_DISK_TRIM_EVERY = 64;
    private static final long THUMB_DISK_TOUCH_MS = 60L * 1000;
    private File thumbDir;
    private int thumbDiskWrites = 0;

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
            /* Measured after the eviction pass, so the number logged is what the cache is really
               holding and never a transient burst above the cap. */
            if (thumbCacheBytes > thumbCacheHighBytes) {
                thumbCacheHighBytes = thumbCacheBytes;
                if (thumbCacheHighBytes - thumbCacheHighLogged >= HIGH_WATER_LOG_STEP) {
                    thumbCacheHighLogged = thumbCacheHighBytes;
                    Log.i(TAG, "thumb cache high-water " + (thumbCacheHighBytes / 1024L) + " KB of "
                            + (THUMB_CACHE_BYTES / 1024L) + " KB");
                }
            }
        }
    }

    private File thumbDir() {
        if (thumbDir == null) {
            File d = new File(getCacheDir(), "thumbs");
            if (!d.isDirectory() && !d.mkdirs()) return null;
            thumbDir = d;
        }
        return thumbDir;
    }

    private String thumbDiskName(long id) {
        Long stamp = dateCache.get(id);
        return id + "-" + (stamp != null ? stamp : 0L) + ".jpg";
    }

    /** Read a previously decoded thumbnail, or null when the cache is cold for this photo. */
    private byte[] readThumbDisk(long id) {
        File d = thumbDir();
        if (d == null) return null;
        File f = new File(d, thumbDiskName(id));
        long len = f.length();
        if (len <= 0 || len > 4L * 1024 * 1024) return null;
        try {
            byte[] b = new byte[(int) len];
            FileInputStream in = new FileInputStream(f);
            try {
                int off = 0;
                while (off < b.length) {
                    int n = in.read(b, off, b.length - off);
                    if (n < 0) break;
                    off += n;
                }
                if (off != b.length) return null;
            } finally { close(in); }
            /* A read is a use: refresh the timestamp, but not on every hit (that would be a
               metadata write per thumbnail). */
            long now = System.currentTimeMillis();
            if (now - f.lastModified() > THUMB_DISK_TOUCH_MS) f.setLastModified(now);
            return b;
        } catch (Throwable t) {
            return null;
        }
    }

    private void writeThumbDisk(long id, byte[] bytes) {
        File d = thumbDir();
        if (d == null || bytes == null || bytes.length == 0) return;
        File tmp = null;
        try {
            /* Write to a temp name and rename, so a process that dies mid-write cannot leave a
               truncated JPEG that the next cold start would hand to the grid. */
            tmp = File.createTempFile("t", ".tmp", d);
            FileOutputStream out = new FileOutputStream(tmp);
            try { out.write(bytes); } finally { close(out); }
            File dst = new File(d, thumbDiskName(id));
            if (!tmp.renameTo(dst)) { dst.delete(); tmp.renameTo(dst); }
            tmp = null;
            if (++thumbDiskWrites % THUMB_DISK_TRIM_EVERY == 0) trimThumbDisk(d);
        } catch (Throwable t) {
            Log.w(TAG, "thumb disk write " + id, t);
        } finally {
            if (tmp != null) tmp.delete();
        }
    }

    /** Drop least-recently-used entries once the directory passes its byte budget. */
    private void trimThumbDisk(File d) {
        File[] files = d.listFiles();
        if (files == null) return;
        long total = 0L;
        for (File f : files) total += f.length();
        /* The directory is only measured here, so this is also the one place the disk side can
           report its high-water mark. Logged on a new peak only, so a steady cache is silent. */
        if (total > thumbDiskHighBytes) {
            thumbDiskHighBytes = total;
            Log.i(TAG, "thumb disk high-water " + (total / 1024L) + " KB of "
                    + (THUMB_DISK_BYTES / 1024L) + " KB");
        }
        if (total <= THUMB_DISK_BYTES) return;
        Arrays.sort(files, new Comparator<File>() {
            public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        for (File f : files) {
            if (total <= THUMB_DISK_BYTES) break;
            long len = f.length();
            if (f.delete()) total -= len;
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

    /* Paint every layer the user can see before the page draws in the colour the page itself
       will use. Called before setContentView on launch and again whenever the theme changes, so
       the pre-paint frame never belongs to the other theme. */
    private void applyBackground() {
        applyBackground(prefs.getBoolean("light", false));
    }

    private void applyBackground(boolean light) {
        int bg = light ? BG_LIGHT : BG_DARK;
        if (root != null) root.setBackgroundColor(bg);
        if (web != null) web.setBackgroundColor(bg);
        Window w = getWindow();
        if (w != null) w.setBackgroundDrawable(new ColorDrawable(bg));
    }

    /* Build a WebView with every setting, client and bridge the app runs with. Used once by
       onCreate and again by rebuildWebView() after the renderer has been killed, so the launch
       path and the recovery path cannot drift apart. */
    private WebView createWeb() {
        WebView w = new WebView(this);

        WebSettings s = w.getSettings();
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
        /* Pin the text scale at 100%: Chromium's font boosting (text autosizing) derives its
           multiplier from the WebView's text zoom, so 100 leaves every px size in index.html
           exactly as written. It is set here, in the one settings block both the launch path and
           the recovery path go through, so a rebuilt WebView is pinned before its first load. */
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setOffscreenPreRaster(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);

        w.addJavascriptInterface(new Bridge(), BRIDGE_NAME);
        /* onRenderProcessGone only exists from API 26, and its parameter type does not exist on
           24/25: the recovery client is a separate class that is loaded only on 26+, so a device
           without the class never resolves it. */
        w.setWebViewClient(Build.VERSION.SDK_INT >= 26 ? new RecoverClient() : new LocalClient());
        w.setWebChromeClient(new WebChromeClient());
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        return w;
    }

    /* The bridge is the one object a WebView holds that reaches back into this activity: Bridge is
       a non-static inner class, so the injected instance carries MainActivity.this — the media
       list, the thumbnail caches, the grid. destroy() drops the view's AwContents, and the
       injected-object map goes with it, so a destroyed WebView retains nothing on a stock WebView.
       But that release is the framework's own, and a WebView that keeps its AwContents alive past
       destroy() — an OEM build, a bug — would keep the bridge and, through it, this activity.
       Both teardown paths therefore drop the interface on the live view first, so what the
       WebView holds is severed by this class and not by the framework's cleanup. Nothing on
       screen changes: the page is already gone, or about to be, at both call sites. */
    private static void dropBridge(WebView w) {
        if (w == null) return;
        try {
            w.removeJavascriptInterface(BRIDGE_NAME);
        } catch (Throwable ignored) {
            /* the view is already unusable; destroy() below still runs */
        }
    }

    /* The renderer is a separate process and the system kills it whenever it needs to: a
       low-memory device reclaims it, or a page takes it down. The default answer to
       onRenderProcessGone is to let the app die with it, which is the crash this replaces. A
       WebView whose renderer is gone can never be used again, so it is removed from the tree,
       destroyed, and a fresh one — same settings, same bridge, same start URL, same layout
       params and the same IME padding — is put back in its place. Nothing on screen moves: the
       page reloads from the same asset, the persisted state is unchanged, the MediaStore query
       and the thumbnail caches are untouched, and the page restores its insets from meta() on
       the way up, so the recovered frame is the one the user was looking at. */
    private void rebuildWebView() {
        if (root == null) return;
        WebView old = web;
        web = null;
        if (old != null) {
            root.removeView(old);
            dropBridge(old);
            try {
                old.destroy();
            } catch (Throwable ignored) {
            }
        }
        WebView fresh = createWeb();
        web = fresh;
        fresh.setPadding(0, 0, 0, imeBottom);
        root.addView(fresh, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyBackground();
        fresh.loadUrl(HOST + "index.html");
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
        web = createWeb();
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyBackground();
        setContentView(root);

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
                            evalOn(js, null);
                        }
                    });
                }
                return ins;
            }
        });

        web.loadUrl(HOST + "index.html");
    }

    /* The one place the app calls into the page. A WebView is unusable the moment it has been
       destroyed — onDestroy() tears the activity's view down, and rebuildWebView() destroys the
       view whose renderer died — and every call site here is asynchronous, so the view can be gone
       by the time the call runs. The field and the liveness flag are therefore re-read here, at
       the moment of the call, instead of being checked by the caller: a stale check passes, this
       one cannot. Returns false when nothing was dispatched, so a caller that needs an answer
       (back-press) can act on the page being absent. */
    private boolean evalOn(final String js, final ValueCallback<String> cb) {
        WebView w = web;
        if (w == null || webGone) return false;
        try {
            w.evaluateJavascript(js, cb);
        } catch (Throwable ignored) {
            /* the view went away between the check and the call */
            return false;
        }
        return true;
    }

    private void pushInsets() {
        final String js = "window.__native&&window.__native.insets&&window.__native.insets("
                + insetTop + "," + insetBottom + ")";
        runOnUiThread(new Runnable() {
            public void run() {
                evalOn(js, null);
            }
        });
    }

    private void eval(final String js) {
        runOnUiThread(new Runnable() {
            public void run() {
                evalOn(js, null);
            }
        });
    }

    @Override
    public void onBackPressed() {
        // let the web app handle back (close viewer / leave album) first
        boolean sent = evalOn("(function(){return window.__native&&window.__native.back?window.__native.back():false})()",
                new ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        if (value == null || !value.contains("true")) {
                            finish();
                        }
                    }
                });
        /* no page to ask: back means leave the app */
        if (!sent) finish();
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
        /* date is the effective capture time the grid orders and groups by: DATE_TAKEN when the
           provider has one, DATE_MODIFIED otherwise. modified is the raw DATE_MODIFIED stamp and
           is kept separately, because the on-disk thumbnail is keyed on it (an edit rewrites the
           file and must invalidate the cached thumb, while DATE_TAKEN does not move). */
        long date, modified, size;
        int w, h;
    }

    private List<Item> cachedMedia = null;
    private long cachedMediaAt = 0L;
    private static final long MEDIA_CACHE_MS = 1500L;

    /* 65. The media list is the largest thing this activity holds that the page does not need
       while it is not on screen. Every tile on screen was painted from JSON the page parsed for
       itself, so the native copy is only ever read again through photos() — and a resume that
       comes more than MEDIA_CACHE_MS after the query re-queries MediaStore anyway. A backgrounding
       therefore has two outcomes and no third: a short one (a dialog, the system picker, a
       permission prompt, a share sheet) keeps the list, because onStart cancels the drop below;
       a long one drops it, because the list is stale by then and the system wants the heap back
       from exactly that process. Nothing the user can see changes: no bridge method, no setting,
       no page change, and the grid that is still in memory keeps drawing from the page's own
       copy. The id-keyed metadata caches stay — they are small, and the on-disk thumbnail name is
       derived from one of them, so dropping those would cost a re-decode per tile on resume. */
    private static final long MEDIA_LIST_BG_FREE_MS = 60L * 1000;
    /* cachedMedia is written from three threads (the bridge's photos(), a background import, the
       UI-thread drop below), so the field and its timestamp move together under this lock. The
       query itself is outside it: holding the lock across MediaStore would block the UI thread
       behind a provider call. */
    private final Object mediaLock = new Object();
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable freeMediaOnBackground = new Runnable() {
        public void run() {
            int held;
            synchronized (mediaLock) {
                held = cachedMedia == null ? 0 : cachedMedia.size();
                cachedMedia = null;
                cachedMediaAt = 0L;
            }
            if (held > 0) {
                Log.i(TAG, "media list freed after " + (MEDIA_LIST_BG_FREE_MS / 1000L)
                        + " s in the background, dropped " + held + " row(s)");
            }
        }
    };

    /* A library can hold far more than the app will show. The row ceiling below is unchanged (the
       list a user sees is exactly the same), but the rows now arrive a page at a time: each query
       asks the provider for MEDIA_PAGE_SIZE rows at an offset instead of materialising the whole
       library in one CursorWindow, and the read stops as soon as a page comes back short. */
    private static final int MEDIA_PAGE_SIZE = 1000;
    private static final int MEDIA_MAX_ITEMS = 6000;

    /** Query args for one page of the library, or null below API 26, where paging is unavailable
     *  and the single capped query is used instead. */
    private Bundle pageArgs(int offset) {
        if (Build.VERSION.SDK_INT < 26) return null;
        Bundle args = new Bundle();
        args.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER,
                MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
        args.putInt(ContentResolver.QUERY_ARG_LIMIT, MEDIA_PAGE_SIZE);
        args.putInt(ContentResolver.QUERY_ARG_OFFSET, offset);
        /* Recycle bin (API 30+): a trashed photo keeps its MediaStore row until the bin is
           emptied, so the grid used to show pictures the user had already deleted. The provider
           filters them out with one selection term, which costs nothing per row here and keeps
           the 6000-row ceiling counting real photos instead of tombstones. Below API 30 there is
           no IS_TRASHED column and no recycle bin, so the query is unchanged. */
        StringBuilder selection = new StringBuilder();
        if (Build.VERSION.SDK_INT >= 30) {
            selection.append(MediaStore.MediaColumns.IS_TRASHED).append(" = 0");
        }
        /* Pending imports (API 29+): the importer inserts a row with IS_PENDING = 1 and flips it
           back to 0 only once the bytes are written, and the provider hands pending rows to a
           query in the meantime. Those rows used to reach the grid as blank or half-drawn tiles
           (and their thumbnail request returned nothing). One more selection term hides them until
           the write completes; the projection, the order and the page ceiling are untouched, and
           the row appears on the next query once the flag clears. Below API 29 there is no
           IS_PENDING column, so the selection stays as it was. */
        if (Build.VERSION.SDK_INT >= 29) {
            if (selection.length() > 0) selection.append(" AND ");
            selection.append(MediaStore.MediaColumns.IS_PENDING).append(" = 0");
        }
        if (selection.length() > 0) {
            args.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection.toString());
        }
        return args;
    }

    /** MediaStore is expensive; a resume right after a permission callback must not query twice. */
    private List<Item> queryMediaCached() {
        long now = System.currentTimeMillis();
        synchronized (mediaLock) {
            if (cachedMedia != null && now - cachedMediaAt < MEDIA_CACHE_MS) return cachedMedia;
        }
        List<Item> list = queryMedia();
        synchronized (mediaLock) {
            cachedMedia = list;
            cachedMediaAt = now;
        }
        return list;
    }

    private void invalidateMediaCache() {
        synchronized (mediaLock) {
            cachedMedia = null;
            cachedMediaAt = 0L;
        }
    }

    private List<Item> queryMedia() {
        List<Item> out = new ArrayList<>();
        if (!hasAccess()) return out;
        /* How long the provider takes is the number that separates a slow first frame caused by
           MediaStore from one caused by the decode path, and it is the one measurement that is
           missing from a bug report. It is only measured and printed when someone has switched
           debug logging on for this tag (adb shell setprop log.tag.LGP DEBUG): the guard is a
           single boolean read, so a normal run pays no System.nanoTime call, no string
           concatenation and no log line — the query path itself is untouched. */
        boolean trace = Log.isLoggable(TAG, Log.DEBUG);
        long queryStart = trace ? System.nanoTime() : 0L;
        queryOne(out, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
        /* Newest first by capture time. The provider still orders the pages by DATE_MODIFIED,
           because that column is never null and every term of the sort string it accepts is a
           plain column name, so paging and the 6000-row ceiling keep returning exactly the rows
           they returned before; the capture date only reorders what came back. The comparator
           already sorted on the effective date, so this is where DATE_TAKEN wins when it exists. */
        Collections.sort(out, new Comparator<Item>() {
            public int compare(Item a, Item b) {
                return Long.compare(b.date, a.date);
            }
        });
        if (trace) {
            Log.d(TAG, "query " + out.size() + " rows in "
                    + ((System.nanoTime() - queryStart) / 1000000L) + " ms");
        }
        return out;
    }

    private void queryOne(List<Item> out, Uri base) {
        /* Only the columns the row loop below actually consumes are projected: _ID (identity, the
           thumb URL and the delete URI), DISPLAY_NAME (name), DATE_TAKEN (the capture time the
           grid orders and groups by when the camera or the importer recorded one), DATE_MODIFIED
           (the fallback sort key and the disk-thumb stamp), SIZE (the info sheet and the
           Content-Length fallback when the provider reports no length), MIME_TYPE (response type,
           HEIF test, share type), WIDTH and HEIGHT (the decode size hint and the info sheet) and
           bucket_display_name (albums). Every one of the nine is read; a column added here without
           a consumer would cost a Cursor read per row for nothing. tools/test_suite.js enforces
           that pairing. DATE_TAKEN is read through MediaStore.MediaColumns, whose value is a
           compile-time constant, so the projection is unchanged on API 24-28 where the field was
           added later; the "datetaken" column itself has existed since API 1. */
        String[] proj = {
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.DATE_TAKEN,
                MediaStore.MediaColumns.DATE_MODIFIED,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.MIME_TYPE,
                MediaStore.MediaColumns.WIDTH,
                MediaStore.MediaColumns.HEIGHT,
                "bucket_display_name"
        };
        boolean paged = Build.VERSION.SDK_INT >= 26;
        for (int page = 0; out.size() < MEDIA_MAX_ITEMS; page++) {
            int before = out.size();
            Bundle args = pageArgs(page * MEDIA_PAGE_SIZE);
            Cursor c = null;
            try {
                c = args != null
                        ? getContentResolver().query(base, proj, args, null)
                        : getContentResolver().query(base, proj, null, null,
                                MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
                if (c == null) return;
                /* Resolved once, before the row loop. Cursor.getColumnIndex walks the projection on
                   every call, so a lookup inside the loop would cost eight projection scans per
                   photo. tools/test_suite.js fails if a getColumnIndex reappears in any cursor
                   loop, or if a projected column stops being looked up. */
                int iId = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
                int iName = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
                int iTaken = c.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN);
                int iDate = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED);
                int iSize = c.getColumnIndex(MediaStore.MediaColumns.SIZE);
                int iMime = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE);
                int iW = c.getColumnIndex(MediaStore.MediaColumns.WIDTH);
                int iH = c.getColumnIndex(MediaStore.MediaColumns.HEIGHT);
                int iB = c.getColumnIndex("bucket_display_name");
                /* BUCKET_DISPLAY_NAME is null on rows the provider has no album for (and on some
                   importers), and the provider hands back a freshly allocated String for every
                   row even when a thousand rows name the same album. Rows with no bucket now
                   share the EMPTY constant, and every repeated album name shares the first
                   instance seen in this query, so a 6000-row library holds a handful of bucket
                   strings instead of 6000. The value each row carries is unchanged, so the grid,
                   the album filters and the search haystack read exactly what they read before. */
                Map<String, String> bucketPool = new HashMap<String, String>();
                bucketPool.put(EMPTY, EMPTY);
                while (c.moveToNext() && out.size() < MEDIA_MAX_ITEMS) {
                    Item it = new Item();
                    it.id = c.getLong(iId);
                    it.name = iName >= 0 && !c.isNull(iName) ? c.getString(iName) : "IMG_" + it.id;
                    /* DATE_TAKEN is already milliseconds; DATE_MODIFIED is seconds. A row with no
                       capture time (0 or null: screenshots, downloads, imports, older media) keeps
                       the modified stamp, so nothing loses a date and the order stays total. */
                    long takenMs = iTaken >= 0 && !c.isNull(iTaken) ? c.getLong(iTaken) : 0L;
                    long modifiedMs = (iDate >= 0 && !c.isNull(iDate) ? c.getLong(iDate) : 0L) * 1000L;
                    it.modified = modifiedMs;
                    it.date = takenMs > 0 ? takenMs : modifiedMs;
                    it.size = iSize >= 0 && !c.isNull(iSize) ? c.getLong(iSize) : 0L;
                    it.mime = iMime >= 0 && !c.isNull(iMime) ? c.getString(iMime) : "image/jpeg";
                    it.w = iW >= 0 && !c.isNull(iW) ? c.getInt(iW) : 0;
                    it.h = iH >= 0 && !c.isNull(iH) ? c.getInt(iH) : 0;
                    if (iB < 0 || c.isNull(iB)) {
                        it.bucket = EMPTY;
                    } else {
                        String raw = c.getString(iB);
                        String pooled = bucketPool.get(raw);
                        if (pooled == null) {
                            bucketPool.put(raw, raw);
                            pooled = raw;
                        }
                        it.bucket = pooled;
                    }
                    out.add(it);
                    rememberMeta(it.id, it.mime, it.size);
                    if (it.w > 0 && it.h > 0) dimCache.put(it.id, new int[]{it.w, it.h});
                    if (it.modified > 0) dateCache.put(it.id, it.modified);
                }
            } catch (Exception e) {
                Log.w(TAG, "query failed", e);
                return;
            } finally {
                /* Every exit from the try above lands here — the null-cursor return, the caught
                   per-row failure and the return it takes, and the normal end of the page — so the
                   cursor is closed on every path and its CursorWindow and provider fd are never
                   leaked. The close is guarded in turn: a provider that throws out of close() must
                   not turn a page that has already been read into a failed query. */
                if (c != null) {
                    try {
                        c.close();
                    } catch (Exception ignored) {
                    }
                }
            }
            /* A short page is the end of the library; an unpaged query has nothing left to ask for. */
            if (!paged || out.size() - before < MEDIA_PAGE_SIZE) break;
        }
    }

    /* The mime and size maps are what the thumb response, the info sheet and the share type read
       after a row has scrolled out of the query, so they have to carry what the last query saw.
       They used to be rewritten row by row on every query — two boxed puts, and a possible resize
       and rehash, per photo even when a rescan found nothing new. A row is now written only when
       its value actually differs from the cached one, so a refresh over an unchanged library does
       no map writes at all, and each map is capped so a growing library cannot grow it forever
       (a full map is dropped rather than evicted one entry at a time, the same way heifUnsupported
       is handled: the next query refills it from the rows it reads). */
    private void rememberMeta(long id, String mime, long size) {
        Long key = Long.valueOf(id);
        String oldMime = mimeCache.get(key);
        if (oldMime == null || !oldMime.equals(mime)) {
            if (mimeCache.size() >= MEDIA_META_CACHE_MAX) mimeCache.clear();
            mimeCache.put(key, mime);
        }
        Long oldSize = sizeCache.get(key);
        if (oldSize == null || oldSize.longValue() != size) {
            if (sizeCache.size() >= MEDIA_META_CACHE_MAX) sizeCache.clear();
            sizeCache.put(key, size);
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

    /* HEIC/HEIF: the platform image decoder only learned these formats in API 28, so on API 24-27
       BitmapFactory cannot read them at all and every attempt opens the stream, fails and throws
       the fd away - once per request, so every scroll past the tile pays for it again. Those ids
       are refused before anything is opened and remembered, so the tile simply stays empty the
       way it does today for a photo that cannot be read. On API 28+ ImageDecoder reads HEIF
       natively, so nothing is refused there. */
    private static boolean isHeif(String mime) {
        if (mime == null) return false;
        String m = mime.toLowerCase(Locale.US);
        return m.equals("image/heic") || m.equals("image/heif")
                || m.equals("image/heic-sequence") || m.equals("image/heif-sequence");
    }

    private void noteHeifUnsupported(long id, String why) {
        if (heifUnsupported.size() >= HEIF_UNSUPPORTED_MAX) heifUnsupported.clear();
        if (heifUnsupported.add(id)) Log.i(TAG, "heif unsupported " + id + ": " + why);
    }

    private byte[] thumbnail(long id) {
        long key = id;
        /* MediaStore already reported the pixel size, so a media row that claims to be smaller
           than the floor can be dropped before anything is opened, decoded or served — including
           a 1x1 thumb an older build may have left in the disk cache. */
        int[] dims = dimCache.get(id);
        if (dims != null && Math.max(dims[0], dims[1]) < THUMB_MIN_PX) {
            Log.w(TAG, "thumb too small, skipping " + id + " " + dims[0] + "x" + dims[1]);
            return null;
        }
        /* A HEIF row this device already refused costs nothing to refuse again: no cache probe,
           no stream open, no decode attempt. */
        if (heifUnsupported.contains(id)) return null;
        boolean heif = isHeif(mimeCache.get(id));
        if (heif && Build.VERSION.SDK_INT < 28) {
            noteHeifUnsupported(id, "no HEIF decoder before API 28");
            return null;
        }
        synchronized (thumbCache) {
            byte[] hit = thumbCache.get(key);
            if (hit != null) return hit;
        }
        byte[] onDisk = readThumbDisk(id);
        if (onDisk != null) {
            cacheThumb(key, onDisk);
            return onDisk;
        }
        Bitmap bmp = null;
        try {
            Uri uri = uriFor(id);
            int max = THUMB_MAX_PX;
            int maxDim = dims != null ? Math.max(dims[0], dims[1]) : 0;
            bmp = decodeThumb(uri, maxDim, max, heif);
            if (bmp == null) return null;
            int wd = bmp.getWidth(), ht = bmp.getHeight();
            /* A decoder handed a truncated or malformed file can still return a frame. Below the
               floor that frame is not worth serving, so nothing is scaled, compressed, cached or
               written to disk for it and the caller answers 404. */
            if (Math.max(wd, ht) < THUMB_MIN_PX) {
                Log.w(TAG, "thumb decoded too small, skipping " + id + " " + wd + "x" + ht);
                return null;
            }
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
            writeThumbDisk(id, bytes);
            return bytes;
        } catch (OutOfMemoryError oom) {
            /* A very large or oddly encoded photo can ask for more heap than the process has
               left. The decode is the only place that allocates that much, so the failure is
               contained here: give the cache's bytes back, log it, and answer 404 the way an
               unreadable photo already does, instead of letting the Error kill the app. */
            dropThumbCache();
            Log.w(TAG, "thumb out of memory " + id);
            return null;
        } catch (Throwable t) {
            Log.w(TAG, "thumb fail " + id, t);
            return null;
        } finally {
            if (bmp != null) bmp.recycle();
        }
    }

    /* Release the decoded-JPEG cache so the next decode has heap to work with. The disk cache is
       left alone: it costs no heap and is still correct. */
    private void dropThumbCache() {
        synchronized (thumbCache) {
            thumbCache.clear();
            thumbCacheBytes = 0L;
        }
    }

    /* Decode one thumbnail, no larger than `max` px on its longest side. ImageDecoder is the
       primary path on API 28+: it applies the EXIF rotation (so the grid matches the viewer),
       does the downscale inside the decode, and is the only decoder on the platform that reads
       HEIC/HEIF. Anything it cannot read, and every device below API 28, falls back to the
       BitmapFactory path - except a HEIF file, which that path cannot read on any version, so
       falling back to it would only open the same stream to watch it fail again. */
    private Bitmap decodeThumb(Uri uri, int maxDim, int max, boolean heif) throws Exception {
        if (Build.VERSION.SDK_INT >= 28) {
            Bitmap b = decodeThumbImageDecoder(uri, max);
            if (b != null) return b;
            if (heif) {
                /* 28+ owns HEIF, so a failure here is the file and not the format: one attempt,
                   no second open, and the tile stays empty as it does for any unreadable photo. */
                Log.w(TAG, "heif decode failed on ImageDecoder " + uri);
                return null;
            }
        }
        return decodeThumbFactory(uri, maxDim, max);
    }

    private Bitmap decodeThumbImageDecoder(Uri uri, int max) {
        try {
            ImageDecoder.Source src = ImageDecoder.createSource(getContentResolver(), uri);
            return ImageDecoder.decodeBitmap(src, new ThumbHeader(max));
        } catch (Exception e) {
            Log.w(TAG, "ImageDecoder thumb fail " + uri, e);
            return null;
        }
    }

    /* 63. This callback is run by the decoder on its own thread while a decode is in flight, so
       everything it holds stays alive for the whole decode - and an anonymous class here would be
       an inner class of the activity, carrying `MainActivity.this` (and with it every cache, the
       WebView and the grid's bitmaps) into the decoder for that time. It is static and holds one
       int instead, so nothing but the cap travels with the decode, and it has no field a Bitmap
       could be parked in. Behaviour is unchanged: same allocator, same low-RAM policy, same target
       size. */
    private static final class ThumbHeader implements ImageDecoder.OnHeaderDecodedListener {
        private final int max;

        ThumbHeader(int max) {
            this.max = max;
        }

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

    private static void close(java.io.OutputStream s) {
        try { if (s != null) s.close(); } catch (IOException ignored) {}
    }

    /* ------------------------------------------------------------------ */
    /* web client: serve assets + media from the device                   */
    /* ------------------------------------------------------------------ */

    private class LocalClient extends WebViewClient {
        /* One main-frame retry per load. Cleared when a page actually finishes, so a failure after
           a good load (a resume, a reload) gets its own retry, while a load that keeps failing
           cannot spin. */
        private boolean mainFrameRetried;

        /* A main-frame load can fail before the page ever runs: the asset stream will not open, the
           renderer is still coming up, or the surface is handed back mid-load. Chromium then shows
           its own error page — and this app's page owns every control, so an error page is a dead
           screen with no way back. One retry of the same start URL recovers it, from the same
           intercept path, with the same UI. Sub-resource failures are not retried: the grid
           already draws a tile for a thumb that will not decode. */
        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req == null || !req.isForMainFrame()) return;
            Uri u = req.getUrl();
            if (u == null || !"app.local".equals(u.getHost())) return;
            /* A callback for a WebView this activity already replaced is ignored, so a stale view
               cannot reload over the live one. */
            if (view != web) return;
            if (mainFrameRetried) return;
            /* ERROR_UNKNOWN is what Chromium reports for a load it cancelled itself, which is not
               a failure: reloading on it would fight the load that replaced it. */
            if (err != null && err.getErrorCode() == WebViewClient.ERROR_UNKNOWN) return;
            mainFrameRetried = true;
            Log.w(TAG, "main frame error " + (err == null ? "?" : err.getErrorCode()) + ", retrying");
            view.loadUrl(HOST + "index.html");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            /* A page that finished is a page that loaded, so the next failure starts with a fresh
               retry. */
            mainFrameRetried = false;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (u == null || !"app.local".equals(u.getHost())) return null;
            String path = u.getPath() == null ? "/" : u.getPath();
            try {
                /* Chromium asks for /favicon.ico on the first paint and the app ships no icon, so
                   the request used to miss the asset table and fall through to the index.html
                   fallback: the whole app was opened, streamed back and thrown away as an icon, on
                   every launch and every reload. A 204 is the answer a browser already gives for a
                   site with no icon, and it is decided here before any asset lookup. */
                if ("/favicon.ico".equals(path)) return noContent();
                if (path.startsWith("/thumb/")) {
                    String rest = path.substring(7);
                    long id = Long.parseLong(rest);
                    byte[] bytes = thumbnail(id);
                    /* Every thumb response carries a Content-Length: the 200 below sends the
                       JPEG length, and the 404 fallback (notFound) sends 0. Without a length
                       Chromium has to wait for the stream to end before it can paint the tile,
                       which shows up as an empty tile that fills in late. */
                    if (bytes == null) return notFound();
                    /* The length is the one header that differs between thumbs, so this map
                       cannot be shared: it is the fresh map the fixed shapes above avoid. */
                    Map<String, String> h = new HashMap<>();
                    h.put("Content-Type", "image/jpeg");
                    /* A thumb URL is stable for a media id, and the bytes behind it only change when
                       the photo is re-imported under a new id, so the response can be marked
                       immutable: the WebView stops re-asking for a thumb it already has instead of
                       going back through shouldInterceptRequest on every grid repaint. */
                    h.put("Cache-Control", "public, max-age=31536000, immutable");
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

    private static Map<String, String> fixedHeaders(String... kv) {
        Map<String, String> h = new HashMap<String, String>();
        for (int i = 0; i + 1 < kv.length; i += 2) h.put(kv[i], kv[i + 1]);
        return Collections.unmodifiableMap(h);
    }

    private static Map<String, Map<String, String>> assetHeaders() {
        String[] mimes = {"text/plain", "text/html", "application/javascript", "text/css",
                "image/svg+xml", "image/png", "application/json"};
        Map<String, Map<String, String>> out = new HashMap<String, Map<String, String>>();
        for (int i = 0; i < mimes.length; i++) {
            out.put(mimes[i], fixedHeaders("Content-Type", mimes[i] + "; charset=utf-8",
                    "Cache-Control", "no-cache"));
        }
        return Collections.unmodifiableMap(out);
    }

    private static Map<String, String> mediaHeaders(String mime) {
        Map<String, String> h = MEDIA_HEADERS.get(mime);
        if (h == null) {
            h = fixedHeaders("Accept-Ranges", "bytes", "Content-Type", mime,
                    "Cache-Control", "public, max-age=3600");
            MEDIA_HEADERS.put(mime, h);
        }
        return h;
    }

    private WebResourceResponse notFound() {
        /* The body is empty, so the length is 0 rather than unknown: a thumb request that fails
           to decode must still be a length-delimited response, like the successful one. The
           header pair is identical for every failure, so all of them share NOT_FOUND_HEADERS;
           a failed decode still says nothing durable about the photo, so it is still no-store. */
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                NOT_FOUND_HEADERS, new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse noContent() {
        /* 204 carries no body, so there is nothing to type and nothing to cache: the icon does
           not exist and must not be remembered as if it did. The header pair never varies, so it
           reuses NO_CONTENT_HEADERS instead of allocating a map per request. */
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content",
                NO_CONTENT_HEADERS, new ByteArrayInputStream(new byte[0]));
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
        Map<String, String> h = ASSET_HEADERS.get(mime);
        if (h == null) h = fixedHeaders("Content-Type", mime + "; charset=utf-8", "Cache-Control", "no-cache");
        return new WebResourceResponse(mime, "utf-8", 200, "OK", h, in);
    }

    private WebResourceResponse streamMedia(long id, WebResourceRequest req) {
        /* The descriptor is opened before the first fallible step, and the WebView only closes a
           body it actually receives: a stream that is never handed to a response is never closed
           by anyone. Both handles are therefore declared out here so the catch below can release
           them — a malformed Range header (Long.parseLong throws) or a failed seek used to return
           404 with the descriptor still open, one file descriptor per request. */
        AssetFileDescriptor afd = null;
        FileInputStream fis = null;
        try {
            Uri uri = uriFor(id);
            String mime = mimeCache.get(id);
            if (mime == null) mime = "image/jpeg";

            afd = getContentResolver().openAssetFileDescriptor(uri, "r");
            if (afd == null) return notFound();
            long start = afd.getStartOffset();
            long len = afd.getLength();
            if (len < 0) {
                Long s = sizeCache.get(id);
                len = s != null ? s : -1;
            }
            ParcelFileDescriptor pfd = afd.getParcelFileDescriptor();
            final AssetFileDescriptor afdRef = afd;
            fis = new FileInputStream(pfd.getFileDescriptor()) {
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

            /* The three headers that never vary come from the shared per-mime map; the two
               variants below need a value of their own, so they copy it rather than write to it. */
            Map<String, String> h = mediaHeaders(mime);

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
                Map<String, String> rh = new HashMap<String, String>(h);
                rh.put("Content-Range", "bytes " + from + "-" + to + "/" + len);
                rh.put("Content-Length", String.valueOf(count));
                return new WebResourceResponse(mime, null, 206, "Partial Content", rh,
                        new LimitedStream(fis, count));
            }

            if (len > 0) {
                ch.position(start);
                Map<String, String> lh = new HashMap<String, String>(h);
                lh.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mime, null, 200, "OK", lh,
                        new LimitedStream(fis, len));
            }
            ch.position(start);
            return new WebResourceResponse(mime, null, 200, "OK", h, fis);
        } catch (Exception e) {
            Log.w(TAG, "media " + id, e);
            releaseMedia(fis, afd);
            return notFound();
        }
    }

    /* The launch client plus one callback. onRenderProcessGone arrived in API 26 and its parameter
       type does not exist below it, so the override lives in a class of its own: createWeb()
       instantiates this one only on 26+, and a device that has neither the method nor the type
       never resolves it and keeps the plain client. */
    private class RecoverClient extends LocalClient {
        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            /* Returning false — the default — lets the framework kill the app along with the dead
               renderer. true says the activity has handled it: the view that died is replaced by
               rebuildWebView(). A callback arriving for a WebView this activity already replaced
               is acknowledged and ignored, so it cannot tear down the live one. */
            if (view == web) rebuildWebView();
            return true;
        }
    }

    /* Nothing was returned, so nothing else will ever close these. Closing the FileInputStream
       also closes the AssetFileDescriptor it was built on; the second close is guarded because a
       provider may already have released it (or the FileInputStream may never have been built). */
    private static void releaseMedia(FileInputStream fis, AssetFileDescriptor afd) {
        if (fis != null) {
            try { fis.close(); } catch (Exception ignored) {}
        }
        if (afd != null) {
            try { afd.close(); } catch (Exception ignored) {}
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
                /* the page debounces its double tap on the system's own window instead of a
                   number of its own: 300 ms stock, changed by accessibility and OEM skins */
                o.put("dblTap", ViewConfiguration.getDoubleTapTimeout());
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
                    applyBackground(l);
                }
            });
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

    /* The manifest absorbs fontScale and density changes, so a user who changes the system text
       size while the app is running gets no new activity and no new WebView — the same view is
       simply re-laid out, and it would re-derive its text scale from the new configuration. The
       pin applied in createWeb() is therefore re-applied here, on the live view, before that
       re-layout: still 100%, so the text the page drew at px sizes is the text it keeps drawing,
       and nothing on screen moves. */
    @Override
    public void onConfigurationChanged(Configuration cfg) {
        super.onConfigurationChanged(cfg);
        WebView w = web;
        if (w == null || webGone) return;
        try {
            w.getSettings().setTextZoom(100);
        } catch (Throwable ignored) {
            /* the view went away before the re-pin */
        }
    }

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

    /* 65. onStop is the first callback that means "the user has left" rather than "something is on
       top of the app", so the long-background timer starts here and is cancelled in onStart: the
       picker, the delete dialog and a permission prompt all pause the app and none of them stop
       it. The Runnable lives on this activity's own handler, so it can only run while the process
       is alive, and it is removed again in onDestroy. */
    @Override
    protected void onStop() {
        super.onStop();
        uiHandler.removeCallbacks(freeMediaOnBackground);
        uiHandler.postDelayed(freeMediaOnBackground, MEDIA_LIST_BG_FREE_MS);
    }

    @Override
    protected void onStart() {
        super.onStart();
        uiHandler.removeCallbacks(freeMediaOnBackground);
    }

    /* 62. Android tells the process when memory is getting tight, and the decoded-JPEG cache is
       the largest thing this app holds that can be given back without losing anything: every
       byte in it is either re-readable from the disk cache or re-decodable from MediaStore, so
       dropping it costs one re-decode and never a photo, a selection or a scroll position.
       Only real pressure drops it — a light trim and the UI-hidden callback (the user switched
       away, memory is fine) are left alone, so a background/foreground round trip does not throw
       away the grid it is about to paint again. The disk cache is untouched, exactly as in the
       OutOfMemoryError path: it costs no heap and is still correct. Nothing here is reachable
       from the page — no bridge method, no setting, no page change. */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level == ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) return;
        if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) return;
        long held;
        synchronized (thumbCache) {
            held = thumbCacheBytes;
        }
        dropThumbCache();
        Log.i(TAG, "thumb cache dropped on trim " + level + ", freed " + (held / 1024L) + " KB");
    }

    @Override
    protected void onDestroy() {
        /* The flag goes up before the destroy, so a Runnable already sitting on the UI queue — an
           insets push, an IME push, a resume eval — finds the view dead and returns instead of
           calling into a WebView that no longer exists. The field is cleared afterwards, so from
           then on the null check answers on its own. */
        webGone = true;
        uiHandler.removeCallbacks(freeMediaOnBackground);
        WebView w = web;
        web = null;
        if (w != null) {
            dropBridge(w);
            try {
                w.loadUrl("about:blank");
                w.destroy();
            } catch (Throwable ignored) {
            }
        }
        super.onDestroy();
    }
}

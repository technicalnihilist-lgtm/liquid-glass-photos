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

    private WebView web;
    private FrameLayout root;
    private SharedPreferences prefs;

    private final Map<Long, String> mimeCache = Collections.synchronizedMap(new HashMap<Long, String>());
    private final Map<Long, Long> sizeCache = Collections.synchronizedMap(new HashMap<Long, Long>());
    /* Ceiling for the two metadata maps above, at twice the 6000-row media ceiling: they are keyed
       by media id, so a library that only ever grows would otherwise grow them forever. */
    private static final int MEDIA_META_CACHE_MAX = 2 * 6000;

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

    private static void close(java.io.OutputStream s) {
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

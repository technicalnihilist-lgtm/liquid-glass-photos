# Liquid Glass Photos

A real, installable Android **photos** app — the liquid-glass UI from the original single-file HTML, wrapped in a native Android shell that reads **your actual phone photo library**. No demo photos, no mock data: on first launch it asks for photo permission and then shows the images that are really on the device. Photos only - video support is deliberately not included.

<p align="center">
  <img src="docs/screenshots/01-library.jpg" width="240" alt="Library">
  <img src="docs/screenshots/02-albums.jpg" width="240" alt="Albums">
  <img src="docs/screenshots/05-viewer.jpg" width="240" alt="Viewer">
</p>
<p align="center">
  <img src="docs/screenshots/04-search.jpg" width="240" alt="Search">
</p>

## Download

**[LiquidGlassPhotos.apk](LiquidGlassPhotos.apk)** — v1.1.0, 110 KB, signed, min Android 7.0 (API 24), target API 34.

Or download it from the [v1.1.0 release](https://github.com/technicalnihilist-lgtm/liquid-glass-photos/releases/latest).

Install it on a phone (enable "install unknown apps" for your file manager), then grant photo access when prompted.

## What works

- **Real gallery** — reads images through Android's `MediaStore`, newest first, grouped by day (Today / Yesterday / date), like Google Photos.
- **Albums** — Recents, Favourites, Camera, Screenshots, Trash, with live counts and cover thumbnails.
- **Viewer** — swipe between items, double-tap to zoom, drag to pan, swipe down to close.
- **Selection** — long-press or tap "Select", then favourite, share or delete a batch. Press one photo and **drag across the grid** to select everything you pass over (drag over selected ones to deselect); it auto-scrolls at the top and bottom edges. **Swipe to the right edge** while dragging and every photo gets selected. The **All** button in the header toggles select-all.
- **Share** — real Android share sheet via `ACTION_SEND_MULTIPLE` with content URIs.
- **Delete** — first moves to the app's Trash (undoable), then "Delete" in Trash calls the Android 11+ system delete confirmation, which removes the file from the device for real.
- **Add** — system image picker; selected photos are copied into your gallery (`Pictures/LiquidGlass`).
- **Depth effect** — the accelerometer drives three parallax layers: the wallpaper moves against the tilt, the photo grid moves a little, and the glass chrome (header buttons, tab bar, selection bar) moves the most and rotates in 3D around the touch point. Tilt the phone and the UI has real depth.
- **4D motion** — when the phone is held still the layers keep drifting on a slow sine, and the glass chrome shimmers gently, so the screen never feels frozen.
- **Liquid glass settings** — transparency, blur, grid size (1–6 columns, also pinch the grid), water sound + volume, bounce, haptics, depth effect, 4D motion, dark/light theme. All persisted.
- **Haptics and sound** — real `VIBRATE` and a Web Audio "plop" on every tap.
- **Back button** — closes the viewer, leaves an album, or exits, in that order.

## How it is built

The UI is the original HTML/CSS/JS, unchanged in look and behaviour. Everything that used to be simulated was replaced with a native bridge:

| Original HTML | This app |
| --- | --- |
| 48 canvas-generated demo photos | `MediaStore` query for real device media |
| `p.src` data URLs | `/thumb/<id>`, `/media/<id>` served by the app |
| fake delete (flag) | app Trash, then Android system delete request |
| `navigator.share` on blobs | native `ACTION_SEND_MULTIPLE` |
| `<input type=file>` | `ACTION_OPEN_DOCUMENT` + copy into MediaStore |
| favourites in memory | `SharedPreferences` |
| (new) tilt parallax | `Sensor.TYPE_ACCELEROMETER` → `window.__native.tilt(x, y)` |

The app is photos-only: only `MediaStore.Images` is queried, and `READ_MEDIA_VIDEO` is not requested in the manifest.

`MainActivity` hosts a `WebView` and serves the app from a private origin (`https://app.local/`) that it intercepts in `shouldInterceptRequest`. That handler does the real work:

- `/thumb/<id>` — decodes a downscaled JPEG with `BitmapFactory` and `inSampleSize`, cached in memory, so a 50 MP library scrolls smoothly.
- `/media/<id>` — streams the original image bytes with `Content-Length` and HTTP `Range` / `206 Partial Content` support.

No third-party libraries. No Gradle. No AndroidX. Just the Android framework, one Java file, and the original HTML.

## Performance

The number that matters most on a big library is how long the first tile takes to appear.
`tools/bench_first_frame.js` measures it: it loads the real `app/assets/index.html` in headless
Chromium with the native bridge stubbed, feeds it **2000 photos**, and serves `/thumb/<id>` from a
local HTTP server the same way `shouldInterceptRequest` serves it on the device. Median of 5 runs,
milliseconds from navigation start (412×915 viewport):

| 2000 photos | ms |
| --- | --- |
| chrome painted, empty state | 209 |
| every tile in the DOM | 1705 |
| first thumbnail decoded | 2481 |
| **first tile decoded and painted** | **3657** |

```bash
node tools/bench_first_frame.js --count=2000 --runs=5
```

This is the day-1 baseline (v1.1.0) that the rest of the optimisation plan is measured against. It
is a browser-harness number on a 2-core sandbox, not a phone measurement, so compare pass against
pass rather than against a device. The gap between "first thumbnail decoded" and "first tile
painted" is the cost of laying out the 2000-tile grid, which is where the next passes look first.

## Build it yourself

Requirements: JDK 17, Android SDK platform 34 + build-tools 34.0.0.

```bash
export JAVA_HOME=/path/to/jdk17
export SDK=/path/to/android-sdk
bash build.sh          # aapt2 -> javac -> d8 -> zipalign -> apksigner
```

`build.sh` produces a signed `LiquidGlassPhotos.apk`. The signing key is generated on first run (`lgp-release.jks`) — replace it with your own for a real release.

Icons are generated by `tools/make_icons.py` (Pillow) into `app/res/`, so they are not committed.

## Repo layout

```
app/AndroidManifest.xml                     permissions, activity, theme
app/java/com/liquidglass/photos/MainActivity.java   WebView shell + MediaStore bridge (~900 lines)
app/assets/index.html                       the entire UI (liquid glass)
app/res/                                    strings, colours, theme, adaptive icon
build.sh                                    full APK pipeline without Gradle
tools/make_icons.py                         launcher icon generator
tools/gen_preview.py                        preview harness (see below)
tools/bench_first_frame.js                  first-frame benchmark on a 2000-photo library
docs/screenshots/                           screenshots
```

## About the screenshots

The APK ships with **no** sample media — it is empty until it reads your gallery. The screenshots above were rendered from the same `app/assets/index.html` through `tools/gen_preview.py`, a browser harness that stubs the native bridge with 44 generated sample images. That is the only place sample images exist; they are not in the APK.

## Changelog

### 1.1.0 — day 1 of the 20-day optimisation plan, fourth pass
No UI change, no new features, no app code touched. Item 10 of the plan: the first-frame cost of a
2000-photo library is now measured and written down, so the later passes have a baseline.
- New `tools/bench_first_frame.js`: runs the real `app/assets/index.html` in headless Chromium with
  the bridge stubbed and 2000 photos, serves thumbnails from a local HTTP server, and reports the
  time to the first tile painted (median of runs).
- Result on 2000 photos: first tile decoded and painted at **3657 ms** from navigation start, with
  the empty chrome up at 209 ms and all 2000 tiles in the DOM by 1705 ms. See *Performance* above.

### 1.0.9 — day 1 of the 20-day optimisation plan, third pass
No UI change, no new features.
- The header markup is keyed on mode/tab/album, so toggling a selection during a drag only rewrites
  the title text instead of rebuilding the buttons on every hit-test.

### 1.0.8 — day 1 of the 20-day optimisation plan, second pass
No UI change, no new features.
- The grid is built into a `DocumentFragment` and swapped in with a single insert, instead of assigning a large `innerHTML` string to the live screen.
- When the grid markup has not changed, the screen is left alone: a selection change (select mode, a tap, All) now only flips the `.on` class on the tiles that changed, so the existing `<img>` elements are never recreated or re-decoded.
- Search results get the same treatment: typing a query that resolves to the same list no longer rebuilds the results grid.

### 1.0.7 — day 1 of the 20-day optimisation plan
No UI change, no new features. Only internal work, see `OPTIMIZATION_PLAN.md`.
- Thumbnails decode in **one** pass: the size comes from the MediaStore `WIDTH`/`HEIGHT` columns instead of a second `inJustDecodeBounds` stream open.
- The thumbnail cache is bounded by **bytes** (12 MB LRU) instead of a 220-entry count, so memory stays flat on a big library.
- `.tile` gets `contain: layout paint style`, so off-screen tiles cost nothing to lay out or paint.
- Drag-select hit-tests **once per frame** (rAF) instead of once per pointer event.
- Tilt values are only written to CSS when they actually move (>0.002), cutting style recalcs while the phone is still.
- A 1.5 s cache of the MediaStore result stops a resume + permission callback from querying twice; the cache is invalidated on delete and import.
- One `paintTilt()` per settings change instead of two.

### 1.0.6
- **Drag to select.** In selection mode, press a photo and drag across the grid: every tile you pass is selected (or deselected, if you started on a selected one). The grid auto-scrolls when you drag to the top or bottom edge.
- **Swipe right to select all.** Drag to the right edge of the screen and every photo in the current view is selected at once.
- **All button** in the header while selecting - toggles select-all / clear.
- **Deeper depth + parallax.** The photo plane itself now tilts in perspective with the device (`rotateX`/`rotateY`), the wallpaper parallaxes further against the tilt, and the glass chrome rotates harder - the layers read as separate depths instead of a flat sheet.
- Fixed: the tilt transform was overriding `translateX(-50%)`, which pushed the selection bar and the viewer bar off-centre.

### 1.0.5
- **Depth effect.** A native accelerometer listener (baseline-calibrated, ~30 Hz, paused with the app) feeds tilt into CSS custom properties. Three layers move at different rates - wallpaper against the tilt, grid slightly with it, glass chrome most - and the chrome rotates in 3D (`perspective` + `rotateX/rotateY`), with the tab bar's shadow sliding under it.
- **4D motion.** An idle drift on a slow sine keeps the depth layers alive when the phone is still, plus a gentle shimmer on the glass chrome.
- Both are toggles in the settings sheet, persisted; turning depth off also stops the sensor listener to save battery.
- Soft gradient scrims behind the header and tab bar, so glass labels stay readable over bright photos.
- Tighter settings rows so the whole sheet - including Done/Reset - fits without scrolling.

### 1.0.4
- **Photos only.** Video support removed completely: only `MediaStore.Images` is queried, the `READ_MEDIA_VIDEO` permission is gone, the native video player and the `Videos` album are deleted, and the picker accepts images only.
- Smaller APK and a shorter permission list - the app asks for photo access only.

### 1.0.3
- **Full-screen video with no black bars.** The player now measures the surface to the centre-cropped video size and tells the decoder to scale-to-fit-with-cropping, so 16:9, 4:3, vertical and square clips all fill the display edge-to-edge instead of being letterboxed.
- The playback scrubber is anchored to the window rather than the video surface, so it stays correctly placed at the bottom of the screen.

### 1.0.2
- **Fixed: videos would not play.** WebView never fetched `<video>` sources through the app's request interceptor, so playback now happens in a native full-screen player (`VideoView` + `MediaController`) with seek, pause/resume and an automatic fallback to the phone's own player.
- Video tiles in the grid open straight into the player; inside the viewer a video shows its poster frame with a play button.

### 1.0.1
- Returning to the app now refreshes the library, so photos taken in another app show up (throttled so it does not re-query on every resume).
- Opening the keyboard scrolls the search field into view instead of leaving it hidden behind it.
- Media streams release their file descriptors reliably.

### 1.0.0
- First release: native MediaStore gallery, albums, viewer with zoom, selection, share, trash + system delete, picker import, liquid-glass settings.

## Licence

MIT. The original single-file HTML design belongs to whoever made it.

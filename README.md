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

**[LiquidGlassPhotos.apk](LiquidGlassPhotos.apk)** — v1.5.15, 122 KB, signed, min Android 7.0 (API 24), target API 34.

Or download it from the [v1.5.15 release](https://github.com/technicalnihilist-lgtm/liquid-glass-photos/releases/latest).

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

- `/thumb/<id>` — decodes a downscaled JPEG with `ImageDecoder` on API 28+ (`BitmapFactory` + `inSampleSize` below that, and as the fallback for anything `ImageDecoder` cannot read), cached in memory, so a 50 MP library scrolls smoothly.
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
app/java/com/liquidglass/photos/MainActivity.java   WebView shell + MediaStore bridge (~1000 lines)
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

### 1.5.15 — day 7 of the 20-day optimisation plan, forty-seventh pass
No UI change, no new features. Item 65 of the plan: the media list is freed when the app stays in
the background.
- The list is the largest thing the activity holds that the page does not need off screen. Every
  tile on screen was painted from JSON the page parsed for itself, so the native copy is read again
  only through `photos()` — and a resume more than 1.5 s after the query (`MEDIA_CACHE_MS`)
  re-queries MediaStore regardless. Dropping it costs the app nothing it can observe.
- The drop is armed in `onStop()`, the first callback that means the user left rather than "a dialog
  is on top of us": the image picker, the delete confirmation and the permission prompt all pause
  the app and none of them stop it, so a short trip away keeps the list. `onStart()` cancels the
  timer, and `onDestroy()` cancels it too. Only a backgrounding longer than `MEDIA_LIST_BG_FREE_MS`
  (60 s) actually drops it, and it logs how many rows it released.
- The list and its timestamp now move together under `mediaLock`, because the drop adds a third
  writer to the two that were already there (the bridge's `photos()`, a background import). The
  lock is never held across the MediaStore query, so the UI thread cannot queue behind the provider.
- The id-keyed metadata caches (`dimCache`, `mimeCache`, `sizeCache`, `dateCache`) are deliberately
  kept: they are small, and the on-disk thumbnail name is derived from `dateCache`, so dropping them
  would cost a re-decode per tile on resume. No bridge method, no setting, no page change —
  `app/assets/index.html` is byte-identical to 1.5.14.
- `tools/test_suite.js` gains one check (85 now) pinning the timer, its two cancels, the single
  `mediaLock`, the three write sites and the absence of any page-facing surface on the drop.

### 1.5.14 — day 7 of the 20-day optimisation plan, forty-sixth pass
No UI change, no new features. Item 64 of the plan: the WebView does not retain the bridge after
`destroy()` — and nothing now depends on the framework to make that true.
- The bridge is the one object a WebView holds that reaches back into the activity: `Bridge` is a
  non-static inner class, so the injected `AndroidNative` instance carries `MainActivity.this` — the
  media list, the thumbnail caches, the grid. The audit found one holder, the WebView's injected-object
  map, and one injection site, `createWeb()`.
- `destroy()` drops the view's `AwContents` and that map with it, so a destroyed WebView retains nothing
  on a stock WebView. That release was the framework's own, though, and a WebView that keeps its
  `AwContents` alive past `destroy()` would keep the bridge, and the activity with it.
- Both teardown paths — `rebuildWebView()` after a renderer death, and `onDestroy()` — now call
  `dropBridge()`, which removes the interface on the live view before `destroy()`, and both name it from
  the same `BRIDGE_NAME` constant that `createWeb()` injects with, so a removal cannot name a different
  interface than the injection. The activity holds no reference to a bridge instance and `Bridge`
  declares no static field, so the drop is the whole of the reference.
- `tools/test_suite.js` gains two checks (84 now): the constant, the single injection site, both drops
  ahead of their own `destroy()`, and the non-static, stateless, single-instance shape of the bridge.
  No bridge method, no setting, no row, no pixel changed — `app/assets/index.html` is byte-identical to
  1.5.13.

### 1.5.13 — day 7 of the 20-day optimisation plan, forty-fifth pass
No UI change, no new features. Item 63 of the plan: no listener holds a `Bitmap` — and none holds
the activity either.
- The audit found exactly one place where the decode path met a listener: `decodeThumbImageDecoder`
  handed `ImageDecoder.decodeBitmap` an anonymous `OnHeaderDecodedListener`. An anonymous class in
  the activity is an inner class, so it carried `MainActivity.this` — every cache, the WebView, the
  grid — into the decoder for the whole decode, which runs on the decoder's own thread while a
  thumbnail is being built. It held no bitmap itself, but it had a field for anything it was given.
- That callback is now `ThumbHeader`, a `static final` nested class whose only field is the pixel
  cap, so what travels with a decode is one int and no reference to the activity. The allocator,
  the low-RAM policy and the target size it asks for are unchanged, so every thumbnail is decoded
  exactly as before.
- The rest of the bridge was audited the same way: the tilt listener, the insets listener and the
  eleven `Runnable`s hold no `Bitmap` and the activity declares no `Bitmap` field at all, so a
  recycled or live bitmap cannot be kept alive by a listener that outlives it.
- `tools/test_suite.js` gains two checks (82 now, all PASS): every anonymous class in the bridge is
  scanned for a `Bitmap` and the activity for a `Bitmap` field, and the header callback must be the
  static class, holding one int, asking for the same allocator, policy and target size. No bridge
  method, no setting, no row, no pixel changed — `app/assets/index.html` is byte-identical to
  1.5.12.

### 1.5.12 — day 7 of the 20-day optimisation plan, forty-fourth pass
No UI change, no new features. Item 62 of the plan: the thumbnail cache is handed back when the
system asks for memory.
- The activity now overrides `onTrimMemory` and calls `dropThumbCache()` there. The decoded-JPEG
  cache is the largest thing the app holds that can be given back without losing anything — every
  byte in it is either re-readable from the disk cache or re-decodable from MediaStore — so a trim
  costs one re-decode and never a photo, a selection or a scroll offset.
- Only real pressure drops it. `TRIM_MEMORY_UI_HIDDEN` (the user switched away, memory is fine) and
  anything below `TRIM_MEMORY_RUNNING_LOW` are ignored, so a background/foreground round trip does
  not empty the grid it is about to paint again. The freed size is logged once per trim.
- The disk cache is left alone, exactly as in the `OutOfMemoryError` path: it costs no heap and is
  still correct. No bridge method, no setting, no row, no pixel changed — `app/assets/index.html`
  is byte-identical to 1.5.11.
- `tools/test_suite.js` gains one check (80 now, all PASS): the override exists, it calls
  `dropThumbCache()`, the UI-hidden and light-trim gates come before the drop, and it never
  touches the disk cache.

### 1.5.11 — day 7 of the 20-day optimisation plan, forty-third pass
No UI change, no new features. Item 61 of the plan: the thumbnail byte budgets now report the peak
they reached instead of only their current size.
- Both caches already had a 12 MB ceiling — the in-memory `LinkedHashMap` by bytes, the
  `getCacheDir()/thumbs` directory by `THUMB_DISK_BYTES` at trim time — but nothing ever said how
  close a run came to either. Each now keeps a high-water mark next to its current size and writes
  it to logcat as it climbs: the memory side once per MiB (`thumb cache high-water N KB of 12288
  KB`), the disk side on a new peak at each trim (`thumb disk high-water N KB of 12288 KB`).
- The peak is taken *after* the eviction pass, so the number logged is what the cache is really
  holding and never a burst that was about to be evicted. Nothing is logged per thumbnail, nothing
  repeats a level it already logged, and no mark is reset by `dropThumbCache()`, so an OOM still
  leaves the peak that led to it in the log.
- Nothing here is reachable from the page: no bridge method, no setting, no row, no pixel changed.
  `app/assets/index.html` is byte-identical to 1.5.10.
- `tools/test_suite.js` gains one check (79 now, all PASS): the eviction pass comes before the peak
  is read, the memory side logs through `HIGH_WATER_LOG_STEP` and never per thumb, the disk side
  logs before it trims, and both 12 MB constants are still in place.

### 1.5.10 — day 7 of the 20-day optimisation plan, forty-second pass
No UI change, no new features. Item 60 of the plan, an audit: the grid's scroll position survives the viewer.
- Audited every way the viewer closes over a scrolled grid — the close button, the Android back button, a
  swipe-down, a favourite toggled inside the viewer (which changes the grid key and rebuilds every tile), a
  confirmed delete, and the search tab's results — on libraries from 60 to 400 photos, scrolled to the middle
  and to the very bottom. Every path hands `#screen` back at the offset it had; nothing was found to fix.
- The reason it holds is worth writing down: `openViewer()` never writes the scroller, `closeViewer()` renders
  with `renderAll(true)`, and `renderScreen(keepScroll)` reads the offset *before* it swaps the tiles and puts it
  back *after* the swap and after `renderResults()`, so a rebuild cannot leave the grid at the top. The one thing
  that does move is a list that got shorter while the viewer was open (a delete), where the browser clamps the
  offset to the new maximum — it can only clamp, never jump to the top.
- `tools/test_suite.js` gains three checks so this cannot drift: one drives all three close paths on a fresh page
  scrolled half way down and reads that the offset is unchanged during and after; one deletes the current photo
  from the viewer and reads that the grid comes back near its offset and one tile shorter, never at the top; the
  last holds the shape — `renderAll(true)` in `closeViewer`, the `y=keepScroll?sc.scrollTop:0` capture, the
  restore after `swapIn` and `renderResults()`, no `scrollTop` write in `openViewer`, and `#screen` still the
  `overflow-y:auto` scroller.
- 78 checks in `tools/test_suite.js`, all PASS.

### 1.5.9 — day 7 of the 20-day optimisation plan, forty-first pass
No UI change, no new features. Item 59 of the plan: a delete that names another photo no longer takes the
viewer off the photo the user is looking at.
- The viewer's Delete and Restore removed the entry at the current index (`V.list.splice(V.i,1)`) instead of the
  photo the action named, and it closed itself the moment its list emptied — so a delete that arrived for some
  other photo, and every confirmed system delete, could move or close a viewer that was showing a photo nobody
  had touched.
- `dropFromViewer(list)` now removes the ids it is given, by id: an entry ahead of the current one goes without
  the viewer moving off the photo on the stage — nothing is rebuilt, so the slide, its zoom and its title stay
  exactly as they were — the current photo's own delete still hands the stage on with the zoom snapped back, and
  only a list that empties closes the viewer.
- The ids the page asks the system to delete are kept in `delIds`, because the reply to the Android 11+ delete
  dialog carries a count rather than the ids; `onDeleted` drops exactly those from a viewer that is still open.
- Same buttons, same toasts, same swipe and zoom behaviour — only which entry leaves the viewer's list changed.
- `tools/test_suite.js` gains two checks: one opens the viewer on a middle photo, reports a confirmed delete for
  a photo ahead of it and reads that the viewer is still open on the same photo with its title and src intact,
  then deletes the current photo and reads that the stage hands on and that an emptied list closes the viewer;
  the other holds the shape — the id lookup, the `V.i--` for entries ahead, the close only on an empty list, and
  no `V.list.splice(V.i,1)` left anywhere.
- 75 checks in `tools/test_suite.js`, all PASS.

### 1.5.8 — day 7 of the 20-day optimisation plan, fortieth pass
No UI change, no new features. Item 58 of the plan: a photo that cannot be fetched now shows a placeholder in
the viewer instead of an empty slide.
- `/media/<id>` answers 404 when the photo was deleted or moved on disk behind the app's back, and the viewer's
  `<img>` painted nothing at all — a black rectangle where a photo should be, with the day, the time and the
  action bar still sitting around it. The slide now falls back to an inline broken-image placeholder: the same
  `<img>` node, the same box, the same gestures, drawn small and dimmed, and the viewer stays open on the photo
  the user asked for.
- The id that failed is remembered on the slide node (`data-bad`), so the rebuilds that a swipe, a favourite
  toggle or a delete already trigger do not fire the same 404 again; pointing the slide at another photo clears
  it, and the real image comes back the moment it can be read.
- Nothing moves for a photo that loads: the placeholder only appears after a failed fetch, and the CSS rule is
  scoped to `.slide img.miss`.
- `tools/test_suite.js` gains two checks: one serves a 404 for the first photo's full-size fetch, opens it and
  reads that the centre slide paints the placeholder with the viewer still open, then lets the photo load again
  and reads that the real image comes back; the other holds the shape — the inline placeholder constant, the
  `error` listener that records the failed src, both the `build()` and `pointNear()` paths that skip a known-bad
  src, and the `.slide img.miss` rule.
- 73 checks in `tools/test_suite.js`, all PASS.

### 1.5.7 — day 7 of the 20-day optimisation plan, thirty-ninth pass
No UI change, no new features. Item 57 of the plan: the swipe hint's timer now ends with the viewer.
- `build()` hid the viewer's `.hint` with a bare 3.5 s `setTimeout` and kept no handle on it. Closing the viewer
  removes the node 300 ms later, so that callback still fired against a detached element — and since `build()`
  runs again on every swipe, favourite toggle and delete, each rebuild armed another copy of the same timer.
- The handle is kept on the viewer now: `V.hintT` is zeroed in the `openViewer` object, `build()` arms the timer
  only when it is not already armed, and `closeViewer` clears it beside `V.detach()` before `V` is dropped.
- Nothing visible moves: the hint still shows on open with the same text and hides after the same 3.5 s, because
  the timer is still armed by the first `build()` of the viewer.
- `tools/test_suite.js` gains two checks: one wraps the page's `setTimeout`/`clearTimeout`, opens a viewer, reads
  that exactly one 3500 ms timer was armed and owned by `V.hintT`, closes it and reads that the id was cleared,
  `V` is null and no viewer node is left; the other holds the shape — the timer stored on `V`, re-armed only when
  free, cleared before `V=null`, and no bare 3500 ms hint timer left in the page.
- 70 checks in `tools/test_suite.js`, all PASS.

### 1.5.6 — day 7 of the 20-day optimisation plan, thirty-eighth pass
No UI change, no new features. Item 56 of the plan: the swipe no longer asks the layout for its width.
- The viewer read `innerWidth` twice inside the swipe itself — once to decide whether the drag had gone far enough
  to count (22% of the width) and once to write the translate that carries the track to the next photo. A layout
  read that lands between the gesture's own transform writes can flush the frame it is still building, so the
  swipe paid a read/write thrash every time it settled.
- The width is now pre-measured: `measureW()` takes the stage's own `clientWidth` (falling back to `innerWidth`)
  once when the viewer opens and stores it in `V.w`, and a `resize` listener refreshes it only when the window
  actually changes size. The threshold and the settle translate read that number and nothing else, so no layout is
  touched anywhere between a finger landing on the stage and the next photo settling.
- The listener is removed with the viewer (`V.detach()` in `closeViewer`), so repeated open/close leaves nothing
  registered behind it.
- The stage is exactly one viewport wide, so the settle still moves the track by precisely one photo: same swipe,
  same 22% threshold, same spring, same pop and plop.
- `tools/test_suite.js` gains two checks: one reads `V.w` at open and compares it with the stage's width, resizes
  the viewport to 380 and back to 412 and reads that the cached width followed; the other holds the shape — the
  settle writes `-dir*V.w`, the swipe's `end()` contains no `innerWidth`, `clientWidth`, `offsetWidth` or
  `getBoundingClientRect`, and the resize listener is added at open and removed on close.
- 68 checks in `tools/test_suite.js`, all PASS.

### 1.5.5 — day 7 of the 20-day optimisation plan, thirty-seventh pass
No UI change, no new features. Item 55 of the plan: the double tap is debounced on the system's own timeout.
- The viewer decided a double tap with a hard-coded 320 ms of its own, so a tap pair the system would call two
  separate taps (Android's `ViewConfiguration.getDoubleTapTimeout()` is 300 ms stock, and accessibility services
  and some OEM skins raise it) still zoomed the photo, and a pair the system would call one tap could be read as
  a double tap on a device whose window is longer than 320 ms.
- The window now comes from the system: `Bridge.meta()` reports `ViewConfiguration.getDoubleTapTimeout()` and the
  page reads it as `DBL_MS`, falling back to 300 ms only in the browser harness, where there is no bridge.
- The pair is also broken by anything that is not a tap: a swipe or a pan now clears `V.last`, so a tap, a pan and
  a tap a few milliseconds apart are three gestures instead of a double tap — before, that third tap toggled the
  zoom straight back off. After a pair fires, the next tap starts a fresh pair rather than completing the old one.
- Same 2.4x zoom, same pop, same pan, same swipe; only the moment a tap counts as a double tap changed.
- `tools/test_suite.js` gains two checks: one drives real pointer taps on the stage and reads that two taps 420 ms
  apart leave the photo at 1x, two taps 60 ms apart zoom to 2.4x, and a tap-pan-tap leaves it at 2.4x; the other
  holds the shape — `DBL_MS` comes from `META.dblTap` with a 300 fallback, the tap branch compares against
  `DBL_MS` instead of a literal, and the other gestures clear the pair.
- 66 checks in `tools/test_suite.js`, all PASS.

### 1.5.4 — day 6 of the 20-day optimisation plan, thirty-sixth pass
No UI change, no new features. Item 54 of the plan: the zoom snaps back to 1 when the photo changes.
- The zoom belonged to the viewer, not to the photo. Deleting the photo you had double-tapped to 2.4x left
  `V.zoom` at 2.4 while `build()` cleared the transform, so the next photo was drawn at 1x but the viewer still
  thought it was zoomed: a swipe on it was read as a pan and re-applied `scale(2.4)` to a photo the user had never
  zoomed, and the viewer could not advance at all — the swipe was swallowed every time. The same stale state
  followed a restore out of Trash.
- `snapZoom()` now resets `V.zoom` to 1, `V.tx`/`V.ty` to 0 and clears the centre image's transform, and it runs on
  every path that puts a different photo on the stage: the swipe settle, the delete and the restore. The photo you
  are looking at keeps its zoom for as long as it is the photo you are looking at — only the hand-off snaps it back.
- Same swipe, same 2.4x double-tap zoom, same pan, same pop and plop; the next photo now simply arrives unzoomed.
- `tools/test_suite.js` gains two checks: one double-taps to 2.4x, deletes that photo, reads that the next photo
  opens at 1x with no transform, swipes with a real pointer and reads that the swipe advanced one photo at 1x; the
  other holds the shape — `snapZoom()` resets zoom and translation and clears the transform, the swipe calls it
  before `build()`, both the delete and the restore call it, and no inline `V.zoom=1;V.tx=V.ty=0` is left in the
  swipe path.
- 64 checks in `tools/test_suite.js`, all PASS.

### 1.5.3 — day 6 of the 20-day optimisation plan, thirty-fifth pass
No UI change, no new features. Item 53 of the plan: a pan is clamped so the photo cannot be dragged off screen.
- A zoomed photo could be dragged anywhere. The viewer's `V.tx`/`V.ty` were the raw sum of the gesture with nothing
  to stop them, so a finger that kept moving pushed the picture past its own edge and off the stage — a 1500 px drag
  at 2.4x left a full-screen photo entirely outside the viewport, with a blank viewer and no way back except a
  double-tap or a close.
- `clampPan()` now runs on every pan frame, before the transform is painted, and bounds the translation to the room
  the scaled image actually has inside its slide: the centre slide's content box (its `clientWidth`/`clientHeight`
  less the `--sat`/`--sab` padding) against the image's layout size times the zoom. Where the scaled image is larger
  than the slide its edge stops at the slide edge; on an axis where it is still smaller the overhang is zero and it
  stays centred. The bound is read from `offsetWidth`/`offsetHeight`, the untransformed layout size, so it does not
  drift as the pan applies.
- Same pan, same 2.4x double-tap zoom, same swipe, same pop and plop — the photo still moves over its whole area, the
  drag now just ends where the image would have left the screen.
- `tools/test_suite.js` gains two checks: one gives the centre slide the box a full-resolution photo fills, double-taps
  to 2.4x with real clicks and drags 1500 px past the edge, then reads that the translation equals the computed
  overhang, that the image still covers the slide on both axes and that its edge sits on the slide edge; the other
  holds the shape — `panBox()` measures the content box, `clampPan()` clamps both axes, and the pan branch calls
  `clampPan();applyZ(false)`.
- 62 checks in `tools/test_suite.js`, all PASS.

### 1.5.2 — day 6 of the 20-day optimisation plan, thirty-fourth pass
No UI change, no new features. Item 52 of the plan: the offscreen slide images are released.
- Every slide that carries a `src` holds a decoded full-size bitmap, and since the three slide nodes became permanent
  in 1.5.1 all three held one for as long as the viewer was open — two full-resolution decodes of photos the user was
  not looking at. The viewer now drops the `src` of the two offscreen slides 560 ms after it settles, which is after
  the 500 ms slide transition has finished, so nothing is released while the track is moving and the photo on screen
  is never touched.
- A slide with no photo — the ends of the list, or after a delete shortens it — gives its bitmap back at once instead
  of keeping a stale `src` for the life of the viewer, and closing the viewer drops all three once the element has
  left the document.
- A finger landing on the stage re-points the two offscreen slides from the same `src` a build would use, before the
  gesture is read, so the photo that slides in is already loading; the centre slide is never cleared, so the photo on
  screen never blinks. Same slides, same swap, same pop and plop, same gestures.
- `tools/test_suite.js` gains two checks: one swipes, settles, reads that exactly one slide still has a `src` and that
  it is the one on screen, then presses on the stage and reads that all three are pointed again; the other holds the
  shape — `releaseOffscreen()` removes the attribute, `pointNear()` re-sets it, pointerdown calls it first.
- 60 checks in `tools/test_suite.js`, all PASS.

### 1.5.1 — day 6 of the 20-day optimisation plan, thirty-third pass
No UI change, no new features. Item 51 of the plan: the viewer's three slide nodes are reused instead of rebuilt.
- Opening the viewer used to write `track.innerHTML` with three fresh `.slide` divs and three fresh `<img>` elements,
  and every swipe wrote it again — throwing away the two photos that were already in the document, one of them the
  photo the swipe was moving to, and asking the WebView to fetch and decode them a second time.
- The three nodes are now created once when the viewer opens and rotated on a swipe: the node already showing the
  next photo becomes the centre one, the node showing the previous photo becomes the new `next`, and each is re-pointed
  at the id its role holds. A forward swipe therefore sets one `src` — the recycled offscreen node — instead of
  rebuilding the track.
- `data-c` travels with the centre role, so the `popIn` animation still plays on the arriving photo and never re-fires
  on the one that left; a delete or restore rebuilds in place and restarts it across a forced reflow. Stale inline
  `transform`/`transition` from a zoom or pan is cleared, so a swipe out of a zoomed photo lands un-zoomed as before.
- Same slides, same track, same 230 ms swap, same pop and plop, same header, bar, hint, gestures and double-tap zoom.
- `tools/test_suite.js` gains two checks: one swipes a real pointer across the stage and reads that the same three
  slide elements and the same three `<img>` elements survive the swipe, that exactly one carries `data-c`, that the
  centre advanced and that the new centre was already one of the three on screen; the other holds the shape — nodes
  created once from `[-1,0,1]`, no `track.innerHTML` in `build()`, rotation via `n.push(n.shift())`.
- 58 checks in `tools/test_suite.js`, all PASS.

### 1.5.0 — day 6 of the 20-day optimisation plan, thirty-second pass
No UI change, no new features. Item 50 of the plan: "All" is verified against the current filter.
- The header's **All** button and the swipe-to-the-right-edge select-all both take the list the screen is showing —
  `current()` — not the library behind it, so a search result set or an album is selected exactly and no photo
  outside the filter is ever picked up. That is already how it read; what was missing was anything that said so.
- The one select-all check in the suite ran against the unfiltered library, where the filtered list and the whole
  library are the same list, so a regression to the whole library would have passed it. The behaviour is unchanged —
  same tiles, same header, same gestures, same count and toast — and this pass ships the verification.
- `tools/test_suite.js` gains three checks: one long-presses a search result and presses All, reading that the
  selection is exactly the result ids (none outside the filter) and that every one of their tiles is painted; one
  does the same inside the Camera album, a strict subset of the grid, so a select-all that reached for the library
  would overrun it; the third holds the shape — one `selectAll()` helper reading `const list=current();` and never
  `P`, with both entry points, the header button and the right-edge swipe, routed through it.
- 56 checks in `tools/test_suite.js`, all PASS.

### 1.4.9 — day 5 of the 20-day optimisation plan, thirty-first pass
No UI change, no new features. Item 49 of the plan: pinch-to-change-columns no longer fights drag-select.
- A pinch is two fingers on the grid, and both of them landed on the same handler that arms a press. The second
  finger armed a long press and a drag of its own on whatever tile it touched, overwriting the first finger's, and
  neither was torn down when the pinch started — so 430 ms into a pinch a tile was selected, and as the fingers
  travelled one of them claimed the pointer and painted tiles while the columns changed under them.
- A touch that is not the first finger down now returns before the long-press timer and the drag are armed, so a
  pinch finger is never a press; and a two-finger `touchstart` ends whatever the first finger had in flight — drag,
  pointer capture, edge auto-scroll and long-press timer — before it reads the finger distance, so nothing survives
  the re-flow the pinch is about to cause. The pinch itself is unchanged: same 1.3 / 0.77 ratio, same 1–6 columns,
  same plop and buzz.
- Same tiles, same header, same gestures: a one-finger drag-select still paints as it travels and a long press still
  starts the selection at 430 ms.
- `tools/test_suite.js` gains two checks that pin it: one drives a real two-finger pinch over the grid in selection
  mode — finger one presses a tile, finger two lands, the fingers spread to 1.5x and then travel sideways — and reads
  that the second finger never takes the press over, that the drag and the timer are gone by the time the pinch
  moves, that the columns still drop by one, that nothing is painted during or after the pinch and that no press
  fires late; the other holds the shape — the non-primary guard ahead of the long-press timer, and `endDrag()` ahead
  of the distance read in `touchstart`.
- 53 checks in `tools/test_suite.js`, all PASS.

### 1.4.8 — day 5 of the 20-day optimisation plan, thirtieth pass
No UI change, no new features. Item 48 of the plan: `touch-action: pan-y` is honoured, so a diagonal drag still scrolls.
- `#screen` declares `touch-action: pan-y`, so the browser owns every vertical pan and only a sideways gesture is
  the app's. The drag ignored that: the 6 px threshold was measured in any direction and the first frame past it
  called `preventDefault()` and took the pointer capture, so a finger that set off diagonally was claimed on the
  spot and the scroll it belonged to never started — the grid froze and tiles painted instead.
- The touch gesture now has to be further sideways than it is up or down before the drag claims it — the one
  direction pan-y denies the browser. Until then nothing is prevented, nothing is captured and no tile is painted,
  so the pan is free to start and the finger can travel diagonally; once the gesture is sideways the drag takes it
  as before. A mouse or a pen has no pan to hand back, so it drags in any direction exactly as it did.
- Same tiles, same header, same gestures, same selection behaviour on a sideways drag.
- `tools/test_suite.js` gains two checks that pin it: one drives a real touch pointer through a diagonal move (7 px
  across, 9 px down — past the threshold) and then a sideways one, reading that the diagonal move prevents nothing,
  paints nothing and leaves the drag unapplied while the sideways move prevents, paints and applies; the other
  holds the shape — the sideways guard ahead of the `preventDefault` and the capture, with pan-y still on `#screen`.
  The suite also waits out the 750 ms `popIn` on the tabs before clicking the search button, which used to race the
  animation and click the grid behind it.
- 51 checks in `tools/test_suite.js`, all PASS.

### 1.4.7 — day 5 of the 20-day optimisation plan, twenty-ninth pass
No UI change, no new features. Item 47 of the plan: a re-render clears the drag state instead of leaving it in flight.
- A drag remembers the tile node it started on, that tile's cached hit box, the pointer capture, a pending animation
  frame and the edge auto-scroll interval. When the screen painted a fresh grid — a library reload, a delete, a
  changed query — every one of those belonged to nodes that had just left the document, and the gesture kept
  hit-testing and auto-scrolling against a grid it never measured.
- `swapIn()` is the one place the markup is replaced (grid, albums, empty state, search results), so it now calls a
  new `resetDrag()` before the old nodes are removed. `resetDrag()` ends the gesture only when something is actually
  in flight — a drag, a capture, an auto-scroll or an armed long press — so a repaint that keeps its tiles, and the
  `.on`-only `paintSel` path, are untouched and a drag still runs through them.
- Same tiles, same header, same gestures.
- `tools/test_suite.js` gains two checks that pin it: one starts a real drag across the grid, re-renders under the
  finger (the path a reload or a delete takes) and moves onto a tile the drag never measured, reading that nothing
  more is painted and the drag, capture and auto-scroll state are cleared; the other holds the shape — the guarded
  teardown and its call site ahead of the node removal.
- 49 checks in `tools/test_suite.js`, all PASS.

### 1.4.6 — day 5 of the 20-day optimisation plan, twenty-eighth pass
No UI change, no new features. Item 46 of the plan: the selection count stays in sync when the list changes under it.
- A selection is a set of photo ids, and nothing re-checked that those ids were still in the list on screen. A
  library reload after a delete or a resume, and a search query or a chip typed under an open selection, left the
  title counting photos that were no longer there — "4 selected" with one tile painted — and the selection bar
  acted on those ids too.
- `syncSel()` now drops the ids that have left the current list (it takes the list when the caller already has it)
  and `selTitle()` rewrites the title from what is left, so the count always describes the tiles that are actually
  selected and visible. A selected photo that is still in the list keeps its `.on` state.
- Both render paths call it before they paint — `renderScreen()` for the grid and the album screens, and
  `renderResults()` for a query or a chip — so the count is re-derived on every render rather than only when a tile
  is tapped. Same header, same tiles, same gestures.
- `tools/test_suite.js` gains two checks that pin it: one long-presses a real search result, narrows the query until
  that photo drops out of the results, and reads the title ("1 selected" -> "Select items", tile unpainted), the
  other holds the shape — the prune against the live list and the two guarded call sites.
- 47 checks in `tools/test_suite.js`, all PASS.

### 1.4.5 — day 5 of the 20-day optimisation plan, twenty-seventh pass
No UI change, no new features. Item 45 of the plan: a long press starts the selection on the press, and the release does not select again.
- The 430 ms timer was armed only outside selection mode. Inside it the press armed nothing, so holding a finger on
  a tile produced no feedback at all: the tile was selected by the `click` that arrived when the finger came off,
  and the selection appeared to start on the release rather than on the press.
- The timer is now armed once, before the selection-mode branch, so the gesture is the same in both modes and does
  all of its work when it fires — enter selection mode, then select the tile under the finger exactly once, at 430 ms.
- The release is then only a release. The `lpFired` flag that the timer sets is what the click handler already
  checks, so the click a lift produces is swallowed instead of toggling the same tile back off; holding a selected
  tile deselects it once, on the press, and the lift leaves it that way.
- A press that turns into a drag drops the timer as soon as the 6 px threshold is crossed, so a slow drag-select is
  never mistaken for a hold. Same tiles, same swipe-right select-all, same auto-scroll, same tap behaviour.
- `tools/test_suite.js` gains two checks that pin it: one holds a real pointer for 650 ms and reads the grid while
  the pointer is still down (selection mode entered and the tile painted, nothing more on release, and the same for
  a deselect), the other holds the shape — one arming site ahead of the mode branch, `toggleSel(id)` in the timer,
  the `lpFired` guard in the click, and the timer dropped past the drag threshold.
- 45 checks in `tools/test_suite.js`, all PASS.

### 1.4.4 — day 5 of the 20-day optimisation plan, twenty-sixth pass
No UI change, no new features. Item 44 of the plan: a drag-select no longer starts on a tap.
- In selection mode the `pointerdown` on a tile painted that tile immediately and took the pointer capture with
  it, so a drag-select began before the finger had moved at all. Two things followed: a finger that only meant to
  scroll the grid painted the tile it started on, and a tap was answered on the way down while the click that
  followed could not toggle it back — the capture had retargeted that click to the scroller, where it hit nothing.
- The tile under the finger is still chosen on `pointerdown` (its on/off state is decided before anything can
  change), but nothing is painted and no capture is taken until the pointer has travelled the 6 px threshold in
  `pointermove`. The first frame past the threshold takes the capture and paints the anchor tile once, so the rest
  of the drag behaves exactly as before.
- A tap therefore ends up in the click handler, which owns it again: one toggle per tap, and a tap that never moves
  selects nothing on the way down. Same tiles, same swipe-right select-all, same edges, same auto-scroll.
- `tools/test_suite.js` gains two checks that pin it: one drives a real tap and a real 40 px drag in headless
  Chromium (tap toggles once, 3 px selects nothing, the drag paints), the other holds the shape — no `setSel` or
  `setPointerCapture` in the `pointerdown` branch, and the paint after the 6 px guard.
- 43 checks in `tools/test_suite.js`, all PASS.

### 1.4.3 — day 5 of the 20-day optimisation plan, twenty-fifth pass
No UI change, no new features. Item 43 of the plan: an in-flight drag is cancelled when the browser takes the pointer.
- A `pointercancel` is the browser withdrawing the gesture — it started a native scroll, the app went to the
  background, a system gesture won. No `pointerup` follows it, so the drag stayed in flight: its pending frame still
  ran `hitTile()` and toggled the tile under the last known position, and the edge auto-scroll interval could be
  started again by a stray move.
- The scroller only saw that cancel when the pointer had been captured to it or was still over it; when
  `setPointerCapture` had not taken, the cancel landed on whatever was under the finger and nothing tore the drag
  down. The window now listens for `pointercancel` in the capture phase and ends the drag from anywhere, and the
  cancelled pointer's id is checked first, so a second finger being cancelled does not end the drag that is running.
- `endDrag()` also releases the capture it took, so the scroller stops receiving every later pointer event after a
  drag, and the drag's pointer id is cleared with it.
- Dragging is unchanged: the same tiles toggle, the same swipe-right select-all, the same edges auto-scroll.
- `tools/test_suite.js` gains a check that pins it: the window-level capture listener, the pointer-id guard, the
  release in `endDrag`, and the scroller's own `pointercancel` listener all have to stay.
- 41 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS on 240 photos.

### 1.4.2 — day 5 of the 20-day optimisation plan, twenty-fourth pass
No UI change, no new features. Item 42 of the plan: the edge auto-scroll stops when the pointer leaves the screen.
- A drag that reached the top or bottom edge of the grid started a 16 ms `setInterval` that scrolled 14 px a step.
  The interval was only ever reset or cleared by the next `pointermove` — and once the pointer leaves the window
  there is no next `pointermove`, so the grid kept scrolling on its own until the finger came back or was lifted.
- The scroll step now runs through `autoStep(dir)`, which re-checks the last known pointer position against the
  viewport on every tick and clears the interval the moment it is outside (`px`/`py` < 0 or beyond `innerWidth`/
  `innerHeight`). The window's own `pointerleave` and `blur` (capture phase) clear it as well, and so does a
  `visibilitychange` that hides the page, so a drag interrupted by leaving the app or locking the screen no longer
  leaves a scroll loop running behind it.
- Dragging inside the grid is unchanged: the same edges start it, the same 14 px per 16 ms speed, the same tiles
  toggle as they pass under the pointer, and a pointer that stays inside the viewport scrolls exactly as before.
- `tools/test_suite.js` gains a check that pins it: the scroll step is the guarded `autoStep`, the frame starts it
  for both edges, and the boundary, blur and visibility listeners are present.
- 40 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS on 240 photos.

### 1.4.1 — day 5 of the 20-day optimisation plan, twenty-third pass
No UI change, no new features. Item 41 of the plan: drag-select hit-tests the tile it already knows.
- Every drag frame used to call `document.elementFromPoint` at the pointer, then walk up to the enclosing `.tile`,
  even when the pointer had not left the tile found on the previous frame — a full hit test per frame for a pointer
  that is often sitting still or crawling inside one tile.
- `hitTile()` now remembers the box it measured for the last tile and answers from it while the pointer is still
  inside that box, the tile is still connected and the scroller has not moved under it (`scrollTop`/`scrollLeft`
  unchanged). Anything else — the pointer crossing into another tile, a re-render, an auto-scroll step — re-measures
  once with `elementFromPoint` and caches the new box, so the fallback still resolves the tile the pointer is over.
- Selection behaves exactly as before: same tiles toggle, same swipe-right select-all, same auto-scroll edges; only the
  per-frame cost of asking the DOM which tile is under the finger is gone.
- `tools/test_suite.js` gains a check that pins it: the drag frame calls `hitTile(drag)` and contains no
  `elementFromPoint`, the cached box is gated on `isConnected`, containment and unchanged scroll, and the page keeps
  exactly two `elementFromPoint` sites (the prefetch probe and the fallback).
- 39 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS on 240 photos.

### 1.4.0 — day 5 of the 20-day optimisation plan, twenty-second pass
No UI change, no new features. Item 40 of the plan: the JS bridge exposes only what the page calls.
- The `AndroidNative` bridge carried a twelfth method, `info(String)`, that relayed a string into `Log.i`. The page
  never called it: every bridge call it makes is one of `meta`, `access`, `requestAccess`, `photos`, `favs`,
  `setFav`, `share`, `delete`, `setTilt`, `pick`, `theme` — `parse`/`stringify` are the JSON shims, not the bridge.
- The method and its `@JavascriptInterface` annotation are gone, so the WebView no longer publishes a channel the
  page never opens and nothing can be routed into the log by a name nobody checks.
- The test harness stubs (`tools/test_suite.js`, `tools/test_ui.js`, `tools/bench_first_frame.js`) drop the same
  `info(){}` from their mock bridge, so the stub matches the real surface exactly.
- `tools/test_suite.js` gains a check that pins it: exactly eleven `@JavascriptInterface` methods, no `info(String)`,
  and every exposed method present in the set the page actually calls.
- 38 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS on 240 photos.

### 1.3.9 — day 4 of the 20-day optimisation plan, twenty-first pass
No UI change, no new features. Item 39 of the plan: text autosizing stays off across a reload.
- `WebSettings.setTextZoom(100)` pins Chromium's font-boosting multiplier, but the pin only lived in the settings
  block: the manifest absorbs `fontScale` and `density` changes, so a user who raised the system text size while the
  app was running got no new activity and no new WebView — the same view was re-laid out and re-derived its text
  scale from the new configuration, inflating text the page sizes in px.
- The pin is now re-applied on the live view from `onConfigurationChanged`, before that re-layout, and it still goes
  through the one `createWeb()` block that both the launch path and the renderer-recovery path share, so a rebuilt
  WebView is pinned before its first load.
- The page itself declares `-webkit-text-size-adjust:100%` / `text-size-adjust:100%` on `html,body` — the CSS
  default — so a reload of any kind (the main-frame retry, a rebuilt WebView, a fresh document) cannot bring
  boosting back. Nothing is drawn differently at 100%.
- `tools/test_suite.js` gains a check that pins it: two `setTextZoom` sites (the settings block and the re-pin),
  both at 100, the re-pin behind the live-view guard, and both `text-size-adjust` declarations in the page.
- 37 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS on 240 photos.

### 1.3.8 — day 4 of the 20-day optimisation plan, twentieth pass
No UI change, no new features. Item 38 of the plan: nothing calls into a destroyed WebView any more.
- Every call the app makes into the page is asynchronous — an insets push, an IME push, a resume eval, a back-press
  — so a `Runnable` posted before `onDestroy()` tore the view down could still be sitting on the UI queue when it
  ran. `evaluateJavascript()` on a destroyed WebView throws inside the framework, on the UI thread, where nothing
  catches it. The back-press was the worst of the four: it called in with no check at all.
- All four call sites now go through one `evalOn(js, cb)`, which re-reads the field and a `webGone` flag at the
  moment of the call — a check made earlier cannot see the destroy — and swallows the throw for the window between
  the two. `onDestroy()` raises the flag before destroying and clears the field afterwards, so from then on the
  null check answers on its own.
- A back-press with no live page finishes the activity instead of calling into nothing. Nothing the page receives
  changed: the same four scripts, in the same order, with the same callback.
- `tools/test_suite.js` gains a check that pins it: one `evaluateJavascript` call site, three guarded evals plus the
  back-press, the flag raised before the destroy, and the page-less back-press leaving the app.
- 36 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.3.7 — day 4 of the 20-day optimisation plan, nineteenth pass
No UI change, no new features. Item 37 of the plan: a failed main-frame load is retried instead of leaving Chromium's own error page on screen.
- The start page is served by the app itself, so a main-frame load can still fail before the page ever runs: the asset
  stream will not open, the renderer is still coming up, or the surface is handed back mid-load. Chromium then paints
  its error page — and this app's page owns every control, so that page is a dead screen with no way back short of
  killing the app.
- `WebViewClient.onReceivedError` is now handled for the main frame: a failed load of the start URL is reloaded once,
  through the same intercept path and with the same UI, so the grid comes back by itself.
- The retry is bounded — one per load, re-armed only when a page actually finishes — so an asset that is genuinely
  broken cannot spin. It ignores sub-resource failures (the grid already draws a tile for a thumb that will not
  decode), a callback from a WebView the activity has already replaced, and the cancelled loads Chromium reports as
  `ERROR_UNKNOWN`, which are not failures at all.
- `tools/test_suite.js` gains a check that pins it: the main-frame, host, stale-view and single-retry guards all come
  before the reload, the reload is the start URL, `ERROR_UNKNOWN` is excluded, and the flag is re-armed by
  `onPageFinished`.
- 35 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.3.6 — day 4 of the 20-day optimisation plan, eighteenth pass
No UI change, no new features. Item 36 of the plan: a dead renderer no longer takes the app with it.
- The WebView renders the page in its own process, and the system kills that process whenever it needs the memory
  (or a bad page crashes it). `WebViewClient.onRenderProcessGone` defaults to returning `false`, which means the app
  is killed alongside it: the grid, the open tab and any open viewer disappear because a process the user never saw
  died. Returning `true` keeps the app alive, but leaves a WebView that can never be used again.
- The activity now answers `true`, removes the dead WebView from the tree, destroys it, and installs a freshly built
  one in the same `FrameLayout` — same layout params, same IME padding, same start URL. Nothing on screen moves:
  settings and favourites are persisted, the media query and the thumbnail caches are untouched, and the page
  restores its insets from `meta()` as it boots, so the recovered frame is the one that was on screen.
- Every `WebSettings` call, the JS bridge and the `WebViewClient` now live in one `createWeb()` that both `onCreate`
  and the recovery path call, so a setting added to one cannot go missing from the other. The override sits in
  `RecoverClient`, instantiated only on API 26+ — the callback and its parameter type do not exist below 26, so a
  device that lacks them never resolves the class and keeps the plain client.
- `tools/test_suite.js` fails if the handler returns `false`, if the dead view is reused instead of destroyed and
  replaced, if the recovery path stops reloading the start URL or drops the IME padding, or if the client stops
  being chosen by API level.

### 1.3.5 — day 4 of the 20-day optimisation plan, seventeenth pass
No UI change, no new features. Item 35 of the plan: the frame before the page paints now belongs to the theme the page is about to use.
- The window background, the root `FrameLayout` and the `WebView` were all one hardcoded `#0B0B1A`. That is the dark
  theme's colour, so in Light theme the surface the system paints before the page has drawn — a cold start, a reload,
  or a surface handed back on resume — put a dark frame over a `#E9ECFF` page: a visible flash of the wrong theme.
- All three layers now take the colour of the persisted theme (`BG_DARK` / `BG_LIGHT`, matching `body` and
  `body.light` in `index.html`), set once before `setContentView` and again from `theme()` when the user switches, so
  the pre-paint frame and the page always agree.
- `tools/test_suite.js` fails if a literal colour returns, if any of the three layers stops following the theme, if the
  helper moves behind `setContentView`, or if `theme()` stops re-applying it.

### 1.3.4 — day 4 of the 20-day optimisation plan, sixteenth pass
No UI change, no new features. Item 34 of the plan: the WebView no longer keeps an offscreen raster of the whole page.
- `setOffscreenPreRaster(true)` is the platform default, and it makes the WebView hold a rasterised copy of the
  entire document at screen resolution on top of the live render, so a stale frame can be shown while a resized or
  scrolled region is redrawn. For a photo grid that is a second full-screen bitmap — roughly 8 MB at 1080×2400
  ARGB_8888 — held for the life of the process, bought with memory the thumbnails need.
- The setting is now `false`, so only the live layer is kept. Every other `WebSettings` call is unchanged and in the
  same order, and no response, asset or bridge path moved. The visible cost is at most one frame where a redrawing
  region shows the previous frame instead of a scaled copy of it.
- `tools/test_suite.js` fails if the call disappears, if it is set back to true, or if a second one appears.

### 1.3.3 — day 4 of the 20-day optimisation plan, fifteenth pass
No UI change, no new features. Item 33 of the plan: no media request may leak a file descriptor.
- Every `/media/` response wraps the gallery's `AssetFileDescriptor` in a `FileInputStream` and
  hands it to the WebView as the body, so the WebView closes it when the bytes have been read.
  A stream that is never handed to a response is never closed by anyone — and the error path did
  exactly that: a malformed `Range` header (`Long.parseLong` throws on `bytes=-`, which Chromium
  does send), a failed seek, or a `FileInputStream` that would not build reached the `catch` with
  the descriptor already open and returned 404 without releasing it. Nothing else knew about that
  descriptor, so it stayed open for the life of the process — one per request, until the process
  ran out of descriptors.
- Both handles are now declared before the `try` and released in the `catch` by `releaseMedia()`:
  it closes the `FileInputStream` (which closes the `AssetFileDescriptor` it was built on) and
  then the descriptor itself, each in its own guarded `try`, because a provider may already have
  released it or the stream may never have been built. The success path is untouched: the three
  responses that hand the stream out still own the close, and every status code, header value and
  body is unchanged.
- Audited the rest of the request path for the same shape: `asset()` opens one asset stream and
  returns it in the response with no fallible step in between, and the thumbnail path decodes
  through `close()`d streams already. `/media/` was the only site that could open a descriptor and
  then return without handing it out.
- `tools/test_suite.js` gains a check that pins it: both handles declared outside the `try`, the
  release before the 404 in the `catch`, exactly one `openAssetFileDescriptor` site, and exactly
  three `return`s after the descriptor opens — all three of them handing the stream to a response
  (31 checks now).
- 31 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.3.2 — day 4 of the 20-day optimisation plan, fourteenth pass
No UI change, no new features. Item 32 of the plan: a `shouldInterceptRequest` fast path for
`favicon.ico`.
- Chromium requests `/favicon.ico` on the first paint, and the app ships no icon. The request
  missed the asset table, so it fell through to the `index.html` fallback: the whole app was
  opened from the APK, streamed back and discarded as an icon — on every launch and every reload.
- That path is now answered `204 No Content` before any asset lookup, with no body and no content
  type, which is the answer a browser already gives for a site with no icon.
- The header pair never varies, so the 204 reuses one unmodifiable `NO_CONTENT_HEADERS` map built
  at class load (`Cache-Control: no-store`, `Content-Length: 0`) instead of allocating one per
  request; `no-store` keeps the absence from being cached as if it were a file.
- Nothing else changed: every other path, status code, header value and body is untouched, and no
  screen, control or gesture moved.
- `tools/test_suite.js` gains a check that the favicon branch sits before `asset()`, that the 204
  keeps its shared map and that the map is not allocated per request.
- 30 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.3.1 — day 4 of the 20-day optimisation plan, thirteenth pass
No UI change, no new features. Item 31 of the plan: reuse a single `WebResourceResponse`
header map where safe.
- Every response used to build its own `HashMap` and put the same two or three constant headers
  into it, on the request thread, once per request: a launch paid that for `index.html`, and
  again for every miss that fell through to the 404. Those shapes now share one map, built once
  at class load.
- A shared map is only safe because nothing can write to it afterwards, so each one is wrapped
  in `Collections.unmodifiableMap` before it is published: the WebView reads headers off the UI
  thread while the response streams. The 404 keeps its `no-store` / `Content-Length: 0` pair,
  assets keep `Content-Type: <mime>; charset=utf-8` / `no-cache`, and media keeps
  `Accept-Ranges` / `Content-Type` / `Cache-Control`.
- The responses whose headers depend on the request still build their own map — a thumb's
  `Content-Length`, a media range's `Content-Range` and `Content-Length` — because reusing a
  mutable map there would race the reader.
- Every header value, status code and body is unchanged; `tools/test_suite.js` gains a check
  that the fixed shapes carry no per-request `HashMap` and that the shared maps are unmodifiable.
- 29 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.3.0 — day 4 of the 20-day optimisation plan, twelfth pass
No UI change, no new features. Item 30 of the plan: log the query duration behind
`Log.isLoggable(DEBUG)`.
- The MediaStore scan is the one part of the first frame that was never measured, which makes a
  slow cold start ambiguous: it could be the provider walking a 6000-row library, or the decode
  path behind it. `queryMedia()` now reads `Log.isLoggable(TAG, Log.DEBUG)` once and, only when
  debug logging is on, takes a `System.nanoTime()` before `queryOne()` and prints a single
  `Log.d` line — `query 1234 rows in 87 ms` — after the sort.
- The guard is the whole point: a normal run does one boolean read, no clock call, no string
  concatenation and no log line, and the query, its projection, its paging and its order are
  byte-for-byte unchanged. Turn it on with
  `adb shell setprop log.tag.LGP DEBUG`.
- `tools/test_suite.js` gains a check that the clock read and the log line both sit inside the
  guard and that no second unguarded `Log.d` exists anywhere in the bridge (28 checks now).
- 28 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.2.8 — day 3 of the 20-day optimisation plan, eleventh pass
No UI change, no new features. Item 28 of the plan: close cursors in a `finally` on every path.
- The library query holds one `Cursor` per page, and a leaked one leaks a `CursorWindow` and a
  provider-side file descriptor with it. The audit walked every exit from the page: the provider
  handing back a null cursor, a row that throws mid-read, a `getColumnIndexOrThrow` failing after
  the window is open, and the plain early return at the end of the page. All of them unwind through
  the same `finally`, which sits outside the `try` and therefore sees the cursor whichever way the
  page ends.
- The close itself is now guarded: a provider that throws out of `close()` used to escape the
  `finally` and turn a page that had already been read into a failed query, so the close is wrapped
  and its failure dropped, the way the other stream closes in the bridge already are.
- `tools/test_suite.js` gains a check that pins the shape: exactly one `Cursor` in the file, declared
  before the `try`; every `query()` call inside that one method; the row loop inside the `try`; and
  no `close()` anywhere outside a `finally` (26 checks now).
- 26 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` all PASS.

### 1.2.7 — day 3 of the 20-day optimisation plan, tenth pass
No UI change, no new features. Item 27 of the plan: handle a null `BUCKET_DISPLAY_NAME` without
allocating a string per row.
- `BUCKET_DISPLAY_NAME` is null on rows the provider has no album for, and the provider hands back
  a freshly allocated `String` for every other row even when a thousand of them name the same
  album. A 6000-row library therefore held up to 6000 bucket strings, all of them duplicates, all
  of them live for as long as the grid is.
- Rows with no bucket now point at one shared `EMPTY` constant instead of building a literal, and
  every repeated album name is pooled on the first instance seen in that query, so the same album
  is one string no matter how many photos it holds. The pool lives for one query and is dropped
  with the cursor.
- The value each row carries is unchanged — `""` for a row with no album, the album name otherwise
  — so the album filters, the camera/screenshot tests, the search haystack and the detail sheet read
  exactly what they read before.
- `tools/test_suite.js` gains a check that pins the shared constant, the pooling and the absence of
  a per-row string build in the row loop (25 checks now).
- 25 checks in `tools/test_suite.js`, all PASS.

### 1.2.6 — day 3 of the 20-day optimisation plan, ninth pass
No UI change, no new features. Item 26 of the plan: sort by `DATE_TAKEN` when available,
`DATE_MODIFIED` otherwise.
- The library was ordered by `DATE_MODIFIED`, which is the file's timestamp, not the moment the
  photo was taken. Any file that had been touched — edited, re-saved, restored from a backup,
  copied off a card — carried a fresh modification time and jumped to the top of the grid, and its
  day header said "Today" for a picture from 2019.
- `DATE_TAKEN` is now projected alongside `DATE_MODIFIED` and read once per row, and it wins
  whenever it is non-zero. Rows with no capture time (screenshots, downloads, imported files, older
  media) fall back to `DATE_MODIFIED` exactly as before, so no photo loses a date and the order
  stays total. Both columns are milliseconds once normalised: `DATE_TAKEN` already is,
  `DATE_MODIFIED` is multiplied by 1000 as it always was.
- The provider sort string is deliberately left as `DATE_MODIFIED DESC`. That column is never null
  and the provider only accepts plain column names in a sort order, so paging and the 6000-row
  ceiling still return exactly the rows they returned before — the capture date only reorders what
  came back, in the comparator that already sorted on the effective date.
- The on-disk thumbnail stays keyed on `DATE_MODIFIED` (kept in its own `modified` field), so an
  edit still invalidates the cached thumb even though the capture date does not move.
- `tools/test_suite.js` gains a check that pins the projection, the millisecond handling, the
  fallback expression, the `modified`-keyed thumb stamp and the untouched provider sort (24 checks
  now).
- 24 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.5 — day 3 of the 20-day optimisation plan, eighth pass
No UI change, no new features. Item 25 of the plan: skip pending (`IS_PENDING=1`) media so a
half-written import never appears.
- The importer writes a MediaStore row with `IS_PENDING = 1`, copies the bytes, then clears the
  flag. Until it does, the provider happily returns that row to a query, so a photo still being
  written showed up in the grid as a blank or half-drawn tile, and its `/thumb/` request answered
  404 because the file was not complete yet.
- The page query now carries `is_pending = 0` on API 29+, where the column exists, ANDed onto the
  existing `is_trashed = 0` term on API 30+. The provider filters both before the `LIMIT`/`OFFSET`,
  so a page still returns 1000 usable rows and the 6000-row ceiling still counts real photos. The
  projection, the sort and the row loop are untouched, and the pending row appears on the next
  query once the import finishes.
- Below API 29 there is no `IS_PENDING` column, so the selection is exactly what it was.
- `tools/test_suite.js` gains a check that pins the selection order (`is_trashed = 0 AND
  is_pending = 0`), the API gates and the fact that the pending term never leaks into the row loop
  (23 checks now).
- 23 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.4 — day 3 of the 20-day optimisation plan, seventh pass
No UI change, no new features. Item 24 of the plan: skip trashed media through the `IS_TRASHED`
column on API 30+.
- Android 11 added a recycle bin. A photo the user sends to the bin keeps its MediaStore row until
  the bin is emptied, and that row was still being returned by the library query, so deleted
  pictures sat in the grid. Each page query now carries a `QUERY_ARG_SQL_SELECTION` term of
  `is_trashed = 0` on API 30+, which the provider applies before the `LIMIT`/`OFFSET`, so the
  paging still returns 1000 usable rows per page and the 6000-row ceiling now counts real photos
  instead of tombstones.
- The filter costs nothing per row here: the provider drops the trashed rows while building the
  cursor, so no extra column is projected and the row loop is untouched. Below API 30 there is no
  `IS_TRASHED` column and no recycle bin, so the query is byte-for-byte what it was.
- Fixed the last flaky check in the suite: "every thumb response sends Content-Length" counted the
  responses as soon as the tiles were laid out, while their images were still in flight, so a fast
  machine measured 0/0 and failed. It now waits for the first `/thumb/` response before counting
  (60/60 on every run).
- 22 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.3 — day 3 of the 20-day optimisation plan, sixth pass
No UI change, no new features. Item 23 of the plan: a paging strategy for libraries over 6000
items.
- `queryOne()` used to ask MediaStore for the whole library in one cursor and stop reading after
  6000 rows. The provider still had to build a cursor over every photo on the device, so a 40 000
  photo library cost a full result set to deliver the newest 6000. It now reads in pages: each
  query carries `QUERY_ARG_LIMIT` of 1000 rows and a `QUERY_ARG_OFFSET`, and the loop stops on the
  first short page. The ceiling is the same `MEDIA_MAX_ITEMS = 6000` and the sort is the same
  `DATE_MODIFIED DESC`, so the grid shows exactly the same photos in the same order.
- Paging needs `ContentResolver` query args, which arrive in API 26, so below that the old single
  capped query stands unchanged — API 24-25 devices behave exactly as before.
- A page that throws still ends the read with a warning rather than retrying forever, and every
  cursor is still closed in `finally`.
- `tools/test_suite.js` gains a check that the constants, the query args and the short-page break
  are all present (22 checks now).
- Fixed a flaky check in the suite itself: "every thumb response sends Content-Length" reused
  thumbnail URLs that earlier pages in the same browser had already cached, so no response event
  fired and it counted 0/0. That page now runs with the cache disabled, which measures the
  responses the app actually makes (60/60).
- 22 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.2 — day 3 of the 20-day optimisation plan, fifth pass
No UI change, no new features. Item 22 of the plan: `Cursor.getColumnIndex` stays outside the row
loop.
- `Cursor.getColumnIndex` is not a field read — it walks the projection on every call, so a lookup
  written inside the row loop costs eight projection scans per photo. `queryOne()` already hoisted
  all eight lookups above the first `moveToNext()`, and the audit confirms it: one cursor loop in
  the whole file, eight lookups, all of them before the loop and none inside it. Nothing to move,
  so nothing was moved.
- What did change is that the hoisting is now pinned. A new check in `tools/test_suite.js` finds
  every `while`/`for` whose header calls `moveToNext()`, matches its braces to get the loop body,
  and fails if a `getColumnIndex` appears in any of those bodies or after the first loop starts.
  The lookups carry a comment saying why they sit where they do.
- 21 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.1 — day 3 of the 20-day optimisation plan, fourth pass
No UI change, no new features. Item 21 of the plan: the library query projects only the columns
it reads.
- `queryOne()` asked MediaStore for eight columns. This pass audited each one against its consumer
  in the row loop and found every one of them live: `_ID` (identity, thumb URL, delete URI),
  `DISPLAY_NAME` (name), `DATE_MODIFIED` (sort key, day grouping, disk-thumb stamp), `SIZE` (info
  sheet and the `Content-Length` fallback when the provider reports no length), `MIME_TYPE`
  (response type, HEIF test, share type), `WIDTH`/`HEIGHT` (the decode size hint and the info
  sheet) and `bucket_display_name` (albums). Dropping any of them would have changed what the
  info sheet shows, so nothing was dropped — the projection was already minimal.
- What did change is that it can no longer drift: the projection is now commented column by column,
  and a new check in `tools/test_suite.js` parses `proj` and fails if a projected column has no
  `getColumnIndex` lookup, or if a lookup variable is declared and then never read. A dead column
  is a per-row Cursor read paid for nothing, so it now breaks the suite instead of shipping.
- 20 checks in `tools/test_suite.js`, all PASS; `tools/test_ui.js` PASS on 240 photos.

### 1.2.0 — day 2 of the 20-day optimisation plan, tenth pass
No UI change, no new features. Item 20 of the plan: HEIC/HEIF decodes on API 28+ and is refused
cleanly below it instead of being retried on every scroll.
- `ImageDecoder` is the only decoder on the platform that reads HEIC/HEIF, and it only exists from
  API 28. On API 24-27 `BitmapFactory` cannot read the format at all: it opened the stream, failed
  and threw the descriptor away — once per request, so a tile that came back into view paid for the
  same doomed decode again, and again.
- `thumbnail()` now checks the mime MediaStore already reported for the row (`isHeif()`: `image/heic`,
  `image/heif` and the two `-sequence` variants). Below API 28 a HEIF row returns null before any
  cache probe or stream open, and the id is remembered in a bounded set (`heifUnsupported`, cleared
  at 512 entries) so later requests for it cost nothing. The response is the same 404 an unreadable
  photo already gets, so the tile stays empty exactly as it does today — no placeholder, no change
  to the grid, the glass or any gesture.
- On API 28+ nothing is refused: `ImageDecoder` gets the file first as before. If it fails on a
  HEIF row the `BitmapFactory` fallback is now skipped rather than opening the same stream to fail
  the same way, so a broken HEIC costs one attempt instead of two.
- Two new checks in `tools/test_suite.js` audit the decode path: one fails if the pre-28 guard moves
  below the stream open, if the remembered set disappears, or if the mime test stops covering the
  HEIF family; the other fails if `ImageDecoder` stops being tried first or if a HEIF failure can
  still reach `BitmapFactory`. 19 checks, all PASS.

### 1.1.9 — day 2 of the 20-day optimisation plan, ninth pass
No UI change, no new features. Item 19 of the plan: the grid warms the next screen of thumbnails
while you scroll, so a fast flick lands on tiles that are already decoded.
- A tile only asks for its thumbnail when the browser decides the image is close to the viewport.
  On a quick scroll the decoder is still behind, so the tiles that arrive next paint blank for a
  moment and then pop in.
- `index.html` now has a prefetch step behind a flag (`PRE`, default on; `window.__noPre` turns it
  off). On a scroll frame it finds the last tile on screen (the same `elementFromPoint` probes the
  drag-select code uses), takes the items after it in the current list and requests their
  thumbnails through `new Image()` — up to one screen (`PRE_SCREEN`, 24 tiles) ahead and at most
  `PRE_MAX` (12) requests per frame, each id only once.
- It costs one probe per animation frame and only when the scroll position actually changed, so an
  idle grid does nothing. It never runs while a sheet or the viewer is open (the probe does not hit
  a tile), never on the albums or search screens, and it never touches the DOM — the markup, the
  glass, the animations and every gesture are byte for byte what they were.
- Measured on a 200-photo library in headless Chromium: after a 3000 px jump, 11 thumbnails had
  already been requested in the first 120 ms with the prefetch on, against 6 with it off, all of
  them for tiles still below the fold. `tools/test_suite.js` is unchanged at 17 checks, all PASS.

### 1.1.8 — day 2 of the 20-day optimisation plan, eighth pass
No UI change, no new features. Item 18 of the plan: an `OutOfMemoryError` in the thumbnail decode is
contained and answered with a 404 instead of taking the app down.
- `thumbnail()` caught every failure with a single `catch (Throwable t)`, which returned null for an
  `Error` as well as an `Exception`. That kept the process alive but left the heap in exactly the
  state that caused the failure, so the next tile hit the same wall.
- The decode path now catches `OutOfMemoryError` on its own, before the general handler: it drops
  the in-memory thumbnail cache (`dropThumbCache()`, which frees the byte-bounded 12 MB LRU and
  resets the byte count) so the following decode has heap to work with, logs the media id, and
  returns null — so `shouldInterceptRequest` answers `404` with `Content-Length: 0` and
  `Cache-Control: no-store`, exactly like any other photo that cannot be read. Nothing is scaled,
  compressed, cached or written to disk for it, and the disk cache is left alone since it costs no
  heap and is still correct.
- `ImageDecoder`'s fallback is unaffected: its handler catches `Exception`, so an `Error` propagates
  straight to the guard instead of triggering a second, larger allocation on the `BitmapFactory`
  path. The UI, the glass and every gesture are untouched.
- One new check in `tools/test_suite.js` audits the decode path and fails if the `OutOfMemoryError`
  handler disappears, if it stops freeing the cache, or if the 404 return moves above it. 17 checks,
  all PASS.

### 1.1.7 — day 2 of the 20-day optimisation plan, seventh pass
No UI change, no new features. Item 17 of the plan: media too small to be a photo is skipped instead
of being upscaled into a 1×1 thumbnail.
- A truncated or half-written image can make the decoder return a degenerate frame. The scale step
  clamped that to `Math.max(1, …)`, so it became a 1×1 JPEG that was compressed, cached in memory,
  written to the disk cache and served as a 200 — a flat grey tile that stayed wrong on every later
  run, including after a cold start read it back.
- `thumbnail()` now refuses anything whose longest side is under `THUMB_MIN_PX` (48 px) and returns
  null, so the response is a 404 and the tile simply stays empty. The guard runs twice: once against
  the `WIDTH`/`HEIGHT` columns MediaStore already reported, before any cache read or stream open (so
  a stale tiny thumb from an older build is not served either), and once against the decoded bitmap,
  before it is scaled, compressed, cached or written to disk.
- One new check in `tools/test_suite.js` audits the decode path and fails if the floor moves, if
  either guard disappears, or if scaling or caching is reachable before the guard. 16 checks, all PASS.

### 1.1.6 — day 2 of the 20-day optimisation plan, sixth pass
No UI change, no new features. Item 16 of the plan: thumb responses are marked `Cache-Control:
immutable`.
- A `/thumb/<id>` URL is stable for a media id and the bytes behind it only change when the photo is
  re-imported under a new id, so the 200 now carries `Cache-Control: public, max-age=31536000,
  immutable` and the WebView stops re-asking for a thumb it already has. The 404 fallback is marked
  `no-store` so a thumb that failed to decode is retried next time instead of being remembered as
  permanently missing.

### 1.1.5 — day 2 of the 20-day optimisation plan, fifth pass
No UI change, no new features. Item 15 of the plan: every thumb response carries a `Content-Length`,
and the suite now proves it.
- The 200 response for `/thumb/<id>` already sent the JPEG length; the 404 fallback used when a
  thumbnail cannot be decoded returned an empty body with no length at all. It now sends
  `Content-Length: 0`, so no thumb response is ever length-unknown — Chromium can size the tile
  without waiting for the stream to close.
- Two new checks in `tools/test_suite.js`: one drives the grid and asserts that every `/thumb/`
  response the page receives carries a `Content-Length` that matches the bytes delivered (60/60 in
  the current run), and one audits `MainActivity.java` so the native 200 and 404 paths cannot lose
  the header without failing the suite. The suite is now 15 checks, all PASS.

### 1.1.4 — day 2 of the 20-day optimisation plan, fourth pass
No UI change, no new features. Item 14 of the plan: decoded thumbnails are cached on disk, so a cold
start is not blank.
- Every thumbnail was already a small JPEG byte array in memory; it is now also written to a
  byte-bounded LRU directory (`getCacheDir()/thumbs`, 12 MB) named `<id>-<DATE_MODIFIED>.jpg`. A fresh
  process reads the bytes straight back, so the first screen of tiles paints without opening MediaStore
  or waking the decoder at all.
- Writes go to a temp name and are renamed into place, so a process that dies mid-write cannot leave a
  truncated JPEG for the next cold start. The directory is trimmed least-recently-used first, every 64
  writes, and a read refreshes the entry's timestamp at most once a minute.
- The file name carries the media's `DATE_MODIFIED`, so an edited photo does not keep serving its old
  thumbnail; a photo that moved or was deleted simply falls out of the LRU.

### 1.1.3 — day 2 of the 20-day optimisation plan, third pass
No UI change, no new features. Item 13 of the plan: the bounds pass in the `BitmapFactory` fallback
leaves nothing behind.
- `decodeThumbFactory` reads `outWidth`/`outHeight` from the `inJustDecodeBounds` pass and now recycles
  the bitmap that decode can still hand back the moment the dimensions are taken, so a probe bitmap is
  never alive while the real decode allocates its own buffer. `inBitmap` is cleared on the probe
  options too, so no reuse target is carried into a pass that must not allocate.
- Only the `BitmapFactory` path changes: devices below API 28, and any file `ImageDecoder` throws on.
  Thumbnail bytes, dimensions and quality are identical; the saved allocation is one transient bitmap
  per thumbnail on those paths.

### 1.1.2 — day 2 of the 20-day optimisation plan, second pass
No UI change, no new features. Item 12 of the plan: thumbnails decode through `ImageDecoder` on API 28+.
- `ImageDecoder.decodeBitmap` with an `OnHeaderDecodedListener` does the downscale itself:
  `setTargetSize` clamps the longest side to the same 520 px cap the `BitmapFactory` path uses, and
  `setAllocator(SOFTWARE)` + `setMemorySizePolicy(MEMORY_POLICY_LOW_RAM)` keep the result a mutable
  RGB_565 software bitmap, which is what `compress()` needs and the same config as before.
- `BitmapFactory` (with `inSampleSize` and `inDensity`) is now the fallback: every device below API 28,
  and any file `ImageDecoder` throws on, still decodes exactly as it did in 1.1.1.
- Visible effect, and it is a defect fix rather than a redesign: `ImageDecoder` honours the EXIF
  orientation, so a photo shot in portrait no longer shows up sideways in the grid while the viewer
  shows it upright. Nothing else about the tiles changes.

### 1.1.1 — day 2 of the 20-day optimisation plan, first pass
No UI change, no new features. Item 11 of the plan: thumbnails are now scaled inside the decoder.
- `BitmapFactory.Options` gets `inDensity`/`inTargetDensity` set to the post-sample width and the
  520 px cap, so the decoder produces the final size directly instead of allocating a full-size
  bitmap and copying it through `Bitmap.createScaledBitmap`. One fewer large bitmap per thumbnail,
  and the `createScaledBitmap` path is now only a fallback for when the source dimensions are
  unknown. Thumbnail bytes and image quality are unchanged.

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

---

## ⭐ Like this work? Give it a star

If you like this app and our work, please **star this repository** ⭐ and **[follow technicalnihilist-lgtm on GitHub](https://github.com/technicalnihilist-lgtm)**. If our work isn't for you, that's completely fine — the choice is yours. Thank you for stopping by!

<details>
<summary><b>🌍 Same message in 32 languages (A–Z + Indian languages)</b></summary>

- **A — Arabic** (العربية): ⭐ إذا أعجبك هذا التطبيق وعملنا، فيرجى منح المستودع نجمة ومتابعتنا. وإذا لم يعجبك عملنا، فلا مشكلة على الإطلاق — القرار قرارك. شكرًا لزيارتك!
- **B — Bengali** (বাংলা): ⭐ যদি আপনার এই অ্যাপ এবং আমাদের কাজ ভালো লাগে, তবে অনুগ্রহ করে রিপোজিটরিটিকে একটি স্টার দিন এবং আমাদের ফলো করুন। আমাদের কাজ যদি আপনার পছন্দ না হয়, তাতেও কোনো সমস্যা নেই — সিদ্ধান্ত আপনার। আমাদের পেজে আসার জন্য ধন্যবাদ!
- **C — Chinese** (中文): ⭐ 如果你喜欢这个应用和我们的作品，请给仓库点个星标并关注我们。如果我们的作品不适合你，也完全没关系——选择权在你。感谢你的到访！
- **D — Dutch** (Nederlands): ⭐ Vind je deze app en ons werk leuk? Geef de repository dan een ster en volg ons. Vind je ons werk niets, dan is dat helemaal prima — de keuze is aan jou. Bedankt voor je bezoek!
- **E — English** (English): ⭐ If you like this app and our work, please give the repository a star and follow us. If our work isn't for you, that's completely fine — the choice is yours. Thank you for stopping by!
- **F — French** (Français): ⭐ Si cette application et notre travail vous plaisent, mettez une étoile au dépôt et suivez-nous. Si notre travail n'est pas pour vous, aucun souci — c'est votre choix. Merci de votre visite !
- **G — German** (Deutsch): ⭐ Wenn dir diese App und unsere Arbeit gefallen, gib dem Repository einen Stern und folge uns. Wenn unsere Arbeit nichts für dich ist, ist das völlig in Ordnung — die Wahl liegt bei dir. Danke fürs Vorbeischauen!
- **H — Hindi** (हिन्दी): ⭐ अगर आपको यह ऐप और हमारा काम पसंद है, तो कृपया रिपॉजिटरी को स्टार दें और हमें फॉलो करें। अगर हमारा काम आपके लिए नहीं है, तो भी कोई बात नहीं — यह पूरी तरह आपकी मर्ज़ी है। यहाँ आने के लिए आपका धन्यवाद!
- **I — Indonesian** (Bahasa Indonesia): ⭐ Jika kamu suka aplikasi ini dan karya kami, beri bintang pada repositori ini dan ikuti kami. Kalau karya kami bukan untukmu, tidak masalah sama sekali — itu pilihanmu. Terima kasih sudah mampir!
- **J — Japanese** (日本語): ⭐ このアプリと私たちの仕事が気に入ったら、リポジトリにスターを付けてフォローしてください。合わない場合はまったく問題ありません — 選ぶのはあなたです。お越しいただきありがとうございます！
- **K — Korean** (한국어): ⭐ 이 앱과 저희 작업이 마음에 드신다면 저장소에 스타를 눌러 주시고 팔로우해 주세요. 저희 작업이 맞지 않으셔도 전혀 괜찮습니다 — 선택은 여러분의 몫입니다. 방문해 주셔서 감사합니다!
- **L — Lithuanian** (Lietuvių): ⭐ Jei tau patinka ši programa ir mūsų darbas, duok saugyklai žvaigždutę ir sek mus. Jei mūsų darbas ne tau, viskas gerai — pasirinkimas tavo. Ačiū, kad užsukai!
- **M — Malayalam** (മലയാളം): ⭐ നിങ്ങൾക്ക് ഈ ആപ്പും ഞങ്ങളുടെ പ്രവർത്തനവും ഇഷ്ടപ്പെട്ടെങ്കിൽ, ദയവായി റെപ്പോസിറ്ററിക്ക് ഒരു സ്റ്റാർ നൽകുകയും ഞങ്ങളെ ഫോളോ ചെയ്യുകയും ചെയ്യുക. ഞങ്ങളുടെ പ്രവർത്തനം നിങ്ങൾക്ക് അനുയോജ്യമല്ലെങ്കിൽ, അതും തികച്ചും കുഴപ്പമില്ല — തീരുമാനം നിങ്ങളുടേതാണ്. ഇവിടെ വന്നതിന് നന്ദി!
- **N — Nepali** (नेपाली): ⭐ यदि तपाईंलाई यो एप र हाम्रो काम मन पर्‍यो भने, कृपया रिपोजिटरीलाई स्टार दिनुहोस् र हामीलाई फलो गर्नुहोस्। यदि हाम्रो काम तपाईंलाई मन पर्दैन भने, पनि ठीकै छ — यो तपाईंको इच्छा हो। यहाँ आउनुभएकोमा धन्यवाद!
- **O — Odia** (ଓଡ଼ିଆ): ⭐ ଯଦି ଆପଣଙ୍କୁ ଏହି ଆପ୍ ଏବଂ ଆମର କାମ ଭଲ ଲାଗୁଛି, ତେବେ ଦୟାକରି ରିପୋଜିଟୋରୀକୁ ଗୋଟିଏ ଷ୍ଟାର୍ ଦିଅନ୍ତୁ ଏବଂ ଆମକୁ ଫଲୋ କରନ୍ତୁ। ଯଦି ଆମର କାମ ଆପଣଙ୍କ ପାଇଁ ନୁହେଁ, ତେବେ କିଛି ଅସୁବିଧା ନାହିଁ — ପସନ୍ଦ ଆପଣଙ୍କର। ଆମ ପାଖକୁ ଆସିଥିବାରୁ ଧନ୍ୟବାଦ!
- **P — Polish** (Polski): ⭐ Jeśli podoba Ci się ta aplikacja i nasza praca, daj repozytorium gwiazdkę i obserwuj nas. Jeśli nasza praca nie jest dla Ciebie, to zupełnie w porządku — wybór należy do Ciebie. Dziękujemy za odwiedziny!
- **Q — Quechua** (Runa Simi): ⭐ Kay app, ñuqaykup ruwasqanchikpas gustasunki chayqa, repositorioman huk estrella churay, ñuqaykutapas qatipayku. Mana gustasunki chayqa, allinmi — qampa akllayki. Hamusqaykimanta sulpayki!
- **R — Russian** (Русский): ⭐ Если вам нравится это приложение и наша работа, поставьте звёздочку репозиторию и подпишитесь на нас. Если наша работа не для вас — это совершенно нормально, выбор за вами. Спасибо, что заглянули!
- **S — Spanish** (Español): ⭐ Si te gusta esta app y nuestro trabajo, dale una estrella al repositorio y síguenos. Si nuestro trabajo no es para ti, no pasa nada — la decisión es tuya. ¡Gracias por pasarte!
- **T — Tamil** (தமிழ்): ⭐ உங்களுக்கு இந்த ஆப்பும் எங்க வேலையும் பிடிச்சிருந்தா, தயவுசெஞ்சு இந்த ரெபாசிட்டரிக்கு ஒரு ஸ்டார் குடுத்து, எங்களை ஃபாலோ பண்ணுங்க. எங்க வேலை உங்களுக்கு செட் ஆகலைன்னாலும் பரவாயில்லை — அது உங்க விருப்பம். இங்கே வந்ததுக்கு நன்றி!
- **U — Urdu** (اردو): ⭐ اگر آپ کو یہ ایپ اور ہمارا کام پسند آئے تو براہ کرم ریپازٹری کو سٹار دیں اور ہمیں فالو کریں۔ اگر ہمارا کام آپ کے لیے نہیں ہے، تو یہ بالکل ٹھیک ہے — انتخاب آپ کا ہے۔ یہاں تشریف لانے کا شکریہ!
- **V — Vietnamese** (Tiếng Việt): ⭐ Nếu bạn thích ứng dụng này và công việc của chúng tôi, hãy tặng kho lưu trữ một ngôi sao và theo dõi chúng tôi. Nếu công việc của chúng tôi không phù hợp với bạn, điều đó hoàn toàn ổn — lựa chọn là của bạn. Cảm ơn bạn đã ghé qua!
- **W — Welsh** (Cymraeg): ⭐ Os ydych chi'n hoffi'r ap hwn a'n gwaith, rhowch seren i'r storfa a dilynwch ni. Os nad yw ein gwaith ar eich cyfer, mae hynny'n hollol iawn — chi sydd i benderfynu. Diolch am alw heibio!
- **X — Xhosa** (isiXhosa): ⭐ Ukuba uyayithanda le app nomsebenzi wethu, nika irepo inkwenkwezi kwaye usilandele. Ukuba umsebenzi wethu awukufanelanga, akukho ngxaki — lukhetho lwakho. Enkosi ngokutyelela!
- **Y — Yoruba** (Yorùbá): ⭐ Bí app yìí àti iṣẹ́ wa bá wù ọ́, jọ̀wọ́ fún àkójọpọ̀ náà ní ìràwọ̀ kí o sì tẹ̀lé wa. Bí iṣẹ́ wa kò bá yẹ ọ́, kò séwu — ìwọ ni ó yàn. Ẹ ṣé fún wíwá!
- **Z — Zulu** (isiZulu): ⭐ Uma uthanda le app nomsebenzi wethu, nikeza isitoreji inkanyezi bese usilandela. Uma umsebenzi wethu ungakufanele, akunankinga — wukukhetha kwakho. Siyabonga ngokuvakasha!

**More Indian languages**

- **Assamese** (অসমীয়া): ⭐ যদি আপুনি এই এপটো আৰু আমাৰ কাম ভাল পায়, তেন্তে অনুগ্ৰহ কৰি ৰিপজিটৰীটোক এটা ষ্টাৰ দিয়ক আৰু আমাক ফ'ল' কৰক। যদি আমাৰ কাম আপোনাৰ বাবে নহয়, তেন্তে সেয়া একেবাৰে ঠিক আছে — সিদ্ধান্তটো আপোনাৰ। আমাৰ ইয়ালৈ অহাৰ বাবে ধন্যবাদ!
- **Gujarati** (ગુજરાતી): ⭐ જો તમને આ એપ અને અમારું કામ ગમતું હોય, તો પ્લીઝ રિપોઝિટરીને સ્ટાર આપો અને અમને ફોલો કરો. જો અમારું કામ તમને ન ગમતું હોય, તો તે પણ બરાબર છે — પસંદગી તમારી છે. અહીં આવવા બદલ આભાર!
- **Kannada** (ಕನ್ನಡ): ⭐ ನಿಮಗೆ ಈ ಆ್ಯಪ್ ಮತ್ತು ನಮ್ಮ ಕೆಲಸ ಇಷ್ಟವಾದರೆ, ದಯವಿಟ್ಟು ರೆಪೊಸಿಟರಿಗೆ ಸ್ಟಾರ್ ಕೊಡಿ ಮತ್ತು ನಮ್ಮನ್ನು ಫಾಲೋ ಮಾಡಿ. ನಮ್ಮ ಕೆಲಸ ನಿಮಗೆ ಸರಿಹೊಂದದಿದ್ದರೆ, ಅದೂ ಪರವಾಗಿಲ್ಲ — ಆಯ್ಕೆ ನಿಮ್ಮದು. ಭೇಟಿ ನೀಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು!
- **Marathi** (मराठी): ⭐ जर तुम्हाला हे ॲप आणि आमचं काम आवडलं असेल, तर कृपया रिपॉझिटरीला स्टार द्या आणि आम्हाला फॉलो करा. जर आमचं काम तुम्हाला आवडत नसेल, तर काही हरकत नाही — ती तुमची निवड आहे. इथे आल्याबद्दल धन्यवाद!
- **Punjabi** (ਪੰਜਾਬੀ): ⭐ ਜੇ ਤੁਹਾਨੂੰ ਇਹ ਐਪ ਅਤੇ ਸਾਡਾ ਕੰਮ ਪਸੰਦ ਹੈ, ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਰਿਪੋਜ਼ਟਰੀ ਨੂੰ ਸਟਾਰ ਦਿਓ ਅਤੇ ਸਾਨੂੰ ਫਾਲੋ ਕਰੋ। ਜੇ ਸਾਡਾ ਕੰਮ ਤੁਹਾਡੇ ਲਈ ਨਹੀਂ ਹੈ, ਤਾਂ ਕੋਈ ਗੱਲ ਨਹੀਂ — ਚੋਣ ਤੁਹਾਡੀ ਹੈ। ਸਾਡੇ ਪੇਜ 'ਤੇ ਆਉਣ ਲਈ ਧੰਨਵਾਦ!
- **Telugu** (తెలుగు): ⭐ మీకు ఈ యాప్, మా పని నచ్చితే, దయచేసి రిపోజిటరీకి ఒక స్టార్ ఇచ్చి మమ్మల్ని ఫాలో అవ్వండి. ఒకవేళ మా పని మీకు నచ్చకపోతే, పర్వాలేదు — అది మీ ఇష్టం. మమ్మల్ని సందర్శించినందుకు ధన్యవాదాలు!

</details>

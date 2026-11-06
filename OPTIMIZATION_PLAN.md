# Optimization & hardening plan — 1 to 20, ten items a day

## How a scheduled run must start

The build sandbox is recycled between runs and can come back holding an **old snapshot** of
`/scratch/work`. Always begin by restoring the real sources from the repo:

1. `GITHUB_GET_REPOSITORY_CONTENT` for `technicalnihilist-lgtm/liquid-glass-photos`, branch `main`,
   paths `app/assets/index.html`, `app/java/com/liquidglass/photos/MainActivity.java`,
   `app/AndroidManifest.xml`, `build.sh`, `tools/gen_preview.py`, `README.md` — copy each from its
   `artifacts[0].workspace_path` into the same path under `/scratch/work/`.
2. Confirm `grep versionCode app/AndroidManifest.xml` matches the latest release before building.
3. Only then touch code. Never build on a tree you did not just restore.

## Rules for every run (do not break these):

- **The UI does not change.** Same layout, same glass, same colours, same animations, same screens.
- **No new features.** No new screens, buttons, settings rows or gestures. Only make what exists faster, smoother, lighter, safer.
- If a fix would be visible, it must be a *defect* fix (something that looks wrong today), not a redesign.
- Every run: pick the next unchecked items, do the work, build, run the test suite, bump the version, publish, tick the boxes here.
- Never ship a build that regresses: `bash build.sh` must pass, the puppeteer suite must be all-PASS, and the APK in the repo must match the local build byte for byte.

Legend: `[ ]` todo, `[x]` done (with the version it shipped in).

---

## Day 1 — startup and scroll cost

- [x] 1. Decode thumbnails in one pass: use the MediaStore `WIDTH`/`HEIGHT` columns instead of a second `inJustDecodeBounds` stream open. *(1.0.7)*
- [x] 2. Make the thumbnail cache byte-bounded (LRU by bytes, ~12 MB) instead of a 220-entry count. *(1.0.7)*
- [x] 3. Add `contain: layout paint style` to `.tile` so offscreen tiles cost nothing to lay out. *(1.0.7)*
- [x] 4. Coalesce drag-select hit-testing into one `requestAnimationFrame` per frame instead of one per pointer event. *(1.0.7)*
- [x] 5. Skip `--tx`/`--ty` writes when the tilt value has not changed by more than 0.002. *(1.0.7)*
- [x] 6. Short-lived (1.5 s) cache of the MediaStore result so a resume + permission callback do not double-query. *(1.0.7)*
- [x] 7. Drop the second `paintTilt()` call in `applySettings` when motion is on (the timer already runs). *(1.0.7)*
- [x] 8. Replace `innerHTML` grid rebuilds with a `DocumentFragment` where the DOM is unchanged. *(1.0.8)*
- [x] 9. Avoid re-creating the whole header on every selection toggle during a drag. *(1.0.9)*
- [x] 10. Measure first-frame time on a 2000-photo library and write the number into the README — **3657 ms** to the first tile painted (209 ms to the empty chrome), measured by `tools/bench_first_frame.js`, median of 5 runs. *(1.1.0)*

## Day 2 — image pipeline

- [x] 11. Downscale with `BitmapFactory.Options.inDensity` instead of post-decode `createScaledBitmap` where possible. *(1.1.1)*
- [x] 12. Try `ImageDecoder` (API 28+) for thumbnails with a `BitmapFactory` fallback. *(1.1.2)*
- [x] 13. Recycle the bounds bitmap immediately after reading width/height. *(1.1.3)*
- [x] 14. Cache decoded thumbnails to disk (small LRU dir) so a cold start is not blank. *(1.1.4)*
- [x] 15. Serve `Content-Length` on every thumb response (currently always set — verify with a test). *(1.1.5)*
- [x] 16. Add `Cache-Control: immutable` to thumbs so the WebView stops re-asking. *(1.1.6)*
- [x] 17. Skip thumbnails smaller than 48 px (corrupt media) instead of returning a 1×1 bitmap. *(1.1.7)*
- [x] 18. Guard against `OutOfMemoryError` in the decode path and return a 404 rather than crashing. *(1.1.8)*
- [x] 19. Prefetch the next screen of thumbnails while scrolling (behind a flag, no UI change). *(1.1.9)*
- [x] 20. Verify HEIC/HEIF decodes on API 28+ and fall back gracefully on older. *(1.2.0)*

## Day 3 — media query

- [x] 21. Project only the columns actually used (drop `_SIZE`/`WIDTH` where unused) — audited: all eight projected columns are consumed, so nothing was dropped; the projection is now documented column by column and a suite check fails on any projected-but-unread column. *(1.2.1)*
- [x] 22. Use `Cursor.getColumnIndex` once outside the row loop (already) — verified: the query does eight lookups before the first `moveToNext()` and none inside it; `tools/test_suite.js` now fails if a lookup reappears in any cursor loop or lands after the loop starts. *(1.2.2)*
- [x] 23. Add a `LIMIT`/paging strategy for libraries over 6000 items: 1000-row pages via `QUERY_ARG_LIMIT`/`QUERY_ARG_OFFSET` (API 26+, single capped query below it), stopping on the first short page, with the same 6000 ceiling and the same order. *(1.2.3)*
- [x] 24. Skip trashed/hidden media via the `IS_TRASHED` column on API 30+ — done: on API 30+ every page query carries a `is_trashed = 0` selection term, so recycle-bin rows never reach the grid and the 6000-row ceiling counts real photos. *(1.2.4)*
- [x] 25. Skip pending (`IS_PENDING=1`) items so half-written imports do not appear. *(1.2.5)*
- [x] 26. Sort by `DATE_TAKEN` when available, `DATE_MODIFIED` otherwise — done: `DATE_TAKEN` is projected and read per row and wins when non-zero, `DATE_MODIFIED` (×1000) is the fallback for rows with no capture time, the provider sort string and the page ceiling are untouched so the same rows come back, and the disk-thumb stamp still keys on `DATE_MODIFIED`. *(1.2.6)*
- [x] 27. Handle null `BUCKET_DISPLAY_NAME` without allocating a string per row — done: a row with no album points at one shared `EMPTY` constant and repeated album names are pooled on the first instance per query, so a 6000-row library holds a handful of bucket strings instead of 6000 and every row still carries the same value the grid, album filters and search read. *(1.2.7)*
- [x] 28. Close cursors in a `finally` on every path (audit) — done: the library query's cursor is
  declared outside the `try` so the `finally` can see it, and every exit — the provider's null
  cursor, the caught per-row throw and its `return`, and the normal end of a page — unwinds
  through that one `finally`; the close itself is now guarded so a provider that throws out of
  `close()` cannot fail a page that has already been read, and `tools/test_suite.js` fails if a
  `Cursor` is declared elsewhere, a `query()` appears outside the method, or a `close()` lands
  outside a `finally`. *(1.2.8)*
- [x] 29. Avoid rebuilding the mime/size maps on every query — done: the row loop hands each row to `rememberMeta(id, mime, size)`, which writes an entry only when the cached value actually differs, so a refresh over an unchanged library performs no map writes at all (it used to do two boxed `put`s, and the occasional resize and rehash, per photo); both maps are capped at 12 000 ids (twice the 6000-row ceiling) and dropped rather than grown past it, and `dateCache` keeps its unconditional `put` so an edited photo still restamps its disk thumb. `tools/test_suite.js` fails if a `mimeCache`/`sizeCache` put returns to the row loop or the cap goes away. *(1.2.9)*
- [x] 30. Log query duration behind `Log.isLoggable(DEBUG)` — done: `queryMedia()` reads `Log.isLoggable(TAG, Log.DEBUG)` once, and only when it is true does it take a `System.nanoTime()` before `queryOne()` and print one `Log.d` line with the row count and the elapsed milliseconds; a normal run pays a single boolean read, no clock read, no concatenation and no log line, and the query itself is untouched. `tools/test_suite.js` fails if the clock read or the log line escapes the guard, or if a second unguarded `Log.d` appears anywhere in the bridge. *(1.3.0)*

## Day 4 — WebView plumbing

- [x] 31. Reuse a single `WebResourceResponse` header map where safe — done: the shapes whose headers never vary now share one map each, built once at class load and wrapped in `Collections.unmodifiableMap` before publication (the WebView reads headers off the UI thread, so a map may only be shared when nothing can write to it afterwards): every 404 reuses `NOT_FOUND_HEADERS` (`Cache-Control: no-store`, `Content-Length: 0`), `asset()` reuses the `ASSET_HEADERS` entry for its mime (all seven mimes the extension table can produce are prebuilt), and media reuses one base map per mime from `MEDIA_HEADERS` (`Accept-Ranges`, `Content-Type`, `Cache-Control`). A launch no longer allocates a `HashMap` for `index.html` or for any miss that falls through to the 404. The responses that genuinely depend on the request — a thumb's `Content-Length`, a media range's `Content-Range`/`Content-Length` — copy the shared base instead of writing to it, so no map is ever mutated after it is handed to a response; every status code, header value and body is unchanged. `tools/test_suite.js` fails if a fixed shape allocates a `HashMap` again, if the shared maps stop being unmodifiable, or if the varying paths start writing into the shared base. *(1.3.1)*
- [x] 32. Add `shouldInterceptRequest` fast path for `favicon.ico` (return 204) — done: Chromium asks for `/favicon.ico` on the first paint, the app ships no icon, and the request used to miss the asset table and fall through to the `index.html` fallback — so the whole app was opened, streamed back and thrown away as an icon, on every launch and every reload. The path is now answered `204 No Content` in `shouldInterceptRequest` before any asset lookup, from `NO_CONTENT_HEADERS`, a shared unmodifiable map (`Cache-Control: no-store`, `Content-Length: 0`) built once at class load, so the fast path allocates no `HashMap` and reads no asset. Every other path, status and header is unchanged and the UI is untouched. `tools/test_suite.js` fails if the favicon branch moves behind `asset()`, if the 204 loses its shared map, or if that map is allocated per request. *(1.3.2)*
- [ ] 33. Verify no request leaks file descriptors after 200 media loads.
- [ ] 34. Set `WebSettings.setOffscreenPreRaster(false)` for memory.
- [ ] 35. Consider `setBackgroundColor` on the WebView once (already) — confirm no flash on resume.
- [ ] 36. Handle `onRenderProcessGone` by rebuilding the WebView instead of crashing.
- [ ] 37. Handle `onReceivedError` for the main frame with a retry.
- [ ] 38. Guard `evaluateJavascript` against a destroyed WebView everywhere.
- [ ] 39. Disable text autosizing (`setTextZoom(100)` present) — verify it survives reload.
- [ ] 40. Trim the JS bridge surface: remove unused `info()` if nothing calls it.

## Day 5 — selection and gestures

- [ ] 41. Make drag-select hit-testing use the last known tile index instead of `elementFromPoint` when the pointer stays inside it.
- [ ] 42. Stop the auto-scroll interval when the pointer leaves the screen entirely.
- [ ] 43. Cancel an in-flight drag on `pointercancel` (audit).
- [ ] 44. Prevent drag-select from starting on a tap (only after 6 px of movement).
- [ ] 45. Make long-press start selection without also selecting on release.
- [ ] 46. Keep the selection count text in sync when the list changes under it.
- [ ] 47. Clear the drag state when the screen re-renders.
- [ ] 48. Add `touch-action: pan-y` handling so a diagonal drag still scrolls.
- [ ] 49. Verify pinch-to-change-columns does not fight drag-select.
- [ ] 50. Make "All" respect the current filter (search/album), verified by a test.

## Day 6 — viewer

- [ ] 51. Reuse the three slide nodes instead of rebuilding all of them on swipe.
- [ ] 52. Release the offscreen slide images (`src=''`) to free memory.
- [ ] 53. Clamp pan so the image cannot be dragged fully off screen.
- [ ] 54. Snap zoom back to 1 when swiping to the next photo (audit).
- [ ] 55. Debounce double-tap detection to the system double-tap timeout.
- [ ] 56. Avoid layout thrash on swipe by pre-measuring the width.
- [ ] 57. Stop the hint timer when the viewer closes.
- [ ] 58. Handle a 404 image in the viewer with a placeholder instead of a blank.
- [ ] 59. Keep the viewer open if the deleted photo was not the current one.
- [ ] 60. Restore scroll position of the grid after closing the viewer (audit).

## Day 7 — memory

- [ ] 61. Cap the total thumbnail bytes and log the high-water mark.
- [ ] 62. Drop the thumbnail cache on `onTrimMemory`.
- [ ] 63. Avoid holding `Bitmap` references in listeners.
- [ ] 64. Check the WebView does not retain the bridge after `destroy()`.
- [ ] 65. Free the media list when the app goes to the background for a long time.
- [ ] 66. Use `RGB_565` for thumbs (present) — verify it does not band badly.
- [ ] 67. Avoid string concatenation in the JSON builder (use a reusable buffer).
- [ ] 68. Trim the JSON payload: drop fields the UI never reads.
- [ ] 69. Verify no leak across 50 open/close cycles of the viewer.
- [ ] 70. Add a debug counter of live bitmaps.

## Day 8 — battery and sensors

- [ ] 71. Lower the accelerometer rate when 4D motion is off.
- [ ] 72. Unregister the sensor on `onStop`, not just `onPause`.
- [ ] 73. Stop the tilt timer when the page is hidden.
- [ ] 74. Reduce bridge calls to at most 20/s (currently ~30/s).
- [ ] 75. Re-baseline the tilt after a long idle so it does not drift.
- [ ] 76. Skip tilt pushes while a sheet is open (nothing visible moves).
- [ ] 77. Use `SENSOR_DELAY_UI` when the battery is low.
- [ ] 78. Pause the water-sound AudioContext when idle.
- [ ] 79. Verify no wakelocks are held.
- [ ] 80. Measure battery impact over 10 minutes of idle scroll.

## Day 9 — startup

- [ ] 81. Defer the first library load until after the first paint (present) — verify the order.
- [ ] 82. Avoid the double `renderAll()` at boot.
- [ ] 83. Precompile the icon strings once instead of on every render.
- [ ] 84. Cut the number of `setTimeout` calls in the boot path.
- [ ] 85. Show the cached library immediately on a warm start.
- [ ] 86. Skip the boot animation when the process was already alive.
- [ ] 87. Measure cold start to first tile.
- [ ] 88. Avoid querying favourites twice at boot.
- [ ] 89. Remove the unused `#file` fallback work on Android (keep for browsers).
- [ ] 90. Verify no network requests at boot (everything is local).

## Day 10 — correctness sweep

- [ ] 91. Audit every `parseInt`/`Number` on ids (long vs double precision).
- [ ] 92. Make sure `TRASH` ids are cleaned when the underlying media disappears.
- [ ] 93. Handle a photo deleted outside the app (404) by hiding it.
- [ ] 94. Fix any date grouping bug around midnight/DST.
- [ ] 95. Verify `fmtDay` on a 1-year-old photo.
- [ ] 96. Audit the `undo` window for the batch delete.
- [ ] 97. Make delete from the viewer keep the list consistent.
- [ ] 98. Guard against `current()` returning a stale list after a delete.
- [ ] 99. Verify search is case-insensitive for non-Latin names.
- [ ] 100. Re-check every `catch (Exception ignored)` and log where useful.

## Day 11 — build and packaging

- [ ] 101. Enable resource shrinking (aapt2 `--no-resource-removal` is off — verify).
- [ ] 102. Strip unused densities from the icons.
- [ ] 103. Verify the APK has no debug symbols.
- [ ] 104. Sign with v4 if supported.
- [ ] 105. Reduce the APK below 100 KB.
- [ ] 106. Make `build.sh` fail loudly on any javac warning.
- [ ] 107. Add `--target-sdk` bump to 35 with a compatibility pass.
- [ ] 108. Reproducible build: same input, same bytes.
- [ ] 109. Verify the manifest has no unused permissions.
- [ ] 110. Document the exact toolchain versions used.

## Day 12 — robustness on old devices

- [ ] 111. Test API 24 paths for `WindowInsets` fallbacks.
- [ ] 112. Guard `MediaStore.createDeleteRequest` for API 30 exactly.
- [ ] 113. Fallback when the WebView is outdated or missing.
- [ ] 114. Handle a device with no accelerometer (depth off gracefully).
- [ ] 115. Handle a 1 GB RAM device without OOM.
- [ ] 116. Verify on a 3-button navigation device (inset height).
- [ ] 117. Verify on a tablet (grid width, insets).
- [ ] 118. Verify with a very small screen (320 dp).
- [ ] 119. Verify with a large font scale.
- [ ] 120. Verify in landscape (no crash, sane layout).

## Day 13 — animation smoothness

- [ ] 121. Move bounce animations to `transform` only (audit for layout properties).
- [ ] 122. Avoid animating `filter` on the glass (expensive) where possible.
- [ ] 123. Promote animated layers with `will-change` only while animating.
- [ ] 124. Verify 60 fps on scroll with 2000 photos.
- [ ] 125. Cut the number of `backdrop-filter` layers visible at once.
- [ ] 126. Verify the sheet animation does not repaint the grid.
- [ ] 127. Reduce the pop-in animation work for offscreen tiles.
- [ ] 128. Make the tab indicator animation frame-budget friendly.
- [ ] 129. Verify no layout thrash in the tilt loop.
- [ ] 130. Profile with Chrome tracing and record the numbers.

## Day 14 — data integrity

- [ ] 131. Verify favourites survive a media rescan.
- [ ] 132. Verify trash ids survive an app restart (audit localStorage).
- [ ] 133. Cap the trash set size.
- [ ] 134. Prune trash ids that no longer exist.
- [ ] 135. Verify the import path writes a valid MediaStore row.
- [ ] 136. Verify imported files appear without a manual refresh.
- [ ] 137. Handle an import of a 100 MB file without OOM.
- [ ] 138. Verify concurrent imports do not collide on filenames.
- [ ] 139. Verify share URIs are still valid after a rescan.
- [ ] 140. Verify delete confirmation returns to the right screen.

## Day 15 — accessibility and input

- [ ] 141. Add `aria-label`s without changing layout.
- [ ] 142. Verify talkback reads the grid sanely.
- [ ] 143. Ensure tap targets stay ≥ 44 dp.
- [ ] 144. Respect "remove animations" system setting.
- [ ] 145. Verify the app works with a hardware keyboard/DPAD.
- [ ] 146. Verify the back gesture does not exit from the viewer.
- [ ] 147. Verify the search field is reachable with the keyboard open.
- [ ] 148. Check contrast of the tab labels over bright photos.
- [ ] 149. Verify the app is usable with one hand (bottom reach).
- [ ] 150. Ensure nothing relies on hover.

## Day 16 — error surfaces

- [ ] 151. Replace silent failures with a toast where the user needs to know.
- [ ] 152. Never show a raw exception string.
- [ ] 153. Handle a revoked permission while the app is open.
- [ ] 154. Handle "partial access" growing to full access without a restart.
- [ ] 155. Handle storage full during an import.
- [ ] 156. Handle a corrupt image without breaking the grid.
- [ ] 157. Handle a WebView crash with a rebuild.
- [ ] 158. Handle a null intent URI in the player path (removed) — audit leftovers.
- [ ] 159. Verify the app survives process death and restore.
- [ ] 160. Verify a second launch while the first is running.

## Day 17 — testing

- [ ] 161. Add a test for the empty library state.
- [ ] 162. Add a test for the permission-denied state.
- [ ] 163. Add a test for 1000+ tiles.
- [ ] 164. Add a test for rapid tab switching.
- [ ] 165. Add a test for delete-then-undo-then-delete.
- [ ] 166. Add a test for search + chip + clear.
- [ ] 167. Add a test for the viewer at the first and last item.
- [ ] 168. Add a test for grid column changes.
- [ ] 169. Add a test that the APK contains no sample media.
- [ ] 170. Keep the suite under 90 seconds.

## Day 18 — polish that is invisible

- [ ] 171. Align all `dp` values to a 4 dp grid.
- [ ] 172. Remove dead CSS.
- [ ] 173. Remove dead Java imports.
- [ ] 174. Name every magic number in the Java.
- [ ] 175. Comment the non-obvious parts of the bridge.
- [ ] 176. Keep the README honest with the code.
- [ ] 177. Delete stale screenshots.
- [ ] 178. Make the changelog complete.
- [ ] 179. Verify no TODO/FIXME left unaddressed.
- [ ] 180. Verify the licence and credits are correct.

## Day 19 — final performance pass

- [ ] 181. Re-measure cold start, scroll fps, memory after all changes.
- [ ] 182. Compare against the Day 1 numbers.
- [ ] 183. Re-run every test on the final build.
- [ ] 184. Re-verify the APK checksum matches the repo.
- [ ] 185. Re-verify the release asset downloads correctly.
- [ ] 186. Re-check the permission flow on a clean install.
- [ ] 187. Re-check the delete flow on a clean install.
- [ ] 188. Re-check battery over 10 minutes.
- [ ] 189. Re-check APK size.
- [ ] 190. Write the summary of the 20 days.

## Day 20 — wrap up

- [ ] 191. Publish a final stable build.
- [ ] 192. Tag it and note it in the README.
- [ ] 193. Archive the plan with everything ticked.
- [ ] 194. Make sure no scheduled job can ship a broken build.
- [ ] 195. Verify the repo builds from a clean clone.
- [ ] 196. Verify the release notes match reality.
- [ ] 197. Leave the next-steps list short and honest.
- [ ] 198. Confirm nothing in the UI changed over the 20 days (screenshot diff).
- [ ] 199. Confirm no feature was added over the 20 days.
- [ ] 200. Hand back a build that is simply faster and steadier than Day 1.

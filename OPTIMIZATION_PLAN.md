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
- [ ] 12. Try `ImageDecoder` (API 28+) for thumbnails with a `BitmapFactory` fallback.
- [ ] 13. Recycle the bounds bitmap immediately after reading width/height.
- [ ] 14. Cache decoded thumbnails to disk (small LRU dir) so a cold start is not blank.
- [ ] 15. Serve `Content-Length` on every thumb response (currently always set — verify with a test).
- [ ] 16. Add `Cache-Control: immutable` to thumbs so the WebView stops re-asking.
- [ ] 17. Skip thumbnails smaller than 48 px (corrupt media) instead of returning a 1×1 bitmap.
- [ ] 18. Guard against `OutOfMemoryError` in the decode path and return a 404 rather than crashing.
- [ ] 19. Prefetch the next screen of thumbnails while scrolling (behind a flag, no UI change).
- [ ] 20. Verify HEIC/HEIF decodes on API 28+ and fall back gracefully on older.

## Day 3 — media query

- [ ] 21. Project only the columns actually used (drop `_SIZE`/`WIDTH` where unused).
- [ ] 22. Use `Cursor.getColumnIndex` once outside the row loop (already) — verify no repeated lookups.
- [ ] 23. Add a `LIMIT`/paging strategy for libraries over 6000 items.
- [ ] 24. Skip trashed/hidden media via the `IS_TRASHED` column on API 30+.
- [ ] 25. Skip pending (`IS_PENDING=1`) items so half-written imports do not appear.
- [ ] 26. Sort by `DATE_TAKEN` when available, `DATE_MODIFIED` otherwise.
- [ ] 27. Handle null `BUCKET_DISPLAY_NAME` without allocating a string per row.
- [ ] 28. Close cursors in a `finally` on every path (audit).
- [ ] 29. Avoid rebuilding the mime/size maps on every query.
- [ ] 30. Log query duration behind `Log.isLoggable(DEBUG)`.

## Day 4 — WebView plumbing

- [ ] 31. Reuse a single `WebResourceResponse` header map where safe.
- [ ] 32. Add `shouldInterceptRequest` fast path for `favicon.ico` (return 204).
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

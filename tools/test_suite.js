#!/usr/bin/env node
/*
 * Puppeteer regression suite for Liquid Glass Photos.
 *
 * Runs the real app/assets/index.html in headless Chromium with the native bridge
 * stubbed out (the way tools/bench_first_frame.js does), drives the UI through real
 * clicks and typing, and asserts the behaviour that must not change between
 * optimisation passes: the grid paints, thumbnails are fetched, tabs/search/chips
 * filter, selection works, the viewer opens and closes, the grid size setting
 * applies, and the empty / permission-denied states still render.
 *
 * usage: node tools/test_suite.js [--count=60] [--verbose]
 * exit code 0 only when every check prints PASS.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app/assets/index.html');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const a = argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const COUNT = parseInt(arg('count', '60'), 10);
const VERBOSE = argv.includes('--verbose');
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium';

const THUMB = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACgAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmNtG2pNtG2vpLnmWI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WH4oxUmKMVlcuxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxJto21Jto21nc0sR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsSYoxT8UYrO5pYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYk20bakxRisrmliPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiTFGKk20bazuXYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYfto21JijFZ3NLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEmKMVJto21lc0sR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsSbaNtPxRis7l2GbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WJMUYqTbRtrO5pYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhY/9k=',
  'base64'
);

function library(n) {
  const types = ['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/png'];
  const buckets = ['Camera', 'Camera', 'Camera', 'WhatsApp Images', 'Download', 'Instagram', 'DCIM', 'Screenshots'];
  const now = Date.UTC(2026, 9, 30, 11, 20);
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: i + 1,
      v: 0,
      n: 'IMG_2026' + String(1000 + i) + '.jpg',
      b: buckets[i % buckets.length],
      m: types[i % types.length],
      d: now - i * 3 * 60 * 60 * 1000,
      s: 1900000 + i * 977,
      w: 1080,
      h: i % 3 === 0 ? 1080 : 810,
    });
  }
  return items;
}

function stubFor(items, access) {
  return (
    '<script>(function(){const ITEMS=' +
    JSON.stringify(items) +
    ';window.AndroidNative={meta(){return JSON.stringify({sdk:34,device:"Pixel 8",android:"14",access:' +
    access +
    ',insetTop:74,insetBottom:48,light:false})},access(){return ' +
    access +
    '},requestAccess(){},photos(){return JSON.stringify({count:ITEMS.length,items:ITEMS})},favs(){return "[]"},setFav(){},share(){},delete(){},pick(){},theme(){},setTilt(){}};})();</script>'
  );
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
}

(async () => {
  const thumbHits = { total: 0, bad: 0 };
  let currentStub = stubFor(library(COUNT), 'true');

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(APP, 'utf8').replace('<body>', '<body>\n' + currentStub, 1);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (/^\/thumb\/\d+$/.test(url)) {
      thumbHits.total++;
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      res.end(THUMB);
      return;
    }
    if (/^\/media\/\d+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      res.end(THUMB);
      return;
    }
    thumbHits.bad++;
    res.writeHead(404);
    res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1 },
  });

  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  const tiles = () => page.$$eval('.tile', (n) => n.length);
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  /* 1. the library paints every tile */
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 30000 }, COUNT);
  check('boot renders all ' + COUNT + ' tiles', (await tiles()) === COUNT);

  /* 2. the header carries the library title and the select button */
  const headOk = await page.evaluate(() => {
    const t = document.querySelector('#head .ttl');
    return !!t && t.textContent.trim().length > 0 && !!document.querySelector('[data-act="startsel"]');
  });
  check('header renders title + Select', headOk);

  /* 3. thumbnails are served, none 404 */
  await page.waitForFunction(() => document.querySelectorAll('.tile img').length > 0, { timeout: 15000 });
  await settle(400);
  check('thumbnails served (' + thumbHits.total + ' requests, ' + thumbHits.bad + ' bad)', thumbHits.total > 0 && thumbHits.bad === 0);

  /* 4. tab switch to Albums and back */
  await page.click('#pill button[data-tab="albums"]');
  await page.waitForFunction(() => document.querySelectorAll('.album').length > 0, { timeout: 10000 });
  const albums = await page.$$eval('.album', (n) => n.length);
  await page.click('#pill button[data-tab="library"]');
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  check('albums tab lists ' + albums + ' albums, library returns', albums > 0 && (await tiles()) === COUNT);

  /* 5. search filters by album name, then clears */
  await page.click('.tabs .round');
  await page.waitForSelector('#q', { timeout: 10000 });
  await page.type('#q', 'Camera');
  await page.waitForFunction(() => document.querySelectorAll('#res .tile').length > 0, { timeout: 10000 });
  const filtered = await page.$$eval('#res .tile', (n) => n.length);
  await page.click('#q', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const e = document.querySelector('#res .empty');
    return !!e && /search by name/i.test(e.textContent);
  }, { timeout: 10000 });
  check('search "Camera" narrows to ' + filtered + ' of ' + COUNT + ', clearing returns to the prompt', filtered > 0 && filtered < COUNT);

  /* 6. favourites chip with no favourites shows the empty result state */
  await page.click('[data-chip="fav"]');
  await page.waitForFunction(() => {
    const e = document.querySelector('#res .empty');
    return !!e && /no matches/i.test(e.textContent);
  }, { timeout: 10000 });
  await page.click('[data-chip="fav"]');
  await page.waitForFunction(() => {
    const e = document.querySelector('#res .empty');
    return !!e && /search by name/i.test(e.textContent);
  }, { timeout: 10000 });
  check('favourites chip empty state, chip clears', true);

  /* 7. selection: Select -> All -> everything selected -> exit */
  await page.click('#pill button[data-tab="library"]');
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  await page.click('[data-act="selall"]');
  await page.waitForFunction((n) => document.querySelectorAll('.tile.on').length === n, { timeout: 10000 }, COUNT);
  const selAll = await page.$$eval('.tile.on', (n) => n.length);
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('select-all marks ' + selAll + ' tiles, exit clears', selAll === COUNT);

  /* 8. tapping a tile opens the viewer, close returns to the grid */
  await page.click('.tile');
  await page.waitForSelector('.viewer .stage img', { timeout: 10000 });
  const viewerOk = await page.evaluate(() => !!document.querySelector('.viewer .vbar'));
  await page.click('[data-v="close"]');
  await page.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  check('viewer opens with controls and closes back to ' + COUNT + ' tiles', viewerOk);

  /* 9. the grid-size setting changes the tile width */
  const w0 = await page.$eval('.tile', (t) => t.getBoundingClientRect().width);
  await page.click('[data-act="settings"]');
  await page.waitForSelector('#s_co', { timeout: 10000 });
  await page.$eval('#s_co', (el) => {
    el.value = '6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(400);
  const w1 = await page.$eval('.tile', (t) => t.getBoundingClientRect().width);
  await page.click('#dn');
  await settle(400);
  check('grid size setting narrows tiles ' + Math.round(w0) + 'px -> ' + Math.round(w1) + 'px', w1 < w0);

  /* 10. no uncaught errors during any of the above */
  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* 11. empty library state */
  currentStub = stubFor([], 'true');
  const empty = await browser.newPage();
  await empty.goto(base, { waitUntil: 'load' });
  await empty.waitForSelector('#screen .empty', { timeout: 15000 });
  const emptyText = await empty.$eval('#screen .empty', (e) => e.textContent);
  check('empty library state renders', /no photos/i.test(emptyText), emptyText.split('.')[0].slice(0, 40));
  await empty.close();

  /* 12. permission-denied state offers the allow button */
  currentStub = stubFor(library(COUNT), 'false');
  const denied = await browser.newPage();
  await denied.goto(base, { waitUntil: 'load' });
  await denied.waitForSelector('#screen .empty [data-act="ask"]', { timeout: 15000 });
  const deniedText = await denied.$eval('#screen .empty', (e) => e.textContent);
  check('permission-denied state offers Allow access', /permission/i.test(deniedText));
  await denied.close();

  /* 13. every thumb response is length-delimited: the native client must send Content-Length
         on every /thumb/ hit, and the length must match the bytes actually delivered. */
  currentStub = stubFor(library(COUNT), 'true');
  const thumbPage = await browser.newPage();
  await thumbPage.setCacheEnabled(false);   // force real responses: earlier pages already cached these URLs
  const thumbRes = [];
  thumbPage.on('response', (r) => {
    if (/\/thumb\/\d+$/.test(r.url())) thumbRes.push(r);
  });
  await thumbPage.goto(base, { waitUntil: 'load' });
  await thumbPage.waitForFunction(() => document.querySelectorAll('.tile img').length > 0, { timeout: 15000 });
  /* The tiles exist as soon as they are laid out, but their images are still in flight; the loop
     below only awaits inside its body, so counting before the first response lands measured 0/0
     and failed the check at random. Wait for the first thumb response, then let the rest arrive. */
  for (let i = 0; i < 100 && thumbRes.length === 0; i++) await new Promise((ok) => setTimeout(ok, 50));
  await settle(500);
  let lenOk = 0;
  const lenBad = [];
  for (const r of thumbRes) {
    const cl = r.headers()['content-length'];
    let body = 0;
    try { body = (await r.buffer()).length; } catch (e) { body = -1; }
    if (cl != null && parseInt(cl, 10) === body) lenOk++;
    else lenBad.push(r.url().split('/').pop() + '=' + cl + '/' + body);
  }
  check('every thumb response sends Content-Length (' + lenOk + '/' + thumbRes.length + ')',
    thumbRes.length > 0 && lenBad.length === 0, lenBad.slice(0, 2).join(' '));
  await thumbPage.close();

  /* 14. the native side keeps that contract: the thumb 200 sets the JPEG length and the
         404 fallback (a thumb that will not decode) sets 0 instead of omitting the header. */
  const java = fs.readFileSync(path.join(ROOT, 'app/java/com/liquidglass/photos/MainActivity.java'), 'utf8');
  const thumbBranch = (java.match(/if \(path\.startsWith\("\/thumb\/"\)\)[\s\S]*?new ByteArrayInputStream\(bytes\)\);/) || [''])[0];
  const notFoundFn = (java.match(/private WebResourceResponse notFound\(\)[\s\S]*?\n    \}/) || [''])[0];
  check('native thumb 200 sets Content-Length', /h\.put\("Content-Length", String\.valueOf\(bytes\.length\)\)/.test(thumbBranch));
  /* 31. the 404's headers are identical for every failure, so they live in one shared map
         instead of a fresh HashMap per failed request; the header values must not change. */
  const notFoundHeaders = (java.match(/private static final Map<String, String> NOT_FOUND_HEADERS =\s*([\s\S]*?);/) || ['', ''])[1];
  check('native thumb 404 sets Content-Length 0',
    /"Content-Length", "0"/.test(notFoundHeaders) && /"Cache-Control", "no-store"/.test(notFoundHeaders) &&
    /NOT_FOUND_HEADERS/.test(notFoundFn));

  /* 15. corrupt media is skipped rather than upscaled into a 1x1 tile: the decode path must refuse
         anything whose longest side is under the 48 px floor, and refuse it before it scales,
         compresses, caches or writes anything. */
  const minPx = (java.match(/THUMB_MIN_PX = (\d+)/) || [])[1];
  const thumbFn = (java.match(/private byte\[\] thumbnail\(long id\)[\s\S]*?\n    \}/) || [''])[0];
  const preGuard = thumbFn.indexOf('Math.max(dims[0], dims[1]) < THUMB_MIN_PX');
  const postGuard = thumbFn.indexOf('Math.max(wd, ht) < THUMB_MIN_PX');
  const firstScale = thumbFn.indexOf('Bitmap.createScaledBitmap');
  const firstStore = thumbFn.indexOf('cacheThumb(key, bytes)');
  check('native thumb skips media under ' + (minPx || '?') + ' px before scaling or caching',
    minPx === '48' && preGuard > 0 && postGuard > preGuard && firstScale > postGuard &&
    firstStore > postGuard && thumbFn.indexOf('return null') > 0);

  /* The decode path must contain an OutOfMemoryError instead of letting it reach the process:
     the thumbnail decode catches it, frees the byte cache, and answers 404 like any other photo
     that cannot be read. */
  const oomCatch = thumbFn.indexOf('catch (OutOfMemoryError');
  const oomReturn = oomCatch > 0 ? thumbFn.indexOf('return null', oomCatch) : -1;
  const oomDrop = oomCatch > 0 ? thumbFn.indexOf('dropThumbCache()', oomCatch) : -1;
  const dropFn = (java.match(/private void dropThumbCache\(\)[\s\S]*?\n    \}/) || [''])[0];
  check('native thumb contains OutOfMemoryError and answers 404 instead of crashing',
    oomCatch > 0 && oomDrop > oomCatch && oomReturn > oomDrop &&
    /thumbCache\.clear\(\)/.test(dropFn) && /thumbCacheBytes = 0L/.test(dropFn));

  /* 16. HEIC/HEIF: the platform decoder only reads it from API 28, so below that the decode path
         must refuse the row before anything is opened (no stream, no fd, no repeated attempt) and
         remember it, while on 28+ ImageDecoder is tried first and a HEIF failure is not handed to
         the BitmapFactory fallback, which cannot read the format on any version. */
  const heifFn = (java.match(/private static boolean isHeif\(String mime\)[\s\S]*?\n    \}/) || [''])[0];
  const heifSkip = thumbFn.indexOf('heifUnsupported.contains(id)');
  const heifMime = thumbFn.indexOf('isHeif(mimeCache.get(id))');
  const heifGuard = thumbFn.indexOf('Build.VERSION.SDK_INT < 28');
  const heifDecode = thumbFn.indexOf('decodeThumb(', heifMime);
  check('native thumb refuses HEIF below API 28 before opening a stream and remembers the id',
    /image\/heic/.test(heifFn) && /image\/heif-sequence/.test(heifFn) &&
    heifSkip > 0 && heifSkip < heifMime && heifMime > preGuard && heifGuard > heifMime &&
    thumbFn.indexOf('noteHeifUnsupported(id', heifGuard) > heifGuard &&
    heifDecode > heifGuard && thumbFn.indexOf('return null', heifGuard) < heifDecode);

  const decodeFn = (java.match(/private Bitmap decodeThumb\(Uri uri[\s\S]*?\n    \}/) || [''])[0];
  const decPrimary = decodeFn.indexOf('decodeThumbImageDecoder(uri, max)');
  const decHeifStop = decodeFn.indexOf('if (heif)');
  const decFallback = decodeFn.indexOf('return decodeThumbFactory');
  check('native thumb decodes HEIF through ImageDecoder on API 28+ and never retries it on BitmapFactory',
    /boolean heif/.test(decodeFn) && decPrimary > 0 && decHeifStop > decPrimary &&
    decFallback > decHeifStop &&
    /return null/.test(decodeFn.slice(decHeifStop, decFallback)));

  /* 21. The MediaStore projection must carry only columns the row loop consumes: every projected
         column needs its own getColumnIndex lookup, and every one of those lookup variables must
         actually be read afterwards. A column projected but never consumed is a per-row Cursor
         read paid for nothing, which is what this pass removed and what this check keeps out. */
  const projBlock = (java.match(/String\[\] proj = \{([\s\S]*?)\};/) || [])[1] || '';
  const projCols = [...projBlock.matchAll(/MediaStore\.MediaColumns\.(\w+)|"(\w+)"/g)].map((m) => m[1] || m[2]);
  const queryFn = (java.match(/private void queryOne\(List<Item> out, Uri base\)[\s\S]*?\n    \}/) || [''])[0];
  const lookups = [...queryFn.matchAll(/int (i\w+) = c\.getColumnIndex(?:OrThrow)?\(\s*(?:MediaStore\.MediaColumns\.(\w+)|"(\w+)")\s*\)/g)]
    .map((m) => ({ v: m[1], col: m[2] || m[3] }));
  const unlookedUp = projCols.filter((col) => !lookups.some((l) => l.col === col));
  const unread = lookups.filter((l) => (queryFn.split(new RegExp('\\b' + l.v + '\\b')).length - 1) < 2);
  check('native query projects only columns it reads (' + projCols.length + ' columns, ' + lookups.length + ' lookups)',
    projCols.length > 0 && lookups.length === projCols.length && unlookedUp.length === 0 &&
    unread.length === 0);

  /* 22. No Cursor.getColumnIndex inside a row loop. The lookup walks the projection on every
         call, so hoisting it out of the loop is worth eight scans per photo; the query does that
         today and this check keeps a lookup from creeping back into the loop, and keeps every
         lookup ahead of the first moveToNext(). */
  const cursorLoops = (() => {
    const found = [];
    const re = /(?:while|for)\s*\(/g;
    let m;
    while ((m = re.exec(java))) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < java.length && depth > 0) {
        const ch = java[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      const header = java.slice(m.index, i);
      if (!/moveToNext\(\)/.test(header)) continue;
      let j = i;
      while (j < java.length && /\s/.test(java[j])) j++;
      if (java[j] !== '{') continue;
      let d = 0;
      let k = j;
      for (; k < java.length; k++) {
        if (java[k] === '{') d++;
        else if (java[k] === '}') { d--; if (d === 0) { k++; break; } }
      }
      found.push({ start: m.index, body: java.slice(j, k) });
    }
    return found;
  })();
  const loopsWithLookup = cursorLoops.filter((l) => /getColumnIndex(?:OrThrow)?\(/.test(l.body));
  const firstLoopAt = cursorLoops.length ? cursorLoops[0].start : -1;
  const lookupPositions = [...java.matchAll(/int i\w+ = c\.getColumnIndex(?:OrThrow)?\(/g)].map((mm) => mm.index);
  const lateLookups = firstLoopAt >= 0 ? lookupPositions.filter((p) => p > firstLoopAt) : lookupPositions;
  check('native cursor loops hoist every getColumnIndex (' + cursorLoops.length + ' loop(s), ' +
        lookupPositions.length + ' lookup(s))',
    cursorLoops.length > 0 && loopsWithLookup.length === 0 && lateLookups.length === 0);

  /* 23. A library bigger than the cap is read a page at a time. Each query asks the provider for
         one page of rows at an offset (API 26+, where the query args exist; below that the single
         capped query stands) and the read stops on the first short page, so a 40 000-photo library
         never lands in one CursorWindow. The ceiling itself is unchanged: the same 6000 newest
         rows reach the grid, in the same order. */
  const pageSize = (java.match(/MEDIA_PAGE_SIZE = (\d+)/) || [])[1];
  const maxItems = (java.match(/MEDIA_MAX_ITEMS = (\d+)/) || [])[1];
  const pageFn = (java.match(/private Bundle pageArgs\(int offset\)[\s\S]*?\n    \}/) || [''])[0];
  check('native query pages large libraries instead of one whole-library cursor (' +
        (pageSize || '?') + ' rows/page, cap ' + (maxItems || '?') + ')',
    pageSize === '1000' && maxItems === '6000' &&
    /QUERY_ARG_LIMIT, MEDIA_PAGE_SIZE/.test(pageFn) &&
    /QUERY_ARG_OFFSET, offset/.test(pageFn) &&
    /Build\.VERSION\.SDK_INT < 26\) return null/.test(pageFn) &&
    /query\(base, proj, args, null\)/.test(queryFn) &&
    /for \(int page = 0; out\.size\(\) < MEDIA_MAX_ITEMS; page\+\+\)/.test(queryFn) &&
    /out\.size\(\) - before < MEDIA_PAGE_SIZE\) break;/.test(queryFn));

  /* 25. Half-written imports stay out of the grid. The importer inserts a MediaStore row with
         IS_PENDING = 1 and clears it only once the bytes are on disk, and the provider hands
         pending rows to a query in between, so they used to reach the grid as blank tiles. Every
         page query now carries `is_pending = 0` on API 29+, ANDed onto the trash term on API 30+.
         The projection, the sort and the page ceiling are untouched. */
  check('native query hides pending imports on API 29+ (selection is_trashed = 0 AND is_pending = 0)',
    /SDK_INT >= 30\) \{[\s\S]*IS_TRASHED\)\.append\(" = 0"\)/.test(pageFn) &&
    /SDK_INT >= 29\) \{[\s\S]*selection\.append\(" AND "\)[\s\S]*IS_PENDING\)\.append\(" = 0"\)/.test(pageFn) &&
    /selection\.length\(\) > 0\) \{\n            args\.putString\(ContentResolver\.QUERY_ARG_SQL_SELECTION, selection\.toString\(\)\);/.test(pageFn) &&
    pageFn.indexOf('IS_TRASHED') < pageFn.indexOf('IS_PENDING') &&
    !/IS_PENDING[\s\S]*MediaColumns\.WIDTH/.test(queryFn));

  /* 26. The grid orders by capture time, not by file-modification time. A photo whose file was
         touched (edited, re-saved, restored, copied) used to jump to the top of the library even
         though it was taken years ago, because DATE_MODIFIED was the only date read. DATE_TAKEN is
         now projected and read alongside it and wins whenever it is non-zero; DATE_MODIFIED stays
         the fallback (screenshots, downloads, imports and older media have no capture time) and
         stays the disk-thumb stamp, since an edit moves it and a capture time does not. The
         provider sort string is deliberately still DATE_MODIFIED: it is never null and the provider
         only accepts plain column names there, so paging and the 6000-row ceiling return exactly
         the rows they returned before and the capture date only reorders them. */
  const itemClass = (java.match(/private static class Item \{[\s\S]*?\n    \}/) || [''])[0];
  check('native query sorts by DATE_TAKEN with a DATE_MODIFIED fallback',
    /MediaStore\.MediaColumns\.DATE_TAKEN,/.test(projBlock) &&
    /int iTaken = c\.getColumnIndex\(MediaStore\.MediaColumns\.DATE_TAKEN\);/.test(queryFn) &&
    /takenMs > 0 \? takenMs : modifiedMs/.test(queryFn) &&
    /c\.getLong\(iDate\) : 0L\) \* 1000L/.test(queryFn) &&
    !/getLong\(iTaken\)[^;]*\* 1000L/.test(queryFn) &&
    /dateCache\.put\(it\.id, it\.modified\)/.test(queryFn) &&
    /long date, modified, size;/.test(itemClass) &&
    /Long\.compare\(b\.date, a\.date\)/.test(java) &&
    /QUERY_ARG_SQL_SORT_ORDER,\s*\n?\s*MediaStore\.MediaColumns\.DATE_MODIFIED \+ " DESC"/.test(pageFn));

  /* 27. A row with no BUCKET_DISPLAY_NAME costs nothing, and rows that share an album share one
         String. The provider returns null for rows it has no album for, and a freshly allocated
         String for every other row even when a thousand of them name the same album, so a 6000-row
         library used to hold 6000 bucket strings. The row loop now points a null bucket at one
         shared EMPTY constant and pools a repeated album name on the first instance seen, so the
         same values reach the JSON with a handful of strings behind them. */
  const rowLoop = cursorLoops.length ? cursorLoops[0].body : '';
  check('native query pools bucket names and points a null bucket at one shared constant',
    /private static final String EMPTY = "";/.test(java) &&
    /Map<String, String> bucketPool = new HashMap<String, String>\(\);\s*bucketPool\.put\(EMPTY, EMPTY\);/.test(queryFn) &&
    /if \(iB < 0 \|\| c\.isNull\(iB\)\) \{\s*it\.bucket = EMPTY;/.test(rowLoop) &&
    /bucketPool\.get\(raw\)/.test(rowLoop) &&
    /bucketPool\.put\(raw, raw\)/.test(rowLoop) &&
    /it\.bucket = pooled;/.test(rowLoop) &&
    !/\? c\.getString\(iB\) : ""/.test(rowLoop) &&
    !/new String\(/.test(rowLoop));

  /* 28. The library cursor is closed in a finally, on every path. A Cursor holds a CursorWindow
         and a provider-side file descriptor, and the paths that leak one are the ones that are
         easiest to forget: the null cursor the provider hands back, the per-row throw, the
         getColumnIndexOrThrow that fails after the window is open, and the plain early return.
         The audit confirms each of them unwinds through the same finally: the cursor is declared
         outside the try so the finally can see it, the row loop sits inside the try, every
         query() in the file is that one site, and no close() anywhere in the file sits outside a
         finally. The close itself is guarded, so a provider that throws out of close() cannot
         turn a page that has already been read into a failed query. */
  const finallySpans = (() => {
    const spans = [];
    for (const m of java.matchAll(/finally\s*\{/g)) {
      let i = m.index + m[0].length;
      let d = 1;
      while (i < java.length && d > 0) {
        if (java[i] === '{') d++;
        else if (java[i] === '}') d--;
        i++;
      }
      spans.push([m.index, i]);
    }
    return spans;
  })();
  const cursorDecls = [...java.matchAll(/\bCursor\s+\w+\s*=/g)].map((m) => m.index);
  const openSites = [...java.matchAll(/getContentResolver\(\)\.query\(/g)].map((m) => m.index);
  const closeSites = [...java.matchAll(/\bc\.close\(\)/g)].map((m) => m.index);
  const unguardedCloses = closeSites.filter((p) => !finallySpans.some(([a, b]) => p > a && p < b));
  /* queryFn is a slice, so its try/finally offsets are shifted back onto the whole file before
     they are compared with anything found in java. */
  const qStart = java.indexOf('private void queryOne(');
  const qEnd = java.indexOf('private String itemsJson(');
  const qTry = qStart + queryFn.indexOf('try {');
  const qFinally = qStart + queryFn.search(/finally\s*\{/);
  check('native cursor is closed in a finally on every path (' + closeSites.length + ' close site(s), ' +
        openSites.length + ' query site(s), ' + cursorDecls.length + ' cursor(s))',
    cursorDecls.length === 1 && openSites.length > 0 && closeSites.length > 0 &&
    unguardedCloses.length === 0 &&
    qStart > 0 && qEnd > qStart &&
    cursorDecls[0] > qStart && cursorDecls[0] < qTry &&
    /Cursor c = null;\s*try \{/.test(queryFn) &&
    qTry > qStart && qFinally > qTry && qFinally < qEnd &&
    cursorLoops.length > 0 && cursorLoops[0].start > qTry && cursorLoops[0].start < qFinally &&
    /finally \{\s*(?:\/\*[\s\S]*?\*\/\s*)?if \(c != null\) \{\s*try \{\s*c\.close\(\);\s*\} catch \(Exception ignored\) \{\s*\}\s*\}\s*\}/.test(queryFn) &&
    openSites.every((p) => p > qStart && p < qEnd));

  /* 29. A rescan does not rewrite the mime/size maps. The two id-keyed maps behind the thumb
         response, the info sheet and the share type used to be filled row by row on every query —
         two boxed puts, and the occasional resize and rehash, per photo even when nothing in the
         library had changed. The row loop now hands the pair to rememberMeta(), which writes only
         the entry whose value actually differs, so a refresh over an unchanged library performs
         no map writes at all, and each map is capped so an ever-growing library cannot grow it
         forever. dateCache keeps its unconditional put: an edited photo must still restamp. */
  const metaFn = (java.match(/private void rememberMeta\(long id, String mime, long size\)[\s\S]*?\n    \}/) || [''])[0];
  check('native query writes the mime/size maps only when a row changed, and bounds them',
    /private static final int MEDIA_META_CACHE_MAX = 2 \* 6000;/.test(java) &&
    /rememberMeta\(it\.id, it\.mime, it\.size\);/.test(rowLoop) &&
    !/mimeCache\.put\(it\.id, it\.mime\)/.test(rowLoop) &&
    !/sizeCache\.put\(it\.id, it\.size\)/.test(rowLoop) &&
    /oldMime == null \|\| !oldMime\.equals\(mime\)/.test(metaFn) &&
    /oldSize == null \|\| oldSize\.longValue\(\) != size/.test(metaFn) &&
    /mimeCache\.size\(\) >= MEDIA_META_CACHE_MAX\) mimeCache\.clear\(\);/.test(metaFn) &&
    /sizeCache\.size\(\) >= MEDIA_META_CACHE_MAX\) sizeCache\.clear\(\);/.test(metaFn) &&
    /dateCache\.put\(it\.id, it\.modified\)/.test(rowLoop));

  /* 30. The MediaStore query is timed, but only behind Log.isLoggable(DEBUG). Knowing how long
         the provider takes is what separates a slow first frame caused by the library scan from
         one caused by the decode path; it used to be unmeasured. The timing is now taken around
         queryOne(), and both the clock read and the log line sit behind one guard, so a normal
         run pays a single boolean read and prints nothing. */
  const queryMediaFn = (java.match(/private List<Item> queryMedia\(\)[\s\S]*?\n    \}/) || [''])[0];
  check('native query times MediaStore only behind a Log.isLoggable(DEBUG) guard',
    /boolean trace = Log\.isLoggable\(TAG, Log\.DEBUG\);/.test(queryMediaFn) &&
    /long queryStart = trace \? System\.nanoTime\(\) : 0L;/.test(queryMediaFn) &&
    /if \(trace\) \{\s*Log\.d\(TAG, "query "/.test(queryMediaFn) &&
    (queryMediaFn.match(/Log\.d\(/g) || []).length === 1 &&
    (java.match(/Log\.d\(/g) || []).length === 1 &&
    queryMediaFn.indexOf('boolean trace = Log.isLoggable') <
    queryMediaFn.indexOf('long queryStart = trace ?') &&
    queryMediaFn.indexOf('long queryStart = trace ?') < queryMediaFn.indexOf('queryOne(out'));

  /* 31. Reuse one WebResourceResponse header map where it is safe. Every 404 and every asset
         response used to allocate a HashMap and put the same two or three constants into it, on
         the request thread, once per request — a launch pays that for index.html and again for
         each miss. Those shapes now share one unmodifiable map per response type, built once;
         a shared map is only safe because nothing can write to it after it is published, so the
         responses whose headers depend on the request (a thumb's Content-Length, a media
         range's Content-Range) must still build their own. */
  const assetFn = (java.match(/private WebResourceResponse asset\(String path\)[\s\S]*?\n    \}/) || [''])[0];
  const streamFn = (java.match(/private WebResourceResponse streamMedia\(long id[\s\S]*?\n    \}/) || [''])[0];
  const fixedFn = (java.match(/private static Map<String, String> fixedHeaders\(String\.\.\. kv\)[\s\S]*?\n    \}/) || [''])[0];
  check('native reuses one immutable header map per fixed response shape',
    /private static final Map<String, String> NOT_FOUND_HEADERS =/.test(java) &&
    /private static final Map<String, Map<String, String>> ASSET_HEADERS = assetHeaders\(\);/.test(java) &&
    /Collections\.unmodifiableMap\(h\)/.test(fixedFn) &&
    !/new HashMap</.test(notFoundFn) && /NOT_FOUND_HEADERS/.test(notFoundFn) &&
    !/new HashMap</.test(assetFn) && /ASSET_HEADERS\.get\(mime\)/.test(assetFn) &&
    /Map<String, String> h = mediaHeaders\(mime\);/.test(streamFn) &&
    /MEDIA_HEADERS\.put\(mime, h\)/.test(java) &&
    /Map<String, String> lh = new HashMap<String, String>\(h\);/.test(streamFn) &&
    /Map<String, String> rh = new HashMap<String, String>\(h\);/.test(streamFn));

  /* 32. A favicon request never reaches the asset fallback. Chromium asks for /favicon.ico on
         the first paint, the app ships no icon, and the miss used to fall through to the
         index.html fallback — the whole app opened, streamed back and discarded as an icon, on
         every launch and every reload. The request is now answered 204 No Content, from a shared
         unmodifiable header map, before any asset lookup. */
  const interceptFn = (java.match(/public WebResourceResponse shouldInterceptRequest\(WebView view, WebResourceRequest req\)[\s\S]*?\n        \}/) || [''])[0];
  const noContentFn = (java.match(/private WebResourceResponse noContent\(\)[\s\S]*?\n    \}/) || [''])[0];
  check('native answers /favicon.ico with 204 before any asset lookup',
    /private static final Map<String, String> NO_CONTENT_HEADERS =\s*fixedHeaders\("Cache-Control", "no-store", "Content-Length", "0"\);/.test(java) &&
    /if \("\/favicon\.ico"\.equals\(path\)\) return noContent\(\);/.test(interceptFn) &&
    interceptFn.indexOf('"/favicon.ico"') < interceptFn.indexOf('path.startsWith("/thumb/")') &&
    interceptFn.indexOf('"/favicon.ico"') < interceptFn.indexOf('return asset(path)') &&
    /204, "No Content"/.test(noContentFn) &&
    /NO_CONTENT_HEADERS/.test(noContentFn) &&
    !/new HashMap</.test(noContentFn));

  /* 33. No media request may leak a file descriptor — 200 loads must leave 200 streams closed.
         The WebView closes the body it is given, so a response that is handed out is fine; the
         danger is the error path. A malformed Range header (Long.parseLong throws), a failed
         seek, or a FileInputStream that will not build used to reach the catch with the
         AssetFileDescriptor already open and return 404 without closing it — Chromium never saw
         that stream, so nothing else would ever close it, one descriptor per request until
         EMFILE. Both handles are now declared before the try and released in the catch, and the
         only returns after the descriptor opens are the three that hand the stream to a
         response. */
  const mediaOpen = streamFn.indexOf('openAssetFileDescriptor');
  const mediaCatch = streamFn.lastIndexOf('} catch (Exception e) {');
  const mediaTry = streamFn.indexOf('try {');
  /* the null-descriptor guard opens nothing, so counting starts after it */
  const guardStmt = 'if (afd == null) return notFound();';
  const mediaGuard = streamFn.indexOf(guardStmt);
  const handedOut = (streamFn.slice(mediaGuard + guardStmt.length, mediaCatch).match(/return [^;]+;/g) || []);
  const leaky = handedOut.filter((r) => !/new WebResourceResponse/.test(r));
  const mediaCatchBody = streamFn.slice(mediaCatch);
  const releaseFn = (java.match(/private static void releaseMedia\(FileInputStream fis, AssetFileDescriptor afd\)[\s\S]*?\n    \}/) || [''])[0];
  check('native media stream closes the descriptor on every path that returns no response (' +
    handedOut.length + ' hand-off(s), ' + (java.match(/openAssetFileDescriptor/g) || []).length + ' open site(s))',
    /AssetFileDescriptor afd = null;\s*\n\s*FileInputStream fis = null;\s*\n\s*try \{/.test(streamFn) &&
    mediaTry < mediaOpen && mediaOpen > 0 && mediaGuard > mediaOpen && mediaCatch > mediaGuard &&
    handedOut.length === 3 && leaky.length === 0 &&
    /releaseMedia\(fis, afd\);/.test(mediaCatchBody) &&
    mediaCatchBody.indexOf('releaseMedia(fis, afd);') < mediaCatchBody.indexOf('return notFound();') &&
    /if \(fis != null\)/.test(releaseFn) && /try \{ fis\.close\(\); \} catch \(Exception ignored\) \{\}/.test(releaseFn) &&
    /if \(afd != null\)/.test(releaseFn) && /try \{ afd\.close\(\); \} catch \(Exception ignored\) \{\}/.test(releaseFn),
    leaky.slice(0, 2).join(' | '));

  /* 34. The WebView keeps no offscreen raster of the whole page. setOffscreenPreRaster(true)
         is the default and holds a second full-screen bitmap of the document so a stale frame
         can stand in during a redraw; the grid does not need it, and the memory belongs to the
         thumbnails. The call must be present, once, and off. */
  const settingsBlock = (java.match(/WebSettings s = w\.getSettings\(\);([\s\S]*?)w\.addJavascriptInterface/) || ['', ''])[1];
  const offscreenCalls = settingsBlock.match(/setOffscreenPreRaster\([^)]*\)/g) || [];
  check('native WebView keeps no offscreen pre-raster (' + offscreenCalls.length + ' call(s))',
    offscreenCalls.length === 1 && offscreenCalls[0] === 'setOffscreenPreRaster(false)' &&
    /s\.setCacheMode\(WebSettings\.LOAD_NO_CACHE\);\s*\n\s*s\.setOffscreenPreRaster\(false\);/.test(settingsBlock) &&
    (java.match(/setOffscreenPreRaster/g) || []).length === 1);

  /* 35. The frame shown before the page paints belongs to the theme the page is about to use.
         The window background, the root view and the WebView were all one hardcoded dark colour,
         so in Light theme a surface handed back on resume — or a reload — put a #0B0B1A frame
         over a #E9ECFF page. All three now take the colour of the persisted theme, applied once
         before setContentView and again whenever theme() changes it, and nothing sets a literal
         colour outside that helper. */
  const asset = fs.readFileSync(APP, 'utf8');
  const bgFn = (java.match(/private void applyBackground\(boolean light\)[\s\S]*?\n    \}/) || [''])[0];
  const onCreateBody = (java.match(/protected void onCreate\(Bundle savedInstanceState\)[\s\S]*?setContentView\(root\);/) || [''])[0];
  const themeFn = (java.match(/public void theme\(boolean light\)[\s\S]*?\n        \}/) || [''])[0];
  const literalColours = (java.match(/setBackgroundColor\(0x/g) || []).length;
  check('native pre-paint background follows the theme (' + literalColours + ' literal colour(s))',
    /private static final int BG_DARK = 0xFF0B0B1A;/.test(java) &&
    /private static final int BG_LIGHT = 0xFFE9ECFF;/.test(java) &&
    /body\{[^}]*background:#0b0b1a/.test(asset) &&
    /body\.light\{background:#e9ecff\}/.test(asset) &&
    /int bg = light \? BG_LIGHT : BG_DARK;/.test(bgFn) &&
    /root\.setBackgroundColor\(bg\)/.test(bgFn) &&
    /web\.setBackgroundColor\(bg\)/.test(bgFn) &&
    /w\.setBackgroundDrawable\(new ColorDrawable\(bg\)\)/.test(bgFn) &&
    /applyBackground\(\);\s*\n\s*setContentView\(root\);/.test(onCreateBody) &&
    /applyBackground\(l\);/.test(themeFn) &&
    literalColours === 0);

  /* 36. A dead renderer no longer takes the app with it. The renderer runs in its own process
         and the system kills it under memory pressure (or a page crashes it); the default
         onRenderProcessGone lets the framework kill the app too. It is now handled: the activity
         answers true, throws the dead WebView away and puts a freshly built one in the same
         FrameLayout, at the same layout params and with the same IME padding, loading the same
         start URL. The settings, the bridge and the client live in one createWeb() that both the
         launch path and the recovery path call, so the two cannot drift. The override sits in
         RecoverClient, instantiated only on API 26+, because the callback and its parameter type
         do not exist below 26. */
  const createWebFn = (java.match(/private WebView createWeb\(\)[\s\S]*?\n    \}/) || [''])[0];
  const rebuildFn = (java.match(/private void rebuildWebView\(\)[\s\S]*?\n    \}/) || [''])[0];
  const recoverFn = (java.match(/private class RecoverClient extends LocalClient[\s\S]*?\n    \}/) || [''])[0];
  const launchBlock = (java.match(/protected void onCreate\(Bundle savedInstanceState\)[\s\S]*?web\.loadUrl\(HOST \+ "index\.html"\);/) || [''])[0];
  const renderGoneSites = (java.match(/public boolean onRenderProcessGone\(/g) || []).length;
  check('native rebuilds the WebView when the renderer dies (' + renderGoneSites + ' override(s))',
    renderGoneSites === 1 &&
    /public boolean onRenderProcessGone\(WebView view, RenderProcessGoneDetail detail\)/.test(recoverFn) &&
    /if \(view == web\) rebuildWebView\(\);\s*\n\s*return true;/.test(recoverFn) &&
    /private class RecoverClient extends LocalClient/.test(java) &&
    /import android\.webkit\.RenderProcessGoneDetail;/.test(java) &&
    /Build\.VERSION\.SDK_INT >= 26 \? new RecoverClient\(\) : new LocalClient\(\)/.test(createWebFn) &&
    /web = createWeb\(\);/.test(launchBlock) &&
    /web\.loadUrl\(HOST \+ "index\.html"\);/.test(launchBlock) &&
    /root\.removeView\(old\);/.test(rebuildFn) &&
    /old\.destroy\(\);/.test(rebuildFn) &&
    /web = null;/.test(rebuildFn) &&
    /WebView fresh = createWeb\(\);/.test(rebuildFn) &&
    /web = fresh;/.test(rebuildFn) &&
    /fresh\.setPadding\(0, 0, 0, imeBottom\);/.test(rebuildFn) &&
    /root\.addView\(fresh, 0, new FrameLayout\.LayoutParams\(/.test(rebuildFn) &&
    /applyBackground\(\);/.test(rebuildFn) &&
    /fresh\.loadUrl\(HOST \+ "index\.html"\);/.test(rebuildFn));

  /* 37. A main-frame load that fails no longer leaves Chromium's own error page on screen. The
         page owns every control in this app, so an error page is a dead screen with no way back:
         a failed main-frame load of the start URL is now reloaded once, from the same intercept
         path, with the same UI. The retry is bounded — one per load, re-armed only by a page that
         actually finished — and it ignores sub-resource failures, a stale WebView this activity
         already replaced, and the cancelled loads Chromium reports as ERROR_UNKNOWN. */
  const localClientFn = (java.match(/private class LocalClient extends WebViewClient[\s\S]*?\n    \}/) || [''])[0];
  const errorFn = (localClientFn.match(/public void onReceivedError\(WebView view, WebResourceRequest req, WebResourceError err\)[\s\S]*?\n        \}/) || [''])[0];
  const finishedFn = (localClientFn.match(/public void onPageFinished\(WebView view, String url\)[\s\S]*?\n        \}/) || [''])[0];
  const errorSites = (java.match(/public void onReceivedError\(WebView view, WebResourceRequest req, WebResourceError err\)/g) || []).length;
  check('native retries a failed main-frame load once (' + errorSites + ' override(s))',
    errorSites === 1 &&
    /import android\.webkit\.WebResourceError;/.test(java) &&
    /private boolean mainFrameRetried;/.test(localClientFn) &&
    /!req\.isForMainFrame\(\)\) return;/.test(errorFn) &&
    /!"app\.local"\.equals\(u\.getHost\(\)\)\) return;/.test(errorFn) &&
    /if \(view != web\) return;/.test(errorFn) &&
    /if \(mainFrameRetried\) return;/.test(errorFn) &&
    /err\.getErrorCode\(\) == WebViewClient\.ERROR_UNKNOWN\) return;/.test(errorFn) &&
    errorFn.indexOf('mainFrameRetried = true;') > -1 &&
    errorFn.indexOf('mainFrameRetried = true;') < errorFn.indexOf('view.loadUrl(HOST + "index.html");') &&
    errorFn.indexOf('view.loadUrl(HOST + "index.html");') > errorFn.indexOf('!req.isForMainFrame()') &&
    /mainFrameRetried = false;/.test(finishedFn) &&
    !/rebuildWebView\(\)/.test(errorFn));

  /* 38. A destroyed WebView is never called into. Every call into the page is asynchronous — an
         insets push, an IME push, a resume eval, a back-press — so a Runnable posted before
         onDestroy() tore the view down could still be sitting on the UI queue when it ran, and
         evaluateJavascript() on a destroyed WebView throws inside the framework, on the UI thread,
         as an uncaught exception. All four call sites now go through one evalOn() that re-reads
         the field and the liveness flag at the moment of the call, and swallows the throw for the
         window between the two; onDestroy() raises the flag before destroying and clears the field
         after, and a back-press with no live page leaves the app instead of calling into nothing. */
  const evalFn = (java.match(/private boolean evalOn\([\s\S]*?\n    \}/) || [''])[0];
  const destroyFn = (java.match(/protected void onDestroy\(\)[\s\S]*?\n    \}/) || [''])[0];
  const backFn = (java.match(/public void onBackPressed\(\)[\s\S]*?\n    \}/) || [''])[0];
  const evalSites = (java.match(/\.evaluateJavascript\(/g) || []).length;
  const evalCallSites = (java.match(/evalOn\(js, null\);/g) || []).length;
  check('native never calls into a destroyed WebView (' + evalSites + ' evaluateJavascript site(s), ' +
    evalCallSites + ' guarded eval(s))',
    evalSites === 1 &&
    /import android\.webkit\.ValueCallback;/.test(java) &&
    /private boolean webGone;/.test(java) &&
    /WebView w = web;/.test(evalFn) &&
    /if \(w == null \|\| webGone\) return false;/.test(evalFn) &&
    /w\.evaluateJavascript\(js, cb\);/.test(evalFn) &&
    /catch \(Throwable ignored\)/.test(evalFn) &&
    /return true;/.test(evalFn) &&
    evalCallSites === 3 &&
    /webGone = true;/.test(destroyFn) &&
    destroyFn.indexOf('webGone = true;') < destroyFn.indexOf('destroy();') &&
    /web = null;/.test(destroyFn) &&
    /boolean sent = evalOn\(/.test(backFn) &&
    /if \(!sent\) finish\(\);/.test(backFn));

  /* 39. Text autosizing is off, and it stays off across a reload. Chromium's font boosting
         inflates text the page sizes in px whenever it decides the content is too wide for the
         viewport, and the manifest absorbs fontScale/density changes, so nothing recreates the
         activity that would re-apply the pin. The scale is therefore pinned at 100 in the one
         settings block the launch and recovery paths share, re-applied on the live view from
         onConfigurationChanged before the re-layout, and the page itself declares
         -webkit-text-size-adjust:100% — so the retry reload, a rebuilt WebView and a fresh
         document all draw the same text at the same size. */
  const configFn = (java.match(/public void onConfigurationChanged\(Configuration cfg\)[\s\S]*?\n    \}/) || [''])[0];
  const zoomSites = (java.match(/setTextZoom\(/g) || []).length;
  check('native pins text zoom at 100 across reloads (' + zoomSites + ' setTextZoom site(s))',
    zoomSites === 2 &&
    /s\.setTextZoom\(100\);/.test(createWebFn) &&
    !/setTextZoom\((?!100\))/.test(java) &&
    /import android\.content\.res\.Configuration;/.test(java) &&
    /super\.onConfigurationChanged\(cfg\);/.test(configFn) &&
    /WebView w = web;/.test(configFn) &&
    /if \(w == null \|\| webGone\) return;/.test(configFn) &&
    /w\.getSettings\(\)\.setTextZoom\(100\);/.test(configFn) &&
    /-webkit-text-size-adjust:100%/.test(asset) &&
    /text-size-adjust:100%/.test(asset));

  /* 40. The bridge surface carries only what the page calls. `info(String)` was a log relay the
         page stopped using: the page reaches the bridge as window.AndroidNative and every call it
         makes is one of the eleven below. The method is gone, so the bridge no longer exposes a
         channel nobody reads, and no call from the page can be silently swallowed by it. */
  const exposedMethods = (java.match(/@JavascriptInterface\s+public [\w.<>\[\]]+ (\w+)\(/g) || [])
    .map((sig) => sig.match(/(\w+)\($/)[1]);
  const jsBridgeCalls = new Set((asset.match(/\bN\.([A-Za-z_]+)/g) || []).map((s2) => s2.slice(2)));
  check('native bridge exposes only the methods the page calls (' + exposedMethods.length + ' method(s))',
    exposedMethods.length === 11 &&
    !/public void info\(String/.test(java) &&
    exposedMethods.every((m) => jsBridgeCalls.has(m)) &&
    jsBridgeCalls.size > 0);

  /* 41. Drag-select hit-tests the tile it already knows. Once a frame has found the tile under
         the pointer, later frames that stay inside that tile's box reuse it instead of asking
         elementFromPoint again: the box is trusted only while the pointer is still in it, the
         tile is still connected and the scroller has not moved under it. The elementFromPoint
         call stays as the fallback for a pointer that crosses into another tile. */
  const dragRaf = (asset.match(/drag\.raf=requestAnimationFrame\(\(\)=>\{([\s\S]*?)clearInterval\(autoScroll\);autoScroll=null;/) || ['', ''])[1];
  const hitFn = (asset.match(/function hitTile\(d\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  const efrSites = asset.match(/elementFromPoint/g) || [];
  check('drag hit-test reuses the last tile while the pointer stays in it (' + efrSites.length + ' elementFromPoint site(s))',
    /const tile=hitTile\(drag\);/.test(dragRaf) &&
    !/elementFromPoint/.test(dragRaf) &&
    /c\.el\.isConnected/.test(hitFn) &&
    /d\.px>=c\.l&&d\.px<=c\.r&&d\.py>=c\.t&&d\.py<=c\.b/.test(hitFn) &&
    /scr\.scrollTop===c\.st&&scr\.scrollLeft===c\.sl/.test(hitFn) &&
    /return c\.el;/.test(hitFn) &&
    /d\.hit=\{el:tile,/.test(hitFn) &&
    efrSites.length === 2);

  /* 42. The edge auto-scroll stops when the pointer leaves the window. A drag that runs into the
         top or bottom edge starts a 16 ms interval; once the pointer leaves the window no
         pointermove arrives to reset it, so it used to scroll the grid until the pointer came
         back. Each step now checks the last known pointer position against the viewport and
         clears the interval, and the window's boundary / focus events clear it too. */
  const stepFn = (asset.match(/function autoStep\(dir\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  const dragRaf42 = (asset.match(/drag\.raf=requestAnimationFrame\(\(\)=>\{([\s\S]*?)\n    \}\);/) || ['', ''])[1];
  check('drag auto-scroll stops when the pointer leaves the viewport',
    /if\(!drag\|\|drag\.px<0\|\|drag\.py<0\|\|drag\.px>innerWidth\|\|drag\.py>innerHeight\)\{stopAutoScroll\(\);return\}/.test(stepFn) &&
    /scr\.scrollTop\+=dir;/.test(stepFn) &&
    /function stopAutoScroll\(\)\{if\(autoScroll\)\{clearInterval\(autoScroll\);autoScroll=null\}\}/.test(asset) &&
    /setInterval\(\(\)=>autoStep\(-14\),16\)/.test(dragRaf42) &&
    /setInterval\(\(\)=>autoStep\(14\),16\)/.test(dragRaf42) &&
    /\['pointerleave','blur'\]\.forEach\(n=>addEventListener\(n,stopAutoScroll,true\)\)/.test(asset) &&
    /addEventListener\('visibilitychange',\(\)=>\{if\(document\.hidden\)stopAutoScroll\(\)\}\)/.test(asset));

  /* 43. A pointercancel tears an in-flight drag down. The browser takes the gesture away when it
         starts a native scroll, the app goes to the background or a system gesture wins, and no
         pointerup follows — the drag used to stay in flight with its pending frame and its edge
         auto-scroll. The scroller only sees that cancel when the pointer was captured to it or was
         still over it, so the window listens too (capture phase), and the drag's own pointer id is
         checked so a cancel for another finger does not end this drag. */
  const endFn = (asset.match(/function endDrag\(\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  const cancelFn = (asset.match(/function cancelDrag\(e\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  check('drag is cancelled when the browser takes the pointer (pointercancel)',
    /function cancelDrag\(e\)\{/.test(asset) &&
    /if\(e&&e\.pointerId!=null&&dragPid!=null&&e\.pointerId!==dragPid\)return;/.test(cancelFn) &&
    /endDrag\(\);/.test(cancelFn) &&
    /addEventListener\('pointercancel',cancelDrag,true\)/.test(asset) &&
    /\['pointerup','pointercancel','pointerleave'\]\.forEach\(n=>scr\.addEventListener\(n,endDrag\)\)/.test(asset) &&
    /lpStart=\{x:e\.clientX,y:e\.clientY\}; dragPid=e\.pointerId;/.test(asset) &&
    /scr\.releasePointerCapture\(dragPid\)/.test(endFn) &&
    /dragPid=null;/.test(endFn) &&
    /cancelAnimationFrame\(drag\.raf\)/.test(endFn) &&
    /clearInterval\(autoScroll\);autoScroll=null;/.test(endFn));

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' PASS' + (failed.length ? ', ' + failed.length + ' FAIL' : ''));
  if (VERBOSE && failed.length) console.log(failed.map((f) => f.name).join('\n'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('suite failed:', e && e.message);
  process.exit(1);
});

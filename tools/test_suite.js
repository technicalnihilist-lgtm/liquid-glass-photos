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
    '},requestAccess(){},photos(){return JSON.stringify({count:ITEMS.length,items:ITEMS})},favs(){return "[]"},setFav(){},share(){},delete(){},pick(){},theme(){},info(){},setTilt(){}};})();</script>'
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
  check('native thumb 404 sets Content-Length 0', /h\.put\("Content-Length", "0"\)/.test(notFoundFn));

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

#!/usr/bin/env node
/*
 * First-frame benchmark for a large library.
 *
 * Runs the real app/assets/index.html in headless Chromium with the native
 * bridge stubbed out, the way tools/gen_preview.py does, but with a library of
 * N photos (default 2000) instead of 44. /thumb/<id> is served from a local
 * HTTP server so the WebView-style thumbnail fetch is included in the timing,
 * and every tile image is a real JPEG so decode cost is real.
 *
 * Reported, all in milliseconds from navigation start:
 *   shell   - first animation frame after the app's own boot render (chrome only)
 *   first   - the first grid tile is on screen with its thumbnail decoded and painted
 *   all     - every tile of the library is in the DOM
 *
 * usage: node tools/bench_first_frame.js [--count=2000] [--runs=5] [--json]
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
const COUNT = parseInt(arg('count', '2000'), 10);
const RUNS = parseInt(arg('runs', '5'), 10);
const AS_JSON = argv.includes('--json');
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium';

// one 160x160 JPEG, inlined so the benchmark has no data files to lose
const THUMB = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACgAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmNtG2pNtG2vpLnmWI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WH4oxUmKMVlcuxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxJto21Jto21nc0sR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsSYoxT8UYrO5pYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYk20bakxRisrmliPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiTFGKk20bazuXYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYfto21JijFZ3NLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEmKMVJto21lc0sR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsSbaNtPxRis7l2GbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WJMUYqTbRtrO5pYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhY/9k=',
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
      s: 1_900_000 + i * 977,
      w: 1080,
      h: i % 3 === 0 ? 1080 : 810,
    });
  }
  return items;
}

const ITEMS = library(COUNT);

const stub =
  '<script>(function(){window.__benchCount=' +
  COUNT +
  ';const ITEMS=' +
  JSON.stringify(ITEMS) +
  ';window.AndroidNative={meta(){return JSON.stringify({sdk:34,device:"Pixel 8",android:"14",access:true,insetTop:74,insetBottom:48,light:false})},access(){return true},requestAccess(){},photos(){return JSON.stringify({count:ITEMS.length,items:ITEMS})},favs(){return "[]"},setFav(){},share(){},delete(){},pick(){},theme(){},info(){},setTilt(){}};})();</script>';

const html = fs
  .readFileSync(APP, 'utf8')
  .replace('<body>', '<body>\n' + stub, 1);

function instrument() {
  window.__bench = { shell: null, imgLoad: null, first: null, all: null, tiles: 0 };
  const b = window.__bench;
  requestAnimationFrame(() => {
    b.shell = performance.now();
  });
  let firstDone = false;
  new MutationObserver(() => {
    const tiles = document.querySelectorAll('.tile');
    b.tiles = tiles.length;
    if (b.all === null && tiles.length && tiles.length === window.__benchCount) b.all = performance.now();
    if (firstDone) return;
    const img = document.querySelector('.tile img');
    if (!img) return;
    firstDone = true;
    const paint = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          b.first = performance.now();
        })
      );
    const loaded = () => {
      b.imgLoad = performance.now();
      paint();
    };
    if (img.complete && img.naturalWidth) loaded();
    else {
      img.addEventListener('load', loaded, { once: true });
      img.addEventListener('error', loaded, { once: true });
    }
  }).observe(document, { childList: true, subtree: true });
}

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

(async () => {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (/^\/thumb\/\d+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      res.end(THUMB);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1 },
  });

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(instrument);
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
    await page.waitForFunction('window.__bench && window.__bench.first !== null', { timeout: 60000 });
    const b = await page.evaluate(() => window.__bench);
    runs.push(b);
    await page.close();
  }
  await browser.close();
  server.close();

  const out = {
    photos: COUNT,
    runs: RUNS,
    shell: r1(median(runs.map((r) => r.shell))),
    imgLoad: r1(median(runs.map((r) => r.imgLoad))),
    first: r1(median(runs.map((r) => r.first))),
    all: r1(median(runs.map((r) => r.all))),
    samples: runs.map((r) => ({ shell: r1(r.shell), imgLoad: r1(r.imgLoad), first: r1(r.first), all: r1(r.all), tiles: r.tiles })),
  };

  if (AS_JSON) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log('library: ' + COUNT + ' photos, ' + RUNS + ' runs, median of runs (ms from navigation start)');
  console.log('  shell  (chrome painted, empty state): ' + out.shell);
  console.log('  img    (first thumbnail decoded):       ' + out.imgLoad);
  console.log('  first  (first tile decoded + painted): ' + out.first);
  console.log('  all    (every tile in the DOM):        ' + out.all);
  console.log('  samples: ' + JSON.stringify(out.samples));
})().catch((e) => {
  console.error('bench failed:', e && e.message);
  process.exit(1);
});

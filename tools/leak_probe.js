#!/usr/bin/env node
/*
 * Viewer leak probe — item 69 of OPTIMIZATION_PLAN.md.
 *
 * Opens and closes the viewer 50 times on the same library and reports, after a forced GC,
 * what the page still holds: DOM nodes, live .viewer subtrees, img elements still pointing at a
 * src, window/document event listeners, and the JS heap. A leak shows up as any of those growing
 * with the cycle count; a stable page shows all of them flat.
 *
 * usage: node tools/leak_probe.js [--cycles=50] [--count=60]
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
const CYCLES = parseInt(arg('cycles', '50'), 10);
const COUNT = parseInt(arg('count', '60'), 10);
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium';
/* --control runs the same loop with the open/close skipped, so the growth the harness itself
   causes (the evaluate round trips, the settle timers) can be subtracted from the real one */
const CONTROL = argv.includes('--control');

const THUMB = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCACgAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmNtG2pNtG2vpLnmWI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WI9tG2pNtG2i4WH4oxUmKMVlcuxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMUXCxHijFSYoxRcLEeKMVJijFFwsR4oxUmKMVlc0sR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsR7aNtSbaNtFwsSYoxT8UYrO5pYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYZijFPxRii4WGYoxT8UYouFhmKMU/FGKLhYk20bakxRisrmliPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiPbRtqTFGKLhYj20bakxRii4WI9tG2pMUYouFiTFGKk20bazuXYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYfto21JijFZ3NLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEe2jbUmKMUXCxHto21JijFFwsR7aNtSYoxRcLEmKMVJto21lc0sR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsR4oxUm2jbRcLEeKMVJto20XCxHijFSbaNtFwsSbaNtPxRis7l2GbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WGbaNtPxRii4WJMUYqTbRtrO5pYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhYjxRipNtG2i4WI8UYqTbRtouFiPFGKk20baLhY/9k=',
  'base64'
);

function library(n) {
  const buckets = ['Camera', 'Camera', 'Camera', 'WhatsApp Images', 'Download', 'Instagram', 'DCIM', 'Screenshots'];
  const now = Date.UTC(2026, 9, 30, 11, 20);
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: i + 1,
      n: 'IMG_2026' + String(1000 + i) + '.jpg',
      b: buckets[i % buckets.length],
      d: now - i * 3 * 60 * 60 * 1000,
      s: 1900000 + i * 977,
      w: 1080,
      h: i % 3 === 0 ? 1080 : 810,
    });
  }
  return items;
}

function stubFor(items) {
  return (
    '<script>(function(){const ITEMS=' + JSON.stringify(items) +
    ';window.AndroidNative={meta(){return JSON.stringify({sdk:34,device:"Pixel 8",android:"14",access:true,insetTop:74,insetBottom:48,light:false})},' +
    'access(){return true},requestAccess(){},photos(){return JSON.stringify({items:ITEMS})},favs(){return "[]"},' +
    'setFav(){},share(){},delete(){},pick(){},theme(){},setTilt(){}};})();</script>'
  );
}

(async () => {
  const stub = stubFor(library(COUNT));
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(APP, 'utf8').replace('<body>', '<body>\n' + stub, 1);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (/^\/(thumb|media)\/\d+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      res.end(THUMB);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
      '--enable-precise-memory-info', '--js-flags=--expose-gc',
    ],
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message)));
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 30000 }, COUNT);

  const cdp = await page.target().createCDPSession();
  await cdp.send('HeapProfiler.enable');

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  async function snapshot() {
    await cdp.send('HeapProfiler.collectGarbage');
    await settle(120);
    await cdp.send('HeapProfiler.collectGarbage');
    return page.evaluate(() => ({
      nodes: document.getElementsByTagName('*').length,
      viewers: document.querySelectorAll('.viewer').length,
      slides: document.querySelectorAll('.slide').length,
      imgs: document.querySelectorAll('img').length,
      imgsWithSrc: document.querySelectorAll('img[src]').length,
      tiles: document.querySelectorAll('.tile').length,
      heap: performance.memory ? performance.memory.usedJSHeapSize : -1,
    }));
  }

  async function listenerCount() {
    /* window + document listeners are the ones a viewer can outlive; the ones on the viewer's own
       nodes die with the subtree, so they are not counted here */
    const out = {};
    for (const expr of ['window', 'document']) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      out[expr] = listeners.length;
    }
    return out;
  }

  const open = async () => {
    await page.evaluate(() => {
      const t = document.querySelectorAll('.tile')[10];
      t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(() => !!document.querySelector('.viewer'), { timeout: 10000 });
  };
  const close = async () => {
    await page.evaluate(() => {
      const b = document.querySelector('.viewer [data-v="close"]');
      if (b) b.click();
    });
    await page.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
    await settle(340);
  };

  /* one warm-up cycle first: the first open pays for the font/image cache and the CSS the viewer
     uses, which is a one-off cost and would otherwise read as growth */
  await open();
  await close();
  await settle(300);

  const before = await snapshot();
  const lBefore = await listenerCount();

  for (let k = 1; k <= CYCLES; k++) {
    if (!CONTROL) {
      await open();
      await settle(60);
      await close();
    } else {
      await settle(400);
    }
    if (k % 10 === 0) {
      const s = await snapshot();
      console.log('cycle ' + k + ': nodes ' + s.nodes + ', viewers ' + s.viewers +
        ', slides ' + s.slides + ', img[src] ' + s.imgsWithSrc + ', heap ' +
        (s.heap / 1024).toFixed(0) + ' KB');
    }
  }
  await settle(400);
  const after = await snapshot();
  const lAfter = await listenerCount();

  console.log('');
  console.log('after ' + CYCLES + ' open/close cycles:');
  console.log('  DOM nodes      ' + before.nodes + ' -> ' + after.nodes + '  (' + (after.nodes - before.nodes) + ')');
  console.log('  .viewer left   ' + after.viewers);
  console.log('  .slide left    ' + after.slides);
  console.log('  img[src]       ' + before.imgsWithSrc + ' -> ' + after.imgsWithSrc);
  console.log('  tiles          ' + before.tiles + ' -> ' + after.tiles);
  console.log('  window listeners ' + lBefore.window + ' -> ' + lAfter.window);
  console.log('  document listeners ' + lBefore.document + ' -> ' + lAfter.document);
  console.log('  JS heap        ' + (before.heap / 1024).toFixed(0) + ' KB -> ' +
    (after.heap / 1024).toFixed(0) + ' KB  (' + ((after.heap - before.heap) / 1024).toFixed(0) + ' KB)');
  console.log('  page errors    ' + (errors.length ? errors.join(' | ') : 'none'));

  await browser.close();
  server.close();
})();

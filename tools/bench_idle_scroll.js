#!/usr/bin/env node
/*
 * Idle-scroll cost benchmark.
 *
 * Item 80 of the optimisation plan asks what ten minutes of idle scrolling costs
 * the battery. A headless browser cannot read a battery, so this measures the
 * part the app is responsible for and that a phone would pay for: the CPU time
 * the WebView render process spends while the grid is scrolled and while it is
 * left alone, and the work that scroll drives (prefetch probes, thumbnail
 * requests, timers armed).
 *
 * The page is the real app/assets/index.html with the native bridge stubbed, the
 * way tools/bench_first_frame.js runs it, on a library of N photos with
 * /thumb/<id> served from a local HTTP server.
 *
 * Two windows are measured on the same page, back to back:
 *   scroll - a continuous slow drag, ~6 px per frame, the way a thumb resting on
 *            the grid moves it, for --seconds
 *   idle   - no input at all for --seconds, the same page left open
 *
 * CPU time comes from CDP Performance.getMetrics: TaskDuration is the renderer's
 * main-thread busy time, and the script/layout/style splits say where it went.
 * Wall time is measured separately, so a window that is starved of frames shows
 * up as a low frame count rather than as free work.
 *
 * The ten-minute figure is a projection: the measured per-second rate times 600.
 * The milliamp-hours are a projection too, from an explicitly stated model (a
 * 4500 mAh pack at 3.85 V and 1.0 W for a core busy on this work) - read them as
 * an order of magnitude for the app's own CPU, not as a phone battery reading.
 * The display itself, which dominates a real phone's draw while the grid is on
 * screen, is not in this number and is the same for every pass.
 *
 * usage: node tools/bench_idle_scroll.js [--count=2000] [--seconds=60] [--json]
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
const SECONDS = parseFloat(arg('seconds', '60'));
const MODE = arg('mode', 'full'); // full | noblobs | nopre - see the two controls below
const AS_JSON = argv.includes('--json');
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium';

/* the model the mAh column is projected from - change it here, not in the prose */
const PACK_MAH = 4500;
const PACK_V = 3.85;
const BUSY_W = 1.0; // a core busy on this work
const MINUTES = 10;

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

const ITEMS = library(COUNT);

const stub =
  '<script>(function(){const ITEMS=' +
  JSON.stringify(ITEMS) +
  ';window.AndroidNative={meta(){return JSON.stringify({sdk:34,device:"Pixel 8",android:"14",access:true,insetTop:74,insetBottom:48,light:false})},access(){return true},requestAccess(){},photos(){return JSON.stringify({count:ITEMS.length,items:ITEMS})},favs(){return "[]"},setFav(){},share(){},delete(){},pick(){},theme(){},setTilt(){}};})();</script>';

/* the three wallpaper blobs run a permanent `float` animation under a 60 px
   blur. On a phone that is a composited transform; in a software-rendered
   headless browser it re-rasters three 60 vmax layers every frame and swamps
   everything else, so --mode=noblobs freezes it to show what the app's own
   scroll path costs on its own. Measurement control only - nothing ships. */
const NOBLOBS =
  '<style>.blobs i{animation-play-state:paused !important}</style>';

/* --mode=nopre boots with the page's own prefetch switch off (window.__noPre,
   which the page documents as leaving the UI identical), so the same scroll
   can be run without the thumbnail probe and the two compared. */
const NOPRE = MODE === 'nopre' ? '<script>window.__noPre=1;</script>' : '';

const html = fs
  .readFileSync(APP, 'utf8')
  .replace('<body>', '<body>\n' + stub + NOPRE, 1)
  .replace('</head>', (MODE === 'noblobs' ? NOBLOBS : '') + '</head>', 1);

/* Counts what the scroll path does from inside the page: frames, probes (one
   requestAnimationFrame callback per scroll burst), and every timer the page
   arms while the window is open. */
function instrument() {
  const b = (window.__idle = { frames: 0, timers: 0, intervals: 0, scrolled: 0 });
  const st = window.setTimeout;
  const si = window.setInterval;
  window.setTimeout = function () {
    b.timers++;
    return st.apply(this, arguments);
  };
  window.setInterval = function () {
    b.intervals++;
    return si.apply(this, arguments);
  };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    return raf.call(window, function (t) {
      b.frames++;
      return fn.call(this, t);
    });
  };
}

const num = (m, k) => (typeof m[k] === 'number' ? m[k] : 0);

(async () => {
  const thumbs = { total: 0, ids: new Set() };
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (/^\/thumb\/\d+$/.test(url)) {
      thumbs.total++;
      thumbs.ids.add(url);
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

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(instrument);
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 90000 }, COUNT);

  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const metrics = async () => {
    const { metrics: list } = await cdp.send('Performance.getMetrics');
    const m = {};
    list.forEach((x) => (m[x.name] = x.value));
    return m;
  };

  /* one window: reset the page counters, run for `ms`, read the renderer's own
     CPU accounting across it. `scroll` decides whether the grid moves. */
  async function window_(label, ms, scroll) {
    const a = await metrics();
    const before = await page.evaluate(() => ({ frames: window.__idle.frames, timers: window.__idle.timers, intervals: window.__idle.intervals }));
    const thumbStart = thumbs.total;
    const wallStart = Date.now();
    await page.evaluate(
      (ms, scroll) =>
        new Promise((done) => {
          const el = document.querySelector('#screen');
          const end = performance.now() + ms;
          let moved = 0;
          const step = () => {
            if (scroll && el) {
              const max = el.scrollHeight - el.clientHeight;
              el.scrollTop = el.scrollTop + 6 > max ? 0 : el.scrollTop + 6;
              moved += 6;
            }
            if (performance.now() < end) requestAnimationFrame(step);
            else done(moved);
          };
          requestAnimationFrame(step);
        }),
      ms,
      scroll
    );
    const wall = (Date.now() - wallStart) / 1000;
    const b = await metrics();
    const after = await page.evaluate(() => ({ frames: window.__idle.frames, timers: window.__idle.timers, intervals: window.__idle.intervals }));
    const d = (k) => Math.max(0, num(b, k) - num(a, k));
    const sec = wall;
    return {
      label,
      seconds: Math.round(sec * 100) / 100,
      frames: after.frames - before.frames,
      timers: after.timers - before.timers,
      intervals: after.intervals - before.intervals,
      task: d('TaskDuration'),
      script: d('ScriptDuration'),
      layout: d('LayoutDuration'),
      style: d('RecalcStyleDuration'),
      thread: d('ThreadTime'),
      process: d('ProcessTime'),
      cpuPerSec: d('TaskDuration') / sec,
      thumbs: thumbs.total - thumbStart,
      thumbIds: thumbs.ids.size,
    };
  }

  const scroll = await window_('scroll', SECONDS * 1000, true);
  const idle = await window_('idle', SECONDS * 1000, false);

  await browser.close();
  server.close();

  const round = (x, p) => Math.round(x * Math.pow(10, p)) / Math.pow(10, p);
  const mah = (cpuSec) => ((BUSY_W * (cpuSec / 3600)) / PACK_V) * 1000;
  const project = (w) => ({
    label: w.label,
    cpuSecPerMin: round(w.cpuPerSec * 60, 2),
    cpuSec10min: round(w.cpuPerSec * 60 * MINUTES, 1),
    pctOfMinute: round((w.cpuPerSec * 60) / 60 * 100, 2),
    mah10min: round(mah(w.cpuPerSec * 60 * MINUTES), 1),
    pctOfPack: round((mah(w.cpuPerSec * 60 * MINUTES) / PACK_MAH) * 100, 2),
    fps: round(w.frames / w.seconds, 1),
    thumbsPerMin: round((w.thumbs / w.seconds) * 60, 1),
    timersPerMin: round((w.timers / w.seconds) * 60, 2),
  });

  const out = {
    photos: COUNT,
    mode: MODE,
    windowSeconds: SECONDS,
    model: { packMah: PACK_MAH, packV: PACK_V, busyW: BUSY_W, minutes: MINUTES },
    windows: [scroll, idle].map((w) => ({
      label: w.label,
      seconds: w.seconds,
      frames: w.frames,
      task: round(w.task, 3),
      script: round(w.script, 3),
      layout: round(w.layout, 3),
      style: round(w.style, 3),
      thread: round(w.thread, 3),
      process: round(w.process, 3),
      cpuPerSec: round(w.cpuPerSec, 4),
      thumbs: w.thumbs,
      timers: w.timers,
      intervals: w.intervals,
    })),
    projected: [scroll, idle].map(project),
  };

  if (AS_JSON) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log('library: ' + COUNT + ' photos, ' + SECONDS + ' s per window, 412x915 viewport, mode ' + MODE);
  for (const w of out.windows) {
    console.log(
      '  ' +
        w.label.padEnd(6) +
        ' task ' +
        String(w.task).padStart(7) +
        ' s  script ' +
        String(w.script).padStart(6) +
        '  layout ' +
        String(w.layout).padStart(6) +
        '  style ' +
        String(w.style).padStart(6) +
        '  cpu/s ' +
        String(w.cpuPerSec).padStart(7) +
        '  frames ' +
        String(w.frames).padStart(5) +
        '  thumbs ' +
        String(w.thumbs).padStart(5) +
        '  timers ' +
        w.timers +
        '/' +
        w.intervals
    );
  }
  const dScript = (scroll.script / scroll.seconds - idle.script / idle.seconds) * 1000;
  const dTask = (scroll.task / scroll.seconds - idle.task / idle.seconds) * 1000;
  const sg = (x) => (x < 0 ? '' : '+') + round(x, 1);
  console.log(
    'scroll over idle: ' +
      sg(dScript) +
      ' ms/s of script, ' +
      sg(dTask) +
      ' ms/s of main-thread task  (per ' +
      MINUTES +
      ' min: ' +
      sg((dScript * 60 * MINUTES) / 1000) +
      ' s of script)'
  );
  console.log('projected to ' + MINUTES + ' min (' + PACK_MAH + ' mAh @ ' + PACK_V + ' V, ' + BUSY_W + ' W busy):');
  for (const p of out.projected) {
    console.log(
      '  ' +
        p.label.padEnd(6) +
        ' cpu ' +
        String(p.cpuSec10min).padStart(6) +
        ' s  (' +
        p.pctOfMinute +
        '% of wall)  ' +
        p.mah10min +
        ' mAh  (' +
        p.pctOfPack +
        '% of pack)  ' +
        p.fps +
        ' fps  ' +
        p.thumbsPerMin +
        ' thumbs/min  ' +
        p.timersPerMin +
        ' timers/min'
    );
  }
})().catch((e) => {
  console.error('bench failed:', e && e.message);
  process.exit(1);
});

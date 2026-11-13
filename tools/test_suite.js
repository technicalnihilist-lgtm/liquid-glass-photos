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
  /* ids whose full-size fetch must answer 404, the way the native client does for a photo that
     was deleted or moved on disk behind the app's back */
  const missMedia = new Set();

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
      if (missMedia.has(Number(url.slice(7)))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end();
        return;
      }
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

  /* 7b. (44) A tap in selection mode toggles exactly the tile under the finger, once. The
         selection is armed on pointerdown but applied only after the pointer has moved 6 px,
         so a tap that never moves is left to the click handler — one toggle, not two — and a
         real drag still paints every tile it crosses. */
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  await page.click('.tile');
  await settle(300);
  const tapSel = await page.$$eval('.tile.on', (n) => n.length);
  await page.click('.tile');
  await settle(300);
  const tapSel2 = await page.$$eval('.tile.on', (n) => n.length);
  const c0 = await page.$eval('.tile', (t) => {
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(c0.x, c0.y + 3);
  await settle(120);
  const preDrag = await page.$$eval('.tile.on', (n) => n.length);
  await page.mouse.move(c0.x, c0.y + 40, { steps: 4 });
  await settle(120);
  const dragSel = await page.$$eval('.tile.on', (n) => n.length);
  await page.mouse.up();
  await settle(200);
  const afterDrag = await page.$$eval('.tile.on', (n) => n.length);
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('selection: a tap toggles one tile once, a 6 px drag selects (tap ' + tapSel + '/' + tapSel2 +
    ', 3 px ' + preDrag + ', drag ' + dragSel + ', after ' + afterDrag + ')',
    tapSel === 1 && tapSel2 === 0 && preDrag === 0 && dragSel >= 1 && afterDrag === dragSel);

  /* 7c. (45) A long press starts the selection when it fires — on the press, not on the lift —
         and the release that follows does not toggle the tile a second time. The same gesture
         used to work only outside selection mode: inside it the press armed nothing, the timer
         never ran, and the tile was selected by the click on release instead. */
  const centerOf = (i) => page.evaluate((k) => {
    const t = document.querySelectorAll('.tile')[k];
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, i);
  const onCount = () => page.$$eval('.tile.on', (n) => n.length);
  const hold = async (p, ms) => {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await settle(ms);
  };
  const release = async () => {
    await page.mouse.up();
    await settle(320);
  };
  const lp1 = await centerOf(0);
  await hold(lp1, 650);
  const lpHeld = await onCount();          // selection mode entered, tile painted while held
  await release();
  const lpUp = await onCount();            // and the lift changes nothing
  const lp2 = await centerOf(3);
  await hold(lp2, 650);
  const lpSelHeld = await onCount();       // second hold, now in selection mode: painted on the press
  await release();
  const lpSelUp = await onCount();
  await hold(lp2, 650);                    // holding a selected tile deselects it, once, at the press
  const lpOffHeld = await onCount();
  await release();
  const lpOffUp = await onCount();
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('long press starts selection on the press, the release does not toggle again (' +
    'held ' + lpHeld + ', up ' + lpUp + ', sel-mode held ' + lpSelHeld + ', up ' + lpSelUp +
    ', deselect held ' + lpOffHeld + ', up ' + lpOffUp + ')',
    lpHeld === 1 && lpUp === 1 && lpSelHeld === 2 && lpSelUp === 2 &&
    lpOffHeld === 1 && lpOffUp === 1);

  /* 7d. (46) The count in the title follows the list when the list changes under it. A
         selection is a set of photo ids, and nothing re-checked that those ids were still in
         the list the user is looking at: a library reload after a delete or a resume, and a
         search query or a chip typed under an open selection, all left the title counting
         photos that were no longer on screen (and the bar acting on them). Here a long press
         selects one search result, then the query is narrowed until that photo drops out of
         the results — the count must fall back to the empty-selection text on its own. */
  const ttlText = () => page.$eval('.head .ttl', (t) => t.textContent.trim());
  // the tabs re-enter with a 750 ms popIn scale animation, so a click measured mid-flight
  // lands nowhere near the button: let the render settle before clicking it
  await settle(800);
  await page.click('.tabs .round');
  await page.waitForSelector('#q', { timeout: 10000 });
  await page.type('#q', 'Camera');
  await page.waitForFunction(() => document.querySelectorAll('#res .tile').length > 0, { timeout: 10000 });
  const r0 = await page.$eval('#res .tile', (t) => {
    const b = t.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.move(r0.x, r0.y);
  await page.mouse.down();
  await settle(650);
  await page.mouse.up();
  await settle(320);
  const countBefore = await ttlText();
  const onBefore = await page.$$eval('#res .tile.on', (n) => n.length);
  await page.click('#q');
  await page.keyboard.type('zzz');
  await page.waitForFunction(() => {
    const e = document.querySelector('#res .empty');
    return !!e && /no matches/i.test(e.textContent);
  }, { timeout: 10000 });
  await settle(200);
  const countAfter = await ttlText();
  const onAfter = await page.$$eval('.tile.on', (n) => n.length);
  await page.click('#q', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => {
    const e = document.querySelector('#res .empty');
    return !!e && /search by name/i.test(e.textContent);
  }, { timeout: 10000 });
  await page.click('[data-act="endsel"]');
  await page.click('#pill button[data-tab="library"]');
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  await settle(250);
  check('selection count follows the list when the list changes under it (' +
    countBefore + ' / ' + countAfter + ', on ' + onBefore + ' -> ' + onAfter + ')',
    countBefore === '1 selected' && countAfter === 'Select items' && onBefore === 1 && onAfter === 0);

  /* 7d2. (50) "All" selects the current filter, not the library behind it. The header button
         was only ever pinned against the unfiltered grid, so nothing said what it should do
         when a query or an album has narrowed the list: here it is pressed with the search
         results on screen and the ids it collects are compared with the tiles that filter
         actually painted — the selection may hold no photo outside them and must paint every
         one of them. */
  await settle(800);                       // the tabs re-enter with a 750 ms popIn scale
  await page.click('.tabs .round');
  await page.waitForSelector('#q', { timeout: 10000 });
  await page.type('#q', 'Camera');
  await page.waitForFunction(() => document.querySelectorAll('#res .tile').length > 0, { timeout: 10000 });
  await settle(250);
  const resIds = await page.$$eval('#res .tile', (n) => n.map((t) => +t.dataset.id));
  const q0 = await page.$eval('#res .tile', (t) => {
    const b = t.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await hold(q0, 650);                     // long press a result: selection mode over the results
  await release();
  await page.click('[data-act="selall"]');
  await settle(300);
  const qSel = await page.evaluate(() => [...S.sel]);
  const qOn = await page.$$eval('#res .tile.on', (n) => n.length);
  const qOut = qSel.filter((id) => resIds.indexOf(id) < 0).length;
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('All in the search tab selects exactly the ' + resIds.length + ' filtered results (' +
    qSel.length + ' picked, ' + qOn + ' painted, ' + qOut + ' outside the filter)',
    resIds.length > 0 && resIds.length < COUNT && qSel.length === resIds.length &&
    qOn === resIds.length && qOut === 0);

  /* 7d3. (50) and inside an album it takes the album, not the library: the Camera album is a
         strict subset of the grid, so a select-all that reached for the whole library would
         overrun it by every other photo. */
  await page.click('#pill button[data-tab="albums"]');
  await settle(700);
  await page.evaluate(() => document.querySelector('.album[data-album="camera"]').click());
  await page.waitForFunction(() => document.querySelectorAll('.tile').length > 0, { timeout: 10000 });
  await settle(300);
  const albIds = await page.$$eval('.tile', (n) => n.map((t) => +t.dataset.id));
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  await page.click('[data-act="selall"]');
  await settle(300);
  const aSel = await page.evaluate(() => [...S.sel]);
  const aOn = await page.$$eval('.tile.on', (n) => n.length);
  const aOut = aSel.filter((id) => albIds.indexOf(id) < 0).length;
  await page.click('[data-act="endsel"]');
  await page.click('#pill button[data-tab="library"]');
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  await settle(250);
  check('All inside an album selects exactly the ' + albIds.length + ' album photos (' +
    aSel.length + ' picked, ' + aOn + ' painted, ' + aOut + ' outside the album)',
    albIds.length > 0 && albIds.length < COUNT && aSel.length === albIds.length &&
    aOn === albIds.length && aOut === 0);

  /* 7d4. (50) the shape that keeps it so: one select-all helper reading the same `current()`
         list every render paints from — never the library `P` — and both entry points, the
         header button and the swipe to the right edge, going through it. */
  const selSrc = fs.readFileSync(APP, 'utf8');
  const selBody = (selSrc.match(/function selectAll\(\)\{[\s\S]*?\n\}/) || [''])[0];
  const edgeAll = /if\(drag\.state&&e\.clientX>innerWidth\*\.94\)\{\s*\n\s*const list=current\(\);/.test(selSrc);
  const btnAll = /else if\(a==='selall'\)\{selectAll\(\)\}/.test(selSrc);
  check('select-all reads the filtered list (current()) at both entry points',
    /const list=current\(\);/.test(selBody) && selBody.indexOf('P.') < 0 && selBody.indexOf('P[') < 0 &&
    edgeAll && btnAll);

  /* 7e. (47) A re-render that replaces the tiles ends the drag instead of leaving it in
         flight. The drag remembers the node it started on, its hit box, the pointer
         capture and a pending frame; when the screen paints a fresh grid those nodes are
         gone, and the gesture used to keep hit-testing and auto-scrolling against a grid
         it never measured. Here a drag is started across the grid, the screen re-renders
         under the finger (the same path a library reload or a delete takes: S.anim set,
         renderAll, fresh nodes), and the pointer then moves onto a tile the drag never
         measured — nothing more may be painted. */
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  const g0 = await centerOf(0);
  await page.mouse.move(g0.x, g0.y);
  await page.mouse.down();
  await page.mouse.move(g0.x, g0.y + 40, { steps: 4 });
  await settle(150);
  const dragPainted = await onCount();
  await page.evaluate(() => { S.anim = true; renderAll(true); });
  await settle(200);
  const afterRenderOn = await onCount();
  const g1 = await centerOf(6);
  await page.mouse.move(g1.x, g1.y, { steps: 4 });
  await settle(250);
  const afterMoveOn = await onCount();
  const dragGone = await page.evaluate(() => drag === null && autoScroll === null && dragPid === null);
  await page.mouse.up();
  await settle(250);
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('a re-render ends the drag instead of leaving it in flight (painted ' + dragPainted +
    ', kept ' + afterRenderOn + ' -> ' + afterMoveOn + ', state cleared ' + dragGone + ')',
    dragPainted >= 1 && afterMoveOn === afterRenderOn && dragGone === true);

  /* 7f. (48) A diagonal drag on a touch screen still scrolls. #screen declares
         `touch-action: pan-y`, so the browser owns every vertical pan and only the sideways
         gesture belongs to the app; a finger that crossed the 6 px threshold diagonally
         used to be claimed on the spot — preventDefault and a pointer capture — and the
         scroll it belonged to never started. The same pointerdown is followed here by a
         diagonal move and then a sideways one: the diagonal move must leave the drag
         unclaimed (nothing prevented, nothing painted), the sideways one must claim it. */
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  await settle(800);
  const touchRun = await page.evaluate(() => {
    const tile = document.querySelector('.tile');
    const b = tile.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const scrEl = document.querySelector('#screen');
    const painted = () => document.querySelectorAll('.tile.on').length;
    const fire = (type, cx, cy) => {
      const ev = new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
        isPrimary: true, clientX: cx, clientY: cy, buttons: 1,
      });
      (type === 'pointerdown' ? tile : scrEl).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const out = {};
    fire('pointerdown', x, y);
    out.onDown = painted();
    // 7 px sideways, 9 px down: past the 6 px threshold, but the gesture is the scroller's
    out.diagPrevented = fire('pointermove', x + 7, y + 9);
    out.onDiag = painted();
    out.appliedAfterDiag = !!(drag && drag.applied);
    // 30 px sideways, 4 px down: the one direction pan-y leaves to the app
    out.sidePrevented = fire('pointermove', x + 30, y + 13);
    out.onSide = painted();
    out.appliedAfterSide = !!(drag && drag.applied);
    fire('pointerup', x + 30, y + 13);
    return out;
  });
  await settle(200);
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  check('a diagonal touch drag is left to the scroller, a sideways one becomes the drag (' +
    'down ' + touchRun.onDown + ', diagonal prevented ' + touchRun.diagPrevented + ' painted ' +
    touchRun.onDiag + ' applied ' + touchRun.appliedAfterDiag + ', sideways prevented ' +
    touchRun.sidePrevented + ' painted ' + touchRun.onSide + ' applied ' + touchRun.appliedAfterSide + ')',
    touchRun.onDown === 0 &&
    touchRun.diagPrevented === false && touchRun.onDiag === 0 && touchRun.appliedAfterDiag === false &&
    touchRun.sidePrevented === true && touchRun.onSide === 1 && touchRun.appliedAfterSide === true);

  /* 7g. (49) A second finger is a pinch, not a selection. The pinch changes the column count
         under the grid, so the finger that went down first is no longer over the tile it
         pressed; the drag and the long press it armed used to survive the pinch and paint a
         tile the grid had already moved out from under them — and the second finger armed a
         press of its own on the way down. A real two-finger pinch is driven here: the drag and
         the long-press timer must be gone before the pinch moves anything, the pinch must still
         change the columns, and the sideways travel of either finger must paint nothing. */
  await page.click('[data-act="startsel"]');
  await page.waitForSelector('#selbar:not(.hide)', { timeout: 10000 });
  await settle(800);
  const pinchRun = await page.evaluate(() => {
    const tiles = document.querySelectorAll('.tile');
    const a = tiles[0], b = tiles[1];
    const ab = a.getBoundingClientRect(), bb = b.getBoundingClientRect();
    const ax = ab.left + ab.width / 2, ay = ab.top + ab.height / 2;
    const bx = bb.left + bb.width / 2, by = bb.top + bb.height / 2;
    const d0 = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / d0, uy = (by - ay) / d0;
    const s = d0 * 0.25; // each finger out by s -> the fingers are 1.5x apart
    const scrEl = document.querySelector('#screen');
    const painted = () => document.querySelectorAll('.tile.on').length;
    const ptr = (type, id, cx, cy) => {
      const ev = new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        isPrimary: id === 7, clientX: cx, clientY: cy, buttons: 1,
      });
      const target = type === 'pointerdown' ? (document.elementFromPoint(cx, cy) || scrEl) : scrEl;
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const touch = (type, pts) => {
      const list = pts.map(([id, cx, cy]) => new Touch({ identifier: id, target: scrEl, clientX: cx, clientY: cy }));
      const ev = new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: list,
      });
      scrEl.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const out = { cols0: ST.cols };
    ptr('pointerdown', 7, ax, ay);                    // finger 1 on a tile
    out.armed = !!(drag && lpTimer);                  // press armed, as on a real finger
    ptr('pointerdown', 8, bx, by);                    // finger 2 lands: a pinch begins
    out.secondTookOver = !!(drag && drag.x === bx && drag.y === by) || dragPid === 8;
    touch('touchstart', [[7, ax, ay], [8, bx, by]]);
    out.dragAtPinch = !!drag;
    out.timerAtPinch = !!lpTimer;
    out.pinchPrevented = touch('touchmove', [[7, ax - ux * s, ay - uy * s], [8, bx + ux * s, by + uy * s]]);
    out.colsAfter = ST.cols;
    out.paintedDuringPinch = painted();
    // the fingers travel sideways while they pinch: nothing may be painted
    out.movePrevented = ptr('pointermove', 7, ax - ux * s - 40, ay - uy * s);
    out.paintedAfterMove = painted();
    ptr('pointerup', 7, ax - ux * s - 40, ay - uy * s);
    ptr('pointerup', 8, bx + ux * s + 40, by + uy * s);
    touch('touchend', []);
    out.dragAfter = !!drag;
    out.timerAfter = !!lpTimer;
    return out;
  });
  // a press armed by the pinch must not fire once the fingers have gone
  await settle(600);
  const pinchLate = await page.evaluate(() => ({
    painted: document.querySelectorAll('.tile.on').length,
    drag: !!drag,
    timer: !!lpTimer,
  }));
  await page.click('[data-act="endsel"]');
  await page.waitForFunction(() => document.querySelectorAll('.tile.on').length === 0, { timeout: 10000 });
  await page.evaluate(() => { ST.cols = 3; applySettings(); });
  check('a pinch changes the columns without painting a selection (' +
    'armed ' + pinchRun.armed + ', second finger took over ' + pinchRun.secondTookOver +
    ', drag at pinch ' + pinchRun.dragAtPinch + ', timer at pinch ' + pinchRun.timerAtPinch +
    ', cols ' + pinchRun.cols0 + ' -> ' + pinchRun.colsAfter +
    ', painted ' + pinchRun.paintedDuringPinch + ' -> ' + pinchRun.paintedAfterMove +
    ', late paint ' + pinchLate.painted + ')',
    pinchRun.armed === true &&
    pinchRun.secondTookOver === false &&
    pinchRun.dragAtPinch === false && pinchRun.timerAtPinch === false &&
    pinchRun.pinchPrevented === true &&
    pinchRun.colsAfter === pinchRun.cols0 - 1 &&
    pinchRun.paintedDuringPinch === 0 && pinchRun.paintedAfterMove === 0 &&
    pinchRun.movePrevented === false &&
    pinchRun.dragAfter === false && pinchRun.timerAfter === false &&
    pinchLate.painted === 0 && pinchLate.drag === false && pinchLate.timer === false);

  /* 8. tapping a tile opens the viewer, close returns to the grid */
  await page.click('.tile');
  await page.waitForSelector('.viewer .stage img', { timeout: 10000 });
  const viewerOk = await page.evaluate(() => !!document.querySelector('.viewer .vbar'));
  await page.click('[data-v="close"]');
  await page.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 10000 }, COUNT);
  check('viewer opens with controls and closes back to ' + COUNT + ' tiles', viewerOk);

  /* 8b. a swipe reuses the three slide nodes instead of rebuilding them: the elements that
         exist when the viewer opens are the elements that are there after a swipe, only their
         src and their role change, and the centre one is the photo that was already preloaded. */
  await page.click('.tile');
  await page.waitForSelector('.viewer .slide[data-c] img', { timeout: 10000 });
  const slidesBefore = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.viewer .slide')];
    window.__slideNodes = s;
    window.__slideImgs = s.map((d) => d.firstElementChild);
    return {
      n: s.length,
      cur: document.querySelector('.viewer .slide[data-c] img').getAttribute('src'),
      srcs: s.map((d) => d.firstElementChild.getAttribute('src')),
    };
  });
  const stg = await page.$eval('.viewer .stage', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(stg.x + stg.w * 0.8, stg.y + stg.h * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 9; i++) {
    await page.mouse.move(stg.x + stg.w * (0.8 - 0.065 * i), stg.y + stg.h * 0.5);
  }
  await page.mouse.up();
  await settle(600);
  const slidesAfter = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.viewer .slide')];
    const curEl = document.querySelector('.viewer .slide[data-c] img');
    return {
      n: s.length,
      same: s.length === window.__slideNodes.length &&
        s.every((d, i) => d === window.__slideNodes[i] && d.firstElementChild === window.__slideImgs[i]),
      cur: curEl ? curEl.getAttribute('src') : null,
      centres: s.filter((d) => d.hasAttribute('data-c')).length,
      srcs: s.map((d) => d.firstElementChild.getAttribute('src')),
    };
  });
  check('a swipe reuses the three slide nodes (' + slidesBefore.n + ' nodes, same nodes ' +
    slidesAfter.same + ', centre ' + (slidesBefore.cur !== slidesAfter.cur ? 'advanced' : 'stuck') +
    ', preloaded ' + (slidesBefore.srcs.includes(slidesAfter.cur) ? 'yes' : 'no') + ')',
    slidesBefore.n === 3 && slidesAfter.n === 3 && slidesAfter.same === true &&
    slidesAfter.centres === 1 && slidesBefore.cur !== slidesAfter.cur &&
    slidesBefore.srcs.includes(slidesAfter.cur));
  const viewerHtml = fs.readFileSync(APP, 'utf8');
  const buildFn = (viewerHtml.match(/function build\(keepTrack,dir\)[\s\S]*?\n\}/) || [''])[0];
  check('viewer build() creates its slide nodes once and never rebuilds them with innerHTML',
    /V\.slides=\[-1,0,1\]\.map/.test(buildFn) && /document\.createElement\('div'\)/.test(buildFn) &&
    !/track\.innerHTML/.test(buildFn) && /n\.push\(n\.shift\(\)\)/.test(buildFn));

  /* 8bb. the width a swipe is measured against is taken once, not read during the gesture: the
          viewer caches the stage width when it opens and refreshes it on a resize, so the settle
          moves the track by exactly one photo without asking the layout mid-swipe. */
  const wOpen = await page.evaluate(() => ({
    w: V.w,
    stage: document.querySelector('.viewer .stage').clientWidth,
    inner: innerWidth,
  }));
  await page.setViewport({ width: 380, height: 915, deviceScaleFactor: 1 });
  await settle(200);
  const wSmall = await page.evaluate(() => ({
    w: V.w,
    stage: document.querySelector('.viewer .stage').clientWidth,
  }));
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
  await settle(200);
  const wBack = await page.evaluate(() => ({
    w: V.w,
    stage: document.querySelector('.viewer .stage').clientWidth,
  }));
  check('the swipe width is pre-measured once and refreshed on a resize (' +
    'open ' + wOpen.w + ' of stage ' + wOpen.stage + ', resized ' + wSmall.w +
    ', restored ' + wBack.w + ')',
    wOpen.w > 0 && wOpen.w === wOpen.stage && wOpen.w === wOpen.inner &&
    wSmall.w === wSmall.stage && wSmall.w === 380 &&
    wBack.w === wBack.stage && wBack.w === 412);
  const swipeEndFn = (viewerHtml.match(/const end=\(\)=>\{[\s\S]*?\n  \};/) || [''])[0];
  check('the swipe path never reads the layout, and the width is dropped with the viewer',
    /V\.w\*\.22/.test(swipeEndFn) && /translateX\(\$\{-dir\*V\.w\}px\)/.test(swipeEndFn) &&
    !/innerWidth|clientWidth|offsetWidth|getBoundingClientRect/.test(swipeEndFn) &&
    /const measureW=\(\)=>\{V\.w=stage\.clientWidth\|\|innerWidth\}/.test(viewerHtml) &&
    /addEventListener\('resize',measureW\)/.test(viewerHtml) &&
    /V\.detach=\(\)=>removeEventListener\('resize',measureW\)/.test(viewerHtml) &&
    /if\(V\.detach\)V\.detach\(\);clearTimeout\(V\.hintT\);V=null/.test(viewerHtml));

  /* 8c. the two offscreen slides give their decoded bitmaps back: once a swipe has settled only
         the centre slide still carries a src, and the moment a finger lands on the stage both
         neighbours are pointed at their photo again so the arrival is already loading. */
  await settle(900);
  const released = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.viewer .slide')];
    const srcs = s.map((d) => d.firstElementChild.getAttribute('src'));
    return {
      srcs,
      centre: s.findIndex((d) => d.hasAttribute('data-c')),
      kept: srcs.filter(Boolean).length,
    };
  });
  const stg2 = await page.$eval('.viewer .stage', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(stg2.x + stg2.w * 0.5, stg2.y + stg2.h * 0.5);
  await page.mouse.down();
  await settle(60);
  const pointed = await page.evaluate(() =>
    [...document.querySelectorAll('.viewer .slide')].map((d) => d.firstElementChild.getAttribute('src')));
  await page.mouse.up();
  await settle(700);
  check('offscreen slides release their bitmap at rest (' + released.kept +
    ' of 3 kept, the one on screen) and are pointed again on touch (' +
    pointed.filter(Boolean).length + ' of 3)',
    released.kept === 1 && !!released.srcs[released.centre] &&
    pointed.filter(Boolean).length === 3 && pointed[released.centre] === released.srcs[released.centre]);
  const relFn = (viewerHtml.match(/const releaseOffscreen=\(\)=>\{[\s\S]*?\n\};/) || [''])[0];
  const ptFn = (viewerHtml.match(/const pointNear=\(\)=>\{[\s\S]*?\n\};/) || [''])[0];
  check('viewer drops the offscreen src and re-points it on pointerdown, and drops all three on close',
    /removeAttribute\('src'\)/.test(relFn) && /im\.src=src/.test(ptFn) &&
    /pointerdown',e=>\{pointNear\(\)/.test(viewerHtml) &&
    /armRelease\(\);/.test(viewerHtml) && /clearTimeout\(relT\)/.test(viewerHtml));
  /* 8d. a pan cannot drag the photo off the screen: the harness thumb is 160 px, so the centre
         slide is given the box a full-resolution photo would fill, zoomed to 2.4x with a real
         double tap and then dragged far past the edge — the image has to stop at the edge of its
         slide instead of leaving the stage. */
  await page.evaluate(() => {
    /* a real full-size photo is laid out with object-fit: contain, so its box fills the slide's
       content area — give the harness thumb that box, then 2.4x overflows it on both axes */
    const sl = document.querySelector('.viewer .slide[data-c]');
    const im = sl.querySelector('img'), cs = getComputedStyle(sl);
    im.style.maxWidth = 'none'; im.style.maxHeight = 'none';
    im.style.width = (sl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
    im.style.height = (sl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) + 'px';
  });
  await settle(150);
  const cx = stg2.x + stg2.w * 0.5, cy = stg2.y + stg2.h * 0.5;
  await page.mouse.click(cx, cy);
  await settle(60);
  await page.mouse.click(cx, cy);
  await settle(500);
  const zoomBefore = await page.evaluate(() => V.zoom);
  for (let g = 0; g < 10; g++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 3; i++) await page.mouse.move(cx + i * 50, cy + i * 50);
    await page.mouse.up();
    await settle(30);
  }
  await settle(200);
  const pan = await page.evaluate(() => {
    const sl = document.querySelector('.viewer .slide[data-c]');
    const im = sl.querySelector('img');
    const cs = getComputedStyle(sl), sr = sl.getBoundingClientRect(), r = im.getBoundingClientRect();
    return {
      zoom: V.zoom, tx: V.tx, ty: V.ty, baseW: im.offsetWidth, baseH: im.offsetHeight,
      box: { l: sr.left + parseFloat(cs.paddingLeft), r: sr.right - parseFloat(cs.paddingRight),
             t: sr.top + parseFloat(cs.paddingTop), b: sr.bottom - parseFloat(cs.paddingBottom) },
      img: { l: r.left, r: r.right, t: r.top, b: r.bottom },
      stage: (() => { const q = document.querySelector('.viewer .stage').getBoundingClientRect();
                      return { l: q.left, r: q.right, t: q.top, b: q.bottom }; })(),
    };
  });
  const boxW = pan.box.r - pan.box.l, boxH = pan.box.b - pan.box.t;
  const mx = Math.max(0, (pan.baseW * pan.zoom - boxW) / 2);
  const my = Math.max(0, (pan.baseH * pan.zoom - boxH) / 2);
  const coversX = pan.img.l <= pan.box.l + 1.5 && pan.img.r >= pan.box.r - 1.5;
  const coversY = pan.img.t <= pan.box.t + 1.5 && pan.img.b >= pan.box.b - 1.5;
  const edgeX = Math.abs(pan.img.r - pan.box.r) < 1.5 || Math.abs(pan.img.l - pan.box.l) < 1.5;
  const edgeY = Math.abs(pan.img.b - pan.box.b) < 1.5 || Math.abs(pan.img.t - pan.box.t) < 1.5;
  const centred = (a, b, c, d) => Math.abs((a + b) / 2 - (c + d) / 2) < 1.5;
  const xOk = mx > 0 ? coversX && edgeX && Math.abs(Math.abs(pan.tx) - mx) < 1.5
                     : centred(pan.img.l, pan.img.r, pan.box.l, pan.box.r) && Math.abs(pan.tx) < 1.5;
  const yOk = my > 0 ? coversY && edgeY && Math.abs(Math.abs(pan.ty) - my) < 1.5
                     : centred(pan.img.t, pan.img.b, pan.box.t, pan.box.b) && Math.abs(pan.ty) < 1.5;
  const onStage = pan.img.r > pan.stage.l && pan.img.l < pan.stage.r &&
                  pan.img.b > pan.stage.t && pan.img.t < pan.stage.b;
  check('a pan stops at the edge instead of dragging the photo off screen (zoom ' + pan.zoom +
    ', drag ' + Math.round(10 * 150) + ' px, tx ' + Math.round(pan.tx) + '/' + Math.round(mx) +
    ', ty ' + Math.round(pan.ty) + '/' + Math.round(my) + ', img ' + Math.round(pan.img.l) + '..' +
    Math.round(pan.img.r) + ' / ' + Math.round(pan.img.t) + '..' + Math.round(pan.img.b) +
    ', box ' + Math.round(pan.box.l) + '..' + Math.round(pan.box.r) + ' / ' +
    Math.round(pan.box.t) + '..' + Math.round(pan.box.b) + ')',
    zoomBefore > 1 && pan.zoom > 1 && mx > 0 && my > 0 && xOk && yOk && onStage);
  const clampFn = (viewerHtml.match(/const clampPan=\(\)=>\{[\s\S]*?\n  \};/) || [''])[0];
  check('viewer clamps the pan to the slide before it paints it',
    /const panBox=\(\)=>\{/.test(viewerHtml) && /im\.offsetWidth\*V\.zoom/.test(clampFn) &&
    /im\.offsetHeight\*V\.zoom/.test(clampFn) && /V\.tx=Math\.min\(mx,Math\.max\(-mx,V\.tx\)\)/.test(clampFn) &&
    /V\.ty=Math\.min\(my,Math\.max\(-my,V\.ty\)\)/.test(clampFn) &&
    /clampPan\(\);applyZ\(false\)/.test(viewerHtml));

  /* 8e. the zoom belongs to the photo it was put on: the photo on the stage is still at 2.4x, so
         delete it — the next photo must open at 1x, and a swipe on it must still be a swipe that
         advances instead of a pan that re-applies the deleted photo's zoom. */
  const zoomBeforeDel = await page.evaluate(() => V.zoom);
  await page.click('[data-v="del"]');
  await settle(500);
  const afterDel = await page.evaluate(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    return { zoom: V.zoom, i: V.i, tx: V.tx, ty: V.ty, tr: im ? im.style.transform : 'no-img' };
  });
  await page.mouse.move(stg2.x + stg2.w * 0.8, cy);
  await page.mouse.down();
  for (let i = 1; i <= 9; i++) await page.mouse.move(stg2.x + stg2.w * (0.8 - 0.065 * i), cy);
  await page.mouse.up();
  await settle(700);
  const afterSnap = await page.evaluate(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    return { zoom: V.zoom, i: V.i, tx: V.tx, ty: V.ty, tr: im ? im.style.transform : 'no-img' };
  });
  check('zoom snaps back to 1 when the photo changes (deleted at ' + zoomBeforeDel +
    'x -> next photo at ' + afterDel.zoom + 'x, transform "' + afterDel.tr + '", swipe lands on ' +
    'photo ' + afterSnap.i + ' at ' + afterSnap.zoom + 'x)',
    zoomBeforeDel > 1 && afterDel.zoom === 1 && afterDel.tx === 0 && afterDel.ty === 0 &&
    !/scale\(2\.4\)/.test(afterDel.tr) &&
    afterSnap.i === afterDel.i + 1 && afterSnap.zoom === 1 && afterSnap.tx === 0 && afterSnap.ty === 0 &&
    !/scale\(2\.4\)/.test(afterSnap.tr));
  const snapFn = (viewerHtml.match(/const snapZoom=\(\)=>\{[\s\S]*?\n  \};/) || [''])[0];
  check('viewer snaps the zoom on every path that changes the photo',
    /V\.zoom=1;V\.tx=V\.ty=0/.test(snapFn) && /im\.style\.transform=''/.test(snapFn) &&
    /V\.i=ni;snapZoom\(\)/.test(viewerHtml) &&
    /* the delete and the restore hand the stage on through dropFromViewer, which snaps the zoom
       before it rebuilds, so both still go through snapZoom() and neither skips it */
    /if\(V\.list\[V\.i\]!==was\)\{V\.snapZoom\(\);build\(\)\}/.test(viewerHtml) &&
    (viewerHtml.match(/dropFromViewer\(\[p\.id\]\)/g) || []).length === 2 &&
    !/V\.zoom=1;V\.tx=V\.ty=0;track/.test(viewerHtml));
  /* put the deleted photo back so the pages opened further down still see the whole library */
  await page.evaluate(() => { TRASH.clear(); saveTrash(); });

  /* 8g. the double tap is debounced on the system's own window instead of a number of ours:
         two taps 420 ms apart are two single taps (no zoom), two taps 60 ms apart still zoom, and
         a pan between two taps breaks the pair, so the tap after it does not complete a double
         tap — all driven with real pointer events on the stage. */
  const tap = async () => { await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); };
  const zoomAt = () => page.evaluate(() => V.zoom);
  await page.evaluate(() => { V.zoom = 1; V.tx = V.ty = 0; });
  await tap();
  await settle(420);
  await tap();
  await settle(420);
  const slowPair = await zoomAt();
  await tap();
  await settle(60);
  await tap();
  await settle(420);
  const fastPair = await zoomAt();
  await tap();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 3; i++) await page.mouse.move(cx + i * 14, cy + i * 14);
  await page.mouse.up();
  await tap();
  await settle(420);
  const afterPan = await zoomAt();
  check('double tap waits for the system window (420 ms apart -> ' + slowPair + 'x, 60 ms apart -> ' +
    fastPair + 'x, a pan between taps -> ' + afterPan + 'x)',
    slowPair === 1 && fastPair === 2.4 && afterPan === 2.4);
  const dblDecl = (viewerHtml.match(/const DBL_MS=[^;]*;/) || [''])[0];
  const tapBranch = (viewerHtml.match(/if\(!s\.mode\)\{[\s\S]*?\n {4}\}/) || [''])[0];
  check('the tap branch uses the system double-tap timeout, and any other gesture clears the pair',
    /META\.dblTap/.test(dblDecl) && /:300;/.test(dblDecl) && /now-V\.last<DBL_MS/.test(tapBranch) &&
    !/320/.test(tapBranch) && /V\.last=0/.test(viewerHtml));
  await page.click('[data-v="close"]');
  await page.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });

  /* 8f. the hint's 3.5 s timer belongs to the viewer: it is armed once when the viewer opens
         and cancelled by closeViewer, instead of surviving the viewer and firing against the
         node closeViewer has already removed. */
  await page.waitForSelector('.tile', { timeout: 10000 });
  await page.evaluate(() => {
    window.__hintTimers = [];
    window.__cleared = [];
    const st = window.setTimeout, ct = window.clearTimeout;
    window.setTimeout = function (fn, ms) {
      const id = st.apply(window, arguments);
      if (ms === 3500) window.__hintTimers.push(id);
      return id;
    };
    window.clearTimeout = function (id) { window.__cleared.push(id); return ct(id); };
  });
  await page.click('.tile');
  await page.waitForSelector('.viewer .hint', { timeout: 10000 });
  const hintArmed = await page.evaluate(() => ({
    timers: window.__hintTimers.length,
    owner: !!(V && V.hintT),
    visible: getComputedStyle(document.querySelector('.viewer .hint')).display !== 'none',
  }));
  await page.click('[data-v="close"]');
  await page.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
  await settle(400);
  const hintClosed = await page.evaluate(() => ({
    cleared: window.__hintTimers.length > 0 &&
      window.__hintTimers.every((id) => window.__cleared.includes(id)),
    v: V === null,
    live: document.querySelectorAll('.viewer').length,
  }));
  check('closing the viewer cancels the hint timer (' + hintArmed.timers + ' armed, owned by V ' +
    hintArmed.owner + ', hint visible ' + hintArmed.visible + ', cleared ' + hintClosed.cleared +
    ', viewer left ' + hintClosed.live + ')',
    hintArmed.timers === 1 && hintArmed.owner === true && hintArmed.visible === true &&
    hintClosed.cleared === true && hintClosed.v === true && hintClosed.live === 0);
  const hintFn = (viewerHtml.match(/if\(!V\.hintT\)V\.hintT=setTimeout[\s\S]*?\},3500\);/) || [''])[0];
  check('the hint timer is kept on V, armed once per viewer, and cleared before V is dropped',
    /V\.hintT=setTimeout/.test(hintFn) && /V\.hintT=0/.test(hintFn) &&
    /if\(V\.detach\)V\.detach\(\);clearTimeout\(V\.hintT\);V=null/.test(viewerHtml) &&
    !/setTimeout\(\(\)=>\{const h=\$\(\'\.hint\',el\);if\(h\)h\.style\.display=\'none\'\},3500\)/.test(viewerHtml));

  /* 8g. a photo whose full-size fetch 404s shows the placeholder in the viewer instead of an
         empty slide, and the placeholder gives way to the real photo once it loads again. */
  const missPage = await browser.newPage();
  missPage.on('pageerror', (e) => errors.push(String(e && e.message)));
  await missPage.setCacheEnabled(false);
  await missPage.goto(base, { waitUntil: 'load' });
  await missPage.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 30000 }, COUNT);
  const missId = await missPage.$eval('.tile img', (i) => Number(i.getAttribute('src').split('/').pop()));
  missMedia.add(missId);
  await missPage.click('.tile');
  await missPage.waitForSelector('.viewer .slide[data-c] img', { timeout: 10000 });
  await missPage.waitForFunction(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    return !!im && /^data:image\/svg\+xml/.test(im.getAttribute('src') || '');
  }, { timeout: 10000 });
  const missState = await missPage.evaluate(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    const sl = document.querySelector('.viewer .slide[data-c]');
    return {
      placeholder: /^data:image\/svg\+xml/.test(im.getAttribute('src') || ''),
      marked: im.classList.contains('miss'),
      sized: Math.round(im.getBoundingClientRect().width),
      centre: !!sl,
      viewer: document.querySelectorAll('.viewer').length,
      title: (document.querySelector('.viewer .mid b') || {}).textContent || '',
    };
  });
  check('a 404 full-size fetch paints the placeholder in the viewer (id ' + missId +
    ', placeholder ' + missState.placeholder + ', marked ' + missState.marked +
    ', ' + missState.sized + 'px, slide centred ' + missState.centre +
    ', viewer ' + missState.viewer + ')',
    missState.placeholder === true && missState.marked === true && missState.sized > 0 &&
    missState.sized < 200 && missState.centre === true && missState.viewer === 1 &&
    missState.title.length > 0);
  /* the same photo, now readable: closing and re-opening the viewer must fetch it again and show
     the real image, with the placeholder's class and the remembered bad src both gone */
  missMedia.delete(missId);
  await missPage.click('[data-v="close"]');
  await missPage.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
  await missPage.click('.tile');
  await missPage.waitForFunction(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    return !!im && /^\/media\/\d+$/.test(im.getAttribute('src') || '') && im.complete && im.naturalWidth > 0;
  }, { timeout: 15000 });
  const missBack = await missPage.evaluate(() => {
    const im = document.querySelector('.viewer .slide[data-c] img');
    const sl = document.querySelector('.viewer .slide[data-c]');
    return {
      src: (im.getAttribute('src') || '').slice(0, 7),
      marked: im.classList.contains('miss'),
      bad: sl.hasAttribute('data-bad'),
      natural: im.naturalWidth,
    };
  });
  check('the placeholder gives way to the real photo once it loads (' + missBack.src +
    ', marked ' + missBack.marked + ', bad src kept ' + missBack.bad + ', decoded ' +
    missBack.natural + 'px)',
    missBack.src === '/media/' && missBack.marked === false && missBack.bad === false &&
    missBack.natural > 100);
  const missDecl = (viewerHtml.match(/const MISS_SRC='data:image\/svg\+xml,'\+encodeURIComponent\([\s\S]*?\);/) || [''])[0];
  const missHandler = (viewerHtml.match(/im\.addEventListener\('error',\(\)=>\{[\s\S]*?\}\);/) || [''])[0];
  const missPoint = (viewerHtml.match(/const pointNear=\(\)=>\{[\s\S]*?\n\};/) || [''])[0];
  const missBuild = (viewerHtml.match(/function build\(keepTrack,dir\)[\s\S]*?\n\}/) || [''])[0];
  check('a failed slide keeps an inline placeholder and does not re-request the missing photo',
    /MISS_SRC/.test(missDecl) && /data:image\/svg\+xml/.test(missDecl) &&
    /dataset\.bad=s/.test(missHandler) && /showMiss\(im\)/.test(missHandler) &&
    /s===MISS_SRC/.test(missHandler) &&
    /if\(d\.dataset\.bad===src\)showMiss\(im\);/.test(missBuild) &&
    /im\.classList\.remove\('miss'\);if\(im\.getAttribute\('src'\)!==src\)im\.src=src/.test(missBuild) &&
    /if\(d\.dataset\.bad===src\)showMiss\(im\);/.test(missPoint) &&
    /im\.classList\.remove\('miss'\)/.test(missPoint) &&
    /\.slide img\.miss\{/.test(viewerHtml));
  await missPage.click('[data-v="close"]');
  await missPage.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 10000 });
  await missPage.close();

  /* 8h. a delete that names a photo other than the one on the stage leaves the viewer open on the
         photo the user is looking at: the ids the page asked the system to delete are dropped by
         id (the reply to the system dialog carries a count, not the ids), so the entry ahead of
         the current one goes without the viewer moving, and only the current photo's own delete
         hands the stage on and finally closes it. */
  await page.evaluate(() => document.querySelectorAll('.tile')[3].click());
  await page.waitForSelector('.viewer .slide[data-c] img', { timeout: 10000 });
  await settle(300);
  const keep59 = await page.evaluate(() => ({
    id: V.list[V.i], i: V.i, len: V.list.length, ahead: V.list[0],
    title: document.querySelector('.viewer .mid span').textContent,
    src: document.querySelector('.viewer .slide[data-c] img').getAttribute('src'),
  }));
  await page.evaluate((other) => { delIds = [other]; window.__native.onDeleted(-1); }, keep59.ahead);
  await settle(600);
  const keptState = await page.evaluate((ahead) => ({
    open: document.querySelectorAll('.viewer').length, v: !!V, i: V.i, id: V.list[V.i],
    len: V.list.length, ahead: V.list.indexOf(ahead),
    title: document.querySelector('.viewer .mid span').textContent,
    src: document.querySelector('.viewer .slide[data-c] img').getAttribute('src'),
    tr: document.querySelector('.viewer .slide[data-c] img').style.transform,
  }), keep59.ahead);
  const ownDel = await page.evaluate(() => {
    const id = V.list[V.i];
    dropFromViewer([id]);
    return { open: document.querySelectorAll('.viewer').length, id: V.list[V.i], i: V.i,
             gone: V.list.indexOf(id), len: V.list.length };
  });
  const emptied = await page.evaluate(() => { dropFromViewer(V.list.slice()); return { v: V === null }; });
  await settle(400);
  const closed59 = await page.evaluate(() => document.querySelectorAll('.viewer').length);
  check('a delete that names another photo leaves the viewer on the photo on the stage (id ' +
    keep59.id + ' at ' + keep59.i + ' kept, dropped ' + keep59.ahead + ' -> ' + keptState.ahead +
    ', list ' + keep59.len + ' -> ' + keptState.len + ', viewer ' + keptState.open +
    ', title "' + keptState.title + '", src kept ' + (keptState.src === keep59.src) +
    ', then own delete -> ' + ownDel.id + ' at ' + ownDel.i + ', emptied -> viewer ' + closed59 + ')',
    keep59.len > 3 && keep59.i > 0 &&
    keptState.open === 1 && keptState.v === true &&
    keptState.id === keep59.id && keptState.i === keep59.i - 1 &&
    keptState.len === keep59.len - 1 && keptState.ahead === -1 &&
    keptState.title === keep59.title && keptState.src === keep59.src && keptState.tr === '' &&
    ownDel.open === 1 && ownDel.gone === -1 && ownDel.id !== keep59.id && ownDel.len === keptState.len - 1 &&
    emptied.v === true && closed59 === 0);

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

  /* 61. The byte budget has to be held, and the peak has to be visible: the memory cache keeps
         a high-water mark next to its current size and logs it as it climbs (never per thumb),
         the eviction pass runs before the peak is taken so the logged number is what is really
         resident, and the disk directory — only measured at trim time — reports its own peak
         against its own budget. Nothing here is reachable from the page: no bridge method, no
         setting, no UI. */
  const cacheThumbFn = (java.match(/private void cacheThumb\(long key, byte\[\] bytes\)[\s\S]*?\n    \}/) || [''])[0];
  const trimDiskFn = (java.match(/private void trimThumbDisk\(File d\)[\s\S]*?\n    \}/) || [''])[0];
  const evictAt = cacheThumbFn.indexOf('thumbCacheBytes > THUMB_CACHE_BYTES');
  const peakAt = cacheThumbFn.indexOf('thumbCacheBytes > thumbCacheHighBytes');
  const memLogAt = cacheThumbFn.indexOf('Log.i(TAG, "thumb cache high-water "');
  const diskPeakAt = trimDiskFn.indexOf('total > thumbDiskHighBytes');
  const diskLogAt = trimDiskFn.indexOf('Log.i(TAG, "thumb disk high-water "');
  check('both thumbnail caches cap their bytes and log a high-water mark, never per thumbnail',
    evictAt > 0 && peakAt > evictAt && memLogAt > peakAt &&
    /HIGH_WATER_LOG_STEP = 1024L \* 1024/.test(java) &&
    /thumbCacheHighBytes - thumbCacheHighLogged >= HIGH_WATER_LOG_STEP/.test(cacheThumbFn) &&
    /THUMB_CACHE_BYTES = 12L \* 1024 \* 1024/.test(java) &&
    diskPeakAt > 0 && diskLogAt > diskPeakAt &&
    trimDiskFn.indexOf('total <= THUMB_DISK_BYTES') > diskLogAt &&
    /THUMB_DISK_BYTES = 12L \* 1024 \* 1024/.test(java));

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

  /* 44. A drag-select no longer starts on the way down. The pointerdown in selection mode used
         to call setSel() and take the pointer capture immediately, so the tile under the finger
         was painted before the finger moved at all — a tap selected it on the way down and the
         click that followed could not toggle it back (the capture had retargeted it to the
         scroller), and a finger that only meant to scroll painted the tile it started on. The
         tile is still chosen on pointerdown, but the selection, the capture and the first paint
         now wait for the 6 px threshold in pointermove, so the click owns a tap (one toggle) and
         only a real drag paints. */
  const downFn = (asset.match(/scr\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\n\}\);/) || ['', ''])[1];
  const moveFn = (asset.match(/scr\.addEventListener\('pointermove',e=>\{([\s\S]*?)\n\}\);/) || ['', ''])[1];
  const selBranch = (downFn.match(/if\(S\.selMode\)\{([\s\S]*?)return;\n  \}/) || ['', ''])[1];
  const applyAt = moveFn.indexOf('drag.applied');
  const thresholdAt = moveFn.indexOf('>6)dragMoved=true');
  check('drag-select starts only after 6 px of movement, so a tap toggles once',
    /drag=\{state:!S\.sel\.has\(\+t\.dataset\.id\),x:e\.clientX,y:e\.clientY,id:\+t\.dataset\.id\};/.test(selBranch) &&
    !/setSel\(/.test(selBranch) &&
    !/setPointerCapture/.test(selBranch) &&
    /if\(!dragMoved\)return;/.test(moveFn) &&
    thresholdAt > -1 && applyAt > thresholdAt &&
    /if\(!drag\.applied\)\{[\s\S]*?drag\.applied=true;[\s\S]*?setPointerCapture\(e\.pointerId\)[\s\S]*?setSel\(drag\.id,drag\.state\);/.test(moveFn) &&
    /if\(dragMoved\)\{dragMoved=false;return\}/.test(asset));

  /* 45. The long press is armed once, before the selection-mode branch, so it runs in both
         modes; its timer does all the work — enter selection mode, then select the captured
         tile once — and lpFired swallows the click the release produces, so the lift cannot
         toggle the same tile again. A press that turns into a drag drops the timer, so a slow
         drag-select is never mistaken for a hold. */
  const lpArmAt = downFn.indexOf('lpTimer=setTimeout(');
  const modeBranchAt = downFn.indexOf('if(S.selMode){');
  check('long-press timer is armed for both modes and dropped once a drag starts',
    lpArmAt > -1 && modeBranchAt > lpArmAt &&
    !/lpTimer=setTimeout\(/.test(selBranch) &&
    /const id=\+t\.dataset\.id;/.test(downFn) &&
    /lpTimer=setTimeout\(\(\)=>\{lpTimer=null;lpFired=true;/.test(downFn) &&
    /toggleSel\(id\)\},430\);/.test(downFn) &&
    /if\(lpFired\)\{lpFired=false;return\}/.test(asset) &&
    /if\(lpTimer\)\{clearTimeout\(lpTimer\);lpTimer=null\}/.test(moveFn) &&
    moveFn.indexOf('if(lpTimer){clearTimeout(lpTimer);lpTimer=null}') > moveFn.indexOf('if(!dragMoved)return;'));

  /* 46. The selection count is re-derived from the current list on every render. syncSel()
         drops the ids that have left it (a reload, a query, a chip) and both render paths call
         it before they paint, so the title can never count a photo the user cannot see, while
         a selected photo that is still in the list keeps its .on state. */
  const syncFn = (asset.match(/function syncSel\(list\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  const screenFn = (asset.match(/function renderScreen\(keepScroll=true\)\{([\s\S]*?)\n  const sc=/) || ['', ''])[1];
  const resultsFn = (asset.match(/function renderResults\(\)\{([\s\S]*?)\n  setPrefetchList/) || ['', ''])[1];
  check('selection count is re-synced with the current list on every render',
    /function syncSel\(list\)\{/.test(asset) &&
    /if\(!S\.sel\.size\)return false;/.test(syncFn) &&
    /for\(const p of\(list\|\|current\(\)\)\)live\.add\(p\.id\);/.test(syncFn) &&
    /if\(!live\.has\(id\)\)\{S\.sel\.delete\(id\);dropped=true\}/.test(syncFn) &&
    /if\(S\.selMode\)\{syncSel\(\);selTitle\(\)\}/.test(screenFn) &&
    /if\(S\.selMode\)\{syncSel\(list\);selTitle\(\)\}/.test(resultsFn) &&
    /function selTitle\(\)\{[\s\S]*?S\.sel\.size\+' selected'/.test(asset));

  /* 47. A render that swaps the tiles tears the gesture down first. swapIn() is the one
         place the markup is replaced (grid, albums, empty, results), so resetDrag() runs
         there before the old nodes leave the document: with a drag, a capture, an
         auto-scroll interval or a long-press timer still live it ends the gesture, and
         with nothing in flight it does nothing at all. */
  const swapFn = (asset.match(/function swapIn\(el,html\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  const resetFn = (asset.match(/function resetDrag\(\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  check('a re-render tears the drag down before the old tiles leave the document',
    /function resetDrag\(\)\{/.test(asset) &&
    /if\(drag\|\|dragPid!=null\|\|autoScroll\|\|lpTimer\)endDrag\(\);/.test(resetFn) &&
    /resetDrag\(\);/.test(swapFn) &&
    swapFn.indexOf('resetDrag();') > swapFn.indexOf('const f=fragOf(html);') &&
    swapFn.indexOf('resetDrag();') < swapFn.indexOf('while(el.firstChild)') &&
    /function endDrag\(\)\{[\s\S]*?drag=null;/.test(asset));

  /* 48. #screen keeps `touch-action: pan-y`, and the drag honours it: the sideways test and
         the threshold sit ahead of the preventDefault and the capture, so a diagonal finger
         is never claimed and its scroll can start. */
  const moveFn48 = (asset.match(/scr\.addEventListener\('pointermove',e=>\{([\s\S]*?)\n\}\);/ ) || ['', ''])[1];
  const panGuardAt = moveFn48.indexOf("if(e.pointerType==='touch'&&Math.abs(dx)<=Math.abs(dy))return;");
  check('a diagonal touch drag is left to the scroller (touch-action: pan-y)',
    /#screen\{[^}]*touch-action:pan-y/.test(asset) &&
    /const dx=e\.clientX-drag\.x, dy=e\.clientY-drag\.y;/.test(moveFn48) &&
    panGuardAt > moveFn48.indexOf('if(!dragMoved)return;') &&
    panGuardAt > -1 &&
    panGuardAt < moveFn48.indexOf('e.preventDefault()') &&
    panGuardAt < moveFn48.indexOf('drag.applied=true'));

  /* 49. The shape that makes the pinch safe: the second finger arms no press at all (a
         non-primary touch pointer returns before the long-press timer and the drag), and the
         two-finger touchstart ends whatever the first finger had in flight before it reads
         the finger distance for the zoom ratio. */
  const tsFn = (asset.match(/scr\.addEventListener\('touchstart',e=>\{([\s\S]*?)\n\},\{passive:true\}\);/) || ['', ''])[1];
  const pdFn = (asset.match(/scr\.addEventListener\('pointerdown',e=>\{([\s\S]*?)\n\}\);/) || ['', ''])[1];
  check('a second finger is a pinch, not a selection (touchstart tears the drag down first)',
    /if\(e\.pointerType==='touch'&&!e\.isPrimary\)return;/.test(pdFn) &&
    pdFn.indexOf("!e.isPrimary") < pdFn.indexOf('lpTimer=setTimeout') &&
    /if\(e\.touches\.length>1\)endDrag\(\);/.test(tsFn) &&
    tsFn.indexOf('endDrag()') > -1 &&
    tsFn.indexOf('endDrag()') < tsFn.indexOf('pd=e.touches.length===2?dist(e.touches):0;') &&
    /touch-action:pan-y/.test(asset));

  /* 50. The shape that keeps the viewer on the photo the user is looking at: a delete names its
         ids, and dropFromViewer removes those by id — never the entry at the current index — so
         an id ahead of the current one goes without moving the stage, the current photo's own
         delete still hands the stage on, and only an emptied list closes the viewer. */
  const dropVFn = (asset.match(/function dropFromViewer\(list\)\{[\s\S]*?\n\}/) || [''])[0];
  check('the viewer drops the ids a delete names instead of the entry at the current index',
    /const k=V\.list\.indexOf\(id\);if\(k<0\)return;/.test(dropVFn) &&
    /V\.list\.splice\(k,1\);gone=true;/.test(dropVFn) &&
    /if\(k<V\.i\)V\.i--;/.test(dropVFn) &&
    /if\(!gone\)return false;/.test(dropVFn) &&
    /if\(!V\.list\.length\)\{closeViewer\(\);return true\}/.test(dropVFn) &&
    /if\(V\.list\[V\.i\]!==was\)\{V\.snapZoom\(\);build\(\)\}/.test(dropVFn) &&
    !/V\.list\.splice\(V\.i,1\)/.test(asset) &&
    /dropFromViewer\(\[p\.id\]\);toast\('Moved to Trash'/.test(asset) &&
    /untrash\(\[p\.id\]\);dropFromViewer\(\[p\.id\]\);toast\('Restored'\)/.test(asset) &&
    /delIds=\[p\.id\];N\.delete/.test(asset) &&
    /const gone=delIds\|\|\[\];delIds=null;/.test(asset) &&
    (asset.match(/dropFromViewer\(gone\);/g) || []).length === 2);

  /* 51. The grid keeps the place the user scrolled to when the viewer opens over it and closes
         again. Every path that closes the viewer — the close button, the native back, and a
         favourite toggled inside the viewer, which changes the grid key and so rebuilds every
         tile — must hand the scroller back at the offset it had, not at the top. The check
         drives each one on a fresh page, scrolled half way down a library of COUNT photos. */
  const scrollPage = await browser.newPage();
  scrollPage.on('pageerror', (e) => errors.push(String(e && e.message)));
  await scrollPage.setCacheEnabled(false);
  await scrollPage.goto(base, { waitUntil: 'load' });
  await scrollPage.waitForFunction((n) => document.querySelectorAll('.tile').length === n, { timeout: 30000 }, COUNT);
  const scrollTo = (y) => scrollPage.evaluate((v) => {
    const sc = document.querySelector('#screen');
    sc.scrollTop = v === null ? Math.round(sc.scrollHeight / 2) : v;
    return sc.scrollTop;
  }, y);
  const scrollNow = () => scrollPage.evaluate(() => document.querySelector('#screen').scrollTop);
  /* the tile a finger would hit: fully inside the scroller, away from both bars */
  const tapMiddleTile = () => scrollPage.evaluate(() => {
    const sc = document.querySelector('#screen'), r = sc.getBoundingClientRect();
    const t = [...document.querySelectorAll('.tile')].find((x) => {
      const q = x.getBoundingClientRect();
      return q.top > r.top + 140 && q.bottom < r.bottom - 140;
    });
    if (!t) return null;
    t.click();
    return t.dataset.id;
  });
  /* a tap that lands while the page is still settling is retried rather than waited on */
  const tapForViewer = async (label) => {
    let id = await tapMiddleTile();
    if (id === null) { await settle(300); id = await tapMiddleTile(); }
    if (id === null) throw new Error('no tile to tap for ' + label);
    await scrollPage.waitForSelector('.viewer .slide[data-c] img', { timeout: 20000 });
    return id;
  };
  const runScroll = async (close) => {
    const y0 = await scrollTo(null);
    const id = await tapForViewer('the scroll check');
    const during = await scrollNow();
    await close();
    await scrollPage.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 20000 });
    await settle(500);
    const after = await scrollNow();
    return { y0, id, during, after };
  };
  const byButton = await runScroll(() => scrollPage.evaluate(() => document.querySelector('.viewer [data-v="close"]').click()));
  const byBack = await runScroll(() => scrollPage.evaluate(() => {
    const handled = window.__native.back();
    if (!handled) throw new Error('back() did not take the viewer');
  }));
  const byFav = await runScroll(() => scrollPage.evaluate(() => {
    document.querySelector('.viewer [data-v="fav"]').click();
    document.querySelector('.viewer [data-v="close"]').click();
  }));
  const scrolledPastTop = (r) => r.y0 > 0 && r.id !== null && r.during === r.y0 && r.after === r.y0;
  check('closing the viewer hands the grid back at the scroll offset it had (' +
    [byButton.y0, byBack.y0, byFav.y0].join('/') + ' px kept)',
    scrolledPastTop(byButton) && scrolledPastTop(byBack) && scrolledPastTop(byFav) &&
    byFav.y0 === byButton.y0);
  /* a rebuild that shortens the list can only clamp, never jump to the top */
  const beforeDel = await scrollPage.evaluate(() => ({
    before: document.querySelector('#screen').scrollTop,
    tiles: document.querySelectorAll('.tile').length,
  }));
  await tapForViewer('the delete check');
  await scrollPage.evaluate(() => document.querySelector('.viewer [data-v="del"]').click());
  await settle(200);
  await scrollPage.evaluate(() => window.__native.onDeleted(-1));
  await settle(900);
  /* the list still holds photos, so the viewer hands the stage on and stays open */
  await scrollPage.evaluate(() => { const b = document.querySelector('.viewer [data-v="close"]'); if (b) b.click(); });
  await scrollPage.waitForFunction(() => !document.querySelector('.viewer'), { timeout: 20000 });
  await settle(400);
  const afterDelY = await scrollNow();
  check('a delete from the viewer leaves the grid near its offset, never at the top',
    afterDelY > 0 && afterDelY <= beforeDel.before && (await scrollPage.evaluate(() => document.querySelectorAll('.tile').length)) === beforeDel.tiles - 1);
  await scrollPage.close();

  /* 52. The shape that keeps it: the viewer never writes the grid's scroll, closing it renders
         with keepScroll, and renderScreen puts the offset back after the swap rather than
         before it — so a rebuild cannot leave the grid at the top. */
  const closeFn52 = (asset.match(/function closeViewer\(\)\{[\s\S]*?\n\}/) || [''])[0];
  const screenFn52 = (asset.match(/function renderScreen\(keepScroll=true\)\{[\s\S]*?\n\}/) || [''])[0];
  const openFn52 = (asset.match(/function openViewer\(list,i\)\{[\s\S]*?\n\}/) || [''])[0];
  check('the grid scroll is restored by closeViewer and never reset by the viewer',
    /renderAll\(true\)\},300\);/.test(closeFn52) &&
    /const sc=\$\('#screen'\), y=keepScroll\?sc\.scrollTop:0;/.test(screenFn52) &&
    /sc\.scrollTop=y;/.test(screenFn52) &&
    screenFn52.indexOf('sc.scrollTop=y;') > screenFn52.indexOf('swapIn(sc,html)') &&
    screenFn52.indexOf('sc.scrollTop=y;') > screenFn52.indexOf('renderResults()') &&
    !/scrollTop/.test(openFn52) &&
    /#screen\{[^}]*overflow-y:auto/.test(asset) &&
    !/scrollTop\s*=\s*0/.test(asset));

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

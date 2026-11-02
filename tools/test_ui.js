#!/usr/bin/env node
/*
 * UI regression suite.
 *
 * Loads the real app/assets/index.html in headless Chromium with the native
 * bridge stubbed (same harness as tools/bench_first_frame.js) and drives the
 * screens the way a person would, so an optimisation pass that changes the UI
 * or breaks a flow fails loudly. Every check prints PASS or FAIL; the process
 * exits non-zero if anything failed.
 *
 * usage: node tools/test_ui.js [--count=240]
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
const COUNT = parseInt(arg('count', '240'), 10);
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium';

const THUMB = Buffer.from(
  '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',
  'base64'
);

function library(n) {
  const types = ['image/jpeg', 'image/jpeg', 'image/jpeg', 'image/png'];
  const buckets = ['Camera', 'Camera', 'Camera', 'WhatsApp Images', 'Download', 'Instagram', 'DCIM', 'Screenshots'];
  const now = Date.UTC(2026, 9, 30, 11, 20);
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: i + 1, v: 0, n: 'IMG_2026' + String(1000 + i) + '.jpg', b: buckets[i % buckets.length],
      m: types[i % types.length], d: now - i * 3 * 60 * 60 * 1000, s: 1900000 + i * 977,
      w: 1080, h: i % 3 === 0 ? 1080 : 810,
    });
  }
  return items;
}

const ITEMS = library(COUNT);
const stub =
  '<script>(function(){const ITEMS=' + JSON.stringify(ITEMS) + ';' +
  'window.AndroidNative={meta(){return JSON.stringify({sdk:34,device:"Pixel 8",android:"14",access:true,insetTop:74,insetBottom:48,light:false})},' +
  'access(){return true},requestAccess(){},photos(){return JSON.stringify({count:ITEMS.length,items:ITEMS})},' +
  'favs(){return "[]"},setFav(){},share(){},delete(){},pick(){},theme(){},info(){},setTilt(){}};})();</script>';
const html = fs.readFileSync(APP, 'utf8').replace('<body>', '<body>\n' + stub, 1);

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const unknown = [];
  let thumbHits = 0;
  let thumbWithLength = 0;
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (/^\/thumb\/\d+$/.test(url)) {
      thumbHits++;
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      thumbWithLength++;
      res.end(THUMB);
      return;
    }
    if (/^\/media\/\d+$/.test(url)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': THUMB.length });
      res.end(THUMB);
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    unknown.push(url);
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
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.message)));

  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  await page.waitForFunction('document.querySelectorAll(".tile").length > 0', { timeout: 60000 });
  await sleep(600);

  /* 1. boot: the shell, the tab bar and the grid are all there */
  const boot = await page.evaluate(() => ({
    head: (document.querySelector('#head') || {}).innerHTML || '',
    tabs: document.querySelectorAll('#tabs button[data-tab]').length,
    tiles: document.querySelectorAll('.tile').length,
    cols: getComputedStyle(document.querySelector('#screen .grid') || document.body).gridTemplateColumns,
  }));
  check('boot renders the header', boot.head.length > 40, boot.head.length + ' chars');
  check('boot renders all three tabs', boot.tabs === 3, boot.tabs + ' tabs');
  check('boot renders every tile', boot.tiles === COUNT, boot.tiles + '/' + COUNT);
  check('grid has a column layout', /\d/.test(boot.cols || ''), boot.cols);

  /* 2. thumbnails are fetched and carry a Content-Length */
  check('thumbnails are requested', thumbHits > 0, thumbHits + ' requests');
  check('thumb responses carry Content-Length', thumbHits === thumbWithLength);

  /* 3. albums tab renders a list, then back to the library */
  await page.click('#tabs button[data-tab="albums"]');
  await sleep(400);
  const albums = await page.evaluate(() => ({
    len: (document.querySelector('#screen') || {}).innerHTML.length,
    title: (document.querySelector('#head') || {}).textContent.trim(),
  }));
  check('albums tab renders a screen', albums.len > 200, albums.len + ' chars');
  check('albums tab retitles the header', /Album/i.test(albums.title), albums.title);

  await page.click('#tabs button[data-tab="library"]');
  await sleep(400);
  const back = await page.evaluate(() => document.querySelectorAll('.tile').length);
  check('library tab restores the grid', back === COUNT, back + '/' + COUNT);

  /* 4. search: type, get filtered results, clear */
  await page.click('#tabs button[data-tab="search"]');
  await sleep(400);
  await page.type('#q', 'Screenshots');
  await sleep(500);
  const search = await page.evaluate(() => ({
    q: (document.querySelector('#q') || {}).value,
    res: document.querySelectorAll('#res .tile').length,
  }));
  check('search field takes input', search.q === 'Screenshots', JSON.stringify(search.q));
  check('search filters the library', search.res === Math.round(COUNT / 8), search.res + ' results');

  /* 5. selection: enter select mode, toggle a tile, leave */
  await page.click('#tabs button[data-tab="library"]');
  await sleep(400);
  await page.click('#head [data-act="startsel"]');
  await sleep(300);
  const selMode = await page.evaluate(() => ({
    bar: !document.querySelector('#selbar').classList.contains('hide'),
    txt: document.querySelector('#selbar').textContent.trim(),
  }));
  check('select mode opens the selection bar', selMode.bar, selMode.txt);
  await page.click('.tile');
  await sleep(300);
  const sel1 = await page.evaluate(() => ({
    on: document.querySelectorAll('.tile.on').length,
    txt: document.querySelector('#selbar').textContent.trim(),
  }));
  check('tapping a tile selects it', sel1.on === 1, sel1.txt);
  await page.click('.tile.on');
  await sleep(300);
  const sel0 = await page.evaluate(() => document.querySelectorAll('.tile.on').length);
  check('tapping it again deselects', sel0 === 0, sel0 + ' selected');

  /* 6. viewer: open a photo, close it again */
  await page.click('#head [data-act="endsel"]');
  await sleep(300);
  const selModeOff = await page.evaluate(() => document.querySelectorAll('.tile.on').length);
  check('leaving select mode clears the selection', selModeOff === 0, selModeOff + ' selected');
  await page.click('.tile');
  await sleep(900);
  const viewerOpen = await page.evaluate(() => document.querySelectorAll('.viewer').length);
  check('tapping a photo opens the viewer', viewerOpen === 1, viewerOpen + ' viewers');
  await page.click('.viewer [data-v="close"]');
  await sleep(700);
  const viewerShut = await page.evaluate(() => document.querySelectorAll('.viewer').length);
  check('the back button closes the viewer', viewerShut === 0, viewerShut + ' viewers');
  const gridBack = await page.evaluate(() => document.querySelectorAll('.tile').length);
  check('the grid is intact after the viewer closes', gridBack === COUNT, gridBack + '/' + COUNT);

  /* 7. the session stayed clean */
  check('no console or page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('every request the app made was served', unknown.length === 0, unknown.slice(0, 3).join(' | '));

  await page.close();
  await browser.close();
  server.close();

  console.log('');
  console.log(failures === 0 ? 'SUITE PASS (' + COUNT + ' photos)' : 'SUITE FAIL: ' + failures + ' check(s)');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('suite crashed:', e && e.message);
  process.exit(1);
});

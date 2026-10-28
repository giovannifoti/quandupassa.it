// Test end-to-end nel browser reale (Google Chrome installato, via playwright-core).
// Avvio: npm run test:e2e
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { startServer } from '../../scripts/serve.mjs';

const PORT = 8899;
const BASE = `http://localhost:${PORT}`;
const MESSINA_DUOMO = { latitude: 38.1925, longitude: 15.5545, accuracy: 20 };
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let server;
let browser;

before(async () => {
  server = await startServer(PORT);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function openPage({ width = 390, height = 844, path = '/', geolocation = null, ready = '#search-input' } = {}) {
  const mobile = width < 700;
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'it-IT',
    serviceWorkers: 'block',
    ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {})
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !/tiles\.openfreemap\.org/.test(text)) problems.push(`console: ${text}`);
    if (/Content Security Policy|Refused to/i.test(text)) problems.push(`csp: ${text}`);
  });
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector(ready, { state: 'attached' });
  await page.waitForFunction(() => window.QuandupassaSun);
  return { page, context, problems };
}

async function waitForStops(page) {
  await page.waitForSelector('html[data-stops="ready"]', { state: 'attached' });
}

test('la home si carica senza errori né violazioni CSP e mostra la mappa', async () => {
  const { page, context, problems } = await openPage({ width: 1280, height: 800 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('map-loading').hidden, null, { timeout: 20000 });
  const mapBox = await page.locator('#map').boundingBox();
  assert.ok(mapBox.height > 700, 'la mappa deve occupare lo schermo');
  assert.deepEqual(problems, []);
  await context.close();
});

test('ricerca → scheda fermata con link agli orari', async () => {
  const { page, context, problems } = await openPage();
  await waitForStops(page);
  await page.fill('#search-input', 'caronte centro');
  await page.waitForSelector('#results:not([hidden]) .stop-row');
  assert.match(await page.textContent('#results-status'), /fermat[ae] trovat[ae]/);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sheet:not([hidden])');
  assert.equal(await page.textContent('#sheet-title'), 'CARONTE');
  const href = await page.getAttribute('#sheet-body a.button-primary', 'href');
  assert.equal(href, 'https://www.atmmessinaspa.it/smartpoles2.php?palina=1555');
  assert.match(page.url(), /\?fermata=palina-1555$/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('navigazione da tastiera nei risultati e chiusura con Esc', async () => {
  const { page, context } = await openPage({ width: 1280, height: 800 });
  await waitForStops(page);
  await page.focus('#search-input');
  await page.keyboard.type('cavour');
  await page.waitForSelector('#results:not([hidden]) .stop-row');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('stop-row')), true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sheet:not([hidden])');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sheet-title');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  await context.close();
});

test('nessun risultato: messaggio chiaro', async () => {
  const { page, context } = await openPage();
  await waitForStops(page);
  await page.fill('#search-input', 'zzzzqqq');
  await page.waitForSelector('#results:not([hidden])');
  assert.match(await page.textContent('#results-status'), /Nessuna fermata trovata/);
  await context.close();
});

test('preferiti: salvataggio, persistenza e rimozione', async () => {
  const { page, context } = await openPage({ path: '/?fermata=palina-832' });
  await page.waitForSelector('#sheet:not([hidden])');
  await page.click('[data-action="toggle-favorite"]');
  assert.equal(await page.getAttribute('[data-action="toggle-favorite"]', 'aria-pressed'), 'true');
  await page.reload();
  await page.waitForSelector('#sheet:not([hidden])');
  await page.click('#sheet-close');
  await page.click('#favorites-button');
  await page.waitForSelector('#sheet[data-view="favorites"]');
  assert.match(await page.textContent('#sheet-body'), /CAPOLINEA TORRE FARO/);
  assert.equal(await page.textContent('#favorites-count'), '1');
  await page.click('[data-action="remove-favorite"]');
  await page.waitForSelector('.empty-state');
  assert.equal(await page.isHidden('#favorites-count'), true);
  await context.close();
});

test('fermate vicine con geolocalizzazione', async () => {
  const { page, context, problems } = await openPage({ geolocation: MESSINA_DUOMO });
  await waitForStops(page);
  await page.click('#nearby-button');
  await page.waitForSelector('#sheet[data-view="nearby"]');
  const rows = await page.locator('#sheet-body .stop-row').count();
  assert.equal(rows, 8);
  assert.match(await page.textContent('#sheet-body .stop-row.is-highlighted'), /La più vicina/);
  await page.locator('#sheet-body .stop-row').nth(1).click();
  await page.waitForSelector('#sheet[data-view="stop"]');
  assert.equal(await page.isVisible('#sheet-back'), true);
  await page.click('#sheet-back');
  await page.waitForSelector('#sheet[data-view="nearby"]');
  assert.deepEqual(problems, []);
  await context.close();
});

test('geolocalizzazione negata: avviso comprensibile', async () => {
  const { page, context } = await openPage();
  await waitForStops(page);
  await context.clearPermissions();
  await page.click('#nearby-button');
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('is-visible'), null, { timeout: 15000 });
  assert.match(await page.textContent('#toast'), /posizione/i);
  await context.close();
});

test('pannello informazioni e link all\'elenco fermate', async () => {
  const { page, context } = await openPage();
  await page.click('#info-button');
  await page.waitForSelector('#sheet[data-view="info"]');
  assert.equal(await page.getAttribute('#info-button', 'aria-expanded'), 'true');
  assert.match(await page.textContent('#sheet-body'), /Privacy/);
  await page.click('#sheet-body a[href="/fermate/"]');
  await page.waitForURL(`${BASE}/fermate/`);
  await context.close();
});

test('pagina /fermate/: elenco completo e filtro', async () => {
  const { page, context, problems } = await openPage({ path: '/fermate/', ready: '#filter-input' });
  assert.ok(await page.locator('.stops li').count() > 1400);
  await page.fill('#filter-input', 'piazza cairoli');
  await page.waitForTimeout(250);
  const visible = await page.locator('.stops li:visible').count();
  assert.ok(visible > 0 && visible < 20, `risultati filtrati: ${visible}`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('404 con stato corretto e link di ritorno', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`${BASE}/pagina-che-non-esiste`);
  assert.equal(response.status(), 404);
  assert.equal(await page.locator('a[href="/"]').count() > 0, true);
  await context.close();
});

test('nessuno scroll orizzontale e controlli raggiungibili su tutte le dimensioni', async () => {
  const sizes = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [568, 320], [844, 390], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];
  for (const [width, height] of sizes) {
    const { page, context } = await openPage({ width, height, path: '/?fermata=palina-1555' });
    await page.waitForSelector('#sheet:not([hidden])');
    await page.waitForTimeout(350); // fine dell'animazione di apertura
    const result = await page.evaluate(() => {
      const offscreen = [...document.querySelectorAll('button, a, input')]
        .filter(element => element.offsetParent !== null)
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.right > window.innerWidth + 1 || rect.left < -1;
        })
        .map(element => element.id || element.className || element.tagName);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        offscreen,
        sheetVisible: (() => {
          const rect = document.getElementById('sheet').getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
        })()
      };
    });
    assert.equal(result.overflow, false, `${width}x${height}: scroll orizzontale`);
    assert.deepEqual(result.offscreen, [], `${width}x${height}: elementi fuori schermo`);
    assert.equal(result.sheetVisible, true, `${width}x${height}: pannello fuori schermo`);
    await context.close();
  }
});

test('accessibilità automatica (axe-core, WCAG 2.2 AA)', async () => {
  const scenarios = [
    { name: 'home', path: '/' },
    { name: 'scheda fermata', path: '/?fermata=palina-1555' },
    { name: 'elenco fermate', path: '/fermate/', raw: true }
  ];
  for (const { name, path, raw } of scenarios) {
    // bypassCSP solo qui, per poter iniettare axe-core (la CSP del sito blocca giustamente gli script inline).
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', bypassCSP: true });
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`);
    await page.waitForTimeout(raw ? 300 : 1500);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.waitForTimeout(400); // attende la fine delle transizioni di colore
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
          // La mappa è un canvas WebGL: il contrasto delle etichette cartografiche non è valutabile.
          exclude: [['.maplibregl-canvas-container'], ['.maplibregl-ctrl-attrib']]
        });
        return result.violations.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`);
      });
      assert.deepEqual(violations, [], `${name} (${theme})`);
    }
    await context.close();
  }
});

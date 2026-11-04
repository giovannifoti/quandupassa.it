// Test end-to-end della build dell'app (dist/) in Chrome con viewport da
// smartphone. I plugin Capacitor usano qui le loro implementazioni web
// (Geolocation → navigator.geolocation, Preferences → localStorage, Browser →
// window.open): si verificano interfaccia, flussi, errori e accessibilità.
// I comportamenti nativi vanno verificati su simulatore/dispositivo (vedi docs).
// Avvio: npm run test:e2e   (richiede Google Chrome installato)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const PORT = 8977;
const BASE = `http://localhost:${PORT}`;
const DUOMO = { latitude: 38.1925, longitude: 15.5545, accuracy: 20 };
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

async function openApp({ width = 390, height = 844, geolocation = null, denyLocation = false, colorScheme = 'light', path = '/', blockTiles = false, storageState, bypassCSP = false } = {}) {
  const context = await browser.newContext({
    bypassCSP,
    viewport: { width, height },
    isMobile: width < 700,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'it-IT',
    colorScheme,
    storageState,
    ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {})
  });
  if (blockTiles) await context.route(/tiles\.openfreemap\.org/, route => route.abort('internetdisconnected'));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const text = message.text();
    if (/Content Security Policy|Refused to/i.test(text)) problems.push(`csp: ${text}`);
    else if (message.type() === 'error' && !/openfreemap|Failed to load resource|ERR_INTERNET_DISCONNECTED|AJAXError|Failed to fetch/i.test(text)) problems.push(`console: ${text}`);
  });
  // window.open (orari ATM, mappe) viene registrato invece di aprire schede.
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = url => { window.__opened.push(String(url)); return null; };
  });
  if (denyLocation) {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) => setTimeout(() => fail({ code: 1, message: 'User denied Geolocation' }), 50);
    });
  }
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });
  return { page, context, problems };
}

async function search(page, text) {
  await page.click('#search-input');
  await page.fill('#search-input', text);
  await page.waitForFunction(() => document.querySelector('#search-status').textContent.length > 0);
}

test('avvio: interfaccia pronta, mappa disegnata, nessun errore né violazione CSP', async () => {
  const { page, context, problems } = await openApp();
  assert.equal(await page.textContent('#sheet-title'), 'Fermate ATM Messina');
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('map-loading').hidden, null, { timeout: 30000 });
  assert.equal(await page.isHidden('#map-placeholder'), true);
  assert.equal(await page.isVisible('.map-attribution'), true, 'attribuzione OpenStreetMap visibile');
  assert.match(await page.textContent('.map-attribution'), /OpenStreetMap/);
  assert.deepEqual(problems, []);
  await context.close();
});

test('ricerca: suggerimenti mentre si scrive, Invio apre la prima fermata', async () => {
  const { page, context, problems } = await openApp();
  await search(page, 'caronte centro');
  assert.match(await page.textContent('#search-status'), /^1 fermata trovata$/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
  assert.equal(await page.textContent('#sheet-title'), 'Caronte');
  assert.match(await page.textContent('#sheet-kicker'), /Palina 1555/);
  assert.match(await page.textContent('#sheet-body'), /Direzione Centro/);
  assert.equal(await page.isHidden('#search-panel'), true, 'la ricerca si chiude');
  // "Orari della fermata" apre la pagina ufficiale della palina (mai orari inventati).
  await page.click('#sheet-body [data-action="times"]');
  assert.deepEqual(await page.evaluate(() => window.__opened), ['https://www.atmmessinaspa.it/smartpoles2.php?palina=1555&rnd=87']);
  // Alternative ufficiali se ATM non risponde.
  const alternatives = await page.$$eval('#sheet-body .hint [data-href]', items => items.map(item => item.dataset.href));
  assert.ok(alternatives.some(url => /apps\.apple\.com|play\.google\.com/.test(url)));
  assert.ok(alternatives.includes('https://www.atmmessinaspa.it/servizio_bus.php?pag=2&tipo=1'));
  assert.deepEqual(problems, []);
  await context.close();
});

test('ricerca: abbreviazioni, errori di battitura e nessun risultato', async () => {
  const { page, context } = await openApp();
  await search(page, 'viale san martino');
  assert.match(await page.textContent('#search-status'), /fermate trovate/);
  assert.match(await page.textContent('#search-scroll'), /V\.le S\. ?Martino/);

  await page.fill('#search-input', 'garibaldy');
  await page.waitForFunction(() => /Forse cercavi/.test(document.querySelector('#search-scroll').textContent));
  assert.match(await page.textContent('#search-scroll'), /V\. Garibaldi/);

  await page.fill('#search-input', 'xyzxyzxyz');
  await page.waitForFunction(() => /Nessuna fermata trovata/.test(document.querySelector('#search-scroll').textContent));

  // Tastiera mobile: niente correzione automatica né maiuscole, tasto "Cerca".
  const attributes = await page.$eval('#search-input', input => [input.getAttribute('autocorrect'), input.getAttribute('autocapitalize'), input.getAttribute('enterkeyhint'), input.type]);
  assert.deepEqual(attributes, ['off', 'none', 'search', 'search']);
  const fontSize = await page.$eval('#search-input', input => parseFloat(getComputedStyle(input).fontSize));
  assert.ok(fontSize >= 16, 'iOS non deve ingrandire la pagina al focus');

  // Esc / Indietro chiude la ricerca.
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#search-panel'), true);
  await context.close();
});

test('preferiti: salvataggio, persistenza dopo il riavvio, rimozione con annulla', async () => {
  const { page, context } = await openApp();
  await search(page, 'caronte lago');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
  await page.click('[data-action="toggle-favorite"]');
  assert.match(await page.textContent('#toast'), /Salvata nei preferiti/);
  assert.equal(await page.getAttribute('[data-action="toggle-favorite"]', 'aria-pressed'), 'true');
  assert.equal(await page.textContent('#favorites-count'), '1');

  // Riavvio dell'app: i preferiti sono ancora lì, con gli orari a un tocco.
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });
  assert.equal(await page.textContent('#sheet-title'), 'Le tue fermate');
  assert.match(await page.textContent('#sheet-body'), /Caronte/);
  await page.click('#sheet-body [data-action="times"]');
  assert.deepEqual(await page.evaluate(() => window.__opened), ['https://www.atmmessinaspa.it/smartpoles2.php?palina=555&rnd=85']);

  await page.click('#sheet-body [data-action="remove-favorite"]');
  assert.match(await page.textContent('#sheet-title'), /Fermate ATM Messina/);
  await page.click('#toast-action');
  assert.equal(await page.textContent('#sheet-title'), 'Le tue fermate', 'Annulla ripristina il preferito');
  assert.equal(await page.textContent('#favorites-count'), '1');
  await context.close();
});

test('fermate vicine: posizione, distanze, tempo a piedi e ordine per vicinanza', async () => {
  const { page, context, problems } = await openApp({ geolocation: DUOMO });
  await page.click('#nearby-chip');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'nearby');
  const rows = await page.$$eval('#sheet-body .stop-row', items => items.map(item => item.textContent));
  assert.equal(rows.length, 10);
  assert.match(rows[0], /La più vicina/);
  assert.match(rows[0], /\d+ m · \d+ min a piedi/);
  assert.match(await page.textContent('#sheet-kicker'), /precisione ±20 m/);
  const distances = await page.$$eval('#sheet-body .stop-row-meta', items => items.map(item => {
    const match = item.textContent.match(/([\d.,]+) (m|km) ·/);
    return match ? parseFloat(match[1].replace(',', '.')) * (match[2] === 'km' ? 1000 : 1) : NaN;
  }));
  assert.ok(distances.every(Number.isFinite));
  assert.ok(distances[0] <= Math.min(...distances), 'la prima è la più vicina');
  assert.equal(await page.$$eval('#sheet-body [data-action="times"]', items => items.length), 10, 'orari a un tocco da ogni riga');

  // Dalla lista alla fermata e ritorno (tasto Indietro).
  await page.click('#sheet-body .stop-row >> nth=0');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
  assert.match(await page.textContent('#sheet-body'), /\d+ m · \d+ min/);
  assert.equal(await page.isVisible('#sheet-back'), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'nearby');
  assert.deepEqual(problems, []);
  await context.close();
});

test('posizione negata: messaggio chiaro e alternativa di ricerca', async () => {
  const { page, context } = await openApp({ denyLocation: true });
  await page.click('#nearby-chip');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'location-error');
  assert.equal(await page.textContent('#sheet-title'), 'Posizione non disponibile');
  assert.match(await page.textContent('#sheet-body'), /Hai negato l’accesso alla posizione/);
  await page.click('#sheet-body [data-action="search"]');
  assert.equal(await page.isVisible('#search-panel'), true);
  await context.close();
});

test('offline: avviso, orari bloccati con messaggio, ripresa automatica', async () => {
  const { page, context } = await openApp();
  await page.waitForFunction(() => document.getElementById('map-loading').hidden, null, { timeout: 30000 });
  await context.setOffline(true);
  await page.waitForSelector('#offline-banner:not([hidden])');
  // Ricerca e dati delle fermate funzionano senza rete (dati inclusi nell'app).
  await search(page, 'cavour');
  assert.match(await page.textContent('#search-status'), /fermate trovate/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
  await page.click('#sheet-body [data-action="times"]');
  assert.match(await page.textContent('#toast'), /serve una connessione/);
  assert.deepEqual(await page.evaluate(() => window.__opened), []);

  await context.setOffline(false);
  await page.waitForSelector('#offline-banner', { state: 'hidden' });
  assert.match(await page.textContent('#toast'), /Connessione ripristinata/);
  await context.close();
});

test('servizio cartografico irraggiungibile: messaggio al posto della mappa, il resto funziona', async () => {
  const { page, context } = await openApp({ blockTiles: true });
  await page.waitForSelector('#map-placeholder:not([hidden])', { timeout: 20000 });
  assert.match(await page.textContent('#map-placeholder'), /Mappa momentaneamente non disponibile/);
  await search(page, 'policlinico');
  assert.match(await page.textContent('#search-status'), /fermat/);
  await context.close();
});

test('tema: automatico segue il sistema, la scelta manuale resta dopo il riavvio', async () => {
  const { page, context } = await openApp({ colorScheme: 'dark' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  await page.click('#info-button');
  await page.click('[data-action="theme"][data-value="light"]');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.reload();
  await page.waitForSelector('html[data-ready="true"]', { state: 'attached' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await context.close();
});

test('informazioni: privacy, crediti OpenStreetMap e avviso di app non ufficiale', async () => {
  const { page, context } = await openApp();
  await page.click('#info-button');
  const text = await page.textContent('#sheet-body');
  assert.match(text, /non è un’app ufficiale di ATM Messina/);
  assert.match(text, /non lascia mai il dispositivo/);
  assert.match(text, /OpenStreetMap/);
  assert.match(text, /MapLibre/);
  await context.close();
});

const SIZES = [
  { name: 'iPhone SE (1ª gen.)', width: 320, height: 568 },
  { name: 'iPhone SE / 8', width: 375, height: 667 },
  { name: 'iPhone 15', width: 393, height: 852 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { name: 'Android compatto', width: 360, height: 640 },
  { name: 'Android grande', width: 412, height: 915 },
  { name: 'Orizzontale', width: 844, height: 390 },
  { name: 'Tablet', width: 820, height: 1180 }
];

for (const size of SIZES) {
  test(`layout ${size.name} (${size.width}×${size.height}): niente overflow, controlli visibili e grandi abbastanza`, async () => {
    const { page, context } = await openApp({ width: size.width, height: size.height });
    await search(page, 'cavour');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
    await page.waitForTimeout(450);
    const report = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const overflow = [...document.querySelectorAll('.top *, .sheet *')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width && (rect.right > width + 1 || rect.left < -1) && !element.closest('.chips-bar');
      }).map(element => element.className || element.tagName);
      const smallTargets = [...document.querySelectorAll('.top button, .top input, #sheet-body button, .fab, .sheet-header button')]
        .filter(element => element.offsetParent !== null && !element.closest('.hint, .prose'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height < 36 || rect.width < 36;
        }).map(element => element.getAttribute('aria-label') || element.textContent.trim());
      const times = document.querySelector('#sheet-body [data-action="times"]').getBoundingClientRect();
      return { overflow, smallTargets, timesVisible: times.top >= 0 && times.bottom <= window.innerHeight, timesHeight: times.height };
    });
    assert.deepEqual(report.overflow, [], 'elementi fuori dallo schermo');
    assert.deepEqual(report.smallTargets, [], 'target di tocco troppo piccoli');
    assert.ok(report.timesVisible, 'il pulsante Orari è visibile senza scorrere');
    assert.ok(report.timesHeight >= 48);
    await context.close();
  });
}

test('accessibilità (axe-core): home, ricerca e scheda fermata senza violazioni gravi', async () => {
  // Solo qui la CSP è aggirata, per poter iniettare axe-core nella pagina.
  const { page, context } = await openApp({ geolocation: DUOMO, bypassCSP: true });
  await page.addScriptTag({ content: axeSource });
  const run = () => page.evaluate(async () => {
    const result = await window.axe.run(document, {
      exclude: [['.maplibregl-canvas-container']],
      resultTypes: ['violations']
    });
    return result.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
  });
  assert.deepEqual(await run(), [], 'home');
  await search(page, 'cavour');
  assert.deepEqual(await run(), [], 'ricerca');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'stop');
  assert.deepEqual(await run(), [], 'scheda fermata');
  await page.click('#nearby-chip');
  await page.waitForFunction(() => document.getElementById('sheet').dataset.view === 'nearby');
  assert.deepEqual(await run(), [], 'fermate vicine');
  for (const theme of ['dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    assert.deepEqual(await run(), [], `tema ${theme}`);
  }
  await context.close();
});

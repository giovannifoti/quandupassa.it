import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  arrivalsUrl,
  buildSearchText,
  distanceMeters,
  extractStopCode,
  formatDistance,
  nearestStops,
  parseStops,
  searchStops,
  splitDirection,
  walkingMinutes
} from '../../public/js/stops.js';

const raw = JSON.parse(await readFile(new URL('../../public/stops_fixed.json', import.meta.url), 'utf8'));
const stops = parseStops(raw);

test('il dataset contiene tutte le fermate con coordinate valide', () => {
  assert.equal(stops.length, raw.length);
  for (const stop of stops) {
    assert.ok(stop.lat > 37.9 && stop.lat < 38.4, `${stop.name}: latitudine fuori area`);
    assert.ok(stop.lon > 15.3 && stop.lon < 15.8, `${stop.name}: longitudine fuori area`);
  }
});

test('ogni URL del dataset punta al sito ATM in https', () => {
  for (const item of raw) {
    const url = new URL(item.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'www.atmmessinaspa.it');
  }
});

test('gli id sono unici e compatibili con la versione precedente', () => {
  const ids = new Set(stops.map(stop => stop.id));
  assert.equal(ids.size, stops.length);
  assert.equal(stops[0].id, 'palina-832');
  assert.ok(stops.some(stop => stop.id === 'palina-1557-2'), 'i duplicati ricevono un suffisso');
});

test('il link agli orari è ricostruito solo da codici sicuri', () => {
  assert.equal(arrivalsUrl('832'), 'https://www.atmmessinaspa.it/smartpoles2.php?palina=832');
  assert.equal(arrivalsUrl(''), '');
  assert.equal(arrivalsUrl('"><script>'), '');
  assert.equal(arrivalsUrl('javascript:alert(1)'), '');
});

test('estrazione del codice palina', () => {
  assert.equal(extractStopCode('https://www.atmmessinaspa.it/smartpoles2.php?palina=832&rnd=24'), '832');
  assert.equal(extractStopCode('https://www.atmmessinaspa.it/smartpoles2.php?palina=&rnd=98'), '');
  assert.equal(extractStopCode('https://www.atmmessinaspa.it/smartpoles2.php?palina=%E0%A4%A'), '');
  assert.equal(extractStopCode(undefined), '');
});

test('i dati malevoli vengono scartati senza eccezioni', () => {
  const parsed = parseStops([
    null,
    { name: '', lat: 38.2, lon: 15.5 },
    { name: 'Fuori area', lat: 45, lon: 9 },
    { name: 'NaN', lat: 'abc', lon: 15.5 },
    { name: '<img src=x onerror=alert(1)>', lat: 38.2, lon: 15.55, url: 'javascript:alert(1)' }
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].arrivalsUrl, '');
  assert.throws(() => parseStops({}), TypeError);
});

test('la direzione viene separata dal nome', () => {
  assert.deepEqual(splitDirection('CARONTE DIR CENTRO'), { title: 'CARONTE', direction: 'CENTRO' });
  assert.deepEqual(splitDirection('TRIBUNALE'), { title: 'TRIBUNALE', direction: '' });
});

test('la ricerca capisce le abbreviazioni ATM', () => {
  assert.match(buildSearchText('V.LE S.MARTINO 12'), /viale san/);
  assert.match(buildSearchText('P.ZZA CAIROLI'), /piazza cairoli/);
  const results = searchStops(stops, 'piazza cairoli').map(result => result.stop.name);
  assert.ok(results.length > 0);
  assert.ok(results.every(name => /CAIROLI/.test(name)));
});

test('la ricerca ignora accenti, maiuscole e ordine delle parole', () => {
  const a = searchStops(stops, 'Caronte centro').map(result => result.stop.id);
  const b = searchStops(stops, 'centro CARONTE').map(result => result.stop.id);
  assert.deepEqual(a, b);
  assert.ok(a.includes('palina-1555'));
  assert.deepEqual(searchStops(stops, '   '), []);
});

test('i preferiti compaiono per primi nei risultati', () => {
  const favoriteId = searchStops(stops, 'cavour').at(-1).stop.id;
  const results = searchStops(stops, 'cavour', { isFavorite: stop => stop.id === favoriteId });
  assert.equal(results[0].stop.id, favoriteId);
});

test('distanze e fermate più vicine', () => {
  const duomo = { lat: 38.1925, lon: 15.5545 };
  const distance = distanceMeters(duomo, { lat: 38.2025, lon: 15.5545 });
  assert.ok(Math.abs(distance - 1112) < 5, `distanza attesa ~1112 m, ottenuta ${distance}`);
  const nearest = nearestStops(stops, duomo, 5);
  assert.equal(nearest.length, 5);
  for (let i = 1; i < nearest.length; i += 1) assert.ok(nearest[i].distance >= nearest[i - 1].distance);
  assert.ok(nearest[0].distance < 300);
});

test('formattazione distanze e tempi a piedi', () => {
  assert.equal(formatDistance(42), '40 m');
  assert.equal(formatDistance(1530), '1,5 km');
  assert.equal(formatDistance(NaN), '');
  assert.equal(walkingMinutes(10), 1);
  assert.equal(walkingMinutes(800), 10);
});

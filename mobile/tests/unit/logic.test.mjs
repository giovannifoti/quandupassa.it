// Test della logica dell'app: nomi leggibili, vicinanza, ricerca tollerante,
// validazione dei dati salvati e dei link esterni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStops, searchStops } from '../../../public/js/stops.js';
import { createFavorites } from '../../../public/js/favorites.js';
import {
  fuzzySearch, isAllowedExternalUrl, levenshtein, nearbyGrouped, parseCamera, parseIdList,
  parseSettings, positionMovedEnough, prettyName, pushRecent, shareUrl, walkingDirectionsUrl
} from '../../src/logic.js';

const raw = JSON.parse(await readFile(new URL('../../../public/stops_fixed.json', import.meta.url), 'utf8'));
const stops = parseStops(raw);

test('il dataset condiviso con il sito viene letto per intero', () => {
  assert.equal(stops.length, 1428);
  const withTimes = stops.filter(stop => stop.arrivalsUrl);
  // 10 fermate del dataset non hanno il codice palina: l'app lo segnala.
  assert.equal(withTimes.length, 1418);
  assert.ok(withTimes.every(stop => stop.arrivalsUrl.startsWith('https://www.atmmessinaspa.it/smartpoles2.php?palina=')));
});

test('nomi ATM resi leggibili senza rovinare le abbreviazioni', () => {
  assert.equal(prettyName('V.LE S.MARTINO'), 'V.le S.Martino');
  assert.equal(prettyName('P.ZZA CAIROLI'), 'P.zza Cairoli');
  assert.equal(prettyName('C.DA FORTINO'), 'C.da Fortino');
  assert.equal(prettyName('P.NO ROCCA SS113 B.VIO ACQUALADRONE'), 'P.no Rocca SS113 B.vio Acqualadrone');
  assert.equal(prettyName('ST. PANORAMICA DELLO STRETTO'), 'St. Panoramica dello Stretto');
  assert.equal(prettyName("TABBACCHI SANT'AGATA"), "Tabbacchi Sant'Agata");
  assert.equal(prettyName('VITTORIO EMANUELE III'), 'Vittorio Emanuele III');
  assert.equal(prettyName(''), '');
  // Ogni nome resta riconoscibile: stesse lettere, solo maiuscole diverse.
  for (const stop of stops) assert.equal(prettyName(stop.name).toLowerCase(), stop.name.toLowerCase().replace(/\s+/g, ' '));
});

test('fermate vicine ordinate per distanza, con le due direzioni affiancate', () => {
  const caronte = stops.find(stop => stop.code === '1555');
  const list = nearbyGrouped(stops, caronte, { limit: 10 });
  assert.equal(list.length, 10);
  assert.equal(list[0].stop.id, caronte.id);
  // Dopo il raggruppamento ogni nome compare in un blocco contiguo.
  const titles = list.map(entry => entry.stop.title);
  titles.forEach((title, index) => {
    const last = titles.lastIndexOf(title);
    for (let i = index; i <= last; i += 1) assert.equal(titles[i], title, `"${title}" non è contiguo`);
  });
  assert.deepEqual(nearbyGrouped(stops, caronte, { maxDistance: 0 }).map(entry => entry.stop.id), [caronte.id]);
});

test('ricerca tollerante agli errori di battitura, solo come ripiego', () => {
  assert.equal(levenshtein('garibaldy', 'garibaldi'), 1);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.ok(levenshtein('abcdef', 'uvwxyz', 2) > 2);
  assert.equal(searchStops(stops, 'garibaldy').length, 0);
  const fuzzy = fuzzySearch(stops, 'garibaldy');
  assert.ok(fuzzy.length > 0);
  assert.ok(fuzzy.every(({ stop }) => /GARIBALDI/.test(stop.name)));
  assert.ok(fuzzySearch(stops, 'policlinco').some(({ stop }) => /POLICLINICO/.test(stop.name)));
  assert.deepEqual(fuzzySearch(stops, 'ab'), []);
  assert.deepEqual(fuzzySearch(stops, 'zzzzqqqq'), []);
});

test('recenti, impostazioni e camera salvate vengono validate', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.equal(pushRecent(Array.from({ length: 20 }, (_, i) => `x${i}`), 'new').length, 8);
  assert.deepEqual(parseIdList('["palina-1","<script>",1,"ok-2"]'), ['palina-1', '1', 'ok-2']);
  assert.deepEqual(parseIdList('{"a":1}'), []);
  assert.deepEqual(parseIdList('non json'), []);
  assert.deepEqual(parseSettings('{"theme":"dark"}'), { theme: 'dark' });
  assert.deepEqual(parseSettings('{"theme":"rosa"}'), { theme: 'system' });
  assert.deepEqual(parseSettings(null), { theme: 'system' });
  assert.deepEqual(parseCamera('{"lon":15.55,"lat":38.19,"zoom":30}'), { lon: 15.55, lat: 38.19, zoom: 19 });
  assert.equal(parseCamera('{"lon":9.19,"lat":45.46,"zoom":12}'), null, 'fuori da Messina');
  assert.equal(parseCamera('{"lon":"x"}'), null);
  assert.equal(parseCamera('rotto'), null);
});

test('i preferiti dell’app usano lo stesso formato del sito', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  const favorites = createFavorites(storage);
  favorites.toggle(stops[0]);
  assert.deepEqual(JSON.parse(memory.get('favorites')), [stops[0].id]);
  const reopened = createFavorites(storage);
  assert.ok(reopened.has(stops[0]), 'i preferiti sopravvivono alla riapertura');
});

test('link esterni consentiti solo verso domini noti e in https', () => {
  const stop = stops.find(item => item.code === '1555');
  assert.ok(isAllowedExternalUrl(stop.arrivalsUrl));
  assert.ok(isAllowedExternalUrl(walkingDirectionsUrl(stop, 'ios')));
  assert.ok(isAllowedExternalUrl(walkingDirectionsUrl(stop, 'android')));
  assert.match(walkingDirectionsUrl(stop, 'ios'), /^https:\/\/maps\.apple\.com\/\?daddr=38\.2109\d+,15\.5610\d+&dirflg=w$/);
  assert.match(walkingDirectionsUrl(stop, 'android'), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  assert.equal(shareUrl(stop), 'https://quandupassa.it/?fermata=palina-1555');
  assert.equal(isAllowedExternalUrl('http://www.atmmessinaspa.it/'), false);
  assert.equal(isAllowedExternalUrl('https://evil.example/'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('https://www.atmmessinaspa.it.evil.example/'), false);
});

test('aggiornamento della posizione solo per spostamenti significativi', () => {
  const a = { lat: 38.19, lon: 15.55 };
  assert.equal(positionMovedEnough(a, { lat: 38.19001, lon: 15.55 }, 25), false);
  assert.equal(positionMovedEnough(a, { lat: 38.1905, lon: 15.55 }, 25), true);
  assert.equal(positionMovedEnough(null, a), true);
});

// Logica pura dell'app (senza DOM né plugin nativi): testabile con node:test.
import { distanceMeters, normalize, tokenize } from '../../public/js/stops.js';

/* ------------------------------------------------------------- nomi */

// Le abbreviazioni ATM restano riconoscibili: "V.LE" → "V.le", non "V.Le".
const ABBREVIATION_TAILS = new Set(['le', 'zza', 'so', 'da', 'lla', 'la', 'ne', 'ta', 'ni', 'no', 'vio', 'te', 'go']);
const LOWERCASE_WORDS = new Set([
  'di', 'del', 'della', 'delle', 'dei', 'degli', 'dello', 'da', 'dal', 'dalla',
  'a', 'al', 'alla', 'alle', 'ai', 'agli', 'e', 'ed', 'in', 'con', 'per', 'su', 'sul', 'sulla', 'lato'
]);
const UPPERCASE_WORDS = /^(atm|ss|sp|s\.s\.?|s\.p\.?|ii|iii|iv|vi|vii|viii|ix|xi|xii|xx|xxiv|uil|cisl|cgil|inps|inail|asp|irccs|ctm|cas|ipab|zir|mt)\d*$/;

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function prettyWord(word, isFirst) {
  if (!word) return word;
  if (UPPERCASE_WORDS.test(word)) return word.toUpperCase();
  if (!isFirst && LOWERCASE_WORDS.has(word)) return word;
  // "s.martino" → "S.Martino", "v.le" → "V.le", "c.da" → "C.da"
  const dotted = word.match(/^([a-z]{1,4})\.([a-zàèéìòù].*)$/);
  if (dotted && !ABBREVIATION_TAILS.has(dotted[2].replace(/[^a-z]/g, ''))) {
    return `${capitalize(dotted[1])}.${prettyWord(dotted[2], true)}`;
  }
  // Parole composte: "Torre-Faro", "Sant'Agata", "(Contesse)"
  return word.replace(/(^|[-'(/])([a-zàèéìòù])/g, (_, sep, letter) => `${sep}${letter.toUpperCase()}`);
}

// I nomi ATM sono tutti in maiuscolo: in app li mostriamo in un formato più
// leggibile (anche per VoiceOver/TalkBack), senza toccare i dati originali.
export function prettyName(name) {
  const words = String(name ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.map((word, index) => prettyWord(word, index === 0)).join(' ');
}

/* ------------------------------------------------------------- vicinanza */

// Ordina per distanza ma tiene vicine le fermate con lo stesso nome (le due
// direzioni della stessa via): chi cerca "la fermata qui sotto" le trova insieme.
export function nearbyGrouped(stops, origin, { limit = 10, maxDistance = Infinity } = {}) {
  const sorted = stops
    .map(stop => ({ stop, distance: distanceMeters(origin, stop) }))
    .filter(entry => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);

  const groups = new Map();
  for (const entry of sorted) {
    const key = normalize(entry.stop.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()].flat();
}

/* ------------------------------------------------------------- ricerca tollerante */

export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

const wordsCache = new WeakMap();
function wordsOf(stop) {
  let words = wordsCache.get(stop);
  if (!words) {
    words = [...new Set(stop.searchText.split(' ').filter(Boolean))];
    wordsCache.set(stop, words);
  }
  return words;
}

function tokenMatches(token, words) {
  if (token.length < 4) return words.some(word => word.startsWith(token));
  const tolerance = token.length >= 8 ? 2 : 1;
  return words.some(word => (
    word.startsWith(token) ||
    levenshtein(token, word, tolerance) <= tolerance ||
    (word.length > token.length && levenshtein(token, word.slice(0, token.length), tolerance) <= tolerance)
  ));
}

// Usata solo quando la ricerca esatta non trova nulla: corregge piccoli
// errori di battitura ("garibaldy", "boccetta" → "boccetta").
export function fuzzySearch(stops, query, limit = 20) {
  const tokens = tokenize(query);
  if (!tokens.length || tokens.every(token => token.length < 4)) return [];
  const results = [];
  for (const stop of stops) {
    const words = wordsOf(stop);
    if (tokens.every(token => tokenMatches(token, words))) results.push({ stop, score: 0, distance: null });
    if (results.length >= limit) break;
  }
  return results;
}

/* ------------------------------------------------------------- recenti e camera */

export function pushRecent(list, id, max = 8) {
  return [id, ...list.filter(item => item !== id)].slice(0, max);
}

export function parseIdList(value, max = 500) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter(id => /^[\w-]{1,40}$/.test(id)).slice(0, max);
  } catch {
    return [];
  }
}

const MESSINA_BOUNDS = { minLon: 14.8, maxLon: 16.3, minLat: 37.7, maxLat: 38.7 };

export function parseCamera(value) {
  try {
    const camera = JSON.parse(value || 'null');
    if (!camera) return null;
    const { lon, lat, zoom } = camera;
    if (![lon, lat, zoom].every(Number.isFinite)) return null;
    if (lon < MESSINA_BOUNDS.minLon || lon > MESSINA_BOUNDS.maxLon) return null;
    if (lat < MESSINA_BOUNDS.minLat || lat > MESSINA_BOUNDS.maxLat) return null;
    return { lon, lat, zoom: Math.min(19, Math.max(9, zoom)) };
  } catch {
    return null;
  }
}

export function parseSettings(value) {
  const defaults = { theme: 'system' };
  try {
    const parsed = JSON.parse(value || '{}');
    return {
      theme: ['system', 'light', 'dark'].includes(parsed?.theme) ? parsed.theme : defaults.theme
    };
  } catch {
    return defaults;
  }
}

/* ------------------------------------------------------------- link esterni */

// Percorso a piedi con l'app di mappe del sistema: Apple Mappe su iOS,
// Google Maps (app o sito) altrove. Coordinate validate, nessun dato utente.
export function walkingDirectionsUrl(stop, os) {
  const lat = Number(stop.lat).toFixed(6);
  const lon = Number(stop.lon).toFixed(6);
  if (os === 'ios') return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat}%2C${lon}&travelmode=walking`;
}

export function shareUrl(stop) {
  return `https://quandupassa.it/?fermata=${encodeURIComponent(stop.id)}`;
}

// Consentiamo di aprire solo URL https verso domini noti.
const ALLOWED_HOSTS = [
  'www.atmmessinaspa.it', 'atmmessinaspa.it', 'apps.apple.com', 'play.google.com',
  'maps.apple.com', 'www.google.com', 'openfreemap.org', 'www.openmaptiles.org',
  'www.openstreetmap.org', 'maplibre.org', 'capacitorjs.com', 'github.com', 'quandupassa.it'
];

export function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- posizione */

export function positionMovedEnough(previous, next, meters = 25) {
  if (!previous || !next) return true;
  return distanceMeters(previous, next) >= meters;
}

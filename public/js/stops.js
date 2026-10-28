// Gestione dati fermate: normalizzazione, ricerca e distanze.
// Modulo senza dipendenze dal DOM, così può essere testato con Node.

// Pagina della palina sul sito ATM: è la stessa aperta dal QR code esposto
// alle fermate. A volte ATM la rende temporaneamente irraggiungibile
// ("Accesso non consentito"): per questo offriamo anche i canali alternativi.
const ATM_POLE_URL = 'https://www.atmmessinaspa.it/smartpoles2.php';

export const ATM_LINKS = {
  lines: 'https://www.atmmessinaspa.it/servizio_bus.php?pag=2&tipo=1',
  appStore: 'https://apps.apple.com/it/app/atm-movup/id1576162531',
  googlePlay: 'https://play.google.com/store/apps/details?id=net.pluservice.atmmessina'
};

const ZONE_LABELS = { nord: 'Nord', centro: 'Centro', sud: 'Sud' };
export const ZONE_ORDER = ['nord', 'centro', 'sud'];

// Abbreviazioni ricorrenti nei nomi ATM: servono solo alla ricerca,
// così "viale san martino" trova anche "V.LE S.MARTINO".
const ABBREVIATIONS = [
  [/\bv\.le\b\.?/g, ' viale '],
  [/\bv\.lla\b\.?/g, ' villa '],
  [/\bv\.la\b\.?/g, ' villa '],
  [/\bp\.zza\b\.?/g, ' piazza '],
  [/\bc\.so\b\.?/g, ' corso '],
  [/\bc\.da\b\.?/g, ' contrada '],
  [/\bstr\.(?=\w)/g, ' strada '],
  [/\bstr\./g, ' strada '],
  [/\bst\./g, ' strada '],
  [/\bprov\.le\b/g, ' provinciale '],
  [/\bv\.(?=\s|\w)/g, ' via '],
  [/\bp\.(?=\s|\w)/g, ' piazza '],
  [/\bs\.(?=\s|\w)/g, ' san santa santo '],
  [/\bdir\b\.?/g, ' direzione ']
];

export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function buildSearchText(name) {
  const base = normalize(name);
  let expanded = base;
  for (const [pattern, replacement] of ABBREVIATIONS) {
    expanded = expanded.replace(pattern, replacement);
  }
  const compact = text => text.replace(/[^a-z0-9]+/g, ' ').trim();
  return `${compact(base)} ${compact(expanded)}`;
}

export function tokenize(query) {
  return normalize(query)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Il link alla palina viene ricostruito da codice e parametro rnd validati,
// mai copiato dal dataset: un dato corrotto non può iniettare URL arbitrari.
export function arrivalsUrl(code, rnd = '') {
  if (!/^[0-9A-Za-z_-]{1,12}$/.test(code)) return '';
  const url = `${ATM_POLE_URL}?palina=${encodeURIComponent(code)}`;
  return /^\d{1,6}$/.test(rnd) ? `${url}&rnd=${rnd}` : url;
}

export function extractRnd(url) {
  const match = String(url ?? '').match(/[?&]rnd=(\d{1,6})(?:&|#|$)/);
  return match ? match[1] : '';
}

export function extractStopCode(url) {
  const match = String(url ?? '').match(/[?&]palina=([^&#]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return '';
  }
}

// Sceglie lo store dell'app ATM MovUp adatto al dispositivo (null su desktop).
export function appStoreFor(userAgent = '', maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return ATM_LINKS.appStore;
  if (/Android/i.test(userAgent)) return ATM_LINKS.googlePlay;
  return null;
}

export function directionsUrl(stop) {
  const destination = encodeURIComponent(`${stop.lat},${stop.lon}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=walking`;
}

export function splitDirection(name) {
  const match = String(name).match(/^(.*?)\s+DIR\.?\s+(.+)$/i);
  if (!match || !match[1].trim()) return { title: name, direction: '' };
  return { title: match[1].trim(), direction: match[2].trim() };
}

export function getZone(lat) {
  if (lat >= 38.215) return 'nord';
  if (lat <= 38.175) return 'sud';
  return 'centro';
}

export function zoneLabel(zone) {
  return ZONE_LABELS[zone] ?? '';
}

function isPlausibleCoordinate(lat, lon) {
  return lat >= 37.5 && lat <= 38.6 && lon >= 15 && lon <= 16;
}

// Gli id restano identici alla versione precedente (palina-<codice>,
// con suffisso per i duplicati, oppure idx-<posizione>) per non perdere
// i preferiti già salvati dagli utenti.
export function parseStops(raw) {
  if (!Array.isArray(raw)) throw new TypeError('Il file fermate non contiene una lista valida');

  const usedIds = new Set();
  const uniqueId = base => {
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id;
  };

  const stops = [];
  raw.forEach((item, index) => {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isPlausibleCoordinate(lat, lon)) return;

    const name = item.name.trim().replace(/\s+/g, ' ');
    // Il codice palina è usato solo come identificativo e testo: deve essere alfanumerico.
    const rawCode = extractStopCode(item.url);
    const code = /^[0-9A-Za-z_-]{1,12}$/.test(rawCode) ? rawCode : '';
    const id = uniqueId(code ? `palina-${code}` : `idx-${index}`);
    const { title, direction } = splitDirection(name);

    stops.push({
      id,
      index,
      code,
      name,
      title,
      direction,
      lat,
      lon,
      zone: getZone(lat),
      arrivalsUrl: arrivalsUrl(code, extractRnd(item.url)),
      searchText: buildSearchText(name)
    });
  });
  return stops;
}

export function searchStops(stops, query, { isFavorite = () => false, origin = null } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const phrase = tokens.join(' ');
  const results = [];
  for (const stop of stops) {
    if (!tokens.every(token => stop.searchText.includes(token))) continue;

    const name = stop.searchText;
    let score = 0;
    if (name.startsWith(phrase)) score += 40;
    else if (name.includes(` ${phrase}`)) score += 25;
    else if (name.includes(phrase)) score += 15;
    tokens.forEach(token => {
      if (name.startsWith(token) || name.includes(` ${token}`)) score += 4;
    });
    if (isFavorite(stop)) score += 30;

    const distance = origin ? distanceMeters(origin, stop) : null;
    results.push({ stop, score, distance });
  }

  return results.sort((a, b) => (
    b.score - a.score ||
    (a.distance ?? 0) - (b.distance ?? 0) ||
    a.stop.name.localeCompare(b.stop.name, 'it')
  ));
}

export function distanceMeters(a, b) {
  const R = 6371008.8;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestStops(stops, origin, limit = 8, { exclude = null, maxDistance = Infinity } = {}) {
  return stops
    .filter(stop => stop.id !== exclude)
    .map(stop => ({ stop, distance: distanceMeters(origin, stop) }))
    .filter(entry => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function formatDistance(distance) {
  if (!Number.isFinite(distance)) return '';
  if (distance < 1000) return `${Math.max(1, Math.round(distance / 5) * 5)} m`;
  const km = distance / 1000;
  return `${km.toLocaleString('it-IT', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

// Stima a passo medio (circa 4,8 km/h): indicativa, non un tempo di percorrenza reale.
export function walkingMinutes(distance) {
  if (!Number.isFinite(distance)) return null;
  return Math.max(1, Math.round(distance / 80));
}

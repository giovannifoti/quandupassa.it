// Genera le pagine statiche derivate dal dataset delle fermate:
//   public/fermate/index.html  elenco A–Z indicizzabile e accessibile
//   public/sitemap.xml         sitemap per i motori di ricerca
//   public/robots.txt          regole per i crawler
// Uso: node scripts/build-pages.mjs [--check]
// Con --check non scrive nulla e fallisce se i file non sono aggiornati.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseStops, zoneLabel } from '../public/js/stops.js';

const SITE = 'https://quandupassa.it';
const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = `${root}public/`;
const checkOnly = process.argv.includes('--check');

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const raw = JSON.parse(await readFile(`${publicDir}stops_fixed.json`, 'utf8'));
const stops = parseStops(raw).sort((a, b) => a.name.localeCompare(b.name, 'it'));

function groupKey(name) {
  const first = name.normalize('NFD').charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

const groups = new Map();
for (const stop of stops) {
  const key = groupKey(stop.name);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(stop);
}

const brandMark = '<svg class="brand-mark" viewBox="0 0 64 80" aria-hidden="true" focusable="false"><path class="brand-pin" d="M32 2C15.4 2 2 15.1 2 31.5 2 52 32 78 32 78s30-26 30-46.5C62 15.1 48.6 2 32 2Z"/><rect class="brand-bus" x="16" y="14" width="32" height="33" rx="7"/><rect class="brand-glass" x="20.5" y="18.5" width="23" height="13" rx="3"/><circle class="brand-glass" cx="23.5" cy="39.5" r="2.6"/><circle class="brand-glass" cx="40.5" cy="39.5" r="2.6"/><rect class="brand-bus" x="19" y="44" width="6" height="7" rx="2"/><rect class="brand-bus" x="39" y="44" width="6" height="7" rx="2"/></svg>';

// Markup compatto: il contesto del <li> rende chiaro lo scopo di "Mappa" e
// "Orari" (WCAG 2.4.4) senza ripetere il nome della fermata in ogni link.
function stopItem(stop) {
  const meta = `${zoneLabel(stop.zone)}${stop.code ? ` · palina ${escapeHtml(stop.code)}` : ''}`;
  const arrivals = stop.arrivalsUrl ? `<a href="${escapeHtml(stop.arrivalsUrl)}" rel="nofollow">Orari</a>` : '';
  return `<li><span><b>${escapeHtml(stop.name)}</b><small>${meta}</small></span><a href="/?fermata=${encodeURIComponent(stop.id)}" rel="nofollow">Mappa</a>${arrivals}</li>`;
}

const letters = [...groups.keys()];
const listHtml = letters.map(letter => {
  const id = letter === '#' ? 'altre' : letter.toLowerCase();
  return `<section class="group"><h2 id="g-${id}">${letter}</h2><ul class="stops">\n${groups.get(letter).map(stopItem).join('\n')}\n</ul></section>`;
}).join('\n');

const fermateHtml = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Elenco fermate autobus ATM Messina dalla A alla Z – Quando Passa</title>
  <meta name="description" content="Elenco completo delle ${stops.length.toLocaleString('it-IT')} fermate degli autobus ATM di Messina in ordine alfabetico, con zona, codice palina, posizione sulla mappa e collegamento agli orari.">
  <link rel="canonical" href="${SITE}/fermate/">
  <meta name="robots" content="index, follow">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#faf8f5">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="it_IT">
  <meta property="og:site_name" content="Quando Passa">
  <meta property="og:title" content="Elenco fermate autobus ATM Messina – Quando Passa">
  <meta property="og:description" content="Tutte le fermate ATM di Messina in ordine alfabetico, con mappa e orari della palina.">
  <meta property="og:url" content="${SITE}/fermate/">
  <meta property="og:image" content="${SITE}/img/og-image.png">
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="/css/base.css">
  <link rel="stylesheet" href="/css/page.css">
  <script src="/js/sun.js"></script>
  <script type="module" src="/js/stops-page.js"></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Mappa fermate", "item": "${SITE}/" },
      { "@type": "ListItem", "position": 2, "name": "Elenco fermate", "item": "${SITE}/fermate/" }
    ]
  }
  </script>
</head>
<body>
  <a class="skip-link" href="#elenco">Vai all'elenco</a>
  <div class="page">
    <header class="page-header">
      <a class="brand" href="/">${brandMark}quandupassa<span>.it</span></a>
      <a class="button button-primary" href="/">Apri la mappa</a>
    </header>
    <main>
      <nav aria-label="Percorso di navigazione" class="visually-hidden"><a href="/">Mappa fermate</a> › Elenco fermate</nav>
      <h1>Fermate autobus ATM Messina dalla A alla Z</h1>
      <p class="lead">L'elenco di tutte le ${stops.length.toLocaleString('it-IT')} fermate degli autobus ATM di Messina presenti su Quando Passa. Per ogni fermata puoi vederne la posizione sulla mappa o aprire gli orari della palina sul sito di ATM Messina.</p>
      <div class="filter" id="filter" hidden>
        <label for="filter-input">Filtra l'elenco</label>
        <input id="filter-input" type="search" placeholder="Es. Cavour, viale San Martino" autocomplete="off" spellcheck="false" aria-describedby="filter-status">
        <p class="visually-hidden" id="filter-status" role="status" aria-live="polite"></p>
      </div>
      <nav aria-label="Iniziali">
        <ul class="letters">
${letters.map(letter => `          <li><a href="#g-${letter === '#' ? 'altre' : letter.toLowerCase()}">${letter}</a></li>`).join('\n')}
        </ul>
      </nav>
      <div id="elenco">
${listHtml}
      </div>
      <p class="empty" id="filter-empty" hidden>Nessuna fermata corrisponde alla ricerca.</p>
    </main>
    <footer class="page-footer">
      <p>Gli orari sono pubblicati da <a href="https://www.atmmessinaspa.it/" rel="noopener" target="_blank">ATM Messina</a>. Quando Passa è un progetto di <a href="https://github.com/giovannifoti" rel="noopener" target="_blank">Giovanni Foti</a>.</p>
    </footer>
  </div>
</body>
</html>
`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>
  </url>
  <url>
    <loc>${SITE}/fermate/</loc>
  </url>
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

const outputs = {
  'fermate/index.html': fermateHtml,
  'sitemap.xml': sitemap,
  'robots.txt': robots
};

let stale = [];
for (const [file, content] of Object.entries(outputs)) {
  const path = `${publicDir}${file}`;
  if (checkOnly) {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== content) stale.push(file);
  } else {
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, content);
  }
}

if (checkOnly && stale.length) {
  console.error(`File generati non aggiornati: ${stale.join(', ')}. Esegui "npm run build".`);
  process.exit(1);
}
console.log(checkOnly ? 'Pagine generate aggiornate.' : `Generate ${Object.keys(outputs).length} pagine (${stops.length} fermate).`);

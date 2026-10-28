<p align="center">
  <img src="public/icon-192.png" width="96" height="96" alt="Logo Quando Passa">
</p>

# Quando Passa

**Quando Passa** ([quandupassa.it](https://quandupassa.it)) è una web app mobile-first per trovare le fermate degli autobus ATM di Messina, vedere quelle più vicine alla propria posizione, salvare le preferite e aprire gli orari della palina sul sito ATM.

Funziona interamente nel browser: niente account, niente cookie, nessun backend.

## Funzionalità

- Mappa vettoriale delle 1.428 fermate con raggruppamento automatico (cluster) e nomi visibili da vicino.
- Ricerca istantanea per nome, via o piazza, che capisce le abbreviazioni ATM («viale» trova «V.LE», «piazza» trova «P.ZZA»…) e funziona anche da tastiera (frecce, Invio, Esc).
- **Fermate vicine**: le 8 fermate più vicine alla tua posizione con distanza e tempo a piedi stimato.
- Scheda fermata con direzione, codice palina, link agli orari ATM, percorso a piedi (Google Maps), condivisione e fermate nelle vicinanze (utile per trovare quella in direzione opposta).
- Preferiti salvati sul dispositivo, con accesso diretto agli orari in un tocco.
- Link condivisibili a una fermata: `https://quandupassa.it/?fermata=palina-1555`.
- Elenco testuale di tutte le fermate su [`/fermate/`](https://quandupassa.it/fermate/) (accessibile e indicizzabile).
- Tema chiaro/scuro automatico in base ad alba e tramonto a Messina.
- PWA installabile, utilizzabile anche offline (ricerca, preferiti, elenco).

## Stack tecnico

- HTML, CSS e JavaScript (moduli ES) senza framework né bundler.
- [MapLibre GL JS](https://maplibre.org/) 6, servito dallo stesso dominio (`public/vendor/`), con cartografia [OpenFreeMap](https://openfreemap.org/) / © OpenStreetMap.
- Netlify per l'hosting, con header di sicurezza e cache definiti in `netlify.toml`.

## Struttura

```text
.
├── netlify.toml             # publish = public/, header di sicurezza, cache, redirect
├── package.json             # script di sviluppo e test (nessuna dipendenza a runtime)
├── public/                  # tutto ciò che viene pubblicato
│   ├── index.html           # app
│   ├── fermate/index.html   # elenco A–Z (GENERATO)
│   ├── 404.html
│   ├── css/                 # base.css (token e componenti), app.css, page.css
│   ├── js/
│   │   ├── app.js           # interfaccia: ricerca, pannelli, posizione, preferiti
│   │   ├── map.js           # mappa MapLibre (caricata on demand)
│   │   ├── stops.js         # dati fermate, ricerca, distanze (puro, testabile)
│   │   ├── favorites.js     # preferiti in localStorage
│   │   ├── sun.js           # alba/tramonto e tema iniziale
│   │   └── stops-page.js    # filtro della pagina /fermate/
│   ├── stops_fixed.json     # dataset delle fermate
│   ├── sw.js                # service worker
│   ├── manifest.json, img/, icon-*.png
│   ├── robots.txt, sitemap.xml   # GENERATI
│   └── vendor/              # MapLibre (GENERATO da node_modules)
├── scripts/
│   ├── build-pages.mjs      # genera fermate/, sitemap.xml, robots.txt
│   ├── vendor.mjs           # copia MapLibre in public/vendor
│   ├── images.mjs           # genera og-image e icone dal logo SVG
│   └── serve.mjs            # server locale con gli stessi header di Netlify
└── tests/
    ├── unit/                # node:test (dati, ricerca, preferiti, SEO, sicurezza)
    └── e2e/                 # Playwright + Chrome (flussi, responsive, axe-core)
```

## Sviluppo

Requisiti: Node.js 20+ e, per i test end-to-end, Google Chrome installato.

```bash
npm install
npm run serve        # http://localhost:8888 con CSP e header di produzione
npm test             # test unitari e controlli statici
npm run test:e2e     # test nel browser
```

Dopo aver modificato `public/stops_fixed.json`:

```bash
npm run build        # rigenera /fermate/, sitemap e robots
```

Per aggiornare MapLibre: cambiare la versione in `package.json`, eseguire `npm install && npm run vendor` e aggiornare il numero di versione in `public/js/map.js`, `public/sw.js` e `public/index.html` (un test verifica che siano allineati). A ogni modifica dei file dell'app conviene incrementare `VERSION` in `public/sw.js`.

## Pubblicazione

Ogni push su `main` viene pubblicato automaticamente da Netlify (nessun comando di build: si pubblica `public/` così com'è). Le pull request generano un deploy di anteprima.

## Privacy

- La posizione viene chiesta solo quando si tocca «Fermate vicine» ed è usata esclusivamente nel browser.
- I preferiti restano sul dispositivo (`localStorage`).
- Nessun cookie, analytics o tracciamento; nessun font o script da CDN esterni.
- Le tessere della mappa sono scaricate da OpenFreeMap; i link «Orari» e «Percorso» aprono rispettivamente il sito ATM e Google Maps.

## Autore

Progetto di [Giovanni Foti](https://github.com/giovannifoti). Segnalazioni e suggerimenti sono benvenuti tramite le issue del repository.

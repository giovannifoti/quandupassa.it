# Analisi del progetto quandupassa.it

Analisi svolta il 4 novembre 2026 sul branch `main` (commit `78f2eae`), prima di sviluppare l'app.

## Architettura del sito

| Aspetto | Situazione |
| --- | --- |
| Linguaggi | HTML, CSS, JavaScript (moduli ES), nessun framework né bundler |
| Mappa | MapLibre GL JS 6.16.0, copiato in `public/vendor/` (niente CDN), stile vettoriale OpenFreeMap (positron / dark) |
| Dati | `public/stops_fixed.json`: 1.428 fermate con nome, coordinate e URL della palina ATM |
| Logica | `public/js/stops.js` (normalizzazione, ricerca con abbreviazioni ATM, distanze, tempi a piedi), `favorites.js` (localStorage), `sun.js` (tema da alba/tramonto) |
| Interfaccia | `public/js/app.js` (ricerca, pannello, fermate vicine, preferiti), `map.js` (layer, cluster, selezione) |
| Offline | service worker `sw.js`: shell dell'app e dataset in cache, tessere della mappa escluse |
| Backend | nessuno; nessun cookie, nessun analytics |
| Hosting | Netlify, cartella `public/` senza comando di build, header di sicurezza e cache in `netlify.toml` |
| Test | `node:test` (dati, ricerca, preferiti, SEO, sicurezza) e Playwright + Chrome (flussi, responsive, axe-core) |
| Git | `main` pubblica in produzione su Netlify; le PR generano un deploy di anteprima |

### Funzionamento

- **Mappa**: sorgente GeoJSON con cluster fino allo zoom 15; preferiti in giallo (anche nei cluster), fermata selezionata in rosso, posizione utente con cerchio di precisione; area di tocco allargata.
- **Ricerca**: testo normalizzato (accenti, maiuscole) con espansione delle abbreviazioni ATM («V.LE» ↔ «viale», «P.ZZA» ↔ «piazza», «S.» ↔ «san/santa/santo»…); punteggio per inizio frase/parola, preferiti in cima, a parità di punteggio la più vicina.
- **Fermate vicine**: `navigator.geolocation` solo al tocco, 8 fermate più vicine con distanza in linea d'aria e minuti a piedi (80 m/min).
- **Preferiti**: id `palina-<codice>` salvati in `localStorage`, compatibili con i formati precedenti.
- **Orari**: pulsante verso `https://www.atmmessinaspa.it/smartpoles2.php?palina=<codice>&rnd=<n>`, ricostruito da codice e parametro validati (mai copiato dal dataset). Alternative: app ufficiale ATM MovUp e pagina degli orari delle linee.

### Servizio orari ATM

La pagina `smartpoles2.php` è quella aperta dai QR code esposti alle paline: è pubblica. ATM a volte risponde «Accesso non consentito» per ore o giorni; è un disservizio temporaneo e il link resta l'azione principale. L'app non usa proxy, non modifica Referer o User-Agent e non legge né replica il contenuto della pagina: la apre nel browser di sistema, come farebbe chi inquadra il QR code.

## Problemi e limiti individuati

| # | Tipo | Descrizione | Gestione |
| --- | --- | --- | --- |
| 1 | Dati | 10 fermate hanno `palina=` vuoto nell'URL (es. «P.ZZA CASTRONOVO», «V.AURIGA 8»): non c'è modo di aprire i loro orari | Sito e app mostrano già un avviso con le alternative. Da correggere nel dataset quando si conoscono i codici |
| 2 | Dati | Licenza del dataset non dichiarata nel repository (posizioni e codici «basati sui riferimenti pubblici delle paline») | Da chiarire prima della pubblicazione sugli store (vedi sotto) |
| 3 | Funzionalità | La ricerca trova vie e piazze solo se compaiono nel nome della fermata: non c'è geocodifica di indirizzi arbitrari | Scelta voluta: un geocoder esterno (es. Nominatim) riceverebbe le ricerche degli utenti e la sua policy vieta l'autocompletamento. Nell'app è stata aggiunta una ricerca tollerante agli errori di battitura |
| 4 | Manutenzione | La versione del service worker (`VERSION` in `sw.js`) va incrementata a mano | Nessun intervento (riguarda solo il sito) |
| 5 | Privacy | Chiudendo il pannello «Fermate vicine» il sito dimentica la posizione: corretto per la privacy, ma va richiesta ogni volta | Nell'app la posizione resta attiva solo finché l'app è in primo piano, poi gli aggiornamenti si fermano |
| 6 | Sicurezza | Nessun problema trovato: CSP senza `unsafe-inline`, nessun segreto, link esterni con `noopener`, URL ATM ricostruiti da dati validati | — |
| 7 | Dipendenze | `npm audit` del sito: 0 vulnerabilità. MapLibre 6.16.0 è l'ultima versione | — |

## Licenze e servizi esterni

| Componente | Licenza / condizioni | Obblighi |
| --- | --- | --- |
| MapLibre GL JS 6.16.0 e dipendenze | BSD-3-Clause, ISC, MIT, BSD-2-Clause | Riportare le note di licenza: l'app le include in *Informazioni › Licenze del software open source* (`static/licenses.txt`, generato a ogni build) |
| Capacitor 8 e plugin ufficiali | MIT | Come sopra |
| OpenFreeMap (tessere, stili, font) | Servizio gratuito senza chiave, uso commerciale consentito | Attribuzione «OpenFreeMap © OpenMapTiles» visibile |
| Dati OpenStreetMap | ODbL 1.0 | Attribuzione «© OpenStreetMap» visibile con link a `openstreetmap.org/copyright` (sempre sopra la scheda inferiore) |
| Pagine orari ATM Messina | Pagine pubbliche di ATM Messina S.p.A. | Si aprono così come sono, senza modifiche. Il nome «ATM» è usato solo per descrivere il servizio; l'app dichiara di non essere ufficiale |
| Dataset fermate | Non dichiarata | **Da verificare**: se i dati derivano da materiale ATM, è prudente chiedere ad ATM conferma per la pubblicazione in un'app |

## Scelta della tecnologia

| Opzione | Riuso | Pro | Contro |
| --- | --- | --- | --- |
| **Capacitor 8** (scelta) | Alto: dati, ricerca, preferiti, mappa MapLibre, token CSS | Progetti Xcode e Android Studio standard; plugin ufficiali per GPS, memoria, browser, condivisione; WebGL nativo nella WebView di sistema | Interfaccia web: va curata per sembrare nativa (scheda inferiore, safe area, tasto Indietro) |
| React Native + Expo | Basso: solo `stops.js` | Componenti nativi | Riscrittura completa di interfaccia e mappa (MapLibre React Native), doppio codice da mantenere |
| PWA / TWA | Totale | Nessun codice nuovo | Su iOS non è un'app da App Store; rischio di rifiuto per «sito impacchettato» (guideline 4.2) |

Per non essere una semplice WebView l'app include tutto il codice e i dati nel pacchetto, ha un'interfaccia pensata per il telefono (scheda inferiore trascinabile, ricerca a tutto schermo, recenti, preferiti con orari a un tocco), usa API native (posizione, memoria persistente, browser di sistema, condivisione, Indietro di Android, barre di sistema, splash) e funziona offline per ricerca, preferiti e fermate vicine.

<p align="center">
  <img src="icon-192.png" width="96" height="96" alt="Logo Quando Passa">
</p>

# Quando Passa

**Quando Passa** è una web app mobile-first per consultare rapidamente le fermate autobus di Messina, trovare quelle più vicine alla propria posizione e salvare i punti usati più spesso.

Il progetto nasce con un obiettivo semplice: rendere la mobilità quotidiana più chiara, veloce e accessibile da smartphone, senza obbligare l'utente a installare app pesanti o a creare un account.

## Cosa offre

- Mappa interattiva delle fermate con clustering dinamico e navigazione fluida.
- Ricerca immediata per nome fermata, ottimizzata per l'uso da mobile.
- Localizzazione geografica con elenco delle fermate più vicine.
- Evidenziazione visiva della fermata più vicina sulla mappa.
- Preferiti salvati nel browser e mostrati in oro sulla mappa.
- Tema automatico giorno/notte in base ad alba e tramonto.
- Esperienza installabile come PWA, con cache locale tramite service worker.
- Interfaccia responsive pensata per occupare tutta la schermata disponibile.

## Perché è interessante

Il valore del progetto non è solo nella mappa, ma nel modo in cui mette insieme dati territoriali, usabilità mobile e attenzione alla privacy. L'applicazione funziona interamente lato client: è leggera, facilmente distribuibile su GitHub Pages o hosting statici, e non richiede un backend per offrire un'esperienza concreta e utile.

Questa architettura rende il progetto semplice da mantenere, economico da pubblicare e adatto a essere esteso con nuove funzioni, come orari in tempo reale, filtri per linea, statistiche d'uso anonime o integrazioni con servizi pubblici di trasporto.

## Privacy

- La posizione dell'utente viene richiesta solo dal browser e usata in tempo reale per calcolare le fermate vicine.
- I preferiti restano salvati localmente nel dispositivo tramite `localStorage`.
- Non sono presenti chiavi API, token, credenziali o dati privati nel codice sorgente.
- Non è necessario registrarsi, effettuare login o inviare dati personali a un server proprietario.
- Non sono presenti script di analytics esterni o tracciamenti proprietari.

## Stack tecnico

- **HTML, CSS e JavaScript vanilla** per mantenere il progetto rapido e facilmente ispezionabile.
- **Leaflet** per la mappa interattiva.
- **Leaflet.markercluster** per gestire molte fermate senza appesantire la navigazione.
- **Service Worker** per cache e supporto PWA.
- **Dataset JSON statico** con coordinate e riferimenti pubblici delle fermate.

## Avvio in locale

Clona il repository e avvia un piccolo server statico:

```bash
python3 -m http.server 8000
```

Poi apri:

```text
http://localhost:8000
```

## Struttura del progetto

```text
.
├── index.html          # Struttura dell'app
├── style.css           # Layout, tema e responsive design
├── script.js           # Logica mappa, ricerca, localizzazione e preferiti
├── stops_fixed.json    # Dati pubblici delle fermate
├── manifest.json       # Configurazione PWA
├── sw.js               # Cache offline/service worker
└── icon-*.png          # Icone applicazione
```

## Autore e contatti

Progetto realizzato da [Giovanni Foti](https://github.com/giovannifoti).

Sono aperto a collaborazioni, feedback tecnici e opportunità legate a sviluppo frontend, applicazioni geolocalizzate e servizi digitali per la mobilità. Per contattarmi, usa il profilo GitHub collegato a questo repository o apri una issue.

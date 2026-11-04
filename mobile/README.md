# Quando Passa – app iOS e Android

App nativa di [quandupassa.it](https://quandupassa.it) per trovare le fermate degli autobus ATM di Messina, vedere quelle vicine, salvare le preferite e aprire gli orari ufficiali della palina.

Il sito resta in `../public/` e continua a essere pubblicato da Netlify come prima: questa cartella non viene pubblicata e non cambia la distribuzione del sito.

## Perché Capacitor

Il sito è scritto in JavaScript (moduli ES, senza framework) e usa MapLibre GL JS per la mappa. Con [Capacitor](https://capacitorjs.com/) 8:

- **riuso diretto** di dati e logica del sito: `public/stops_fixed.json`, `public/js/stops.js` (normalizzazione, ricerca con abbreviazioni ATM, distanze), `public/js/favorites.js` (preferiti, stesso formato) e `public/css/base.css` (colori e tema scuro). Una correzione ai dati o alla ricerca vale per sito e app;
- **stessa mappa** MapLibre + OpenFreeMap, già ottimizzata per 1.428 fermate con cluster;
- **funzioni native** tramite plugin ufficiali: posizione, memoria persistente, browser di sistema, condivisione, tasto Indietro, splash, stato della rete.

React Native/Expo avrebbe richiesto di riscrivere interfaccia e mappa (MapLibre React Native) senza vantaggi concreti per un'app di questo tipo. L'app **non** carica quandupassa.it in una WebView: interfaccia, dati e codice sono inclusi nel pacchetto e l'avvio non dipende dalla rete.

## Struttura

```text
mobile/
├── index.html              # struttura dell'interfaccia (CSP restrittiva)
├── src/
│   ├── main.js             # controller: viste, ricerca, posizione, preferiti, orari
│   ├── map.js              # mappa MapLibre (caricata dopo il primo disegno)
│   ├── sheet.js            # scheda inferiore trascinabile (peek / metà / piena)
│   ├── platform.js         # adattatori verso i plugin Capacitor (con ripiego web)
│   ├── logic.js            # logica pura: nomi leggibili, vicinanza, ricerca tollerante
│   └── styles.css          # interfaccia (importa i token di public/css/base.css)
├── static/licenses.txt     # licenze di terze parti (GENERATO a ogni build)
├── resources/              # sorgenti di icona e splash (GENERATI)
├── scripts/
│   ├── make-assets.mjs     # icone e splash iOS/Android dal logo del sito
│   ├── licenses.mjs        # raccoglie le licenze delle dipendenze
│   └── lint.mjs            # ESLint + controlli di sicurezza
├── tests/
│   ├── unit/               # node:test
│   └── e2e/                # Playwright + Chrome sulla build dist/
├── android/                # progetto Android Studio (Gradle)
├── ios/                    # progetto Xcode (Swift Package Manager)
├── capacitor.config.json   # id app, splash, barre di sistema
└── docs/                   # analisi, pubblicazione, testi store, privacy, test
```

Codice condiviso (non duplicato): `../public/js/stops.js`, `../public/js/favorites.js`, `../public/stops_fixed.json`, `../public/css/base.css`, `../public/img/favicon.svg` (sorgente delle icone).

## Requisiti

- Node.js 22 o successivo
- Per Android: JDK 21 e Android SDK (piattaforma 36). Android Studio è il modo più semplice per averli.
- Per iOS: macOS con **Xcode 16 o successivo** (dall'App Store) e un account Apple Developer per la firma.
- Per i test end-to-end: Google Chrome.

## Comandi

```bash
cd mobile
npm install
npm run dev          # interfaccia nel browser su http://localhost:5173 (plugin in modalità web)
npm run build        # build web in dist/
npm run sync         # build + copia nei progetti nativi (da eseguire dopo ogni modifica)
npm run android      # sync + apre Android Studio
npm run ios          # sync + apre Xcode
npm test             # test unitari
npm run test:e2e     # build + test nel browser (flussi, offline, layout, accessibilità)
npm run lint         # analisi statica
npm run assets       # rigenera icone e splash
```

Build Android da riga di comando (con JDK e SDK configurati):

```bash
cd mobile/android
./gradlew assembleDebug      # APK di debug: app/build/outputs/apk/debug/
./gradlew bundleRelease      # AAB per Google Play: app/build/outputs/bundle/release/
```

## Configurazione

| Cosa | Dove |
| --- | --- |
| Bundle ID iOS | Xcode › target App › Signing & Capabilities (ora `it.quandupassa.app`) |
| Application ID Android | `android/app.properties` → `applicationId` |
| Versione Android | `android/app.properties` → `versionName`, `versionCode` (+1 a ogni caricamento) |
| Versione iOS | Xcode › target App › General › Version / Build |
| Firma Android | `android/keystore.properties` (vedi `.example`, **mai versionare**) |
| Firma iOS | Xcode › Signing & Capabilities › Team |
| Nome visualizzato | `capacitor.config.json` (`appName`), `ios/App/App/Info.plist`, `android/app/src/main/res/values/strings.xml` |
| Testo del permesso posizione (iOS) | `ios/App/App/Info.plist` → `NSLocationWhenInUseUsageDescription` |

Se cambi l'identificativo, cambialo anche in `capacitor.config.json` (`appId`).

## Come funziona

- **Dati**: le 1.428 fermate sono incluse nell'app; ricerca, preferiti e fermate vicine funzionano anche offline. 10 fermate del dataset non hanno codice palina: l'app lo dice e propone le alternative.
- **Mappa**: MapLibre GL JS con stile OpenFreeMap (chiaro/scuro). Le tessere arrivano dalla rete; offline o con il servizio irraggiungibile compare un messaggio e la mappa si ricarica da sola al ritorno della connessione. Attribuzione OpenStreetMap sempre visibile.
- **Posizione**: richiesta solo quando si tocca «Fermate vicine» o il pulsante posizione; aggiornamenti solo con l'app in primo piano (fermati quando va in background). Gestiti permesso negato, posizione approssimativa (Android 12+), GPS disattivato, timeout (nuovo tentativo con la rete) e assenza di segnale. La posizione non lascia il dispositivo.
- **Orari**: l'app apre la pagina ufficiale della palina ATM (`smartpoles2.php`, la stessa del QR code) nel browser di sistema integrato (SFSafariViewController / Chrome Custom Tabs), con il pulsante per tornare alla mappa. Nessun orario viene generato, stimato o copiato dall'app. Offline l'app avvisa invece di aprire una pagina vuota.
- **Preferiti, recenti, tema, posizione della mappa**: salvati con `@capacitor/preferences` (UserDefaults / SharedPreferences), quindi persistono alla chiusura dell'app. Il formato dei preferiti è quello del sito.
- **Indietro (Android)**: chiude nell'ordine ricerca → vista precedente → scheda espansa; dalla schermata iniziale manda l'app in background.
- **Ripresa**: alla riapertura l'app aggiorna tema, stato della rete e posizione (se era attiva) e riapre la mappa dove era rimasta.

## Aggiornare i dati delle fermate

Modifica `../public/stops_fixed.json` come per il sito (e `npm run build` nella radice per le pagine del sito), poi:

```bash
cd mobile && npm test && npm run sync
```

e pubblica una nuova versione dell'app (incrementando versione e build).

## Aggiornare le dipendenze

```bash
cd mobile
npm outdated
npm install @capacitor/core@latest @capacitor/cli@latest @capacitor/ios@latest @capacitor/android@latest  # stessa major per tutti
npx cap sync
npm audit && npm run lint && npm test && npm run test:e2e
```

Se aggiorni MapLibre nel sito (`../package.json`), aggiorna la stessa versione anche in `mobile/package.json`.

## Documentazione

- [docs/ANALISI.md](docs/ANALISI.md) – analisi del sito e scelte tecniche
- [docs/PUBBLICAZIONE.md](docs/PUBBLICAZIONE.md) – firma, TestFlight, Google Play, checklist
- [docs/STORE.md](docs/STORE.md) – nome, descrizioni, screenshot, dichiarazioni privacy
- [docs/PRIVACY.md](docs/PRIVACY.md) – informativa privacy da pubblicare
- [docs/TEST.md](docs/TEST.md) – test eseguiti, esiti e verifiche ancora da fare

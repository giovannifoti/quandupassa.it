# Test eseguiti ed esiti

Data: 4 novembre 2026. Branch `app-mobile`. Macchina: MacBook Apple M2, macOS 27.0.1, Node 24.16, Chrome (per Playwright), JDK 21.0.13, Android SDK 36.

## Riepilogo

| # | Verifica | Strumento | Esito |
| --- | --- | --- | --- |
| 1 | Dipendenze | `npm audit` (app e sito) | ✅ 0 vulnerabilità. `@capacitor/assets` scartato perché portava 4 vulnerabilità moderate (uuid): icone e splash generate con `sharp` |
| 2 | Analisi statica JS | ESLint 9 + controlli di sicurezza (`npm run lint`) | ✅ 0 errori, 0 avvisi; nessun `innerHTML`/`eval`, URL `http://`, segreto o SDK di tracciamento |
| 3 | Analisi statica Android | Android Lint (`:app:lintDebug`) | ✅ 0 errori; 7 avvisi non bloccanti (risorse inutilizzate del template Capacitor, versioni più nuove di Gradle e AppCompat disponibili, splash in cartella senza densità) |
| 4 | Logica | `npm test` (8 test) | ✅ dataset (1.428 fermate, 1.418 con palina), nomi leggibili su tutte le fermate, vicinanza con direzioni affiancate, ricerca tollerante, validazione dei dati salvati, formato preferiti uguale al sito, link consentiti solo https verso domini noti |
| 5 | Flussi nell'interfaccia | `npm run test:e2e` (20 test, Chrome headless, viewport mobile) | ✅ vedi sotto |
| 6 | Sito invariato | `npm test` e `npm run test:e2e` nella radice | ✅ 29 + 12 test; nessun file in `public/` modificato |
| 7 | Build Android | Gradle 8.14 | ✅ APK di debug (5,5 MB), AAB di release (4,1 MB), APK di release firmato con una chiave di prova temporanea (firma verificata con `apksigner` e `jarsigner`, chiave poi eliminata) |
| 8 | App Android su emulatore | Pixel 7, Android 16 (API 36), WebView 133 | ✅ vedi sotto |
| 9 | Build iOS | — | ⚠️ **Non eseguita**: su questo Mac non c'è Xcode (solo Command Line Tools). Il progetto Xcode è generato e configurato, ma non compilato |
| 10 | Dispositivi reali | — | ⚠️ **Non eseguiti**: nessun iPhone o telefono Android collegato |

## Test end-to-end (browser)

Eseguiti sulla build di produzione (`dist/`), con i plugin Capacitor nelle loro implementazioni web.

- Avvio senza errori JavaScript né violazioni della CSP; mappa disegnata; attribuzione OpenStreetMap visibile.
- Ricerca: risultati mentre si scrive, Invio apre la prima fermata, abbreviazioni («viale san martino»), errori di battitura («garibaldy» → «Forse cercavi»), nessun risultato con suggerimento, tastiera senza correzione automatica e con tasto «Cerca», testo ≥16 px (niente zoom su iOS), Esc chiude.
- Orari: il pulsante apre esattamente `smartpoles2.php?palina=1555&rnd=87`; presenti le alternative (app ATM MovUp, orari delle linee).
- Preferiti: salvataggio, persistenza dopo il riavvio, orari a un tocco dalla schermata iniziale, rimozione con «Annulla».
- Fermate vicine (posizione simulata al Duomo): 10 fermate, la prima è la più vicina, distanze e minuti a piedi, «Orari» su ogni riga, ritorno indietro alla lista.
- Posizione negata: messaggio con il percorso nelle impostazioni e pulsante «Cerca per nome».
- Offline (rete disattivata dopo l'avvio): avviso, ricerca funzionante, orari bloccati con messaggio, ripresa automatica e avviso «Connessione ripristinata».
- Servizio cartografico irraggiungibile: messaggio al posto della mappa, ricerca funzionante.
- Ripristino: dopo un passaggio in background e un riavvio la fermata aperta torna visibile; una sessione più vecchia di 30 minuti viene ignorata.
- Tema: «Automatico» segue il sistema (scuro); la scelta manuale «Chiaro» resta dopo il riavvio.
- Informazioni: avviso di app non ufficiale, privacy, crediti, licenze open source (MapLibre 6.16.0 BSD-3-Clause).
- Layout su 8 dimensioni (320×568, 375×667, 393×852, 430×932, 360×640, 412×915, orizzontale 844×390, tablet 820×1180): nessun elemento fuori schermo, target di tocco ≥44 px (esclusi i link nel testo), pulsante «Orari» visibile senza scorrere e alto ≥48 px.
- Accessibilità con axe-core (home, ricerca, scheda fermata, fermate vicine, tema scuro): nessuna violazione grave o critica, contrasti compresi.

## Test sull'emulatore Android

APK di debug e APK di release installati su Pixel 7 / Android 16 (API 36, immagine Google APIs arm64) con posizione GPS simulata.

| Verifica | Esito |
| --- | --- |
| Splash arancione con logo, nessun fotogramma nero durante l'avvio | ✅ |
| Mappa OpenFreeMap con cluster, etichette, fermata selezionata e punto della posizione | ✅ |
| Permessi installati: solo Internet, stato della rete, posizione approssimativa/precisa; nessun permesso in background | ✅ (`dumpsys package`) |
| Dialogo di sistema per la posizione solo al tocco di «Fermate vicine», con «Mentre usi l'app» / «Solo questa volta» / «Non consentire» e scelta precisa/approssimativa | ✅ |
| Fermate vicine con distanze, minuti, direzioni affiancate e pulsante Orari | ✅ |
| Posizione negata → istruzioni con il percorso nelle impostazioni Android | ✅ |
| Localizzazione del dispositivo disattivata → messaggio dedicato | ✅ |
| «Orari della fermata» → Chrome Custom Tab sulla pagina ATM della palina (`FERMATA • 1510 Corso Cavour – Ist. Maurolico`), con «X» e tasto Indietro per tornare alla stessa fermata | ✅ (alle 23:23 la pagina ATM non mostrava passaggi: contenuto di ATM, non dell'app) |
| Link «app ufficiale ATM MovUp» → scheda Google Play; «orari delle linee» → Custom Tab | ✅ |
| «Percorso» → app Google Maps | ✅ |
| «Condividi» → pannello di condivisione di sistema con nome della fermata e link | ✅ |
| Tasto Indietro: fermata → fermate vicine → home → app in background | ✅ |
| Ricerca con tastiera Android (tasto 🔍, Invio apre la prima fermata) | ✅ dopo la correzione del ricentraggio (prima la fermata restava in basso quando la tastiera si chiudeva) |
| Preferito salvato → chiusura forzata → riapertura: preferito presente | ✅ |
| Tema scuro di sistema applicato al ritorno nell'app (interfaccia, mappa, barre) | ✅ |
| Modalità aereo → avviso offline in ~1 s; rete ripristinata → avviso nascosto | ✅ |
| Build di release: non debuggabile, nessun log in console, firma verificata | ✅ |

### Prestazioni misurate (indicative)

L'emulatore girava su un Mac con poca RAM libera (load average del sistema Android 6–25), quindi i tempi sono **peggiori** di quelli attesi su un telefono reale:

- avvio a freddo fino al primo fotogramma: circa 6,2 s (`am start -W`, 3 misure), di cui circa 4 s di avvio del processo e della WebView e circa 2 s del codice dell'app fino a interfaccia pronta;
- primo avvio dopo l'installazione: la mappa compare circa 13 s dopo l'interfaccia (circa 6,5 s per caricare il modulo MapLibre da 1 MB). L'interfaccia, la ricerca e i preferiti sono utilizzabili prima.

Da ricontrollare su un telefono Android di fascia media reale.

### Correzioni nate dai test

- La ricerca con Invio a tastiera aperta lasciava la fermata in basso: ora la mappa si ricentra dopo il ridimensionamento.
- Dopo un secondo tentativo di localizzazione (rete invece di GPS) l'app segnalava «posizione approssimativa» anche con il permesso preciso: corretto.
- Avvisi «tile memory limits exceeded» di Chromium: tolti `will-change` permanente e `backdrop-filter`.
- Con WebView < 140 Capacitor non usa l'edge-to-edge: lo sfondo della finestra ora ha il colore dell'app (chiaro/scuro).
- Ordine del manifest Android (avviso di Lint).
- Chip, pulsante di chiusura e «Annulla» portati a un target di tocco di 44 px (erano 36–40).

## Limiti noti

- **iOS non compilato né provato** (manca Xcode). Punti da verificare con attenzione: worker di MapLibre caricato dallo schema `capacitor://` (impostato con `setWorkerUrl`), safe area con notch e Dynamic Island, SFSafariViewController per gli orari, testo del permesso posizione, Dynamic Type.
- **TalkBack e VoiceOver** non provati con lettore di schermo attivo: l'accessibilità è verificata con axe-core e con etichette ARIA, non con un utente reale.
- Capacitor registra nei log di debug «Error injecting safe area CSS» all'avvio su WebView 133. Non ha effetti visibili (in quella modalità la WebView è già spaziata dal sistema); non compare nelle build di release.
- La pagina orari è servita da ATM: se ATM risponde «Accesso non consentito» o non mostra passaggi, l'app non può farci nulla (resta il suggerimento delle alternative ufficiali).

## Verifiche da fare prima della pubblicazione

### iPhone (simulatore e dispositivo)

```bash
cd mobile && npm run ios      # apre Xcode
```

1. Scegli un simulatore (es. iPhone 16) e premi ▶︎. Controlla: splash, mappa con fermate (se la mappa resta grigia, è da controllare il worker di MapLibre nella console di Safari › Sviluppo), barra di ricerca sotto la Dynamic Island, scheda inferiore sopra l'indicatore Home.
2. *Features › Location › Custom Location* (38.1925, 15.5545) → «Fermate vicine» → dialogo con il testo italiano → lista.
3. Nega il permesso (Impostazioni › Quando Passa › Posizione › Mai) → messaggio.
4. «Orari della fermata» → SFSafariViewController → «Fine» torna alla fermata.
5. Salva un preferito, chiudi l'app dal multitasking, riaprila → preferito presente.
6. Impostazioni › Accessibilità › Testo più grande → l'app scala il testo senza sovrapposizioni.
7. VoiceOver: dalla ricerca a «Orari» solo con gesti.
8. Su un iPhone reale: ripeti 2–7 e prova all'aperto (GPS reale) e in modalità aereo.

### Android reale

```bash
cd mobile/android && ./gradlew installDebug   # con il telefono collegato e il debug USB attivo
```

Ripeti la tabella dell'emulatore, poi: GPS reale all'aperto e al chiuso, posizione «approssimativa», TalkBack, dimensione del carattere grande, navigazione a pulsanti e a gesti, tempi di avvio.

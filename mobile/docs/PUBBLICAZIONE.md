# Pubblicazione su App Store e Google Play

Tutto ciò che si può preparare senza account e certificati è già nel progetto. Questa guida elenca i passaggi che richiedono i tuoi account, nell'ordine in cui farli.

## 0. Prima di iniziare (una volta sola)

- [ ] Verificare i diritti sul dataset delle fermate e, se possibile, ottenere da ATM Messina un consenso all'uso del nome e dei link (vedi [ANALISI.md](ANALISI.md)).
- [ ] Pubblicare l'informativa privacy ([PRIVACY.md](PRIVACY.md)) a un URL pubblico, ad esempio `https://quandupassa.it/privacy/`, e indicare un'email di contatto.
- [ ] Scegliere definitivamente l'identificativo dell'app. Ora è `it.quandupassa.app` su entrambe le piattaforme: **dopo la prima pubblicazione non si può più cambiare.**
- [ ] Preparare gli screenshot ([STORE.md](STORE.md)).

```bash
cd mobile
npm ci
npm run lint && npm test && npm run test:e2e
npm run sync
```

## 1. Google Play

### Account

- Account Google Play Console (quota una tantum di 25 USD). Per i nuovi account personali Google richiede un **test chiuso con almeno 12 tester per 14 giorni** prima della pubblicazione in produzione.

### Chiave di caricamento (una volta sola)

```bash
keytool -genkeypair -v -keystore ~/quandupassa-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
cp android/keystore.properties.example android/keystore.properties
# compila android/keystore.properties con percorso e password
```

Conserva il file `.jks` e le password in un luogo sicuro (es. gestore di password + backup). `keystore.properties` e `*.jks` sono esclusi da git. Su Play Console attiva **Play App Signing** (Google conserva la chiave di firma, tu solo quella di caricamento).

### Build

```bash
cd mobile && npm run sync
cd android
./gradlew bundleRelease
# risultato: app/build/outputs/bundle/release/app-release.aab
```

A ogni nuova versione incrementa `versionCode` (e aggiorna `versionName`) in `android/app.properties`.

### Play Console

1. Crea l'app: nome, lingua predefinita italiano, app (non gioco), gratuita.
2. **Contenuti dell'app**: informativa privacy (URL), annunci = no, accesso all'app = nessuna restrizione, classificazione dei contenuti (questionario IARC), pubblico di destinazione (18+ o «tutte le età escluse i bambini», non è un'app per bambini), **Sicurezza dei dati** come in [STORE.md](STORE.md), app governativa = no.
3. **Scheda dello Store**: testi, icona 512×512, immagine in evidenza 1024×500, screenshot.
4. **Test › Test interno**: crea una release, carica `app-release.aab`, aggiungi i tester (email), pubblica. I tester installano dal link di adesione.
5. Poi **test chiuso** (12+ tester, 14 giorni) e infine **produzione**.

## 2. App Store

### Requisiti

- Mac con **Xcode 16 o successivo** (App Store). Su questo Mac oggi c'è solo Command Line Tools: Xcode va installato.
- Account **Apple Developer Program** (99 USD/anno).

### Configurazione in Xcode

```bash
cd mobile && npm run ios   # build web, sync, apre ios/App/App.xcodeproj
```

1. Target **App › Signing & Capabilities**: scegli il tuo *Team*, lascia «Automatically manage signing». Se `it.quandupassa.app` non è disponibile, cambialo qui e in `capacitor.config.json`.
2. Target **App › General**: *Version* `1.0.0`, *Build* `1` (incrementa la build a ogni caricamento). Supported Destinations: iPhone (già impostato; l'iPad esegue l'app in modalità compatibile).
3. Verifica in **Info**: «Privacy – Location When In Use Usage Description» è presente, in italiano.
4. Prova sul simulatore e su un iPhone reale (vedi [TEST.md](TEST.md), sezione «Verifiche da fare»).

### TestFlight

1. In [App Store Connect](https://appstoreconnect.apple.com) crea l'app: piattaforma iOS, nome, lingua italiano, bundle ID, SKU (es. `quandupassa-ios`).
2. In Xcode: dispositivo «Any iOS Device (arm64)» → **Product › Archive** → **Distribute App › App Store Connect › Upload**.
3. In App Store Connect › TestFlight: compila «Informazioni sul test», aggiungi tester interni (subito) o esterni (dopo una breve revisione Beta).
4. Compila **Privacy dell'app** («Dati non raccolti»), classificazione per età, categoria, URL privacy e assistenza, screenshot iPhone 6,9", note per la revisione ([STORE.md](STORE.md)).
5. Invia per la revisione.

## 3. Aggiornamenti successivi

1. Modifica codice o dati, poi `npm run lint && npm test && npm run test:e2e`.
2. Aumenta la versione: `mobile/package.json` (`version`), `android/app.properties` (`versionName`, `versionCode` +1), Xcode (*Version*, *Build* +1).
3. `npm run sync`, poi build e caricamento come sopra.

## 4. Facoltativo: aprire i link quandupassa.it nell'app

Per far aprire i link `https://quandupassa.it/?fermata=…` direttamente nell'app servono file sul sito (`/.well-known/apple-app-site-association` e `/.well-known/assetlinks.json`, che richiedono Team ID Apple e impronta del certificato Google) e una piccola modifica all'app. **Non è stato fatto** perché richiede di modificare il sito in produzione: va deciso e pubblicato a parte.

## Checklist finale

- [ ] Diritti su dati e nome verificati
- [ ] Informativa privacy pubblicata
- [ ] Test su iPhone reale e su telefono Android reale ([TEST.md](TEST.md))
- [ ] Screenshot e immagine in evidenza
- [ ] Android: keystore creato e salvato, AAB caricato nel test interno
- [ ] iOS: Team impostato, archivio caricato su TestFlight
- [ ] Dichiarazioni privacy compilate su entrambi gli store

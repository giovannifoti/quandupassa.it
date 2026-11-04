# Schede per App Store e Google Play

Testi proposti in italiano, da rivedere prima dell'invio. I limiti di caratteri sono indicati tra parentesi.

## Nome e testi

| Campo | App Store | Google Play |
| --- | --- | --- |
| Nome | Quando Passa – Bus Messina (≤30) | Quando Passa – Fermate bus Messina (≤30) |
| Sottotitolo / descrizione breve | Fermate ATM, vicine e orari (≤30) | Trova le fermate ATM di Messina e apri gli orari ufficiali in un tocco (≤80) |
| Categoria | Viaggi (secondaria: Navigazione) | Mappe e navigatori |
| Parole chiave (solo iOS, ≤100) | `autobus,bus,fermate,atm,messina,orari,palina,trasporti,mappa,vicino` | — |
| URL assistenza | https://github.com/giovannifoti/quandupassa.it/issues | idem |
| URL privacy | da pubblicare, es. https://quandupassa.it/privacy/ (testo in [PRIVACY.md](PRIVACY.md)) | idem |
| Prezzo | Gratuita | Gratuita |

### Descrizione (≤4000)

> Quando Passa ti aiuta a trovare in pochi secondi la fermata dell'autobus giusta a Messina e ad aprirne gli orari ufficiali.
>
> • Mappa di tutte le 1.428 fermate ATM di Messina, con nomi leggibili e direzione.
> • Fermate vicine: le fermate più vicine a te con distanza e tempo a piedi stimato.
> • Ricerca per nome, via o piazza, anche con abbreviazioni («viale San Martino», «piazza Cairoli») e piccoli errori di battitura.
> • Preferiti: salva le fermate che usi ogni giorno e apri i loro orari con un solo tocco.
> • Orari ufficiali: si apre la pagina della palina di ATM Messina, la stessa del QR code alla fermata.
> • Percorso a piedi con l'app di mappe del telefono e condivisione della fermata.
> • Tema chiaro e scuro.
> • Ricerca, preferiti e fermate vicine funzionano anche senza connessione.
>
> Privacy prima di tutto: nessuna registrazione, nessuna pubblicità, nessun tracciamento. La posizione resta sul tuo telefono.
>
> Quando Passa è un progetto indipendente e non è un'app ufficiale di ATM Messina S.p.A. Gli orari sono pubblicati da ATM Messina. Mappa © OpenStreetMap, OpenFreeMap.

### Novità della versione 1.0.0

> Prima versione dell'app di Quando Passa.

## Screenshot necessari

Le immagini vanno catturate dal simulatore/emulatore o da un dispositivo, senza elementi di sviluppo visibili.

**App Store** (l'app è configurata solo per iPhone, quindi niente screenshot iPad):

- iPhone 6,9" (1320×2868 o 1290×2796): obbligatori, da 3 a 10. Apple ridimensiona questi per gli altri formati.

**Google Play**:

- Telefono: da 2 a 8 screenshot, lato corto ≥ 1080 px consigliato (es. 1080×2400).
- Icona 512×512 PNG: `resources/icon-1024.png` ridimensionata.
- Immagine in evidenza 1024×500: da realizzare (es. logo su sfondo arancione con la scritta «Fermate bus ATM Messina»).

Sequenza consigliata (stessa per entrambi):

1. Mappa con le fermate e la scheda «Le tue fermate» con i preferiti.
2. Scheda fermata con il pulsante «Orari della fermata».
3. «Fermate vicine» con distanze e minuti a piedi.
4. Ricerca con suggerimenti (es. «garibaldi»).
5. Tema scuro.

## Asset disponibili

| File | Uso |
| --- | --- |
| `resources/icon-1024.png` | Icona App Store (1024×1024, senza trasparenza) e sorgente per l'icona Google Play 512×512 |
| `resources/splash-2732.png` | Splash |
| `android/app/src/main/res/mipmap-*/` | Icone Android (legacy, rotonde, adattive, monocromatiche) |
| `../public/img/og-image.png` | Base per l'immagine in evidenza di Google Play |

## Dichiarazioni privacy

### App Store – «Privacy dell'app»

- **Dati raccolti: nessuno** («Data Not Collected»). Apple considera «raccolti» solo i dati trasmessi fuori dal dispositivo: la posizione è usata solo localmente.
- Tracciamento: no. Nessun SDK di terze parti.
- Il file `ios/App/App/PrivacyInfo.xcprivacy` è coerente (nessun dato raccolto, motivo CA92.1 per UserDefaults).
- Crittografia: l'app usa solo HTTPS di sistema → `ITSAppUsesNonExemptEncryption = NO` già impostato.

### Google Play – «Sicurezza dei dati»

- L'app raccoglie o condivide dati utente? **No.** La posizione è trattata solo sul dispositivo (Google non la considera «raccolta» se non lascia il dispositivo).
- I dati sono criptati in transito? Sì (solo HTTPS).
- Possibilità di richiedere la cancellazione: non applicabile (nessun dato sul server); i dati locali si cancellano disinstallando l'app.
- Permessi dichiarati: posizione approssimativa e precisa (in primo piano), Internet, stato della rete. Nessun permesso di posizione in background.

### Altre risposte richieste

- **Classificazione dei contenuti** (IARC / App Store): nessun contenuto sensibile → 4+ / PEGI 3.
- **Pubblicità**: no.
- **App per bambini**: no (pubblico generale).
- **App governativa / ufficiale**: no.
- **Accesso con account**: non necessario (per la revisione: «L'app non richiede login»).

## Note per i revisori

> Quando Passa è un'app indipendente per i passeggeri degli autobus ATM di Messina (Italia). Le funzioni principali (mappa delle fermate, ricerca, fermate vicine con GPS, preferiti salvati sul dispositivo) sono incluse nell'app e funzionano senza account. Il pulsante «Orari della fermata» apre in SFSafariViewController la pagina pubblica della palina sul sito di ATM Messina, la stessa che si apre con il QR code esposto alla fermata. L'app non è affiliata ad ATM Messina e lo dichiara nella schermata Informazioni. La posizione è usata solo sul dispositivo.

Per i revisori fuori Messina: «Fermate vicine» funziona ovunque (mostra le fermate più vicine con un avviso di distanza); la ricerca «Cavour» o «Garibaldi» mostra subito delle fermate.

## Rischi di revisione da considerare

- **Apple 4.2 (funzionalità minima)**: l'app non è un sito impacchettato (dati e interfaccia inclusi, posizione nativa, offline). Gli orari sono esterni: nella descrizione e nelle note è spiegato il valore aggiunto (mappa, vicinanza, preferiti).
- **Apple 5.2 / Google «Impersonificazione»**: il nome «ATM» è usato solo in modo descrittivo, senza logo ATM; l'app dichiara di non essere ufficiale. Per maggiore sicurezza si può chiedere ad ATM Messina un consenso scritto.
- **Dati del dataset**: vedi [ANALISI.md](ANALISI.md), punto 2.

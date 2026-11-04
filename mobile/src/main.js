// Quando Passa – app iOS e Android.
// Interfaccia a mappa con scheda inferiore; dati e logica delle fermate sono
// gli stessi del sito (public/js/stops.js, public/js/favorites.js).
import rawStops from '../../public/stops_fixed.json';
import {
  ATM_LINKS,
  ZONE_ORDER,
  distanceMeters,
  formatDistance,
  parseStops,
  searchStops,
  walkingMinutes,
  zoneLabel
} from '../../public/js/stops.js';
import { createFavorites } from '../../public/js/favorites.js';
import {
  fuzzySearch,
  nearbyGrouped,
  parseCamera,
  parseIdList,
  parseSettings,
  positionMovedEnough,
  prettyName,
  pushRecent,
  shareUrl,
  walkingDirectionsUrl
} from './logic.js';
import * as platform from './platform.js';
import { createSheet } from './sheet.js';

const MAX_RESULTS = 40;
const NEARBY_LIMIT = 10;
const AROUND_RADIUS = 400;
const POSITION_FRESH_MS = 60000;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Se qualcosa va storto prima dell'avvio, la splash screen non resta bloccata.
const splashFallback = window.setTimeout(() => platform.hideSplash(), 3500);

const $ = id => document.getElementById(id);
const dom = {
  app: $('app'),
  map: $('map'),
  mapLoading: $('map-loading'),
  mapPlaceholder: $('map-placeholder'),
  mapPlaceholderTitle: $('map-placeholder-title'),
  mapPlaceholderText: $('map-placeholder-text'),
  top: $('top'),
  searchForm: $('search-form'),
  searchBack: $('search-back'),
  input: $('search-input'),
  clear: $('search-clear'),
  infoButton: $('info-button'),
  nearbyChip: $('nearby-chip'),
  favoritesChip: $('favorites-chip'),
  favoritesCount: $('favorites-count'),
  offlineBanner: $('offline-banner'),
  searchPanel: $('search-panel'),
  searchScroll: $('search-scroll'),
  searchStatus: $('search-status'),
  sheet: $('sheet'),
  sheetDrag: $('sheet-drag'),
  sheetHandle: $('sheet-handle'),
  sheetBack: $('sheet-back'),
  sheetClose: $('sheet-close'),
  sheetKicker: $('sheet-kicker'),
  sheetTitle: $('sheet-title'),
  sheetBody: $('sheet-body'),
  locateButton: $('locate-button'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action')
};

const state = {
  stops: [],
  byId: new Map(),
  views: [{ type: 'home' }],
  searching: false,
  online: true,
  position: null,
  precise: true,
  locationActive: false,
  locating: false,
  lastNearbyOrigin: null,
  recents: [],
  settings: { theme: 'system' },
  mapStatus: 'loading', // loading | ready | offline | error | unsupported
  nativeVersion: null
};

let store;
let favorites;
let sheet;
let mapApi = null;
let stopWatch = null;
let toastTimer = null;
let searchTimer = null;
let cameraTimer = null;

window.addEventListener('error', event => console.error('Errore inatteso', event.error || event.message));
window.addEventListener('unhandledrejection', event => console.error('Promessa rifiutata', event.reason));

init().catch(error => {
  console.error(error);
  platform.hideSplash();
  dom.sheetTitle.textContent = 'Si è verificato un problema';
  dom.sheetBody.replaceChildren(el('p', { class: 'notice' }, 'Chiudi e riapri l’app. Se il problema continua, reinstallala.'));
});

/* ================================================================ avvio */

async function init() {
  store = await platform.createStore(['favorites', 'recents', 'settings', 'camera']);
  state.settings = parseSettings(store.getItem('settings'));
  applyTheme();

  state.stops = parseStops(rawStops).map(stop => ({
    ...stop,
    label: prettyName(stop.title),
    directionLabel: stop.direction ? prettyName(stop.direction) : ''
  }));
  state.stops.forEach(stop => state.byId.set(stop.id, stop));
  favorites = createFavorites(store);
  state.recents = parseIdList(store.getItem('recents'), 8).filter(id => state.byId.has(id));

  sheet = createSheet({
    element: dom.sheet,
    handle: dom.sheetHandle,
    dragArea: dom.sheetDrag,
    body: dom.sheetBody,
    onChange: snap => {
      dom.sheet.dataset.snap = snap;
    }
  });

  bindEvents();
  bindPlatform();
  updateFavoritesCount();
  renderSheet({ focus: false });
  sheet.set('peek', { animate: false });
  document.documentElement.dataset.ready = 'true';

  window.clearTimeout(splashFallback);
  window.requestAnimationFrame(() => platform.hideSplash());

  setOnline(await platform.networkStatus(), { quiet: true });
  platform.appVersion().then(version => { state.nativeVersion = version; });
  restoreFromUrl();
  // La mappa arriva dopo il primo disegno dell'interfaccia.
  window.setTimeout(initMap, 0);
}

function restoreFromUrl() {
  // Utile nel browser di sviluppo: /?fermata=palina-1555
  const id = new URLSearchParams(window.location.search).get('fermata');
  const stop = id && state.byId.get(id);
  if (stop) openStop(stop, { reset: true, focus: false });
}

/* ================================================================ mappa */

async function initMap() {
  let module;
  try {
    module = await import('./map.js');
  } catch (error) {
    console.error(error);
    setMapStatus('error');
    return;
  }
  if (!module.isMapSupported()) {
    setMapStatus('unsupported');
    return;
  }
  if (!state.online) {
    setMapStatus('offline');
    return;
  }
  try {
    mapApi = module.createMap({
      container: dom.map,
      dark: isDark(),
      camera: parseCamera(store.getItem('camera')),
      onStopSelect: index => {
        const stop = state.stops[index];
        if (stop) openStop(stop, { fromMap: true });
      },
      onMapTap: () => {
        if (sheet.snap !== 'peek') sheet.set('peek');
      },
      onStyleError: () => setMapStatus(state.online ? 'error' : 'offline'),
      onStyleReady: () => setMapStatus('ready'),
      onMove: camera => {
        window.clearTimeout(cameraTimer);
        cameraTimer = window.setTimeout(() => saveCamera(camera), 2000);
      }
    });
    mapApi.setStops(state.stops, favorites.has);
    if (state.position) mapApi.setUserLocation(state.position);
    const view = currentView();
    if (view.type === 'stop') {
      mapApi.setSelected(view.stop);
      mapApi.focus(view.stop, { zoom: 16.5, padding: mapPadding() });
    }
  } catch (error) {
    console.error(error);
    setMapStatus('error');
  }
}

function setMapStatus(status) {
  state.mapStatus = status;
  dom.mapLoading.hidden = status !== 'loading';
  const messages = {
    offline: ['Mappa non disponibile offline', 'La mappa si carica appena torna la connessione. Intanto puoi cercare le fermate e aprire i preferiti.'],
    error: ['Mappa momentaneamente non disponibile', 'Il servizio cartografico non risponde. Riproviamo da soli tra poco; ricerca, fermate vicine e preferiti funzionano comunque.'],
    unsupported: ['Mappa non supportata', 'Questo dispositivo non supporta la mappa interattiva. Puoi usare la ricerca, le fermate vicine e i preferiti.']
  };
  const message = messages[status];
  dom.mapPlaceholder.hidden = !message;
  if (message) {
    dom.mapPlaceholderTitle.textContent = message[0];
    dom.mapPlaceholderText.textContent = message[1];
  }
  if (status === 'error') scheduleMapRetry();
}

let retryTimer = null;
function scheduleMapRetry() {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    if (state.mapStatus === 'error' && state.online) retryMap();
  }, 15000);
}

function retryMap() {
  if (state.mapStatus === 'ready' || state.mapStatus === 'unsupported') return;
  if (!mapApi) {
    setMapStatus('loading');
    initMap();
    return;
  }
  setMapStatus('loading');
  mapApi.retry();
}

function mapPadding() {
  const top = dom.top.getBoundingClientRect().bottom + 12;
  const height = window.innerHeight;
  const wide = window.innerWidth >= 700 || (window.innerHeight <= 500 && window.innerWidth > window.innerHeight);
  if (wide) {
    const rect = dom.sheet.getBoundingClientRect();
    return { top, bottom: 24, left: Math.min(rect.right + 24, window.innerWidth / 2), right: 24 };
  }
  const bottom = Math.min(sheet.visibleHeight + 24, Math.max(height - top - 140, 24));
  return { top, bottom, left: 24, right: 24 };
}

function saveCamera(camera = mapApi?.getCamera()) {
  if (!camera || !mapApi?.ready) return;
  store.setItem('camera', JSON.stringify({
    lon: Number(camera.lon.toFixed(5)),
    lat: Number(camera.lat.toFixed(5)),
    zoom: Number(camera.zoom.toFixed(2))
  }));
}

function refreshMapStops() {
  mapApi?.setStops(state.stops, favorites.has);
}

/* ================================================================ eventi */

function bindEvents() {
  dom.input.addEventListener('focus', openSearch);
  dom.input.addEventListener('input', () => {
    syncClear();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderSearch, 60);
  });
  dom.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    const first = dom.searchScroll.querySelector('[data-action="open-stop"]');
    if (first && dom.input.value.trim()) {
      const stop = state.byId.get(first.dataset.stopId);
      if (stop) selectFromSearch(stop);
    } else {
      dom.input.blur();
    }
  });
  dom.searchBack.addEventListener('click', closeSearch);
  dom.clear.addEventListener('click', () => {
    dom.input.value = '';
    syncClear();
    renderSearch();
    dom.input.focus();
  });
  // Scorrendo i risultati la tastiera si chiude, come nelle app native.
  dom.searchScroll.addEventListener('touchmove', () => {
    if (document.activeElement === dom.input) dom.input.blur();
  }, { passive: true });
  dom.searchScroll.addEventListener('click', handleActionClick);
  dom.sheetBody.addEventListener('click', handleActionClick);

  dom.infoButton.addEventListener('click', () => openView({ type: 'info' }, { reset: true, snap: 'full' }));
  dom.nearbyChip.addEventListener('click', () => showNearby(dom.nearbyChip));
  dom.favoritesChip.addEventListener('click', () => {
    goHome();
    sheet.set(favoriteStops().length > 3 ? 'full' : 'half');
  });
  dom.locateButton.addEventListener('click', centerOnUser);
  dom.sheetBack.addEventListener('click', goBack);
  dom.sheetClose.addEventListener('click', goHome);

  document.querySelectorAll('[data-external]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      openLink(link.href);
    });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') handleBack();
  });

  favorites.onChange(() => {
    refreshMapStops();
    updateFavoritesCount();
  });

  window.addEventListener('resize', debounce(() => mapApi?.resize(), 150));
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
}

function bindPlatform() {
  platform.onBackButton(() => {
    if (!handleBack()) platform.exitToBackground();
  });

  platform.onAppStateChange(active => {
    if (active) {
      applyTheme();
      platform.networkStatus().then(online => setOnline(online, { quiet: true }));
      if (state.locationActive) startWatch();
    } else {
      stopWatching();
      saveCamera();
    }
  });

  platform.onNetworkChange(online => setOnline(online));
}

function handleActionClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const stop = state.byId.get(target.dataset.stopId || '');
  switch (target.dataset.action) {
    case 'open-stop':
      if (!stop) break;
      if (target.closest('#search-panel')) selectFromSearch(stop);
      else openStop(stop);
      break;
    case 'times':
      if (stop) openTimes(stop);
      break;
    case 'toggle-favorite':
      if (stop) toggleFavorite(stop);
      break;
    case 'remove-favorite':
      if (stop) removeFavorite(stop);
      break;
    case 'directions':
      if (stop) openLink(walkingDirectionsUrl(stop, platform.os));
      break;
    case 'share':
      if (stop) shareStop(stop);
      break;
    case 'nearby':
      closeSearch();
      showNearby(dom.nearbyChip);
      break;
    case 'locate-again':
      showNearby(target);
      break;
    case 'search':
      dom.input.focus();
      break;
    case 'clear-recents':
      state.recents = [];
      store.setItem('recents', '[]');
      renderSearch();
      break;
    case 'theme':
      setTheme(target.dataset.value);
      break;
    case 'link':
      openLink(target.dataset.href);
      break;
    case 'show-map':
      sheet.set('peek');
      break;
    default:
      break;
  }
}

// Gestione unica del "torna indietro" (tasto Android, Esc, gesti).
function handleBack() {
  if (state.searching) {
    closeSearch();
    return true;
  }
  if (state.views.length > 1) {
    goBack();
    return true;
  }
  if (sheet.snap !== 'peek') {
    sheet.set('peek');
    return true;
  }
  return false;
}

/* ================================================================ ricerca */

function syncClear() {
  dom.clear.hidden = dom.input.value.length === 0;
}

function openSearch() {
  if (state.searching) return;
  state.searching = true;
  dom.app.classList.add('is-searching');
  dom.searchPanel.hidden = false;
  dom.searchBack.tabIndex = 0;
  renderSearch();
}

function closeSearch() {
  if (!state.searching) return;
  state.searching = false;
  dom.input.value = '';
  syncClear();
  dom.input.blur();
  dom.app.classList.remove('is-searching');
  dom.searchPanel.hidden = true;
  dom.searchBack.tabIndex = -1;
  dom.searchScroll.replaceChildren();
  dom.searchStatus.textContent = '';
}

function renderSearch() {
  if (!state.searching) return;
  const query = dom.input.value.trim();
  const fragment = document.createDocumentFragment();

  if (!query) {
    fragment.append(el('ul', { class: 'stop-list' }, el('li', { class: 'stop-item' },
      el('button', { class: 'stop-row', type: 'button', 'data-action': 'nearby' },
        el('span', { class: 'stop-row-icon' }, icon('i-near')),
        el('span', { class: 'stop-row-text' },
          el('span', { class: 'stop-row-title' }, 'Fermate vicine a me'),
          el('span', { class: 'stop-row-meta' }, 'Usa la posizione del dispositivo')),
        icon('i-chevron', 'stop-row-chevron')))));

    const recents = state.recents.map(id => state.byId.get(id)).filter(Boolean);
    if (recents.length) {
      fragment.append(
        el('div', { class: 'section-row' },
          el('h2', { class: 'section-title' }, 'Recenti'),
          el('button', { class: 'link-button', type: 'button', 'data-action': 'clear-recents' }, 'Cancella')),
        el('ul', { class: 'stop-list' }, ...recents.map(stop => stopRow(stop, { leading: 'recent' })))
      );
    }
    const saved = favoriteStops();
    if (saved.length) {
      fragment.append(
        el('h2', { class: 'section-title' }, 'Preferiti'),
        el('ul', { class: 'stop-list' }, ...saved.map(stop => stopRow(stop, { trailing: [timesButton(stop)] })))
      );
    }
    if (!recents.length && !saved.length) {
      fragment.append(el('p', { class: 'search-message' }, 'Scrivi il nome della fermata, della via o della piazza: ad esempio «Cavour», «viale San Martino» o «Policlinico».'));
    }
    dom.searchStatus.textContent = '';
    dom.searchScroll.replaceChildren(fragment);
    return;
  }

  let results = searchStops(state.stops, query, { isFavorite: favorites.has, origin: freshPosition() });
  let fuzzy = false;
  if (!results.length) {
    results = fuzzySearch(state.stops, query, MAX_RESULTS);
    fuzzy = results.length > 0;
  }

  if (!results.length) {
    fragment.append(el('p', { class: 'search-message' },
      'Nessuna fermata trovata per ', el('strong', {}, `«${query}»`),
      '. Prova con il nome della via (es. «Garibaldi») o di un luogo vicino (es. «Policlinico»).'));
    dom.searchStatus.textContent = 'Nessuna fermata trovata';
  } else {
    if (fuzzy) fragment.append(el('p', { class: 'search-message' }, 'Nessun risultato esatto per ', el('strong', {}, `«${query}»`), '. Forse cercavi:'));
    const shown = results.slice(0, MAX_RESULTS);
    fragment.append(el('ul', { class: 'stop-list', 'aria-label': 'Fermate trovate' },
      ...shown.map(({ stop, distance }) => stopRow(stop, { distance }))));
    if (results.length > MAX_RESULTS) {
      fragment.append(el('p', { class: 'search-message' }, `Altre ${results.length - MAX_RESULTS} fermate: aggiungi una parola per restringere la ricerca.`));
    }
    dom.searchStatus.textContent = results.length === 1 ? '1 fermata trovata' : `${results.length} fermate trovate`;
  }
  dom.searchScroll.replaceChildren(fragment);
  dom.searchScroll.scrollTop = 0;
}

function selectFromSearch(stop) {
  closeSearch();
  openStop(stop, { reset: true });
}

/* ================================================================ scheda */

function currentView() {
  return state.views[state.views.length - 1];
}

function openView(view, { reset = false, replace = false, snap = 'half', focus = true } = {}) {
  if (reset) state.views = [{ type: 'home' }];
  if (replace && state.views.length > 1) state.views.pop();
  if (view.type !== 'home') state.views.push(view);
  renderSheet({ focus });
  if (snap) sheet.set(snap);
}

function goBack() {
  if (state.views.length <= 1) return;
  state.views.pop();
  renderSheet({ focus: true });
  const view = currentView();
  if (view.type === 'home') sheet.set('peek');
}

function goHome() {
  state.views = [{ type: 'home' }];
  renderSheet({ focus: true });
  sheet.set('peek');
}

function rerender() {
  const scroll = dom.sheetBody.scrollTop;
  renderSheet({ focus: false });
  dom.sheetBody.scrollTop = scroll;
}

function renderSheet({ focus = true } = {}) {
  const view = currentView();
  dom.sheet.dataset.view = view.type;
  dom.sheetBack.hidden = state.views.length <= 2;
  dom.sheetClose.hidden = view.type === 'home';
  dom.sheetKicker.textContent = '';
  dom.sheetBody.replaceChildren();
  dom.sheetBody.scrollTop = 0;

  if (view.type === 'home') renderHome();
  else if (view.type === 'stop') renderStop(view.stop);
  else if (view.type === 'nearby') renderNearby();
  else if (view.type === 'location-error') renderLocationError(view.reason);
  else if (view.type === 'info') renderInfo();

  if (view.type !== 'stop') mapApi?.setSelected(view.type === 'nearby' ? nearbyList()[0]?.stop : null);
  dom.nearbyChip.setAttribute('aria-pressed', String(view.type === 'nearby'));
  if (focus) dom.sheetTitle.focus({ preventScroll: true });
}

function updatePeekHeight() {
  // In posizione compatta la scheda mostra il titolo e le prime due fermate.
  window.requestAnimationFrame(() => {
    const rows = [...dom.sheetBody.querySelectorAll('.stop-item, .empty-state')].slice(0, 2);
    const bodyTop = dom.sheetBody.getBoundingClientRect().top;
    const last = rows[rows.length - 1];
    const content = last ? last.getBoundingClientRect().bottom - bodyTop : 40;
    const safeBottom = parseFloat(getComputedStyle(dom.sheetBody).paddingBottom) || 20;
    sheet.setPeekHeight(dom.sheetDrag.offsetHeight + content + Math.min(safeBottom, 44));
  });
}

/* ---------------------------------------------------------------- home / preferiti */

function favoriteStops() {
  const origin = freshPosition();
  const saved = state.stops.filter(favorites.has);
  if (origin) return saved.sort((a, b) => distanceMeters(origin, a) - distanceMeters(origin, b));
  return saved.sort((a, b) => (
    ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone) || a.label.localeCompare(b.label, 'it')
  ));
}

function renderHome() {
  const saved = favoriteStops();
  if (!saved.length) {
    dom.sheetTitle.textContent = 'Fermate ATM Messina';
    dom.sheetBody.append(el('div', { class: 'empty-state' },
      el('p', {}, 'Cerca una fermata o trova quelle vicine a te. Salva le fermate che usi più spesso: qui ne aprirai gli orari con un tocco.'),
      el('div', { class: 'empty-actions' },
        el('button', { class: 'button button-primary', type: 'button', 'data-action': 'nearby' }, icon('i-near'), el('span', {}, 'Fermate vicine')),
        el('button', { class: 'button button-secondary', type: 'button', 'data-action': 'search' }, icon('i-search'), el('span', {}, 'Cerca')))
    ));
    updatePeekHeight();
    return;
  }
  dom.sheetKicker.textContent = saved.length === 1 ? '1 fermata salvata' : `${saved.length} fermate salvate`;
  dom.sheetTitle.textContent = 'Le tue fermate';
  const origin = freshPosition();
  dom.sheetBody.append(el('ul', { class: 'stop-list', 'aria-label': 'Fermate preferite' },
    ...saved.map(stop => stopRow(stop, {
      distance: origin ? distanceMeters(origin, stop) : null,
      trailing: [timesButton(stop), removeButton(stop)]
    }))));
  updatePeekHeight();
}

/* ---------------------------------------------------------------- fermata */

function openStop(stop, { reset = false, fromMap = false, focus = true } = {}) {
  const view = currentView();
  const replace = view.type === 'stop';
  openView({ type: 'stop', stop }, { reset: reset || (fromMap && view.type !== 'nearby'), replace, snap: 'half', focus });
  state.recents = pushRecent(state.recents, stop.id);
  store.setItem('recents', JSON.stringify(state.recents));
  mapApi?.setSelected(stop);
  window.requestAnimationFrame(() => mapApi?.focus(stop, { zoom: fromMap ? 16 : 16.5, padding: mapPadding() }));
}

function renderStop(stop) {
  dom.sheetKicker.textContent = [stop.code ? `Palina ${stop.code}` : '', `Zona ${zoneLabel(stop.zone)}`].filter(Boolean).join(' · ');
  dom.sheetTitle.textContent = stop.label;

  const fragment = document.createDocumentFragment();
  const chips = el('div', { class: 'chips' });
  if (stop.directionLabel) chips.append(el('span', { class: 'chip chip-direction' }, `Direzione ${stop.directionLabel}`));
  const origin = freshPosition();
  if (origin) {
    const distance = distanceMeters(origin, stop);
    chips.append(el('span', { class: 'chip' }, icon('i-walk'), `${formatDistance(distance)} · ${walkingMinutes(distance)} min`));
  }
  if (chips.childElementCount) fragment.append(chips);

  fragment.append(timesSection(stop));

  const isFavorite = favorites.has(stop);
  fragment.append(el('div', { class: 'button-row' },
    el('button', {
      class: `button button-tonal${isFavorite ? ' is-active' : ''}`,
      type: 'button',
      'data-action': 'toggle-favorite',
      'data-stop-id': stop.id,
      'aria-pressed': String(isFavorite)
    }, icon('i-star', 'icon-star'), el('span', {}, isFavorite ? 'Salvata' : 'Salva')),
    el('button', {
      class: 'button button-tonal',
      type: 'button',
      'data-action': 'directions',
      'data-stop-id': stop.id,
      'aria-label': `Percorso a piedi verso ${stop.label} con ${platform.os === 'ios' ? 'Mappe' : 'Google Maps'}`
    }, icon('i-walk'), el('span', {}, 'Percorso')),
    el('button', {
      class: 'button button-tonal',
      type: 'button',
      'data-action': 'share',
      'data-stop-id': stop.id
    }, icon('i-share'), el('span', {}, 'Condividi'))
  ));

  const around = nearbyGrouped(state.stops.filter(other => other.id !== stop.id), stop, { limit: 5, maxDistance: AROUND_RADIUS });
  if (around.length) {
    fragment.append(
      el('h2', { class: 'section-title' }, 'Fermate qui vicino'),
      el('ul', { class: 'stop-list' }, ...around.map(({ stop: other, distance }) => stopRow(other, {
        metaOverride: [other.directionLabel ? `Dir. ${other.directionLabel}` : '', `${formatDistance(distance)} da qui`].filter(Boolean).join(' · ')
      })))
    );
  }
  dom.sheetBody.append(fragment);
}

// Gli orari sono sempre quelli ufficiali ATM: l'app non li elabora né li stima.
function timesSection(stop) {
  const section = el('div', { class: 'times' });
  const alternatives = [
    'Se ATM non risponde, riprova più tardi oppure usa l’',
    el('button', { type: 'button', 'data-action': 'link', 'data-href': atmAppUrl() }, 'app ufficiale ATM MovUp'),
    ' o gli ',
    el('button', { type: 'button', 'data-action': 'link', 'data-href': ATM_LINKS.lines }, 'orari delle linee'),
    '.'
  ];
  if (stop.arrivalsUrl) {
    section.append(
      el('button', {
        class: 'button button-primary button-xl',
        type: 'button',
        'data-action': 'times',
        'data-stop-id': stop.id,
        'aria-label': `Orari della fermata ${stop.label} sul sito ATM Messina`
      }, icon('i-clock'), el('span', {}, 'Orari della fermata'), icon('i-external', 'icon-small')),
      el('p', { class: 'hint' }, 'Si apre la pagina della palina sul sito ATM Messina, la stessa del QR code alla fermata. ', ...alternatives)
    );
  } else {
    section.append(el('p', { class: 'notice' }, 'Per questa fermata manca il codice palina, quindi non possiamo aprire la sua pagina ATM. ', ...alternatives));
  }
  return section;
}

function atmAppUrl() {
  return platform.os === 'android' ? ATM_LINKS.googlePlay : ATM_LINKS.appStore;
}

/* ---------------------------------------------------------------- vicine */

function nearbyList() {
  const origin = state.position;
  if (!origin) return [];
  return nearbyGrouped(state.stops, origin, { limit: NEARBY_LIMIT });
}

async function showNearby(trigger) {
  const ok = await requestLocation(trigger);
  if (!ok) return;
  state.lastNearbyOrigin = state.position;
  openView({ type: 'nearby' }, { reset: true, snap: 'half' });
  const list = nearbyList();
  window.requestAnimationFrame(() => {
    mapApi?.fit([state.position, ...list.slice(0, 4).map(entry => entry.stop)], { padding: mapPadding(), maxZoom: 17 });
  });
}

function renderNearby() {
  dom.sheetTitle.textContent = 'Fermate vicine';
  const position = state.position;
  if (!position) return;
  const accuracy = Math.round(position.accuracy || 0);
  dom.sheetKicker.textContent = accuracy ? `Posizione rilevata · precisione ±${formatDistance(accuracy)}` : 'Posizione rilevata';

  const list = nearbyList();
  const fragment = document.createDocumentFragment();
  if (accuracy > 300 || !state.precise) {
    fragment.append(el('p', { class: 'notice notice-warning' }, state.precise
      ? 'La posizione è approssimativa: le distanze potrebbero non essere precise. Prova all’aperto o riprova tra poco.'
      : 'Stai usando la posizione approssimativa: le distanze sono indicative. Puoi attivare la posizione esatta dalle impostazioni dell’app.'));
  }
  if (list.length && list[0].distance > 5000) {
    fragment.append(el('p', { class: 'notice' }, 'Sembri lontano da Messina: queste sono comunque le fermate ATM più vicine.'));
  }
  const nearestId = list.reduce((best, entry) => (!best || entry.distance < best.distance ? entry : best), null)?.stop.id;
  fragment.append(el('ul', { class: 'stop-list', 'aria-label': 'Fermate vicine ordinate per distanza' },
    ...list.map(({ stop, distance }) => stopRow(stop, {
      highlight: stop.id === nearestId,
      metaOverride: [stop.directionLabel ? `Dir. ${stop.directionLabel}` : '', `${formatDistance(distance)} · ${walkingMinutes(distance)} min a piedi`].filter(Boolean).join(' · '),
      trailing: [timesButton(stop)]
    }))));
  fragment.append(
    el('p', { class: 'hint' }, 'Distanze in linea d’aria e tempi a piedi stimati. La posizione resta sul dispositivo.'),
    el('button', { class: 'button button-ghost button-block', type: 'button', 'data-action': 'locate-again' }, icon('i-near'), el('span', {}, 'Aggiorna posizione'))
  );
  dom.sheetBody.append(fragment);
}

/* ---------------------------------------------------------------- posizione */

function freshPosition() {
  return state.position && Date.now() - state.position.timestamp < 10 * 60000 ? state.position : null;
}

async function requestLocation(trigger) {
  if (state.locating) return false;
  setLocating(true, trigger);
  let result;
  try {
    result = await platform.locate();
  } catch (error) {
    console.error(error);
    result = { ok: false, reason: 'unavailable' };
  } finally {
    setLocating(false, trigger);
  }
  if (!result.ok) {
    openView({ type: 'location-error', reason: result.reason }, { reset: true, snap: 'half' });
    return false;
  }
  state.precise = result.precise !== false;
  updatePosition(result.position);
  state.locationActive = true;
  startWatch();
  return true;
}

function updatePosition(position) {
  state.position = position;
  mapApi?.setUserLocation(position);
  dom.locateButton.classList.add('is-active');
  dom.locateButton.setAttribute('aria-label', 'Centra la mappa sulla mia posizione');
}

async function startWatch() {
  if (stopWatch) return;
  try {
    stopWatch = await platform.watchLocation(state.precise, position => {
      const previous = state.position;
      updatePosition(position);
      const view = currentView();
      if (view.type === 'nearby' && positionMovedEnough(state.lastNearbyOrigin, position, 25)) {
        state.lastNearbyOrigin = position;
        rerender();
      } else if (view.type === 'stop' && positionMovedEnough(previous, position, 15)) {
        rerender();
      }
    });
  } catch (error) {
    console.warn('Aggiornamento posizione non disponibile', error);
  }
}

function stopWatching() {
  stopWatch?.();
  stopWatch = null;
}

async function centerOnUser() {
  const position = state.position && Date.now() - state.position.timestamp < POSITION_FRESH_MS ? state.position : null;
  if (position) {
    mapApi?.focus(position, { zoom: 16, padding: mapPadding() });
    return;
  }
  if (await requestLocation(dom.locateButton)) {
    mapApi?.focus(state.position, { zoom: 16, padding: mapPadding() });
  }
}

function setLocating(value, trigger) {
  state.locating = value;
  [dom.nearbyChip, dom.locateButton, trigger].filter(Boolean).forEach(element => {
    element.classList.toggle('is-loading', value);
    element.setAttribute('aria-busy', String(value));
  });
  const label = dom.nearbyChip.querySelector('span');
  label.textContent = value ? 'Cerco la posizione…' : 'Fermate vicine';
}

function renderLocationError(reason) {
  dom.sheetKicker.textContent = 'Fermate vicine';
  dom.sheetTitle.textContent = 'Posizione non disponibile';
  const settingsPath = platform.os === 'ios'
    ? 'Impostazioni › Quando Passa › Posizione e scegli «Mentre usi l’app»'
    : platform.os === 'android'
      ? 'Impostazioni › App › Quando Passa › Autorizzazioni › Posizione e scegli «Consenti solo mentre l’app è in uso»'
      : 'le impostazioni del browser per questo sito';
  const messages = {
    denied: `Hai negato l’accesso alla posizione. Per vedere le fermate vicine apri ${settingsPath}.`,
    restricted: 'L’uso della posizione è limitato su questo dispositivo (ad esempio da Tempo di utilizzo o da un profilo aziendale).',
    disabled: platform.os === 'ios'
      ? 'I servizi di localizzazione sono disattivati. Attivali da Impostazioni › Privacy e sicurezza › Localizzazione e riprova.'
      : 'La localizzazione del dispositivo è disattivata. Attivala dalle impostazioni rapide e riprova.',
    timeout: 'Non siamo riusciti a rilevare la posizione in tempo. Prova all’aperto o riprova tra qualche secondo.',
    unavailable: 'Il segnale di posizione non è disponibile in questo momento. Riprova tra poco.',
    unsupported: 'Questo dispositivo non permette di rilevare la posizione.'
  };
  dom.sheetBody.append(
    el('p', { class: 'notice' }, messages[reason] || messages.unavailable),
    el('p', { class: 'hint' }, 'Puoi sempre cercare la fermata per nome o per via.'),
    el('div', { class: 'empty-actions' },
      reason === 'unsupported' || reason === 'restricted' ? '' : el('button', { class: 'button button-primary', type: 'button', 'data-action': 'locate-again' }, icon('i-near'), el('span', {}, 'Riprova')),
      el('button', { class: 'button button-secondary', type: 'button', 'data-action': 'search' }, icon('i-search'), el('span', {}, 'Cerca per nome')))
  );
}

/* ---------------------------------------------------------------- informazioni */

function renderInfo() {
  dom.sheetKicker.textContent = 'Informazioni e impostazioni';
  dom.sheetTitle.textContent = 'Quando Passa';
  const themes = [['system', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']];
  const linkButton = (href, text) => el('button', { class: 'inline-link', type: 'button', 'data-action': 'link', 'data-href': href }, text);

  dom.sheetBody.append(el('div', { class: 'prose' },
    el('p', {}, 'Mappa delle fermate degli autobus ATM di Messina: trova la fermata giusta e aprine gli orari ufficiali in pochi tocchi.'),

    el('h2', {}, 'Aspetto'),
    el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Tema' },
      ...themes.map(([value, text]) => el('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(state.settings.theme === value),
        'data-action': 'theme',
        'data-value': value
      }, text))),
    el('p', { class: 'hint' }, '«Automatico» segue il tema chiaro o scuro del telefono.'),

    el('h2', {}, 'Orari'),
    el('p', {}, 'Gli orari sono pubblicati da ATM Messina S.p.A. e si aprono nel browser integrato, sulla stessa pagina del QR code esposto alla palina. Quando Passa non li elabora e non mostra stime proprie.'),
    el('p', {}, 'Quando Passa è un progetto indipendente e non è un’app ufficiale di ATM Messina.'),

    el('h2', {}, 'Privacy'),
    el('ul', {},
      el('li', {}, 'Nessuna registrazione, nessuna pubblicità, nessuno strumento di analisi o tracciamento.'),
      el('li', {}, 'La posizione viene usata solo quando tocchi «Fermate vicine» o il pulsante della posizione, solo mentre l’app è aperta, e non lascia mai il dispositivo.'),
      el('li', {}, 'Preferiti, ricerche recenti e impostazioni restano salvati solo su questo dispositivo.'),
      el('li', {}, 'Per disegnare la mappa l’app scarica le tessere cartografiche da OpenFreeMap, che riceve l’indirizzo IP come qualsiasi sito web. Le pagine degli orari sono servite da ATM Messina.')),

    el('h2', {}, 'Dati e crediti'),
    el('p', {}, 'Posizioni delle fermate e codici palina: dataset del progetto Quando Passa, basato sui riferimenti pubblici delle paline ATM.'),
    el('p', {}, 'Mappa: ', linkButton('https://openfreemap.org/', 'OpenFreeMap'), ', ', linkButton('https://www.openmaptiles.org/', '© OpenMapTiles'), ', dati ', linkButton('https://www.openstreetmap.org/copyright', '© OpenStreetMap'), ' (ODbL).'),
    el('p', {}, 'Software: ', linkButton('https://maplibre.org/', 'MapLibre GL JS'), ' (BSD-3-Clause), ', linkButton('https://capacitorjs.com/', 'Capacitor'), ' (MIT).'),
    el('p', {}, 'Progetto di Giovanni Foti. Codice e segnalazioni su ', linkButton('https://github.com/giovannifoti/quandupassa.it', 'GitHub'), '.'),
    el('p', { class: 'app-version' }, `Versione ${state.nativeVersion || APP_VERSION}`)
  ));
}

/* ================================================================ azioni */

async function openTimes(stop) {
  if (!stop.arrivalsUrl) {
    openStop(stop);
    return;
  }
  if (!state.online) {
    showToast('Per vedere gli orari serve una connessione a Internet.', { timeout: 5000 });
    return;
  }
  try {
    await platform.openWebPage(stop.arrivalsUrl, { toolbarColor: isDark() ? '#16242a' : '#ffffff' });
  } catch (error) {
    console.error(error);
    showToast('Impossibile aprire la pagina degli orari. Riprova.', { timeout: 5000 });
  }
}

function openLink(url) {
  try {
    if (/^https:\/\/(www\.)?atmmessinaspa\.it\//.test(url) || /openfreemap|openstreetmap|openmaptiles|maplibre|capacitorjs|github\.com/.test(url)) {
      if (!state.online) {
        showToast('Serve una connessione a Internet per aprire la pagina.', { timeout: 4000 });
        return;
      }
      platform.openWebPage(url, { toolbarColor: isDark() ? '#16242a' : '#ffffff' }).catch(() => showToast('Impossibile aprire la pagina.'));
    } else {
      platform.openExternal(url);
    }
  } catch (error) {
    console.error(error);
    showToast('Impossibile aprire il collegamento.');
  }
}

function toggleFavorite(stop) {
  const { value } = favorites.toggle(stop);
  showToast(value ? 'Salvata nei preferiti' : 'Rimossa dai preferiti', {
    action: { label: 'Annulla', run: () => { favorites.set(stop, !value); rerender(); } }
  });
  rerender();
  dom.sheetBody.querySelector('[data-action="toggle-favorite"]')?.focus({ preventScroll: true });
}

function removeFavorite(stop) {
  favorites.set(stop, false);
  rerender();
  showToast(`${stop.label} rimossa`, {
    action: { label: 'Annulla', run: () => { favorites.set(stop, true); rerender(); } }
  });
}

async function shareStop(stop) {
  try {
    const result = await platform.share({
      title: `Fermata ${stop.label}`,
      text: `Fermata ATM ${stop.label}${stop.directionLabel ? ` (direzione ${stop.directionLabel})` : ''}`,
      url: shareUrl(stop)
    });
    if (result === 'copied') showToast('Link della fermata copiato');
  } catch (error) {
    console.error(error);
    showToast('Condivisione non disponibile');
  }
}

function updateFavoritesCount() {
  const count = state.stops.filter(favorites.has).length;
  dom.favoritesCount.hidden = count === 0;
  dom.favoritesCount.textContent = String(count);
  dom.favoritesChip.setAttribute('aria-label', count ? `Preferiti, ${count} ${count === 1 ? 'fermata' : 'fermate'}` : 'Preferiti');
}

/* ================================================================ rete, tema, toast */

function setOnline(online, { quiet = false } = {}) {
  const changed = state.online !== online;
  state.online = online;
  dom.offlineBanner.hidden = online;
  if (!changed) return;
  if (online) {
    if (!quiet) showToast('Connessione ripristinata');
    if (state.mapStatus === 'offline' || state.mapStatus === 'error') retryMap();
  } else if (state.mapStatus === 'loading') {
    setMapStatus('offline');
  }
}

function isDark() {
  const { theme } = state.settings;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  platform.setSystemBars(dark);
  mapApi?.setTheme(dark);
}

function setTheme(value) {
  if (!['system', 'light', 'dark'].includes(value)) return;
  state.settings = { ...state.settings, theme: value };
  store.setItem('settings', JSON.stringify(state.settings));
  applyTheme();
  rerender();
}

function showToast(message, { timeout = 3200, action = null } = {}) {
  window.clearTimeout(toastTimer);
  dom.toastText.textContent = message;
  dom.toastAction.hidden = !action;
  dom.toastAction.onclick = null;
  if (action) {
    dom.toastAction.textContent = action.label;
    dom.toastAction.onclick = () => {
      dom.toast.classList.remove('is-visible');
      action.run();
    };
  }
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => dom.toast.classList.remove('is-visible'), action ? Math.max(timeout, 5000) : timeout);
}

/* ================================================================ componenti */

function stopRow(stop, { distance = null, highlight = false, trailing = [], leading = null, metaOverride = '' } = {}) {
  const isFavorite = favorites.has(stop);
  let meta = metaOverride;
  if (!meta) {
    const parts = [];
    if (stop.directionLabel) parts.push(`Dir. ${stop.directionLabel}`);
    if (Number.isFinite(distance)) parts.push(`${formatDistance(distance)} · ${walkingMinutes(distance)} min`);
    else parts.push(`Zona ${zoneLabel(stop.zone)}`);
    meta = parts.join(' · ');
  }
  const iconName = leading === 'recent' ? 'i-history' : isFavorite ? 'i-star' : 'i-bus';
  const iconClass = `stop-row-icon${isFavorite && leading !== 'recent' ? ' is-favorite' : ''}${leading === 'recent' ? ' is-recent' : ''}`;

  const button = el('button', {
    class: `stop-row${highlight ? ' is-highlighted' : ''}`,
    type: 'button',
    'data-action': 'open-stop',
    'data-stop-id': stop.id
  },
  el('span', { class: iconClass }, icon(iconName)),
  el('span', { class: 'stop-row-text' },
    el('span', { class: 'stop-row-title' }, stop.label),
    el('span', { class: 'stop-row-meta' },
      highlight ? el('span', { class: 'tag' }, 'La più vicina') : '',
      meta)),
  trailing.length ? '' : icon('i-chevron', 'stop-row-chevron'));
  if (isFavorite) button.append(el('span', { class: 'visually-hidden' }, ', nei preferiti'));
  return el('li', { class: 'stop-item' }, button, ...trailing);
}

function timesButton(stop) {
  if (!stop.arrivalsUrl) return '';
  return el('button', {
    class: 'times-button',
    type: 'button',
    'data-action': 'times',
    'data-stop-id': stop.id,
    'aria-label': `Orari di ${stop.label}${stop.directionLabel ? `, direzione ${stop.directionLabel}` : ''}`
  }, icon('i-clock'), el('span', { 'aria-hidden': 'true' }, 'Orari'));
}

function removeButton(stop) {
  return el('button', {
    class: 'icon-button remove-button',
    type: 'button',
    'data-action': 'remove-favorite',
    'data-stop-id': stop.id,
    'aria-label': `Rimuovi ${stop.label} dai preferiti`
  }, icon('i-close'));
}

function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === false || value === null || value === undefined) return;
    element.setAttribute(key, value === true ? '' : String(value));
  });
  children.flat().forEach(child => {
    if (child === '' || child === null || child === undefined) return;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return element;
}

function icon(id, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function debounce(callback, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

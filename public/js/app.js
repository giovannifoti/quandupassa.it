import {
  ATM_LINKS,
  ZONE_ORDER,
  appStoreFor,
  directionsUrl,
  distanceMeters,
  formatDistance,
  nearestStops,
  parseStops,
  searchStops,
  walkingMinutes,
  zoneLabel
} from './stops.js';
import { createFavorites } from './favorites.js';

const MAX_RESULTS = 20;
const NEARBY_LIMIT = 8;
const SITE_URL = 'https://quandupassa.it/';
const sun = globalThis.QuandupassaSun;

const $ = id => document.getElementById(id);
const dom = {
  panel: $('panel'),
  searchForm: $('search-form'),
  input: $('search-input'),
  clear: $('search-clear'),
  results: $('results'),
  resultsStatus: $('results-status'),
  resultsList: $('results-list'),
  nearbyButton: $('nearby-button'),
  favoritesButton: $('favorites-button'),
  favoritesCount: $('favorites-count'),
  infoButton: $('info-button'),
  sheet: $('sheet'),
  sheetBack: $('sheet-back'),
  sheetClose: $('sheet-close'),
  sheetKicker: $('sheet-kicker'),
  sheetTitle: $('sheet-title'),
  sheetBody: $('sheet-body'),
  about: $('about'),
  map: $('map'),
  mapLoading: $('map-loading'),
  toast: $('toast')
};

const state = {
  stops: [],
  stopsById: new Map(),
  userPosition: null,
  views: [],
  returnFocus: null,
  locating: false
};

const favorites = createFavorites();
let mapApi = null;
let toastTimer = null;
let searchTimer = null;

const stopsLoaded = loadStops();
initTheme();
bindEvents();
updateFavoritesCount();
initMap();
registerServiceWorker();

/* ---------------------------------------------------------------- dati */

async function loadStops() {
  try {
    const response = await fetch('/stops_fixed.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.stops = parseStops(await response.json());
    state.stops.forEach(stop => state.stopsById.set(stop.id, stop));
    mapApi?.setStops(state.stops, favorites.has);
    updateFavoritesCount();
    restoreFromUrl();
    if (dom.input.value.trim()) renderResults();
    document.documentElement.dataset.stops = 'ready';
  } catch (error) {
    console.error(error);
    showToast('Impossibile caricare le fermate. Controlla la connessione e riprova.', 8000);
  }
}

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const stop = state.stopsById.get(params.get('fermata') || '');
  const query = params.get('q');
  if (stop) {
    openStop(stop, { replace: true, focus: false });
  } else if (query) {
    dom.input.value = query.slice(0, 80);
    syncClearButton();
  }
}

/* ---------------------------------------------------------------- mappa */

async function initMap() {
  try {
    const { createMap } = await import('./map.js');
    mapApi = await createMap({
      container: dom.map,
      dark: document.documentElement.dataset.theme === 'dark',
      padding: mapPadding(),
      onStopSelect: index => {
        const stop = state.stops[index];
        if (stop) openStop(stop, { fromMap: true });
      },
      onError: () => showToast('La mappa non è disponibile al momento. Puoi usare ricerca ed elenco fermate.', 8000)
    });
    if (state.stops.length) mapApi.setStops(state.stops, favorites.has);
    if (state.userPosition) mapApi.setUserLocation(state.userPosition);
    const current = currentView();
    if (current?.type === 'stop') {
      mapApi.setSelected(current.stop);
      mapApi.focus(current.stop, { padding: mapPadding() });
    }
    mapApi.ready.then(() => dom.mapLoading.hidden = true);
  } catch (error) {
    console.error(error);
    dom.mapLoading.hidden = true;
    dom.map.classList.add('map-unavailable');
    const message = document.createElement('p');
    message.className = 'map-fallback';
    message.append(
      'La mappa non può essere visualizzata su questo dispositivo. ',
      link('/fermate/', 'Apri l’elenco delle fermate')
    );
    dom.map.replaceChildren(message);
  }
}

function mapPadding() {
  const margin = 24;
  if (isSidebarLayout()) {
    const rect = dom.panel.getBoundingClientRect();
    return { top: margin, bottom: margin, right: margin, left: rect.right + margin };
  }
  const header = document.querySelector('.app-bar').getBoundingClientRect();
  const bottomElement = dom.sheet.hidden ? document.querySelector('.actions') : dom.sheet;
  const height = window.innerHeight;
  const top = Math.max(header.bottom + 12, margin);
  // Lascia sempre almeno 140px di mappa visibile, altrimenti MapLibre
  // non riesce a inquadrare i punti richiesti.
  const bottom = Math.min(
    Math.max(height - bottomElement.getBoundingClientRect().top + 12, margin),
    Math.max(height - top - 140, margin)
  );
  return { top, bottom, left: margin, right: margin };
}

function isSidebarLayout() {
  return window.getComputedStyle(dom.panel).display !== 'contents';
}

/* ---------------------------------------------------------------- eventi */

function bindEvents() {
  dom.input.addEventListener('input', () => {
    syncClearButton();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(renderResults, 90);
  });

  dom.input.addEventListener('focus', () => {
    if (dom.input.value.trim()) renderResults();
  });

  dom.input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      dom.resultsList.querySelector('button')?.focus();
    }
  });

  dom.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    const first = dom.resultsList.querySelector('[data-stop-id]');
    if (first) {
      const stop = state.stopsById.get(first.dataset.stopId);
      if (stop) selectFromResults(stop);
    } else {
      renderResults();
    }
  });

  dom.clear.addEventListener('click', () => {
    dom.input.value = '';
    syncClearButton();
    closeResults();
    dom.input.focus();
  });

  dom.resultsList.addEventListener('keydown', event => {
    const buttons = [...dom.resultsList.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[Math.min(index + 1, buttons.length - 1)].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      (index === 0 ? dom.input : buttons[index - 1]).focus();
    }
  });

  dom.resultsList.addEventListener('click', event => {
    const button = event.target.closest('[data-stop-id]');
    const stop = button && state.stopsById.get(button.dataset.stopId);
    if (stop) selectFromResults(stop);
  });

  dom.nearbyButton.addEventListener('click', () => locateUser());
  dom.favoritesButton.addEventListener('click', () => {
    if (currentView()?.type === 'favorites') closeSheet();
    else openView({ type: 'favorites' }, { reset: true, trigger: dom.favoritesButton });
  });
  dom.infoButton.addEventListener('click', () => {
    if (currentView()?.type === 'info') closeSheet();
    else openView({ type: 'info' }, { reset: true, trigger: dom.infoButton });
  });
  dom.sheetClose.addEventListener('click', () => closeSheet());
  dom.sheetBack.addEventListener('click', () => goBack());

  dom.sheetBody.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!dom.results.hidden) {
      closeResults();
      dom.input.focus();
    } else if (!dom.sheet.hidden) {
      closeSheet();
    }
  });

  document.addEventListener('pointerdown', event => {
    if (dom.results.hidden) return;
    if (!event.target.closest('.app-bar, .results')) closeResults();
  });

  favorites.onChange(() => {
    mapApi?.setStops(state.stops, favorites.has);
    updateFavoritesCount();
  });

  const syncViewport = () => {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--viewport-height', `${Math.round(height)}px`);
  };
  syncViewport();
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.addEventListener('resize', debounce(() => {
    syncViewport();
    mapApi?.resize(mapPadding());
  }, 120));

}

function handleAction(action, element) {
  const stop = state.stopsById.get(element.dataset.stopId || '');
  switch (action) {
    case 'open-stop':
      if (stop) openStop(stop);
      break;
    case 'toggle-favorite':
      if (stop) toggleFavorite(stop);
      break;
    case 'remove-favorite':
      if (stop) {
        favorites.set(stop, false);
        showToast(`${stop.title} rimossa dai preferiti`);
        rerenderCurrentView({ keepFocus: false });
      }
      break;
    case 'share':
      if (stop) shareStop(stop);
      break;
    case 'clear-favorites':
      if (window.confirm('Vuoi rimuovere tutte le fermate dai preferiti?')) {
        favorites.clear();
        showToast('Preferiti svuotati');
        rerenderCurrentView({ keepFocus: false });
      }
      break;
    case 'locate':
      locateUser();
      break;
    case 'show-on-map':
      if (stop) mapApi?.focus(stop, { zoom: 17, padding: mapPadding() });
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------- ricerca */

function syncClearButton() {
  dom.clear.hidden = dom.input.value.length === 0;
}

function renderResults() {
  const query = dom.input.value.trim();
  if (!query) {
    closeResults();
    return;
  }
  if (!state.stops.length) {
    dom.resultsStatus.textContent = 'Caricamento fermate…';
    dom.resultsList.replaceChildren();
    dom.results.hidden = false;
    return;
  }

  const results = searchStops(state.stops, query, {
    isFavorite: favorites.has,
    origin: state.userPosition
  });

  dom.resultsList.replaceChildren(
    ...results.slice(0, MAX_RESULTS).map(({ stop, distance }) => stopRow(stop, { distance }))
  );

  if (!results.length) {
    dom.resultsStatus.textContent = `Nessuna fermata trovata per «${query}». Prova con un'altra parola o con il nome della via.`;
  } else if (results.length > MAX_RESULTS) {
    dom.resultsStatus.textContent = `${results.length} fermate trovate, mostro le prime ${MAX_RESULTS}`;
  } else {
    dom.resultsStatus.textContent = results.length === 1 ? '1 fermata trovata' : `${results.length} fermate trovate`;
  }
  dom.results.hidden = false;
}

function closeResults() {
  dom.results.hidden = true;
  dom.resultsList.replaceChildren();
  dom.resultsStatus.textContent = '';
}

function selectFromResults(stop) {
  closeResults();
  dom.input.blur();
  openStop(stop, { reset: true });
}

/* ---------------------------------------------------------------- pannello */

function currentView() {
  return state.views[state.views.length - 1] || null;
}

function openView(view, { reset = false, trigger = null, replace = false, focus = true } = {}) {
  if (dom.sheet.hidden) state.returnFocus = trigger || document.activeElement;
  if (reset) state.views = [];
  if (replace) state.views.pop();
  state.views.push(view);
  renderSheet({ focus });
}

function goBack() {
  if (state.views.length <= 1) {
    closeSheet();
    return;
  }
  state.views.pop();
  renderSheet({ focus: true });
}

function closeSheet() {
  const hadLocation = state.views.some(view => view.type === 'nearby');
  state.views = [];
  dom.sheet.hidden = true;
  document.body.classList.remove('has-sheet');
  dom.sheetBody.replaceChildren();
  returnAboutContent();
  mapApi?.setSelected(null);
  if (hadLocation) clearLocation();
  syncExpanded();
  updateUrl(null);

  const target = state.returnFocus;
  state.returnFocus = null;
  if (target && document.contains(target) && typeof target.focus === 'function') target.focus();
}

function rerenderCurrentView({ keepFocus = true } = {}) {
  if (!dom.sheet.hidden) renderSheet({ focus: !keepFocus });
}

function renderSheet({ focus = true } = {}) {
  const view = currentView();
  if (!view) return;

  returnAboutContent();
  dom.sheet.dataset.view = view.type;
  dom.sheetBack.hidden = state.views.length <= 1;
  dom.sheetKicker.textContent = '';
  dom.sheetBody.replaceChildren();

  if (view.type === 'stop') renderStopView(view.stop);
  else if (view.type === 'nearby') renderNearbyView();
  else if (view.type === 'favorites') renderFavoritesView();
  else if (view.type === 'info') renderInfoView();

  if (view.type === 'nearby') {
    const [nearest] = state.userPosition ? nearestStops(state.stops, state.userPosition, 1) : [];
    mapApi?.setSelected(nearest?.stop || null);
  } else if (view.type !== 'stop') {
    mapApi?.setSelected(null);
  }
  updateUrl(view.type === 'stop' ? view.stop : null);

  dom.sheet.hidden = false;
  document.body.classList.add('has-sheet');
  dom.sheetBody.scrollTop = 0;
  syncExpanded();
  if (focus) dom.sheetTitle.focus({ preventScroll: true });
}

function syncExpanded() {
  const type = dom.sheet.hidden ? null : currentView()?.type;
  dom.favoritesButton.setAttribute('aria-expanded', String(type === 'favorites'));
  dom.infoButton.setAttribute('aria-expanded', String(type === 'info'));
}

function returnAboutContent() {
  if (dom.about.parentElement !== document.querySelector('.map-area')) {
    document.querySelector('.map-area').appendChild(dom.about);
  }
  dom.about.hidden = true;
}

/* ---------------------------------------------------------------- viste */

function openStop(stop, { reset = false, replace = false, focus = true, fromMap = false } = {}) {
  const current = currentView();
  const sameAsCurrent = current?.type === 'stop' && current.stop.id === stop.id;
  const shouldReset = reset || fromMap && current?.type !== 'nearby';
  openView({ type: 'stop', stop }, {
    reset: shouldReset,
    replace: replace || sameAsCurrent || (current?.type === 'stop' && fromMap),
    focus
  });
  mapApi?.setSelected(stop);
  // Lascia al pannello il tempo di essere disegnato prima di calcolare il padding.
  window.requestAnimationFrame(() => {
    mapApi?.focus(stop, { zoom: fromMap ? 16 : 17, padding: mapPadding() });
  });
}

function renderStopView(stop) {
  dom.sheetKicker.textContent = [
    `Zona ${zoneLabel(stop.zone)}`,
    stop.code ? `Palina ${stop.code}` : ''
  ].filter(Boolean).join(' · ');
  dom.sheetTitle.textContent = stop.title;

  const fragment = document.createDocumentFragment();
  const chips = el('div', { class: 'chips' });
  if (stop.direction) chips.append(el('span', { class: 'chip chip-direction' }, `Direzione ${stop.direction}`));
  if (state.userPosition) {
    const distance = distanceMeters(state.userPosition, stop);
    chips.append(el('span', { class: 'chip' }, `${formatDistance(distance)} da te · ${walkingMinutes(distance)} min a piedi (stima)`));
  }
  if (chips.childElementCount) fragment.append(chips);

  fragment.append(timesSection());

  const isFavorite = favorites.has(stop);
  const favoriteButton = el('button', {
    class: `button button-tonal${isFavorite ? ' is-active' : ''}`,
    type: 'button',
    'data-action': 'toggle-favorite',
    'data-stop-id': stop.id,
    'aria-pressed': String(isFavorite)
  }, icon('i-star', 'icon-star'), el('span', {}, isFavorite ? 'Salvata' : 'Salva'));

  const directions = el('a', {
    class: 'button button-tonal',
    href: directionsUrl(stop),
    target: '_blank',
    rel: 'noopener'
  }, icon('i-route'), el('span', {}, 'Percorso'));
  directions.setAttribute('aria-label', `Percorso a piedi verso ${stop.name} con Google Maps (si apre in una nuova scheda)`);

  const share = el('button', {
    class: 'button button-tonal',
    type: 'button',
    'data-action': 'share',
    'data-stop-id': stop.id
  }, icon('i-share'), el('span', {}, 'Condividi'));

  fragment.append(el('div', { class: 'button-row' }, favoriteButton, directions, share));

  const around = nearestStops(state.stops, stop, 4, { exclude: stop.id, maxDistance: 400 });
  if (around.length) {
    fragment.append(
      el('h3', { class: 'section-title' }, 'Fermate nelle vicinanze'),
      el('ul', { class: 'stop-list' }, ...around.map(({ stop: other, distance }) => stopRow(other, {
        distance,
        action: 'open-stop',
        distanceLabel: `${formatDistance(distance)} da qui`
      })))
    );
  }

  dom.sheetBody.append(fragment);
}

// Tempi di attesa e orari: solo canali ufficiali ATM effettivamente raggiungibili.
function timesSection() {
  const section = el('div', { class: 'times' });
  const store = appStoreFor(navigator.userAgent, navigator.maxTouchPoints);
  const appLink = (href, label, extraClass = '') => {
    const link = el('a', { class: `button button-primary ${extraClass}`.trim(), href, target: '_blank', rel: 'noopener' },
      icon('i-clock'), el('span', {}, label), icon('i-external', 'icon-small'));
    link.setAttribute('aria-label', `${label}: scarica l'app ufficiale ATM MovUp (si apre in una nuova scheda)`);
    return link;
  };

  if (store) {
    section.append(appLink(store, 'Tempi di attesa con ATM MovUp', 'button-block'));
  } else {
    section.append(el('div', { class: 'store-row' },
      appLink(ATM_LINKS.appStore, 'App Store'),
      appLink(ATM_LINKS.googlePlay, 'Google Play')
    ));
  }
  section.append(el('p', { class: 'hint' },
    'I tempi di attesa in tempo reale sono nell’app ufficiale ATM MovUp. ',
    el('a', { href: ATM_LINKS.lines, target: '_blank', rel: 'noopener' }, 'Orari delle linee sul sito ATM')
  ));
  return section;
}

function renderNearbyView() {
  dom.sheetTitle.textContent = 'Fermate vicine a te';
  const position = state.userPosition;
  if (!position) return;

  const accuracy = Math.round(position.accuracy || 0);
  dom.sheetKicker.textContent = accuracy ? `Posizione rilevata (precisione ±${formatDistance(accuracy)})` : 'Posizione rilevata';

  const list = nearestStops(state.stops, position, NEARBY_LIMIT);
  const fragment = document.createDocumentFragment();
  if (accuracy > 500) {
    fragment.append(el('p', { class: 'notice' }, 'La posizione è approssimativa: le distanze potrebbero non essere precise. Attiva il GPS o riprova all’aperto.'));
  }
  if (list.length && list[0].distance > 5000) {
    fragment.append(el('p', { class: 'notice' }, 'Sembra che tu sia lontano da Messina: queste sono comunque le fermate ATM più vicine.'));
  }

  fragment.append(el('ul', { class: 'stop-list' }, ...list.map(({ stop, distance }, index) => stopRow(stop, {
    distance,
    action: 'open-stop',
    highlight: index === 0,
    distanceLabel: `${formatDistance(distance)} · ${walkingMinutes(distance)} min a piedi`
  }))));
  fragment.append(el('p', { class: 'hint' }, 'Distanze in linea d’aria e tempi a piedi stimati.'));

  fragment.append(el('button', {
    class: 'button button-ghost button-block',
    type: 'button',
    'data-action': 'locate'
  }, icon('i-locate'), el('span', {}, 'Aggiorna posizione')));

  dom.sheetBody.append(fragment);
}

function renderFavoritesView() {
  dom.sheetTitle.textContent = 'Preferiti';
  const saved = state.stops
    .filter(favorites.has)
    .sort((a, b) => ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone) || a.name.localeCompare(b.name, 'it'));

  dom.sheetKicker.textContent = saved.length === 1 ? '1 fermata salvata' : `${saved.length} fermate salvate`;

  if (!saved.length) {
    dom.sheetBody.append(el('div', { class: 'empty-state' },
      icon('i-star', 'empty-icon'),
      el('p', { class: 'empty-title' }, 'Nessuna fermata salvata'),
      el('p', {}, 'Apri una fermata dalla mappa o dalla ricerca e tocca «Salva»: la ritroverai qui e in giallo sulla mappa.')
    ));
    return;
  }

  const fragment = document.createDocumentFragment();
  ZONE_ORDER.forEach(zone => {
    const inZone = saved.filter(stop => stop.zone === zone);
    if (!inZone.length) return;
    fragment.append(
      el('h3', { class: 'section-title' }, `Zona ${zoneLabel(zone)}`),
      el('ul', { class: 'stop-list' }, ...inZone.map(stop => stopRow(stop, {
        action: 'open-stop',
        distanceLabel: stop.code ? `Palina ${stop.code}` : '',
        trailing: favoriteActions(stop)
      })))
    );
  });
  fragment.append(el('button', {
    class: 'button button-ghost button-danger button-block',
    type: 'button',
    'data-action': 'clear-favorites'
  }, icon('i-trash'), el('span', {}, 'Svuota preferiti')));
  dom.sheetBody.append(fragment);
}

function favoriteActions(stop) {
  const actions = [];
  const remove = el('button', {
    class: 'icon-button',
    type: 'button',
    'data-action': 'remove-favorite',
    'data-stop-id': stop.id,
    title: 'Rimuovi dai preferiti'
  }, icon('i-close'));
  remove.setAttribute('aria-label', `Rimuovi ${stop.name} dai preferiti`);
  actions.push(remove);
  return actions;
}

function renderInfoView() {
  dom.sheetKicker.textContent = 'Informazioni';
  dom.sheetTitle.textContent = 'Quando Passa';
  dom.about.hidden = false;
  dom.sheetBody.append(dom.about);
}

/* ---------------------------------------------------------------- componenti */

function stopRow(stop, { distance = null, action = null, highlight = false, distanceLabel = '', trailing = [] } = {}) {
  const isFavorite = favorites.has(stop);
  const meta = [];
  if (stop.direction) meta.push(`Dir. ${stop.direction}`);
  if (distanceLabel) meta.push(distanceLabel);
  else if (Number.isFinite(distance)) meta.push(formatDistance(distance));
  else meta.push(`Zona ${zoneLabel(stop.zone)}`);

  const attributes = {
    class: `stop-row${highlight ? ' is-highlighted' : ''}`,
    type: 'button',
    'data-stop-id': stop.id
  };
  if (action) attributes['data-action'] = action;

  const button = el('button', attributes,
    el('span', { class: `stop-row-icon${isFavorite ? ' is-favorite' : ''}` }, icon(isFavorite ? 'i-star' : 'i-bus')),
    el('span', { class: 'stop-row-text' },
      el('span', { class: 'stop-row-title' }, stop.title),
      el('span', { class: 'stop-row-meta' },
        highlight ? el('span', { class: 'tag' }, 'La più vicina') : '',
        meta.join(' · ')
      )
    ),
    trailing.length ? '' : icon('i-chevron', 'stop-row-chevron')
  );
  if (isFavorite) button.append(el('span', { class: 'visually-hidden' }, ' (nei preferiti)'));

  return el('li', { class: 'stop-item' }, button, ...trailing);
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

function link(href, text) {
  return el('a', { href }, text);
}

/* ---------------------------------------------------------------- azioni */

function toggleFavorite(stop) {
  const { value, saved } = favorites.toggle(stop);
  if (!saved) {
    showToast('Impossibile salvare: la memoria del browser non è disponibile (navigazione privata?).', 6000);
  } else {
    showToast(value ? 'Fermata salvata nei preferiti' : 'Fermata rimossa dai preferiti');
  }
  rerenderCurrentView();
  const button = dom.sheetBody.querySelector('[data-action="toggle-favorite"]');
  button?.focus();
}

async function shareStop(stop) {
  const url = new URL(SITE_URL);
  url.searchParams.set('fermata', stop.id);
  const data = { title: `Fermata ${stop.name} – Quando Passa`, url: url.href };

  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url.href);
    showToast('Link della fermata copiato');
  } catch {
    showToast(`Link della fermata: ${url.href}`, 8000);
  }
}

function updateFavoritesCount() {
  const count = state.stops.filter(favorites.has).length;
  dom.favoritesCount.hidden = count === 0;
  dom.favoritesCount.textContent = String(count);
  dom.favoritesButton.setAttribute('aria-label', count ? `Preferiti, ${count} ${count === 1 ? 'fermata' : 'fermate'}` : 'Preferiti');
}

function updateUrl(stop) {
  const url = new URL(window.location.href);
  url.searchParams.delete('q');
  if (stop) url.searchParams.set('fermata', stop.id);
  else url.searchParams.delete('fermata');
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

/* ---------------------------------------------------------------- posizione */

async function locateUser() {
  if (state.locating) return;
  if (!('geolocation' in navigator)) {
    showToast('Il tuo browser non supporta la geolocalizzazione. Cerca la fermata per nome.', 6000);
    return;
  }
  await stopsLoaded;
  if (!state.stops.length) return;

  setLocating(true);
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      setLocating(false);
      state.userPosition = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
      mapApi?.setUserLocation(state.userPosition);
      openView({ type: 'nearby' }, { reset: true, trigger: dom.nearbyButton });
      const nearest = nearestStops(state.stops, state.userPosition, NEARBY_LIMIT);
      if (nearest.length) mapApi?.setSelected(nearest[0].stop);
      mapApi?.fit([state.userPosition, ...nearest.slice(0, 4).map(entry => entry.stop)], {
        padding: mapPadding(),
        maxZoom: 17
      });
    },
    error => {
      setLocating(false);
      const messages = {
        1: 'Accesso alla posizione negato. Puoi attivarlo dalle impostazioni del browser o cercare la fermata per nome.',
        2: 'Posizione non disponibile. Verifica che il GPS sia attivo e riprova.',
        3: 'La ricerca della posizione ha impiegato troppo tempo. Riprova.'
      };
      showToast(messages[error.code] || messages[2], 7000);
    },
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 12000 }
  );
}

function setLocating(value) {
  state.locating = value;
  dom.nearbyButton.classList.toggle('is-loading', value);
  dom.nearbyButton.setAttribute('aria-busy', String(value));
  dom.nearbyButton.querySelector('span').textContent = value ? 'Cerco la posizione…' : 'Fermate vicine';
}

function clearLocation() {
  state.userPosition = null;
  mapApi?.setUserLocation(null);
}

/* ---------------------------------------------------------------- tema, toast, SW */

function initTheme() {
  if (!sun) return;
  const apply = () => {
    const dark = sun.isNight(new Date());
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1a1f' : '#faf8f5');
    mapApi?.setTheme(dark);
  };
  const schedule = () => {
    window.setTimeout(() => {
      apply();
      schedule();
    }, sun.msUntilNextSunEvent(new Date()));
  };
  apply();
  schedule();
}

function showToast(message, timeout = 3200) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => dom.toast.classList.remove('is-visible'), timeout);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

function debounce(callback, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

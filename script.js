document.addEventListener('DOMContentLoaded', () => {
  const FAVORITES_KEY = 'favorites';
  const MAX_SUGGESTIONS = 12;
  const LOCATION_FOCUS_ZOOM = 15;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MESSINA_COORDS = { lat: 38.1938, lon: 15.5540 };
  const ZONE_LABELS = { nord: 'Nord', centro: 'Centro', sud: 'Sud' };
  const ZONE_ORDER = ['nord', 'centro', 'sud'];

  const dom = {
    input: document.getElementById('searchInput'),
    clearSearch: document.getElementById('clearSearch'),
    suggestions: document.getElementById('suggestions'),
    locateBtn: document.getElementById('locateBtn'),
    infoBox: document.getElementById('nearestStop'),
    favoritesBtn: document.getElementById('open-favorites'),
    favoritesPopup: document.getElementById('favorites-popup'),
    closeFavorites: document.getElementById('close-favorites'),
    favoritesList: document.getElementById('favorites-list'),
    favoritesSummary: document.getElementById('favorites-summary'),
    clearFavorites: document.getElementById('clear-favorites'),
    mapStatus: document.getElementById('mapStatus')
  };

  let statusTimer = null;
  let searchTimer = null;
  let solarThemeTimer = null;
  let locationVisible = false;
  let locationLoading = false;
  let userMarker = null;
  let accuracyCircle = null;
  let nearestStopHighlight = null;
  let lastUserLatLng = null;
  let activeNearbyStopId = null;

  let stops = [];
  const stopsById = new Map();
  const stopsByLegacyId = new Map();
  const usedStopIds = new Set();
  const favorites = readFavoriteSet();

  syncViewportHeight();

  function setStatus(message, timeout = 2200) {
    window.clearTimeout(statusTimer);
    dom.mapStatus.textContent = message || '';
    dom.mapStatus.classList.toggle('is-visible', Boolean(message));

    if (message && timeout > 0) {
      statusTimer = window.setTimeout(() => setStatus(''), timeout);
    }
  }

  if (!window.L || !L.markerClusterGroup) {
    setStatus('Impossibile caricare la mappa. Controlla la connessione.', 6000);
    return;
  }

  const baseLayer = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      className: 'map-tiles',
      maxZoom: 19
    }
  );

  const initialCenter = [38.1938, 15.5540];
  const defaultStopIcon = new L.Icon.Default();
  const favoriteStopIcon = L.divIcon({
    className: 'favorite-stop-marker',
    html: '<span aria-hidden="true"></span>',
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    popupAnchor: [0, -38]
  });
  const initialDark = shouldUseDarkTheme(new Date());

  document.body.classList.toggle('dark', Boolean(initialDark));

  const map = L.map('map', {
    center: initialCenter,
    zoom: 13,
    preferCanvas: true,
    zoomControl: false,
    attributionControl: false
  });

  L.control.attribution({ position: 'bottomleft', prefix: 'Leaflet' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.addLayer(baseLayer);

  const markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 80,
    chunkDelay: 30,
    disableClusteringAtZoom: 18,
    showCoverageOnHover: false,
    maxClusterRadius: zoom => (zoom < 14 ? 64 : 40),
    iconCreateFunction: cluster => {
      const childMarkers = cluster.getAllChildMarkers();
      const hasFavorite = childMarkers.some(marker => marker.stop && isFavoriteStop(marker.stop));
      const count = cluster.getChildCount();
      const size = count < 10 ? 'small' : count < 100 ? 'medium' : 'large';

      return L.divIcon({
        html: `<div><span>${count}</span></div>`,
        className: `marker-cluster marker-cluster-${size}${hasFavorite ? ' marker-cluster-favorite' : ''}`,
        iconSize: L.point(40, 40)
      });
    }
  });
  map.addLayer(markerCluster);
  queueMapResize();

  applyTheme(Boolean(initialDark));
  scheduleSolarThemeSync();
  loadStops();

  dom.input.addEventListener('input', () => {
    dom.clearSearch.hidden = dom.input.value.length === 0;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => applyFilters({ fit: true }), 120);
  });

  dom.input.addEventListener('focus', () => {
    const query = normalize(dom.input.value.trim());
    if (query) renderSuggestions(query, getFilteredStops(query));
  });

  dom.clearSearch.addEventListener('click', () => {
    dom.input.value = '';
    dom.clearSearch.hidden = true;
    closeSuggestions();
    applyFilters();
    dom.input.focus();
  });

  dom.locateBtn.addEventListener('click', locateUser);
  dom.favoritesBtn.addEventListener('click', openFavoritesPopup);
  dom.closeFavorites.addEventListener('click', closeFavoritesPopup);
  dom.clearFavorites.addEventListener('click', clearAllFavorites);

  dom.favoritesPopup.addEventListener('click', event => {
    if (event.target === dom.favoritesPopup) closeFavoritesPopup();
  });

  document.addEventListener('click', event => {
    const star = event.target.closest('.popup-star');
    if (star) {
      const stop = getStopFromTrigger(star);
      if (stop) {
        const isNowFavorite = toggleFavorite(stop);
        star.classList.add('animate');
        star.addEventListener('animationend', () => star.classList.remove('animate'), { once: true });
        setStatus(isNowFavorite ? 'Aggiunta ai preferiti' : 'Rimossa dai preferiti');
      }
      return;
    }

    const openButton = event.target.closest('[data-open-stop]');
    if (openButton) {
      const stop = stopsById.get(openButton.dataset.openStop);
      if (stop) {
        if (openButton.closest('#nearestStop')) {
          selectNearbyStop(stop);
          return;
        }

        if (openButton.closest('#suggestions')) {
          dom.input.value = stop.name;
          dom.clearSearch.hidden = false;
          closeSuggestions();
        }
        if (openButton.closest('#favorites-popup')) closeFavoritesPopup();
        openStop(stop);
      }
      return;
    }

    if (event.target.closest('[data-close-nearest]')) {
      clearLocation();
      return;
    }

    if (!event.target.closest('.top-bar') && !event.target.closest('#suggestions')) {
      closeSuggestions();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeSuggestions();
    if (dom.favoritesPopup.classList.contains('is-open')) closeFavoritesPopup();
    if (dom.infoBox.classList.contains('is-open')) clearLocation();
  });

  window.addEventListener('resize', debounce(() => {
    syncViewportHeight();
    queueMapResize();
  }, 180));
  window.visualViewport?.addEventListener('resize', debounce(() => {
    syncViewportHeight();
    queueMapResize();
  }, 120));
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => {
      syncViewportHeight();
      queueMapResize();
    }, 250);
  });

  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  function loadStops() {
    setStatus('Carico fermate...', 0);

    fetch('./stops_fixed.json')
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Il file fermate non contiene una lista valida');

        stops = data
          .map(enrichStop)
          .filter(Boolean);

        const markers = stops.map(createMarker);
        markerCluster.addLayers(markers);
        applyFilters();
        queueMapResize();
        setStatus(`${stops.length.toLocaleString('it-IT')} fermate caricate`);
      })
      .catch(error => {
        console.error(error);
        setStatus('Errore nel caricamento delle fermate.', 6000);
      });
  }

  function enrichStop(stop, index) {
    if (!stop || !stop.name) return null;

    const lat = Number(stop.lat);
    const lon = Number(stop.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const code = extractStopCode(stop.url);
    const baseId = code ? `palina-${code}` : `idx-${index}`;
    const id = makeUniqueStopId(baseId);
    const name = String(stop.name).trim();

    return {
      ...stop,
      id,
      legacyId: index,
      code,
      name,
      lat,
      lon,
      url: String(stop.url || ''),
      zone: getZone(stop, lat),
      normalizedName: normalize(name)
    };
  }

  function createMarker(stop) {
    const marker = L.marker([stop.lat, stop.lon], {
      title: stop.name,
      keyboard: true,
      icon: isFavoriteStop(stop) ? favoriteStopIcon : defaultStopIcon
    });

    marker.bindPopup(() => buildPopupHtml(stop), {
      maxWidth: 340
    });

    stop.marker = marker;
    marker.stop = stop;
    stopsById.set(stop.id, stop);
    stopsByLegacyId.set(String(stop.legacyId), stop);
    return marker;
  }

  function applyFilters({ fit = false } = {}) {
    if (!stops.length) return;

    const query = normalize(dom.input.value.trim());
    const filteredStops = getFilteredStops(query);

    markerCluster.clearLayers();
    if (filteredStops.length) {
      markerCluster.addLayers(filteredStops.map(stop => stop.marker));
    }

    renderSuggestions(query, filteredStops);

    if (fit && query.length >= 2 && filteredStops.length > 0 && filteredStops.length <= 250) {
      const bounds = L.latLngBounds(filteredStops.map(stop => [stop.lat, stop.lon])).pad(0.18);
      map.fitBounds(bounds, { maxZoom: 16, animate: true });
    }

    if (query && filteredStops.length === 0) {
      setStatus('Nessuna fermata trovata');
    }
  }

  function getFilteredStops(query) {
    const activeQuery = query || '';
    const filtered = stops.filter(stop => {
      return !activeQuery || stop.normalizedName.includes(activeQuery);
    });

    if (!activeQuery) {
      return filtered.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    }

    return filtered.sort((a, b) => compareSearchResult(a, b, activeQuery));
  }

  function renderSuggestions(query, results) {
    dom.suggestions.replaceChildren();

    if (!query) {
      closeSuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    const meta = document.createElement('div');
    meta.className = results.length ? 'suggestions-meta' : 'empty-state';
    meta.textContent = results.length === 1 ? '1 risultato' : `${results.length} risultati`;
    fragment.appendChild(meta);

    results.slice(0, MAX_SUGGESTIONS).forEach(stop => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion-item';
      button.dataset.openStop = stop.id;
      button.setAttribute('role', 'option');

      const name = document.createElement('span');
      name.className = 'suggestion-name';
      name.textContent = stop.name;

      const extra = document.createElement('span');
      extra.className = 'suggestion-extra';
      extra.textContent = getSuggestionMeta(stop);

      button.append(name, extra);
      fragment.appendChild(button);
    });

    dom.suggestions.appendChild(fragment);
    dom.suggestions.classList.add('is-open');
  }

  function closeSuggestions() {
    dom.suggestions.classList.remove('is-open');
    dom.suggestions.replaceChildren();
  }

  function locateUser() {
    if (locationVisible || locationLoading) {
      clearLocation();
      return;
    }

    if (!stops.length) {
      setStatus('Le fermate sono ancora in caricamento.');
      return;
    }

    if (!navigator.geolocation) {
      setStatus('Geolocalizzazione non supportata.', 4200);
      return;
    }

    locationLoading = true;
    updateLocateButton();
    setStatus('Cerco la tua posizione...', 0);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => handlePosition(coords),
      handleLocationError,
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 10000
      }
    );
  }

  function handlePosition(coords) {
    const { latitude, longitude, accuracy } = coords;
    const userLatLng = [latitude, longitude];
    const nearestStops = getNearestStops(userLatLng, 6);

    lastUserLatLng = userLatLng;
    locationLoading = false;
    locationVisible = true;
    updateLocateButton();
    setStatus('Fermata più vicina trovata');

    if (!userMarker) {
      userMarker = L.circleMarker(userLatLng, {
        radius: 8,
        color: '#ffffff',
        fillColor: '#2563eb',
        fillOpacity: 1,
        weight: 3,
        interactive: false
      }).addTo(map);
    } else {
      userMarker.setLatLng(userLatLng);
    }

    const radius = Math.max(Number(accuracy) || 0, 40);
    if (!accuracyCircle) {
      accuracyCircle = L.circle(userLatLng, {
        radius,
        color: '#2563eb',
        opacity: 0.4,
        fillColor: '#2563eb',
        fillOpacity: 0.15,
        weight: 1,
        interactive: false,
        className: 'leaflet-user-circle'
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(userLatLng);
      accuracyCircle.setRadius(radius);
    }

    if (nearestStops.length) {
      const nearest = nearestStops[0].stop;
      activeNearbyStopId = nearest.id;
      renderNearestPanel(nearestStops, radius);
      updateNearestStopHighlight(nearest);
      focusNearestStopArea(nearest);
      renderSuggestions(normalize(dom.input.value.trim()), getFilteredStops(normalize(dom.input.value.trim())));
    }
  }

  function focusNearestStopArea(stop) {
    const focusPoint = map.project([stop.lat, stop.lon], LOCATION_FOCUS_ZOOM);
    const offset = getNearestPanelOffset();
    const adjustedCenter = map.unproject(focusPoint.add([0, offset]), LOCATION_FOCUS_ZOOM);
    map.setView(adjustedCenter, LOCATION_FOCUS_ZOOM, { animate: true });
  }

  function getNearestPanelOffset() {
    const panelHeight = dom.infoBox.getBoundingClientRect().height || 0;
    const mapHeight = map.getSize().y || window.innerHeight;
    const mobileOffset = Math.min(mapHeight * 0.22, Math.max(105, panelHeight * 0.36));
    const desktopOffset = Math.min(120, Math.max(60, panelHeight * 0.24));
    return window.matchMedia?.('(max-width: 640px)').matches ? mobileOffset : desktopOffset;
  }

  function handleLocationError(error) {
    locationLoading = false;
    locationVisible = false;
    updateLocateButton();

    const message = error.code === error.PERMISSION_DENIED
      ? 'Permesso posizione negato.'
      : 'Posizione non disponibile.';
    setStatus(message, 4200);
  }

  function clearLocation() {
    locationLoading = false;
    locationVisible = false;
    activeNearbyStopId = null;
    lastUserLatLng = null;
    updateLocateButton();
    dom.infoBox.classList.remove('is-open');
    dom.infoBox.replaceChildren();

    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }

    if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }

    if (nearestStopHighlight) {
      map.removeLayer(nearestStopHighlight);
      nearestStopHighlight = null;
    }
  }

  function updateNearestStopHighlight(stop) {
    const latLng = [stop.lat, stop.lon];

    if (!nearestStopHighlight) {
      nearestStopHighlight = L.circleMarker(latLng, {
        radius: 10,
        color: '#ffffff',
        fillColor: '#dc2626',
        fillOpacity: 1,
        weight: 3,
        interactive: false,
        className: 'nearest-stop-highlight'
      }).addTo(map);
      return;
    }

    nearestStopHighlight.setLatLng(latLng);
  }

  function selectNearbyStop(stop) {
    activeNearbyStopId = stop.id;
    map.closePopup();
    updateNearestStopHighlight(stop);
    focusNearestStopArea(stop);
    updateNearbySelection();
  }

  function updateNearbySelection() {
    dom.infoBox.querySelectorAll('[data-open-stop]').forEach(button => {
      const selected = button.dataset.openStop === activeNearbyStopId;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-current', selected ? 'true' : 'false');
    });
  }

  function syncViewportHeight() {
    const viewportWidth = Math.max(
      window.innerWidth || 0,
      window.visualViewport?.width || 0,
      document.documentElement.clientWidth || 0
    );
    const viewportHeight = Math.max(
      window.innerHeight || 0,
      window.visualViewport?.height || 0,
      document.documentElement.clientHeight || 0
    );
    const width = Math.ceil(viewportWidth);
    const height = Math.ceil(viewportHeight);

    document.documentElement.style.setProperty('--app-width', `${width}px`);
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  function queueMapResize() {
    syncViewportHeight();
    window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      window.setTimeout(() => map.invalidateSize({ pan: false }), 150);
    });
  }

  function renderNearestPanel(nearestStops, accuracy) {
    const nearest = nearestStops[0];
    const stop = nearest.stop;
    const otherRows = nearestStops
      .slice(1)
      .map(entry => {
        const rowStop = entry.stop;
        const selected = rowStop.id === activeNearbyStopId;
        return `
          <button type="button" class="nearest-row ${selected ? 'is-selected' : ''}" data-open-stop="${escapeHtml(rowStop.id)}" aria-current="${selected}">
            <span>${escapeHtml(rowStop.name)}</span>
            <strong>${formatDistance(entry.distance)}</strong>
          </button>
        `;
      })
      .join('');

    dom.infoBox.innerHTML = `
      <div class="nearest-header">
        <div>
          <p class="nearest-kicker">Fermata più vicina</p>
          <strong>${escapeHtml(stop.name)}</strong>
        </div>
        <div class="nearest-header-actions">
          ${favoriteButtonHtml(stop)}
          <button type="button" class="mini-close" data-close-nearest aria-label="Chiudi fermata più vicina">&times;</button>
        </div>
      </div>
      <button type="button" class="nearest-main ${stop.id === activeNearbyStopId ? 'is-selected' : ''}" data-open-stop="${escapeHtml(stop.id)}" aria-current="${stop.id === activeNearbyStopId}">
        <strong>${formatDistance(nearest.distance)} da te</strong>
        <span>Accuratezza posizione ${formatDistance(accuracy)}</span>
      </button>
      <div class="popup-actions">
        ${detailsLinkHtml(stop)}
        ${mapsLinkHtml(stop)}
      </div>
      ${otherRows ? `<p class="nearby-list-title">Altre fermate vicine</p><div class="nearby-list">${otherRows}</div>` : ''}
    `;
    dom.infoBox.classList.add('is-open');
  }

  function getNearestStops(userLatLng, limit) {
    return stops
      .map(stop => ({
        stop,
        distance: map.distance([stop.lat, stop.lon], userLatLng)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  function openFavoritesPopup() {
    renderFavoritesList();
    dom.favoritesPopup.classList.add('is-open');
    dom.favoritesPopup.setAttribute('aria-hidden', 'false');
    dom.closeFavorites.focus();
  }

  function closeFavoritesPopup() {
    dom.favoritesPopup.classList.remove('is-open');
    dom.favoritesPopup.setAttribute('aria-hidden', 'true');
  }

  function renderFavoritesList() {
    const favoriteStops = stops
      .filter(isFavoriteStop)
      .sort((a, b) => {
        const zoneDiff = ZONE_ORDER.indexOf(a.zone) - ZONE_ORDER.indexOf(b.zone);
        return zoneDiff || a.name.localeCompare(b.name, 'it');
      });

    dom.favoritesList.replaceChildren();
    dom.favoritesSummary.textContent = favoriteStops.length === 1
      ? '1 fermata salvata'
      : `${favoriteStops.length} fermate salvate`;
    dom.clearFavorites.hidden = favoriteStops.length === 0;

    if (!favoriteStops.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Nessuna fermata preferita.';
      dom.favoritesList.appendChild(empty);
      return;
    }

    const grouped = groupByZone(favoriteStops);
    ZONE_ORDER.forEach(zone => {
      if (!grouped[zone]?.length) return;

      const section = document.createElement('section');
      section.className = 'favorites-zone';

      const title = document.createElement('h3');
      title.textContent = ZONE_LABELS[zone];
      section.appendChild(title);

      grouped[zone].forEach(stop => {
        const row = document.createElement('div');
        row.className = 'favorite-row';

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'favorite-main';
        main.dataset.openStop = stop.id;

        const name = document.createElement('strong');
        name.textContent = stop.name;

        const meta = document.createElement('span');
        meta.textContent = ZONE_LABELS[stop.zone];

        main.append(name, meta);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-fav';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Rimuovi ${stop.name} dai preferiti`);
        remove.addEventListener('click', event => {
          event.stopPropagation();
          setFavorite(stop, false);
          refreshFavoriteElements(stop);
          renderFavoritesList();
          applyFilters();
          setStatus('Rimossa dai preferiti');
        });

        row.append(main, remove);
        section.appendChild(row);
      });

      dom.favoritesList.appendChild(section);
    });
  }

  function clearAllFavorites() {
    favorites.clear();
    saveFavorites();
    refreshAllFavoriteElements();
    renderFavoritesList();
    applyFilters();
    setStatus('Preferiti svuotati');
  }

  function toggleFavorite(stop) {
    const shouldFavorite = !isFavoriteStop(stop);
    setFavorite(stop, shouldFavorite);
    refreshFavoriteElements(stop);
    if (dom.favoritesPopup.classList.contains('is-open')) renderFavoritesList();
    if (dom.input.value.trim()) {
      renderSuggestions(normalize(dom.input.value.trim()), getFilteredStops(normalize(dom.input.value.trim())));
    }
    return shouldFavorite;
  }

  function setFavorite(stop, shouldFavorite) {
    favorites.delete(String(stop.legacyId));
    favorites.delete(String(stop.id));
    if (shouldFavorite) favorites.add(String(stop.id));
    saveFavorites();
  }

  function isFavoriteStop(stop) {
    return favorites.has(String(stop.id)) || favorites.has(String(stop.legacyId));
  }

  function refreshFavoriteElements(stop) {
    const active = isFavoriteStop(stop);
    refreshFavoriteMarker(stop);
    document.querySelectorAll('.popup-star').forEach(element => {
      if (element.dataset.id !== String(stop.id) && element.dataset.legacyId !== String(stop.legacyId)) return;
      element.classList.toggle('fav-on', active);
      element.classList.toggle('fav-off', !active);
      element.setAttribute('aria-pressed', String(active));
      element.setAttribute('aria-label', active ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti');
    });
  }

  function refreshAllFavoriteElements() {
    stops.forEach(refreshFavoriteElements);
  }

  function refreshFavoriteMarker(stop) {
    if (!stop.marker) return;
    stop.marker.setIcon(isFavoriteStop(stop) ? favoriteStopIcon : defaultStopIcon);
    markerCluster.refreshClusters?.();
  }

  function updateLocateButton() {
    dom.locateBtn.classList.toggle('active', locationVisible);
    dom.locateBtn.classList.toggle('loading', locationLoading);
    dom.locateBtn.setAttribute('aria-pressed', String(locationVisible));
    dom.locateBtn.textContent = locationLoading ? '📡' : '📍';
  }

  function applyTheme(isDark) {
    document.body.classList.toggle('dark', isDark);

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', isDark ? '#101820' : '#003366');
  }

  function buildPopupHtml(stop) {
    return `
      <div class="stop-popup">
        <div class="popup-title">
          <strong>${escapeHtml(stop.name)}</strong>
          ${favoriteButtonHtml(stop)}
        </div>
        <div class="popup-actions">
          ${detailsLinkHtml(stop)}
          ${mapsLinkHtml(stop)}
        </div>
      </div>
    `;
  }

  function favoriteButtonHtml(stop) {
    const active = isFavoriteStop(stop);
    return `
      <button
        type="button"
        class="popup-star ${active ? 'fav-on' : 'fav-off'}"
        data-id="${escapeHtml(stop.id)}"
        data-legacy-id="${escapeHtml(stop.legacyId)}"
        aria-pressed="${active}"
        aria-label="${active ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}"
        title="${active ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}"
      >★</button>
    `;
  }

  function detailsLinkHtml(stop) {
    if (!stop.url) return '';
    return `<a href="${escapeHtml(stop.url)}" target="_blank" rel="noopener noreferrer" class="popup-link">Dettagli</a>`;
  }

  function mapsLinkHtml(stop) {
    const destination = encodeURIComponent(`${stop.lat},${stop.lon}`);
    return `<a href="https://www.google.com/maps/dir/?api=1&destination=${destination}" target="_blank" rel="noopener noreferrer" class="popup-link">Percorso</a>`;
  }

  function getSuggestionMeta(stop) {
    const bits = [];
    if (isFavoriteStop(stop)) bits.push('★');
    if (lastUserLatLng) bits.push(formatDistance(map.distance([stop.lat, stop.lon], lastUserLatLng)));
    if (!bits.length) bits.push(ZONE_LABELS[stop.zone]);
    return bits.join(' · ');
  }

  function compareSearchResult(a, b, query) {
    const favoriteDiff = Number(isFavoriteStop(b)) - Number(isFavoriteStop(a));
    if (favoriteDiff) return favoriteDiff;

    const aStarts = a.normalizedName.startsWith(query);
    const bStarts = b.normalizedName.startsWith(query);
    if (aStarts !== bStarts) return Number(bStarts) - Number(aStarts);

    const indexDiff = a.normalizedName.indexOf(query) - b.normalizedName.indexOf(query);
    if (indexDiff) return indexDiff;

    if (lastUserLatLng) {
      const distanceDiff = map.distance([a.lat, a.lon], lastUserLatLng) -
        map.distance([b.lat, b.lon], lastUserLatLng);
      if (distanceDiff) return distanceDiff;
    }

    return a.name.localeCompare(b.name, 'it');
  }

  function openStop(stop) {
    if (!markerCluster.hasLayer(stop.marker)) {
      markerCluster.addLayer(stop.marker);
    }

    let popupOpened = false;
    const showPopup = () => {
      if (popupOpened) return;
      popupOpened = true;
      L.popup({ maxWidth: 340 })
        .setLatLng([stop.lat, stop.lon])
        .setContent(buildPopupHtml(stop))
        .openOn(map);
    };

    map.once('moveend', showPopup);
    map.setView(stop.marker.getLatLng(), 18, { animate: true });
    window.setTimeout(showPopup, 450);
  }

  function getStopFromTrigger(element) {
    return stopsById.get(element.dataset.id) ||
      stopsByLegacyId.get(String(element.dataset.legacyId));
  }

  function groupByZone(items) {
    return items.reduce((groups, stop) => {
      const zone = stop.zone || 'centro';
      groups[zone] = groups[zone] || [];
      groups[zone].push(stop);
      return groups;
    }, {});
  }

  function getZone(stop, lat) {
    const rawZone = normalize(stop.zone || '');
    if (rawZone.includes('nord')) return 'nord';
    if (rawZone.includes('sud')) return 'sud';
    if (rawZone.includes('centro')) return 'centro';
    if (lat >= 38.215) return 'nord';
    if (lat <= 38.175) return 'sud';
    return 'centro';
  }

  function extractStopCode(url) {
    const match = String(url || '').match(/[?&]palina=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function makeUniqueStopId(baseId) {
    let id = baseId;
    let suffix = 2;
    while (usedStopIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedStopIds.add(id);
    return id;
  }

  function formatDistance(distance) {
    if (!Number.isFinite(distance)) return '';
    if (distance < 1000) return `${Math.round(distance)} m`;
    return `${(distance / 1000).toFixed(distance < 10000 ? 1 : 0)} km`;
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

  function readFavoriteSet() {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return new Set(Array.isArray(stored) ? stored.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    } catch {
      setStatus('Preferiti non salvati: memoria locale non disponibile.', 4200);
    }
  }

  function scheduleSolarThemeSync() {
    window.clearTimeout(solarThemeTimer);

    const now = new Date();
    const { sunrise, sunset } = getSunTimes(now, MESSINA_COORDS.lat, MESSINA_COORDS.lon);
    const tomorrow = new Date(now.getTime() + DAY_MS);
    const nextSunrise = getSunTimes(tomorrow, MESSINA_COORDS.lat, MESSINA_COORDS.lon).sunrise;
    const nextChange = now < sunrise ? sunrise : now < sunset ? sunset : nextSunrise;
    const delay = Math.max(60000, Math.min(nextChange.getTime() - now.getTime() + 1000, DAY_MS));

    solarThemeTimer = window.setTimeout(() => {
      applyTheme(shouldUseDarkTheme(new Date()));
      scheduleSolarThemeSync();
    }, delay);
  }

  function shouldUseDarkTheme(date) {
    const { sunrise, sunset } = getSunTimes(date, MESSINA_COORDS.lat, MESSINA_COORDS.lon);
    return date < sunrise || date >= sunset;
  }

  function getSunTimes(date, latitude, longitude) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return {
      sunrise: calculateSunEvent(day, latitude, longitude, true),
      sunset: calculateSunEvent(day, latitude, longitude, false)
    };
  }

  function calculateSunEvent(day, latitude, longitude, isSunrise) {
    const zenith = 90.833;
    const dayOfYear = getDayOfYear(day);
    const lngHour = longitude / 15;
    const approxTime = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const meanAnomaly = (0.9856 * approxTime) - 3.289;
    const trueLongitude = normalizeDegrees(
      meanAnomaly +
      (1.916 * Math.sin(degToRad(meanAnomaly))) +
      (0.020 * Math.sin(2 * degToRad(meanAnomaly))) +
      282.634
    );
    const rightAscensionBase = radToDeg(Math.atan(0.91764 * Math.tan(degToRad(trueLongitude))));
    const rightAscension = (
      normalizeDegrees(rightAscensionBase) +
      (Math.floor(trueLongitude / 90) * 90) -
      (Math.floor(normalizeDegrees(rightAscensionBase) / 90) * 90)
    ) / 15;
    const sinDeclination = 0.39782 * Math.sin(degToRad(trueLongitude));
    const cosDeclination = Math.cos(Math.asin(sinDeclination));
    const cosHourAngle = (
      Math.cos(degToRad(zenith)) -
      (sinDeclination * Math.sin(degToRad(latitude)))
    ) / (cosDeclination * Math.cos(degToRad(latitude)));
    const safeCosHourAngle = Math.min(1, Math.max(-1, cosHourAngle));

    const hourAngleDegrees = isSunrise
      ? 360 - radToDeg(Math.acos(safeCosHourAngle))
      : radToDeg(Math.acos(safeCosHourAngle));
    const localMeanTime = (hourAngleDegrees / 15) + rightAscension - (0.06571 * approxTime) - 6.622;
    const utcHour = normalizeHours(localMeanTime - lngHour);

    return new Date(Date.UTC(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      0,
      Math.round(utcHour * 60)
    ));
  }

  function getDayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / (24 * 60 * 60 * 1000));
  }

  function degToRad(degrees) {
    return degrees * Math.PI / 180;
  }

  function radToDeg(radians) {
    return radians * 180 / Math.PI;
  }

  function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
  }

  function normalizeHours(hours) {
    return ((hours % 24) + 24) % 24;
  }

  function debounce(callback, wait) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback(...args), wait);
    };
  }
});

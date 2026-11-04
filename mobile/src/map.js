// Mappa vettoriale MapLibre GL JS (stessa libreria del sito) con cartografia
// OpenFreeMap / OpenStreetMap. Il modulo è caricato on demand dopo il primo
// rendering dell'interfaccia, così l'avvio resta immediato.
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Su iOS la WebView usa lo schema capacitor:// e MapLibre non riesce a
// ricavare da solo l'indirizzo del worker: lo indichiamo esplicitamente.
maplibregl.setWorkerUrl(new URL(workerUrl, window.location.href).href);

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark'
};
export const MESSINA_CENTER = { lon: 15.554, lat: 38.1938, zoom: 12.4 };

const PALETTE = {
  light: {
    stop: '#1f5563', stopStroke: '#ffffff', cluster: '#1f5563', clusterText: '#ffffff',
    favorite: '#f2b705', favoriteText: '#3b2b00', selected: '#d9472b',
    user: '#2563eb', label: '#1f3b45', labelHalo: '#ffffff'
  },
  dark: {
    stop: '#7fd1e0', stopStroke: '#0f1a1f', cluster: '#2c6b7a', clusterText: '#ffffff',
    favorite: '#ffd04f', favoriteText: '#2b2000', selected: '#ff7a5c',
    user: '#60a5fa', label: '#e6eef0', labelHalo: '#0f1a1f'
  }
};

export function isMapSupported() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createMap({ container, dark, camera, padding, onStopSelect, onMapTap, onStyleError, onStyleReady, onMove }) {
  let theme = dark ? 'dark' : 'light';
  let stopsData = emptyCollection();
  let selectedData = emptyCollection();
  let userData = emptyCollection();
  let accuracyData = emptyCollection();
  let styleReady = false;
  const pending = [];

  const start = camera || MESSINA_CENTER;
  const map = new maplibregl.Map({
    container,
    style: STYLES[theme],
    center: [start.lon, start.lat],
    zoom: start.zoom,
    minZoom: 9,
    maxZoom: 19,
    maxBounds: [[14.8, 37.7], [16.3, 38.7]],
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: false,
    validateStyle: false,
    refreshExpiredTiles: false,
    fadeDuration: 150,
    // Oltre 2x la differenza non si vede, ma costa GPU e batteria.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
  });
  if (padding) map.setPadding(padding);
  map.touchZoomRotate.disableRotation();

  const whenReady = action => {
    if (styleReady) action();
    else pending.push(action);
  };

  // 'style.load' scatta a ogni stile caricato (avvio, cambio tema, nuovo tentativo).
  map.on('style.load', () => {
    styleReady = true;
    addOwnLayers();
    bindInteractions();
    pending.splice(0).forEach(action => action());
    onStyleReady?.();
  });

  map.on('error', event => {
    // Le singole tessere che non arrivano non bloccano la mappa; ci interessa
    // solo il caso in cui lo stile non si carica (es. offline all'avvio).
    if (!map.isStyleLoaded() && !styleReady) onStyleError?.(event?.error);
  });

  map.on('moveend', () => onMove?.(getCamera()));

  function getCamera() {
    const center = map.getCenter();
    return { lon: center.lng, lat: center.lat, zoom: map.getZoom() };
  }

  function addOwnLayers() {
    Object.entries(ownSources()).forEach(([id, source]) => {
      if (!map.getSource(id)) map.addSource(id, source);
    });
    ownLayers(theme).forEach(layer => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    });
  }

  function ownSources() {
    return {
      'qp-stops': {
        type: 'geojson',
        data: stopsData,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 46,
        clusterProperties: { favs: ['+', ['get', 'f']] }
      },
      'qp-selected': { type: 'geojson', data: selectedData },
      'qp-user': { type: 'geojson', data: userData },
      'qp-accuracy': { type: 'geojson', data: accuracyData }
    };
  }

  let interactionsBound = false;
  function bindInteractions() {
    if (interactionsBound) return;
    interactionsBound = true;
    map.on('click', event => {
      // Area di tocco più ampia del punto disegnato (~44 pt).
      const { x, y } = event.point;
      const tolerance = 18;
      const layers = ['qp-clusters', 'qp-stops'].filter(id => map.getLayer(id));
      const features = layers.length ? map.queryRenderedFeatures(
        [[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]],
        { layers }
      ) : [];
      if (!features.length) {
        onMapTap?.();
        return;
      }
      const closest = features
        .map(feature => {
          const projected = map.project(feature.geometry.coordinates);
          return { feature, d: Math.hypot(projected.x - x, projected.y - y) };
        })
        .sort((a, b) => a.d - b.d)[0].feature;

      if (closest.properties.cluster) {
        map.getSource('qp-stops').getClusterExpansionZoom(closest.properties.cluster_id).then(zoom => {
          map.easeTo({ center: closest.geometry.coordinates, zoom: Math.min(zoom + 0.3, 18), duration: 450 });
        }).catch(() => {});
        return;
      }
      onStopSelect?.(Number(closest.properties.i));
    });
  }

  function loadStyle(nextTheme) {
    theme = nextTheme;
    map.setStyle(STYLES[theme], {
      transformStyle: (previous, style) => ({
        ...style,
        sources: { ...style.sources, ...ownSources() },
        layers: [...style.layers, ...ownLayers(theme)]
      })
    });
  }

  return {
    raw: map,
    get ready() {
      return styleReady;
    },
    getCamera,
    setTheme(nextDark) {
      const next = nextDark ? 'dark' : 'light';
      if (next === theme) return;
      if (!styleReady) {
        theme = next;
        return;
      }
      loadStyle(next);
    },
    // Dopo un errore di rete all'avvio: nuovo tentativo di caricare lo stile.
    retry() {
      if (styleReady) return;
      map.setStyle(STYLES[theme]);
    },
    resize(nextPadding) {
      map.resize();
      if (nextPadding) map.setPadding(nextPadding);
    },
    setPadding(nextPadding) {
      map.setPadding(nextPadding);
    },
    setStops(stops, isFavorite) {
      stopsData = {
        type: 'FeatureCollection',
        features: stops.map((stop, i) => ({
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          properties: { i, n: stop.label, f: isFavorite(stop) ? 1 : 0 }
        }))
      };
      whenReady(() => map.getSource('qp-stops')?.setData(stopsData));
    },
    setSelected(stop) {
      selectedData = stop ? pointCollection(stop.lon, stop.lat) : emptyCollection();
      whenReady(() => map.getSource('qp-selected')?.setData(selectedData));
    },
    setUserLocation(position) {
      if (!position) {
        userData = emptyCollection();
        accuracyData = emptyCollection();
      } else {
        userData = pointCollection(position.lon, position.lat);
        accuracyData = circlePolygon(position.lon, position.lat, Math.max(position.accuracy || 0, 15));
      }
      whenReady(() => {
        map.getSource('qp-user')?.setData(userData);
        map.getSource('qp-accuracy')?.setData(accuracyData);
      });
    },
    focus(point, { zoom = 17, padding } = {}) {
      map.easeTo({
        center: [point.lon, point.lat],
        zoom: Math.max(zoom, map.getZoom()),
        padding,
        duration: reducedMotion() ? 0 : 650
      });
    },
    fit(points, { padding, maxZoom = 17 } = {}) {
      if (!points.length) return;
      const bounds = new maplibregl.LngLatBounds();
      points.forEach(point => bounds.extend([point.lon, point.lat]));
      map.fitBounds(bounds, { padding, maxZoom, duration: reducedMotion() ? 0 : 650 });
    }
  };
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ownLayers(theme) {
  const c = PALETTE[theme];
  return [
    {
      id: 'qp-accuracy', type: 'fill', source: 'qp-accuracy',
      paint: { 'fill-color': c.user, 'fill-opacity': 0.12, 'fill-outline-color': c.user }
    },
    {
      id: 'qp-clusters', type: 'circle', source: 'qp-stops', filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['case', ['>', ['get', 'favs'], 0], c.favorite, c.cluster],
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 18, 50, 22, 150, 26],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': c.stopStroke,
        'circle-opacity': 0.95
      }
    },
    {
      id: 'qp-cluster-count', type: 'symbol', source: 'qp-stops', filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true
      },
      paint: { 'text-color': ['case', ['>', ['get', 'favs'], 0], c.favoriteText, c.clusterText] }
    },
    {
      id: 'qp-stops', type: 'circle', source: 'qp-stops', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'f'], 1], c.favorite, c.stop],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5.5, 16, 8, 19, 10.5],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': c.stopStroke
      }
    },
    {
      id: 'qp-stop-labels', type: 'symbol', source: 'qp-stops', minzoom: 16, filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'n'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true
      },
      paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.5 }
    },
    {
      id: 'qp-selected', type: 'circle', source: 'qp-selected',
      paint: { 'circle-color': c.selected, 'circle-radius': 12, 'circle-stroke-width': 3.5, 'circle-stroke-color': '#ffffff' }
    },
    {
      id: 'qp-user-halo', type: 'circle', source: 'qp-user',
      paint: { 'circle-color': c.user, 'circle-radius': 16, 'circle-opacity': 0.18 }
    },
    {
      id: 'qp-user', type: 'circle', source: 'qp-user',
      paint: { 'circle-color': c.user, 'circle-radius': 7.5, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' }
    }
  ];
}

function emptyCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function pointCollection(lon, lat) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }]
  };
}

function circlePolygon(lon, lat, radiusMeters, steps = 48) {
  const coordinates = [];
  const latRadius = radiusMeters / 111320;
  const lonRadius = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    coordinates.push([lon + lonRadius * Math.sin(angle), lat + latRadius * Math.cos(angle)]);
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coordinates] }, properties: {} }]
  };
}

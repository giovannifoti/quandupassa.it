// Mappa vettoriale MapLibre: caricata on demand per non bloccare l'interfaccia.

const MAPLIBRE_VERSION = '6.16.0';
const VENDOR = `/vendor/maplibre-gl-${MAPLIBRE_VERSION}`;
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark'
};
const MESSINA_CENTER = [15.554, 38.1938];
const LAYER_PREFIX = 'qp-';

const PALETTE = {
  light: {
    stop: '#1f5563',
    stopStroke: '#ffffff',
    cluster: '#1f5563',
    clusterText: '#ffffff',
    favorite: '#f2b705',
    favoriteText: '#3b2b00',
    selected: '#d9472b',
    user: '#2563eb',
    label: '#1f3b45',
    labelHalo: '#ffffff'
  },
  dark: {
    stop: '#7fd1e0',
    stopStroke: '#0f1a1f',
    cluster: '#2c6b7a',
    clusterText: '#ffffff',
    favorite: '#ffd04f',
    favoriteText: '#2b2000',
    selected: '#ff7a5c',
    user: '#60a5fa',
    label: '#e6eef0',
    labelHalo: '#0f1a1f'
  }
};

export async function createMap({ container, dark, padding, onStopSelect, onError }) {
  loadStylesheet(`${VENDOR}/maplibre-gl.css`);
  const maplibre = await import(`${VENDOR}/maplibre-gl.mjs`);

  let theme = dark ? 'dark' : 'light';
  let stopsData = emptyCollection();
  let selectedData = emptyCollection();
  let userData = emptyCollection();
  let accuracyData = emptyCollection();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  const map = new maplibre.Map({
    container,
    style: STYLES[theme],
    center: MESSINA_CENTER,
    zoom: 12.4,
    minZoom: 9,
    maxZoom: 19,
    maxBounds: [[14.8, 37.7], [16.3, 38.7]],
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    validateStyle: false
  });
  if (padding) map.setPadding(padding);
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    addOwnLayers();
    bindInteractions();
    readyResolve();
  });

  map.on('error', event => {
    // Errori di singole tile non sono bloccanti; segnaliamo solo lo stile.
    const message = String(event?.error?.message || '');
    if (/style/i.test(message) && !map.isStyleLoaded()) onError?.(event.error);
  });

  function addOwnLayers() {
    const sources = ownSources();
    Object.entries(sources).forEach(([id, source]) => {
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

  function bindInteractions() {
    const interactive = ['qp-clusters', 'qp-stops'];
    interactive.forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    map.on('click', event => {
      // Area di tocco più ampia del punto disegnato: più facile su smartphone.
      const { x, y } = event.point;
      const tolerance = 14;
      const features = map.queryRenderedFeatures(
        [[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]],
        { layers: interactive }
      );
      if (!features.length) return;

      const closest = features
        .map(feature => {
          const projected = map.project(feature.geometry.coordinates);
          return { feature, d: Math.hypot(projected.x - x, projected.y - y) };
        })
        .sort((a, b) => a.d - b.d)[0].feature;

      if (closest.properties.cluster) {
        const source = map.getSource('qp-stops');
        source.getClusterExpansionZoom(closest.properties.cluster_id).then(zoom => {
          map.easeTo({ center: closest.geometry.coordinates, zoom: Math.min(zoom + 0.3, 18) });
        }).catch(() => {});
        return;
      }
      onStopSelect?.(Number(closest.properties.i));
    });
  }

  function setTheme(nextDark) {
    const next = nextDark ? 'dark' : 'light';
    if (next === theme) return;
    theme = next;
    map.setStyle(STYLES[theme], {
      transformStyle: (previous, style) => ({
        ...style,
        sources: { ...style.sources, ...ownSources() },
        layers: [...style.layers, ...ownLayers(theme)]
      })
    });
  }

  return {
    ready,
    raw: map,
    setTheme,
    resize(padding) {
      map.resize();
      if (padding) map.setPadding(padding);
    },
    setStops(stops, isFavorite) {
      stopsData = {
        type: 'FeatureCollection',
        features: stops.map((stop, i) => ({
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
          properties: { i, n: stop.title, f: isFavorite(stop) ? 1 : 0 }
        }))
      };
      ready.then(() => map.getSource('qp-stops')?.setData(stopsData));
    },
    setSelected(stop) {
      selectedData = stop ? pointCollection(stop.lon, stop.lat) : emptyCollection();
      ready.then(() => map.getSource('qp-selected')?.setData(selectedData));
    },
    setUserLocation(position) {
      if (!position) {
        userData = emptyCollection();
        accuracyData = emptyCollection();
      } else {
        userData = pointCollection(position.lon, position.lat);
        accuracyData = circlePolygon(position.lon, position.lat, Math.max(position.accuracy || 0, 15));
      }
      ready.then(() => {
        map.getSource('qp-user')?.setData(userData);
        map.getSource('qp-accuracy')?.setData(accuracyData);
      });
    },
    focus(point, { zoom = 17, padding } = {}) {
      ready.then(() => {
        map.easeTo({
          center: [point.lon, point.lat],
          zoom: Math.max(zoom, map.getZoom()),
          padding,
          duration: 700
        });
      });
    },
    fit(points, { padding, maxZoom = 17 } = {}) {
      if (!points.length) return;
      const bounds = new maplibre.LngLatBounds();
      points.forEach(point => bounds.extend([point.lon, point.lat]));
      ready.then(() => map.fitBounds(bounds, { padding, maxZoom, duration: 700 }));
    }
  };
}

function ownLayers(theme) {
  const c = PALETTE[theme];
  return [
    {
      id: `${LAYER_PREFIX}accuracy`,
      type: 'fill',
      source: 'qp-accuracy',
      paint: { 'fill-color': c.user, 'fill-opacity': 0.12, 'fill-outline-color': c.user }
    },
    {
      id: `${LAYER_PREFIX}clusters`,
      type: 'circle',
      source: 'qp-stops',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['case', ['>', ['get', 'favs'], 0], c.favorite, c.cluster],
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 18, 50, 22, 150, 26],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': c.stopStroke,
        'circle-opacity': 0.95
      }
    },
    {
      id: `${LAYER_PREFIX}cluster-count`,
      type: 'symbol',
      source: 'qp-stops',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true
      },
      paint: {
        'text-color': ['case', ['>', ['get', 'favs'], 0], c.favoriteText, c.clusterText]
      }
    },
    {
      id: `${LAYER_PREFIX}stops`,
      type: 'circle',
      source: 'qp-stops',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'f'], 1], c.favorite, c.stop],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 7.5, 19, 10],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': c.stopStroke
      }
    },
    {
      id: `${LAYER_PREFIX}stop-labels`,
      type: 'symbol',
      source: 'qp-stops',
      minzoom: 16,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'n'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true
      },
      paint: {
        'text-color': c.label,
        'text-halo-color': c.labelHalo,
        'text-halo-width': 1.5
      }
    },
    {
      id: `${LAYER_PREFIX}selected`,
      type: 'circle',
      source: 'qp-selected',
      paint: {
        'circle-color': c.selected,
        'circle-radius': 11,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff'
      }
    },
    {
      id: `${LAYER_PREFIX}user`,
      type: 'circle',
      source: 'qp-user',
      paint: {
        'circle-color': c.user,
        'circle-radius': 8,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#ffffff'
      }
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

function loadStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

// Adattatori verso le funzioni del dispositivo (plugin Capacitor), con
// alternative web per lo sviluppo nel browser e per i test end-to-end.
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { isAllowedExternalUrl } from './logic.js';

export const isNative = Capacitor.isNativePlatform();
export const os = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

/* ------------------------------------------------------------- memoria locale */

// I plugin di memorizzazione sono asincroni, mentre la logica dei preferiti
// (condivisa con il sito) usa un'interfaccia sincrona tipo localStorage:
// carichiamo i valori all'avvio e scriviamo in background.
// Su iOS e Android i dati finiscono in UserDefaults / SharedPreferences,
// che il sistema non svuota come può fare con la memoria della WebView.
export async function createStore(keys) {
  const cache = new Map();
  await Promise.all(keys.map(async key => {
    try {
      const { value } = await Preferences.get({ key });
      if (value !== null && value !== undefined) cache.set(key, value);
    } catch (error) {
      console.warn('Lettura memoria non riuscita', key, error);
    }
  }));
  let failures = 0;
  const persist = (key, value) => {
    const operation = value === null ? Preferences.remove({ key }) : Preferences.set({ key, value });
    operation.catch(error => {
      failures += 1;
      console.warn('Salvataggio non riuscito', key, error);
    });
  };
  return {
    getItem: key => (cache.has(key) ? cache.get(key) : null),
    setItem(key, value) {
      cache.set(key, String(value));
      persist(key, String(value));
    },
    removeItem(key) {
      cache.delete(key);
      persist(key, null);
    },
    get failures() {
      return failures;
    }
  };
}

/* ------------------------------------------------------------- posizione */

const NATIVE_ERRORS = {
  'OS-PLUG-GLOC-0003': 'denied',
  'OS-PLUG-GLOC-0008': 'restricted',
  'OS-PLUG-GLOC-0007': 'disabled',
  'OS-PLUG-GLOC-0009': 'disabled',
  'OS-PLUG-GLOC-0017': 'disabled',
  'OS-PLUG-GLOC-0016': 'disabled',
  'OS-PLUG-GLOC-0010': 'timeout'
};

function reasonFrom(error) {
  if (!error) return 'unavailable';
  if (NATIVE_ERRORS[error.code]) return NATIVE_ERRORS[error.code];
  // GeolocationPositionError del browser
  if (error.code === 1) return 'denied';
  if (error.code === 3) return 'timeout';
  const message = String(error.message || '');
  if (/denied|permission/i.test(message)) return 'denied';
  if (/disabled|not enabled|services/i.test(message)) return 'disabled';
  if (/timeout|in time/i.test(message)) return 'timeout';
  return 'unavailable';
}

// Chiede il permesso solo se serve; restituisce { precise } se concesso.
async function ensurePermission() {
  if (!isNative) {
    if (!('geolocation' in navigator)) return { ok: false, reason: 'unsupported' };
    return { ok: true, precise: true };
  }
  let status;
  try {
    status = await Geolocation.checkPermissions();
  } catch (error) {
    return { ok: false, reason: reasonFrom(error) === 'unavailable' ? 'disabled' : reasonFrom(error) };
  }
  if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
    if (status.location === 'denied' && os === 'ios') return { ok: false, reason: 'denied' };
    try {
      status = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    } catch (error) {
      return { ok: false, reason: reasonFrom(error) === 'unavailable' ? 'denied' : reasonFrom(error) };
    }
  }
  if (status.location === 'granted') return { ok: true, precise: true };
  if (status.coarseLocation === 'granted') return { ok: true, precise: false };
  return { ok: false, reason: 'denied' };
}

function toPosition(result) {
  const { latitude, longitude, accuracy } = result.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Coordinate non valide');
  return { lat: latitude, lon: longitude, accuracy: Number(accuracy) || 0, timestamp: result.timestamp || Date.now() };
}

function webCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

// Risultato: { ok: true, position } oppure { ok: false, reason }
// reason: denied | restricted | disabled | timeout | unavailable | unsupported
export async function locate() {
  const permission = await ensurePermission();
  if (!permission.ok) return permission;

  const get = options => (isNative ? Geolocation.getCurrentPosition(options) : webCurrentPosition(options));
  try {
    return { ok: true, precise: permission.precise, position: toPosition(await get({ enableHighAccuracy: permission.precise, timeout: 12000, maximumAge: 30000 })) };
  } catch (error) {
    const reason = reasonFrom(error);
    if (reason !== 'timeout' && reason !== 'unavailable') return { ok: false, reason };
    // Senza segnale GPS (es. al chiuso) riproviamo con la rete, meno precisa.
    try {
      // "precise" descrive il permesso concesso, non la singola lettura:
      // la precisione effettiva è in position.accuracy.
      return { ok: true, precise: permission.precise, position: toPosition(await get({ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })) };
    } catch (retryError) {
      return { ok: false, reason: reasonFrom(retryError) };
    }
  }
}

// Aggiornamenti della posizione solo con l'app in primo piano.
export async function watchLocation(precise, onPosition) {
  const options = { enableHighAccuracy: precise, timeout: 20000, maximumAge: 10000, minimumUpdateInterval: 5000, interval: 10000 };
  const handle = (position, error) => {
    if (error || !position) return;
    try {
      onPosition(toPosition(position));
    } catch {
      /* posizione non valida: ignorata */
    }
  };
  if (isNative) {
    const id = await Geolocation.watchPosition(options, handle);
    return () => Geolocation.clearWatch({ id }).catch(() => {});
  }
  if (!('geolocation' in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(position => handle(position), () => {}, options);
  return () => navigator.geolocation.clearWatch(id);
}

/* ------------------------------------------------------------- rete */

export async function networkStatus() {
  try {
    const { connected } = await Network.getStatus();
    return connected;
  } catch {
    return navigator.onLine !== false;
  }
}

export function onNetworkChange(callback) {
  Network.addListener('networkStatusChange', ({ connected }) => callback(connected)).catch(() => {
    window.addEventListener('online', () => callback(true));
    window.addEventListener('offline', () => callback(false));
  });
}

/* ------------------------------------------------------------- link */

// Pagine web (orari ATM): browser di sistema integrato nell'app
// (SFSafariViewController su iOS, Chrome Custom Tabs su Android), con
// il pulsante per tornare subito alla mappa. Nessun accesso ai cookie o
// ai contenuti della pagina da parte dell'app.
export async function openWebPage(url, { toolbarColor } = {}) {
  if (!isAllowedExternalUrl(url)) throw new Error('URL non consentito');
  if (isNative) {
    await Browser.open({ url, toolbarColor, presentationStyle: 'fullscreen' });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

// App esterne (Mappe, store): il sistema sceglie l'app più adatta.
export function openExternal(url) {
  if (!isAllowedExternalUrl(url)) throw new Error('URL non consentito');
  window.open(url, '_blank', 'noopener');
}

export function onBrowserClosed(callback) {
  if (isNative) Browser.addListener('browserFinished', callback).catch(() => {});
}

export async function share({ title, text, url }) {
  if (isNative) {
    try {
      await Share.share({ title, text, url, dialogTitle: 'Condividi la fermata' });
      return 'shared';
    } catch (error) {
      if (/cancel/i.test(String(error?.message))) return 'cancelled';
      throw error;
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

/* ------------------------------------------------------------- ciclo di vita */

export function onBackButton(callback) {
  if (os === 'android') App.addListener('backButton', callback).catch(() => {});
}

export function onAppStateChange(callback) {
  if (isNative) {
    App.addListener('appStateChange', ({ isActive }) => callback(isActive)).catch(() => {});
  } else {
    document.addEventListener('visibilitychange', () => callback(document.visibilityState === 'visible'));
  }
}

export function exitToBackground() {
  if (os === 'android') App.minimizeApp().catch(() => App.exitApp());
}

export async function appVersion() {
  if (!isNative) return null;
  try {
    const info = await App.getInfo();
    return `${info.version} (${info.build})`;
  } catch {
    return null;
  }
}

export function hideSplash() {
  if (isNative) SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
}

export function setSystemBars(dark) {
  if (!isNative) return;
  // DARK = testo chiaro su sfondo scuro.
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

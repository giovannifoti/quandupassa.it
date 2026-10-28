// Alba e tramonto (algoritmo dell'Almanac for Computers, precisione ~1-2 minuti)
// usati per scegliere automaticamente il tema chiaro o scuro.
// Script classico caricato nell'<head>: imposta il tema prima del primo
// rendering (niente flash) ed espone le funzioni al modulo principale.
(function () {
'use strict';

const MESSINA = { lat: 38.1938, lon: 15.554 };
const DAY_MS = 24 * 60 * 60 * 1000;

function getSunTimes(date, latitude = MESSINA.lat, longitude = MESSINA.lon) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {
    sunrise: calculateSunEvent(day, latitude, longitude, true),
    sunset: calculateSunEvent(day, latitude, longitude, false)
  };
}

function isNight(date = new Date()) {
  const { sunrise, sunset } = getSunTimes(date);
  return date < sunrise || date >= sunset;
}

// Millisecondi che mancano al prossimo cambio di tema (min 1 minuto, max 1 giorno).
function msUntilNextSunEvent(now = new Date()) {
  const { sunrise, sunset } = getSunTimes(now);
  const nextSunrise = getSunTimes(new Date(now.getTime() + DAY_MS)).sunrise;
  const next = now < sunrise ? sunrise : now < sunset ? sunset : nextSunrise;
  return Math.max(60000, Math.min(next.getTime() - now.getTime() + 1000, DAY_MS));
}

function calculateSunEvent(day, latitude, longitude, isSunrise) {
  const zenith = 90.833;
  const dayOfYear = Math.floor((day - new Date(day.getFullYear(), 0, 0)) / DAY_MS);
  const lngHour = longitude / 15;
  const approxTime = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = (0.9856 * approxTime) - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
    (1.916 * Math.sin(toRad(meanAnomaly))) +
    (0.020 * Math.sin(2 * toRad(meanAnomaly))) +
    282.634
  );
  const raBase = normalizeDegrees(toDeg(Math.atan(0.91764 * Math.tan(toRad(trueLongitude)))));
  const rightAscension = (
    raBase +
    (Math.floor(trueLongitude / 90) * 90) -
    (Math.floor(raBase / 90) * 90)
  ) / 15;
  const sinDeclination = 0.39782 * Math.sin(toRad(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(toRad(zenith)) -
    (sinDeclination * Math.sin(toRad(latitude)))
  ) / (cosDeclination * Math.cos(toRad(latitude)));
  const safeCos = Math.min(1, Math.max(-1, cosHourAngle));

  const hourAngle = isSunrise ? 360 - toDeg(Math.acos(safeCos)) : toDeg(Math.acos(safeCos));
  const localMeanTime = (hourAngle / 15) + rightAscension - (0.06571 * approxTime) - 6.622;
  const utcHour = (((localMeanTime - lngHour) % 24) + 24) % 24;

  return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.round(utcHour * 60)));
}

function toRad(degrees) {
  return degrees * Math.PI / 180;
}

function toDeg(radians) {
  return radians * 180 / Math.PI;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

const api = { MESSINA, getSunTimes, isNight, msUntilNextSunEvent };
globalThis.QuandupassaSun = api;
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = isNight(new Date()) ? 'dark' : 'light';
}
})();

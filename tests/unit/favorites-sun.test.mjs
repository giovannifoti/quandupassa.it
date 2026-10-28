import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFavorites } from '../../public/js/favorites.js';
import '../../public/js/sun.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); }
  };
}

const stop = { id: 'palina-832', index: 0 };

test('i preferiti vengono salvati e riletti', () => {
  const storage = memoryStorage();
  const favorites = createFavorites(storage);
  assert.equal(favorites.has(stop), false);
  assert.deepEqual(favorites.toggle(stop), { value: true, saved: true });
  assert.equal(JSON.parse(storage.data.favorites)[0], 'palina-832');
  assert.equal(createFavorites(storage).has(stop), true);
});

test('i formati delle versioni precedenti restano validi e vengono migrati', () => {
  const storage = memoryStorage({ favorites: JSON.stringify(['0', 'idx-7']) });
  const favorites = createFavorites(storage);
  assert.equal(favorites.has(stop), true);
  assert.equal(favorites.has({ id: 'palina-99', index: 7 }), true);
  favorites.set(stop, true);
  assert.deepEqual(JSON.parse(storage.data.favorites).sort(), ['idx-7', 'palina-832']);
});

test('dati corrotti o malevoli nel localStorage non rompono l\'app', () => {
  for (const value of ['{not json', '{"a":1}', JSON.stringify(['<script>', 'x'.repeat(200), 'palina-832'])]) {
    const favorites = createFavorites(memoryStorage({ favorites: value }));
    assert.equal(typeof favorites.has(stop), 'boolean');
  }
  const favorites = createFavorites(memoryStorage({ favorites: JSON.stringify(['<script>', 'palina-832']) }));
  assert.equal(favorites.has(stop), true);
});

test('se il salvataggio fallisce viene segnalato', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
  const favorites = createFavorites(storage);
  assert.equal(favorites.toggle(stop).saved, false);
});

test('alba e tramonto a Messina sono plausibili', () => {
  const sun = globalThis.QuandupassaSun;
  const summer = sun.getSunTimes(new Date(2026, 5, 21, 12));
  const winter = sun.getSunTimes(new Date(2026, 11, 21, 12));
  // Messina, 21 giugno: alba ~03:33 UTC, tramonto ~18:25 UTC
  assert.ok(Math.abs(summer.sunrise.getUTCHours() * 60 + summer.sunrise.getUTCMinutes() - 213) < 10);
  assert.ok(Math.abs(summer.sunset.getUTCHours() * 60 + summer.sunset.getUTCMinutes() - 1105) < 10);
  assert.ok(winter.sunset - winter.sunrise < summer.sunset - summer.sunrise);
  const delay = sun.msUntilNextSunEvent(new Date());
  assert.ok(delay >= 60000 && delay <= 24 * 60 * 60 * 1000);
});

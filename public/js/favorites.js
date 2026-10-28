// Preferiti salvati solo nel browser (localStorage), compatibili con i
// formati delle versioni precedenti (id palina, indice numerico, idx-N).

const STORAGE_KEY = 'favorites';
const MAX_ITEMS = 500;

export function createFavorites(storage = safeStorage()) {
  const ids = read();
  const listeners = new Set();

  function read() {
    try {
      const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return new Set();
      return new Set(
        stored
          .map(String)
          .filter(id => /^[\w-]{1,40}$/.test(id))
          .slice(0, MAX_ITEMS)
      );
    } catch {
      return new Set();
    }
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify([...ids]));
      return true;
    } catch {
      return false;
    }
  }

  const aliases = stop => [stop.id, String(stop.index), `idx-${stop.index}`];

  function has(stop) {
    return aliases(stop).some(id => ids.has(id));
  }

  function set(stop, value) {
    aliases(stop).forEach(id => ids.delete(id));
    if (value) ids.add(stop.id);
    const saved = save();
    listeners.forEach(listener => listener(stop));
    return saved;
  }

  return {
    has,
    set,
    toggle(stop) {
      const value = !has(stop);
      return { value, saved: set(stop, value) };
    },
    clear() {
      ids.clear();
      const saved = save();
      listeners.forEach(listener => listener(null));
      return saved;
    },
    onChange(listener) {
      listeners.add(listener);
    }
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

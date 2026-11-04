// Scheda inferiore espandibile (bottom sheet) con tre altezze:
// "peek" (compatta), "half" (metà schermo) e "full" (quasi a tutto schermo).
// Si trascina dalla maniglia o dall'intestazione; per chi usa VoiceOver o
// TalkBack la maniglia è un pulsante che cambia altezza.

const SNAPS = ['peek', 'half', 'full'];

export function createSheet({ element, handle, dragArea, body, onChange }) {
  let snap = 'peek';
  let peekHeight = 190;
  let drag = null;
  let current = 0;

  const viewportHeight = () => window.innerHeight;
  const safeTop = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;

  function heightFor(name) {
    const vh = viewportHeight();
    const max = vh - safeTop() - 8;
    if (name === 'full') return max;
    if (name === 'half') return Math.min(max, Math.max(peekHeight + 80, Math.round(vh * 0.56)));
    return Math.min(max, peekHeight);
  }

  function apply(height, animate) {
    const max = heightFor('full');
    const clamped = Math.max(96, Math.min(max, height));
    element.classList.toggle('is-animating', animate);
    // Durante il trascinamento cambia solo la traslazione (composita dalla GPU).
    element.style.setProperty('--sheet-max', `${Math.round(max)}px`);
    element.style.setProperty('--sheet-height', `${Math.round(clamped)}px`);
    current = clamped;
    return clamped;
  }

  function set(name, { animate = true, silent = false } = {}) {
    snap = SNAPS.includes(name) ? name : 'peek';
    const height = apply(heightFor(snap), animate);
    element.style.setProperty('--sheet-settled', `${Math.round(height)}px`);
    // Il contenuto scorre solo nella parte visibile della scheda.
    body.style.maxHeight = `${Math.max(0, Math.round(height - dragArea.offsetHeight))}px`;
    element.dataset.snap = snap;
    handle.setAttribute('aria-label', snap === 'full' ? 'Riduci il pannello' : 'Espandi il pannello');
    handle.setAttribute('aria-expanded', String(snap !== 'peek'));
    if (!silent) onChange?.(snap, height);
  }

  function nearestSnap(height, velocity) {
    // Un gesto veloce sceglie l'altezza successiva nella direzione del gesto.
    if (Math.abs(velocity) > 0.6) {
      const index = SNAPS.indexOf(snap);
      const next = velocity < 0 ? Math.min(index + 1, SNAPS.length - 1) : Math.max(index - 1, 0);
      return SNAPS[next];
    }
    return SNAPS
      .map(name => ({ name, d: Math.abs(heightFor(name) - height) }))
      .sort((a, b) => a.d - b.d)[0].name;
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button:not(.sheet-handle), a, input')) return;
    drag = {
      id: event.pointerId,
      startY: event.clientY,
      startHeight: current,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
      moved: false
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      element.classList.add('is-dragging');
      dragArea.setPointerCapture?.(event.pointerId);
    }
    const now = performance.now();
    drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastTime);
    drag.lastY = event.clientY;
    drag.lastTime = now;
    apply(drag.startHeight - dy, false);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, velocity } = drag;
    drag = null;
    element.classList.remove('is-dragging');
    if (!moved) return;
    set(nearestSnap(current, velocity));
  }

  dragArea.addEventListener('pointerdown', onPointerDown);
  dragArea.addEventListener('pointermove', onPointerMove, { passive: false });
  dragArea.addEventListener('pointerup', onPointerUp);
  dragArea.addEventListener('pointercancel', onPointerUp);

  // Trascinando verso il basso il contenuto già in cima si riduce la scheda.
  let bodyTouch = null;
  body.addEventListener('touchstart', event => {
    bodyTouch = body.scrollTop <= 0 ? { y: event.touches[0].clientY, startHeight: current, active: false, lastY: event.touches[0].clientY, lastTime: performance.now(), velocity: 0 } : null;
  }, { passive: true });
  body.addEventListener('touchmove', event => {
    if (!bodyTouch) return;
    const y = event.touches[0].clientY;
    const dy = y - bodyTouch.y;
    if (!bodyTouch.active) {
      if (dy < 8 || body.scrollTop > 0) {
        if (dy < 0) bodyTouch = null;
        return;
      }
      bodyTouch.active = true;
      element.classList.add('is-dragging');
    }
    const now = performance.now();
    bodyTouch.velocity = (y - bodyTouch.lastY) / Math.max(1, now - bodyTouch.lastTime);
    bodyTouch.lastY = y;
    bodyTouch.lastTime = now;
    apply(bodyTouch.startHeight - dy, false);
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  body.addEventListener('touchend', () => {
    element.classList.remove('is-dragging');
    if (bodyTouch?.active) set(nearestSnap(current, bodyTouch.velocity));
    bodyTouch = null;
  });

  handle.addEventListener('click', () => {
    set(snap === 'full' ? 'peek' : snap === 'peek' ? 'half' : 'full');
  });

  element.addEventListener('transitionend', () => element.classList.remove('is-animating'));
  window.addEventListener('resize', () => set(snap, { animate: false }));

  return {
    get snap() {
      return snap;
    },
    get height() {
      return heightFor(snap);
    },
    get visibleHeight() {
      return current;
    },
    set,
    setPeekHeight(height) {
      peekHeight = Math.max(120, Math.round(height));
      if (snap === 'peek') set('peek', { animate: true, silent: false });
    }
  };
}

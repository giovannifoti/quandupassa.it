// Filtro istantaneo per la pagina /fermate/ (miglioramento progressivo:
// senza JavaScript l'elenco resta completo e navigabile per iniziale).
import { buildSearchText, tokenize } from './stops.js';

const filter = document.getElementById('filter');
const input = document.getElementById('filter-input');
const status = document.getElementById('filter-status');
const empty = document.getElementById('filter-empty');
const groups = [...document.querySelectorAll('#elenco .group')].map(section => ({
  section,
  items: [...section.querySelectorAll('li')].map(item => ({
    item,
    text: buildSearchText(item.querySelector('b').textContent)
  }))
}));

filter.hidden = false;

let timer = null;
input.addEventListener('input', () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(apply, 80);
});

function apply() {
  const tokens = tokenize(input.value);
  let visible = 0;
  groups.forEach(({ section, items }) => {
    let inGroup = 0;
    items.forEach(({ item, text }) => {
      const match = tokens.every(token => text.includes(token));
      item.hidden = !match;
      if (match) inGroup += 1;
    });
    section.hidden = inGroup === 0;
    visible += inGroup;
  });
  empty.hidden = visible > 0;
  status.textContent = tokens.length ? `${visible} fermate trovate` : '';
}

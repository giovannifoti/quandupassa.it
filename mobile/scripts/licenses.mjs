// Raccoglie le licenze delle librerie incluse nell'app (dipendenze di
// produzione) in static/licenses.txt, consultabile da Informazioni › Licenze.
// Eseguito automaticamente prima di ogni build.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(`${root}package-lock.json`, 'utf8'));

// Solo i pacchetti che finiscono nel bundle web (i plugin nativi sono MIT e
// la loro parte JavaScript è inclusa anch'essa).
const entries = Object.entries(lock.packages)
  .filter(([path, info]) => path.startsWith('node_modules/') && !info.dev && !info.devOptional)
  .map(([path]) => path)
  .filter(path => !/@capacitor\/(android|ios|cli)$/.test(path))
  .sort();

const sections = [];
for (const path of entries) {
  const pkg = JSON.parse(await readFile(`${root}${path}/package.json`, 'utf8'));
  const files = await readdir(`${root}${path}`);
  const licenseFile = files.find(name => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name));
  const text = licenseFile ? (await readFile(`${root}${path}/${licenseFile}`, 'utf8')).trim() : `Licenza: ${pkg.license}`;
  sections.push(`${pkg.name} ${pkg.version} (${pkg.license})\n${'-'.repeat(60)}\n${text}`);
}

const header = `Quando Passa – licenze del software di terze parti\n\nCartografia: OpenFreeMap (https://openfreemap.org), © OpenMapTiles, dati © OpenStreetMap contributors, disponibili con licenza ODbL (https://www.openstreetmap.org/copyright).\nOrari: pagine pubblicate da ATM Messina S.p.A.\n\n`;
await writeFile(`${root}static/licenses.txt`, `${header}${sections.join('\n\n\n')}\n`);
console.log(`Licenze di ${sections.length} pacchetti scritte in static/licenses.txt`);

// Copia le librerie di terze parti in public/vendor (servite dallo stesso
// dominio: niente CDN esterni, CSP restrittiva e cache "immutable").
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(`${root}node_modules/maplibre-gl/package.json`, 'utf8'));
const target = `${root}public/vendor/maplibre-gl-${pkg.version}`;

await rm(`${root}public/vendor`, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  const source = await readFile(`${root}node_modules/maplibre-gl/dist/${file}`, 'utf8');
  // Le source map non vengono pubblicate: togliamo il riferimento per evitare 404.
  await writeFile(`${target}/${file}`, source.replace(/\n\/[/*]# sourceMappingURL=[^\n]*\s*$/, '\n'));
}
await cp(`${root}node_modules/maplibre-gl/LICENSE.txt`, `${target}/LICENSE.txt`);
console.log(`MapLibre GL ${pkg.version} copiato in ${target}`);

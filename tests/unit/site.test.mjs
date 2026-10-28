// Controlli statici su HTML, configurazione Netlify, SEO e sicurezza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseNetlifyToml } from '../../scripts/serve.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFile(`${root}${path}`, 'utf8');
const index = await read('public/index.html');
const fermate = await read('public/fermate/index.html');
const notFound = await read('public/404.html');
const config = parseNetlifyToml(await read('netlify.toml'));

async function listFiles(dir) {
  const entries = await readdir(`${root}${dir}`, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => (
    entry.isDirectory() ? listFiles(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]
  )));
  return files.flat();
}

test('header di sicurezza configurati per tutte le pagine', () => {
  const global = config.headers.find(rule => rule.for === '/*');
  assert.ok(global, 'manca la regola globale');
  const csp = global.values['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'script-src deve consentire solo lo stesso dominio');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(global.values['X-Content-Type-Options'], 'nosniff');
  assert.equal(global.values['X-Frame-Options'], 'DENY');
  assert.match(global.values['Permissions-Policy'], /geolocation=\(self\)/);
  assert.ok(global.values['Referrer-Policy']);
});

test('nessuno script inline eseguibile né risorse da CDN esterni', async () => {
  for (const [name, html] of [['index', index], ['fermate', fermate], ['404', notFound]]) {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attributes, body] of scripts) {
      if (/type="application\/ld\+json"/.test(attributes)) {
        assert.doesNotThrow(() => JSON.parse(body), `${name}: JSON-LD non valido`);
        continue;
      }
      assert.match(attributes, /src="\//, `${name}: script inline non consentito dalla CSP`);
      assert.equal(body.trim(), '');
    }
    assert.doesNotMatch(html, /<(script|link)[^>]+(src|href)="https?:\/\/(?!quandupassa\.it)[^"]*\.(js|mjs|css)/, `${name}: risorse esterne`);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${name}: gestori di eventi inline`);
    assert.doesNotMatch(html, /\sstyle="/i, `${name}: stili inline bloccati dalla CSP`);
  }
});

test('i link che aprono nuove schede usano rel="noopener"', () => {
  for (const html of [index, fermate, notFound]) {
    for (const [tag] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(tag, /rel="[^"]*noopener/, tag);
    }
  }
});

test('nessun segreto nei file pubblicati', async () => {
  const files = (await listFiles('public')).filter(file => !file.includes('/vendor/') && /\.(html|js|mjs|json|css|txt|xml)$/.test(file));
  const patterns = [/AKIA[0-9A-Z]{16}/, /AIza[0-9A-Za-z_-]{35}/, /gh[pousr]_[0-9A-Za-z]{30,}/, /sk_live_[0-9a-zA-Z]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /xox[baprs]-[0-9A-Za-z-]{10,}/];
  for (const file of files) {
    const content = await read(file);
    for (const pattern of patterns) assert.doesNotMatch(content, pattern, `${file}: possibile segreto`);
  }
});

test('SEO della home: title, description, canonical, h1, Open Graph', () => {
  assert.match(index, /<html lang="it"/);
  const title = index.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length >= 30 && title.length <= 70, `title di ${title.length} caratteri`);
  const description = index.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(description.length >= 70 && description.length <= 170, `description di ${description.length} caratteri`);
  assert.match(index, /<link rel="canonical" href="https:\/\/quandupassa\.it\/">/);
  assert.equal([...index.matchAll(/<h1\b/g)].length, 1);
  assert.match(index, /<meta property="og:image" content="https:\/\/quandupassa\.it\/img\/og-image\.png">/);
  assert.doesNotMatch(index, /noindex/);
});

test('pagina elenco fermate e 404', () => {
  assert.match(fermate, /<link rel="canonical" href="https:\/\/quandupassa\.it\/fermate\/">/);
  assert.equal([...fermate.matchAll(/<h1\b/g)].length, 1);
  assert.match(notFound, /<meta name="robots" content="noindex">/);
});

test('robots.txt e sitemap coerenti', async () => {
  const robots = await read('public/robots.txt');
  const sitemap = await read('public/sitemap.xml');
  assert.match(robots, /^User-agent: \*$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/quandupassa\.it\/sitemap\.xml$/m);
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(urls, ['https://quandupassa.it/', 'https://quandupassa.it/fermate/']);
});

test('le pagine generate sono aggiornate rispetto al dataset', () => {
  execFileSync(process.execPath, [`${root}scripts/build-pages.mjs`, '--check'], { stdio: 'pipe' });
});

test('i file referenziati da HTML, manifest e service worker esistono', async () => {
  const files = new Set((await listFiles('public')).map(file => file.replace(/^public/, '')));
  const references = new Set();
  for (const html of [index, fermate, notFound]) {
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) references.add(path);
  }
  const manifest = JSON.parse(await read('public/manifest.json'));
  manifest.icons.forEach(icon => references.add(icon.src));
  const sw = await read('public/sw.js');
  for (const [, path] of sw.matchAll(/'(\/[^']+\.[a-z]+)'/g)) references.add(path);
  for (const ref of references) {
    const path = ref.endsWith('/') ? `${ref}index.html` : ref;
    assert.ok(files.has(path), `file mancante: ${ref}`);
  }
});

test('versione MapLibre allineata tra package.json, vendor, mappa e service worker', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const version = pkg.devDependencies['maplibre-gl'];
  for (const file of ['public/js/map.js', 'public/sw.js', 'public/index.html']) {
    assert.ok((await read(file)).includes(version), `${file} non usa MapLibre ${version}`);
  }
});

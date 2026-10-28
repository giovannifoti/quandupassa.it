// Server statico per sviluppo e test: serve public/ applicando header e
// redirect di netlify.toml, così CSP e cache si verificano anche in locale.
// Uso: node scripts/serve.mjs [porta]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export function parseNetlifyToml(source) {
  const headers = [];
  const redirects = [];
  let current = null;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line === '[[headers]]') {
      current = { type: 'headers', for: '', values: {} };
      headers.push(current);
    } else if (line === '[[redirects]]') {
      current = { type: 'redirects' };
      redirects.push(current);
    } else if (line.startsWith('[')) {
      if (!line.startsWith('[headers.values]')) current = line.startsWith('[[') ? null : current?.type === 'headers' ? current : null;
    } else {
      const match = line.match(/^([\w-]+)\s*=\s*(?:"(.*)"|(\d+))$/);
      if (!match || !current) continue;
      const [, key, text, number] = match;
      const value = text ?? Number(number);
      if (current.type === 'headers') {
        if (key === 'for') current.for = value;
        else current.values[key] = value;
      } else {
        current[key] = value;
      }
    }
  }
  return { headers, redirects };
}

function matches(pattern, path) {
  if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

export async function startServer(port = 8888) {
  const config = parseNetlifyToml(await readFile(join(root, 'netlify.toml'), 'utf8'));

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    const redirect = config.redirects.find(rule => rule.from === path);
    if (redirect) {
      response.writeHead(redirect.status || 301, { Location: redirect.to });
      response.end();
      return;
    }

    let filePath = normalize(join(publicDir, path));
    if (!filePath.startsWith(publicDir)) {
      response.writeHead(403);
      response.end();
      return;
    }

    let status = 200;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        if (!path.endsWith('/')) {
          response.writeHead(301, { Location: `${path}/${url.search}` });
          response.end();
          return;
        }
        filePath = join(filePath, 'index.html');
        await stat(filePath);
      }
    } catch {
      status = 404;
      filePath = join(publicDir, '404.html');
    }

    const headers = { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' };
    config.headers
      .filter(rule => matches(rule.for, path))
      .forEach(rule => Object.assign(headers, rule.values));
    // In locale (http) HSTS e upgrade-insecure-requests non hanno senso.
    delete headers['Strict-Transport-Security'];
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
    }

    response.writeHead(status, headers);
    response.end(await readFile(filePath));
  });

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8888;
  await startServer(port);
  console.log(`Quando Passa in locale: http://localhost:${port}`);
}

// Server statico minimo per servire dist/ durante i test end-to-end.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../../dist', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

export async function startServer(port) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dist)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

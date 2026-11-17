// A static server for the recorder — the interface is filmed as a page, and a
// page needs an origin (localStorage and module loading both refuse file://).
// Deliberately tiny: it serves one folder to one local browser for a minute.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export function serve(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      // normalize() collapses any ../ before it can leave the root
      const file = join(root, normalize(urlPath === '/' ? '/index.html' : urlPath));
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    // port 0: the OS picks a free one, so two recorders never collide
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

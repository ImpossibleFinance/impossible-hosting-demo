// Meme generator — a tiny static file server. ALL meme rendering happens in the
// browser on an HTML <canvas>; there is no server-side image processing and no
// uploads ever leave the visitor's device. The "server" just hands over the
// static editor (HTML/CSS/JS) and gets out of the way. That's what makes this
// tool infinitely scalable and completely private.
//
// Binds to '::':3000 (dual-stack IPv6). This is deliberate, and getting it
// wrong is the classic ifhost deploy foot-gun:
//   - 127.0.0.1 → the edge can't reach loopback, so the app is unreachable.
//   - '0.0.0.0' → v4-only; edge routing to <app>.host.impossi.build arrives
//     over IPv6, so a v4-only listener silently gets connection-refused even
//     though the deploy looks healthy.
// '::' accepts both. Always bind '::' on ifhost.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const HOST = '::';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request');
  }

  // Lightweight health check for the platform.
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method not allowed');
  }

  // Map the request to a file inside public/. Default to index.html.
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));

  // Refuse anything that escapes the public/ directory.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Meme generator listening on [${HOST}]:${PORT}`);
});

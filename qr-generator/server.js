// QR code generator — a tiny image API plus a one-input web UI.
//
// Binds to '::':3000 (dual-stack IPv6). This is deliberate, and getting it
// wrong is the classic ifhost deploy foot-gun:
//   - 127.0.0.1 → the edge can't reach loopback, so the app is unreachable.
//   - '0.0.0.0' → v4-only; edge routing to <app>.host.impossi.build arrives
//     over IPv6, so a v4-only listener silently gets connection-refused even
//     though the deploy looks healthy.
// '::' accepts both. Always bind '::' on ifhost.
//
// Two routes:
//   GET /              → the web UI (index.html)
//   GET /qr?text=...   → a PNG of the QR code (Content-Type: image/png)

const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const PORT = 3000;
const HOST = '::';

const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'index.html'));

// --- /qr parameter parsing & validation -----------------------------------

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const MAX_TEXT_LEN = 2048;
const MIN_SIZE = 64;
const MAX_SIZE = 1200;

// Normalise a hex colour to #rrggbb, or return the fallback if invalid/missing.
function parseColor(value, fallback) {
  if (!value || !HEX_RE.test(value)) return fallback;
  return value[0] === '#' ? value.toLowerCase() : '#' + value.toLowerCase();
}

// Clamp the requested pixel size into a sane range.
function parseSize(value, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

// --- routing ----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad request');
  }

  // Web UI
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    return res.end(INDEX_HTML);
  }

  // Lightweight health check for the platform.
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // QR image API
  if (req.method === 'GET' && url.pathname === '/qr') {
    const text = url.searchParams.get('text');
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing required ?text= parameter' }));
    }
    if (text.length > MAX_TEXT_LEN) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Text too long (max ${MAX_TEXT_LEN} chars)` }));
    }

    const size = parseSize(url.searchParams.get('size'), 512);
    const dark = parseColor(url.searchParams.get('color'), '#0b0f17');
    const light = parseColor(url.searchParams.get('bg'), '#ffffff');
    const download = url.searchParams.get('download') === '1';

    try {
      const png = await QRCode.toBuffer(text, {
        type: 'png',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark, light },
      });
      const headers = {
        'Content-Type': 'image/png',
        'Content-Length': png.length,
        'Cache-Control': 'public, max-age=3600',
      };
      if (download) {
        headers['Content-Disposition'] = 'attachment; filename="qr-code.png"';
      }
      res.writeHead(200, headers);
      return res.end(png);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Could not generate QR code' }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`QR generator listening on [${HOST}]:${PORT}`);
});

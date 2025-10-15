// exam-stream-server/index.js
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { EventEmitter } = require('events');

const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 4_000_000);

// ----- create app FIRST -----
const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

// --- paths ---
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

// Serve static assets, but NOT the index automatically (we’ll send it ourselves no-cache)
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1y', etag: false }));

// ---------- Health & stats (MUST be before any catch-all) ----------
let lastFrameAt = 0;
let framesThisSecond = 0;
let fps = 0;
setInterval(() => { fps = framesThisSecond; framesThisSecond = 0; }, 1000);

// viewers set
const clients = new Set();

app.head('/health', (_req, res) => res.sendStatus(200));
app.get('/stats', (_req, res) => res.json({ lastFrameAt, fps, viewers: clients.size }));

// ---------- UI routes ----------
function sendIndexNoCache(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(INDEX_HTML);
}
app.get('/', sendIndexNoCache);
app.get('/watch', sendIndexNoCache);

// catch-all UI routes; exclude our API endpoints
app.get(/^\/(?!health|stats|upload|stream|ws).*/, sendIndexNoCache);

// ---------- HTTP server & tuning ----------
const server = http.createServer(app);
server.keepAliveTimeout = 75_000;
server.headersTimeout  = 76_000;
server.requestTimeout  = 0;
server.on('connection', (sock) => sock.setNoDelay(true));

// ---------- Viewer WebSocket (/ws) ----------
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  perMessageDeflate: false,
  maxPayload: 8 * 1024 * 1024,
});

wss.on('connection', (ws, req) => {
  console.log('WS connected from', req.socket.remoteAddress);
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', (e) => console.warn('WS error:', e.message));
});

// ---------- MJPEG /stream ----------
const frameBus = new EventEmitter();
let lastFrame = null;

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Connection': 'close',
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
  });

  const writeFrame = (buf) => {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
    res.write(buf);
    res.write('\r\n');
  };

  if (lastFrame) writeFrame(lastFrame);
  const onFrame = (buf) => writeFrame(buf);
  frameBus.on('frame', onFrame);

  req.on('close', () => {
    frameBus.off('frame', onFrame);
    try { res.end(); } catch {}
  });
});

// ---------- Optimized raw-bytes upload ----------
app.post('/upload', (req, res) => {
  const lenHeader = req.headers['content-length'];
  const len = lenHeader ? Number(lenHeader) : 0;

  if (len > 0 && len <= MAX_FRAME_BYTES) {
    let received = 0;
    const buf = Buffer.allocUnsafe(len);
    req.on('data', (chunk) => {
      const end = received + chunk.length;
      if (end > len) return req.destroy(); // overflow guard
      chunk.copy(buf, received);
      received = end;
    });
    req.on('end', () => {
      if (received !== len) return res.sendStatus(400);
      handleFrame(buf);
      res.sendStatus(200);
    });
    req.on('error', () => res.sendStatus(499));
    return;
  }

  // unknown length fallback
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_FRAME_BYTES) { chunks.length = 0; return req.destroy(); }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (size === 0 || size > MAX_FRAME_BYTES) return res.sendStatus(400);
    handleFrame(Buffer.concat(chunks, size));
    res.sendStatus(200);
  });
  req.on('error', () => res.sendStatus(499));
});

function handleFrame(buffer) {
  lastFrameAt = Date.now();
  framesThisSecond++;
  lastFrame = buffer;
  frameBus.emit('frame', buffer);

  // fan out to WebSocket viewers, dropping stragglers
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.bufferedAmount > 1_000_000) continue;
    ws.send(buffer, { binary: true });
  }
}

// --------- SINGLE listener (bind all interfaces for deploy) ---------
const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}`);
});

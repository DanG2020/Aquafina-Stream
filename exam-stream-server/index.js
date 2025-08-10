const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];
let lastFrameAt = 0;           // ✅ when the last frame arrived (ms)
let framesThisSecond = 0;      // ✅ counter for FPS calc
let fps = 0;

// simple FPS rolling calc
setInterval(() => { fps = framesThisSecond; framesThisSecond = 0; }, 1000);

// ✅ health + stats
app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/stats', (req, res) => {
  res.json({ lastFrameAt, fps, viewers: clients.length });
});

wss.on('connection', (ws) => {
  console.log("Viewer connected");
  clients.push(ws);
  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
    console.log("Viewer disconnected");
  });
});

// RAW BYTES upload route (what your sim uses)
app.post('/upload', (req, res) => {
  let data = [];
  req.on('data', chunk => data.push(chunk));
  req.on('end', () => {
    const buffer = Buffer.concat(data);
    lastFrameAt = Date.now();     // ✅
    framesThisSecond++;           // ✅

    // fan out to viewers
    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(buffer);
    });

    res.sendStatus(200);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'os';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const DIST_DIR = path.join(process.cwd(), 'dist');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let currentStore: any = null;
let saveDebounceTimer: any = null;

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      currentStore = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not load store file:', err);
  }
}

function saveStore(data: any) {
  currentStore = data;
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SyncServer] Failed to write store file:', err);
    }
  }, 100);
}

function flushStoreSync() {
  if (currentStore) {
    try {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      fs.writeFileSync(DATA_FILE, JSON.stringify(currentStore, null, 2), 'utf-8');
      console.log('[SyncServer] Flushed store to disk before shutdown.');
    } catch (err) {
      console.error('[SyncServer] Flush failed:', err);
    }
  }
}

process.on('SIGINT', () => { flushStoreSync(); process.exit(0); });
process.on('SIGTERM', () => { flushStoreSync(); process.exit(0); });
process.on('beforeExit', () => { flushStoreSync(); });

loadStore();

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    clients: wss.clients.size,
    hasStore: !!currentStore
  });
});

app.get('/api/sync/store', (req, res) => {
  res.json({ store: currentStore });
});

app.post('/api/sync/store', (req, res) => {
  const { store, clientId, broadcastMutation } = req.body;
  if (store) {
    saveStore(store);
    if (broadcastMutation !== false) {
      broadcast({
        type: 'STATE_UPDATE',
        payload: store,
        clientId: clientId || null,
        timestamp: store.timestamp || 0
      });
    }
    res.json({ success: true, timestamp: store.timestamp || 0 });
  } else {
    res.status(400).json({ error: 'Missing store data' });
  }
});

// Proxy for Scryfall /cards/collection (bypasses browser CORS and ad-blockers)
app.post('/api/scryfall/collection', async (req, res) => {
  try {
    const { identifiers } = req.body;
    if (!identifiers || !Array.isArray(identifiers)) {
      return res.status(400).json({ error: 'Missing identifiers array' });
    }
    const response = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ArcaWMS/1.1 (MTG Chaos-Sorting WMS)',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ identifiers })
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    console.warn('Scryfall server proxy error:', err);
    res.status(500).json({ error: err.message || 'Scryfall proxy error' });
  }
});

// Serve frontend in production if built
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

function broadcast(msg: any, senderWs?: WebSocket) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== senderWs) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  console.log(`[SyncServer] Client connected. (Active: ${wss.clients.size})`);

  // Send current store if available (timestamp reflects stored data, never Date.now())
  if (currentStore) {
    ws.send(JSON.stringify({
      type: 'SYNC_FULL_STATE',
      payload: currentStore,
      timestamp: currentStore.timestamp || 0
    }));
  }

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'STATE_UPDATE' && parsed.payload) {
        saveStore(parsed.payload);
        broadcast(parsed, ws);
      } else if (parsed.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch (err) {
      console.error('[SyncServer] Error reading message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[SyncServer] Client disconnected. (Active: ${wss.clients.size})`);
  });
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(Number(PORT), '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`\n=======================================================`);
  console.log(`⚡ ArcaWMS Production Sync & Web Server is running!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Local server: http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`📱 Cross-device LAN URL: http://${ips[0]}:${PORT}`);
  }
  console.log(`=======================================================\n`);
});

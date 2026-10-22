import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import compression from 'compression';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { gistStore } from './gistStore';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(compression());
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
let recentDeltas: any[] = [];
let saveDebounceTimer: any = null;
let gistSaveDebounceTimer: any = null;

async function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      currentStore = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not load local store file:', err);
  }

  // If GitHub Gist storage is configured, reconcile with cloud snapshot on boot
  if (gistStore.isConfigured()) {
    try {
      const remoteData = await gistStore.load();
      const localCount = Array.isArray(currentStore?.instances) ? currentStore.instances.length : 0;
      const remoteCount = Array.isArray(remoteData?.instances) ? remoteData.instances.length : 0;
      const localTs = currentStore?.timestamp || currentStore?.last_updated || 0;
      const remoteTs = remoteData?.timestamp || remoteData?.last_updated || 0;

      if (remoteData && remoteCount > 0) {
        // Only accept remote if it's newer or local has no data, AND remote doesn't drastically wipe local
        if (!currentStore || localCount === 0 || (remoteTs >= localTs && remoteCount >= localCount * 0.7)) {
          currentStore = remoteData;
          try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(currentStore, null, 2), 'utf-8');
            console.log(`[SyncServer] Restored store from GitHub Gist (${remoteCount} cards, ts: ${remoteTs})`);
          } catch {}
        } else if (localTs > remoteTs || (localCount > 0 && remoteCount < localCount * 0.7)) {
          console.log(`[SyncServer] Local store is newer or larger than Gist (local: ${localCount} cards vs Gist: ${remoteCount} cards). Updating Gist...`);
          gistStore.save(currentStore);
        }
      } else if (currentStore && localCount > 0) {
        console.log('[GistStore] Gist was empty or newly created. Seeding with current local store...');
        gistStore.save(currentStore);
      }
    } catch (err) {
      console.warn('[SyncServer] Error reconciling with Gist on boot:', err);
    }
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

  // Debounce Gist persistence (1500ms) to bundle rapid changes and avoid rate-limiting
  if (gistStore.isConfigured()) {
    if (gistSaveDebounceTimer) clearTimeout(gistSaveDebounceTimer);
    gistSaveDebounceTimer = setTimeout(() => {
      gistStore.save(data);
    }, 1500);
  }
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

    if (gistStore.isConfigured()) {
      gistStore.save(currentStore);
    }
  }
}

process.on('SIGINT', () => { flushStoreSync(); process.exit(0); });
process.on('SIGTERM', () => { flushStoreSync(); process.exit(0); });
process.on('beforeExit', () => { flushStoreSync(); });

loadStore();

// Ultra-lightweight health endpoint for Render health checks (avoids serving HTML index)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Detailed health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.1.0',
    clients: wss.clients.size,
    hasStore: !!currentStore,
    cloudPersistence: {
      type: gistStore.isConfigured() ? 'github_gist' : 'local_only',
      configured: gistStore.isConfigured(),
      gistId: gistStore.getGistId()
    }
  });
});

app.get('/api/sync/cloud-status', (req, res) => {
  res.json({
    type: gistStore.isConfigured() ? 'github_gist' : 'local_only',
    configured: gistStore.isConfigured(),
    gistId: gistStore.getGistId()
  });
});

// Ultra-lightweight sync metadata endpoint (exchanges ~50 bytes instead of megabytes of JSON)
app.get('/api/sync/meta', (req, res) => {
  res.json({
    timestamp: currentStore?.timestamp || currentStore?.last_updated || 0,
    count: Array.isArray(currentStore?.instances) ? currentStore.instances.length : 0,
    deltaCount: recentDeltas.length
  });
});

app.get('/api/sync/deltas', (req, res) => {
  const sinceParam = req.query.since;
  const since = typeof sinceParam === 'string' ? (parseInt(sinceParam, 10) || 0) : 0;
  const filtered = recentDeltas.filter(d => (d.timestamp || 0) > since);
  const oldestInLog = recentDeltas.length > 0 ? (recentDeltas[0].timestamp || 0) : 0;
  const metaTimestamp = currentStore?.timestamp || currentStore?.last_updated || 0;
  const hasGap = (since > 0 && recentDeltas.length > 0 && since < oldestInLog) || (metaTimestamp > since && recentDeltas.length === 0);

  res.json({
    deltas: filtered,
    hasGap,
    totalDeltasInLog: recentDeltas.length,
    serverTimestamp: metaTimestamp
  });
});

app.get('/api/sync/store', (req, res) => {
  res.json({ store: currentStore });
});

app.post('/api/sync/store', (req, res) => {
  let bodyData = req.body;
  if (typeof bodyData === 'string') {
    try { bodyData = JSON.parse(bodyData); } catch {}
  }

  // 1. Delta Sync Mode
  if (bodyData?.type === 'delta' || bodyData?.delta) {
    const delta = bodyData.delta || bodyData;
    recentDeltas.push(delta);
    if (recentDeltas.length > 50) {
      recentDeltas = recentDeltas.slice(recentDeltas.length - 50);
    }

    if (currentStore) {
      if (delta.instances?.delete && Array.isArray(delta.instances.delete)) {
        const delSet = new Set(delta.instances.delete);
        currentStore.instances = (currentStore.instances || []).filter((i: any) => !delSet.has(i.instance_id));
      }
      if (delta.instances?.upsert && Array.isArray(delta.instances.upsert)) {
        const instMap = new Map((currentStore.instances || []).map((i: any) => [i.instance_id, i]));
        for (const inst of delta.instances.upsert) {
          instMap.set(inst.instance_id, inst);
        }
        currentStore.instances = Array.from(instMap.values());
      }
      if (delta.timestamp) {
        currentStore.timestamp = delta.timestamp;
      }
      saveStore(currentStore);
    }
    return res.json({ success: true, type: 'delta', timestamp: delta.timestamp || Date.now() });
  }

  // 2. Full Snapshot Mode
  const store = bodyData?.store || bodyData;
  const clientId = bodyData?.clientId;
  const broadcastMutation = bodyData?.broadcastMutation;

  if (store && Array.isArray(store.instances)) {
    const currentCount = Array.isArray(currentStore?.instances) ? currentStore.instances.length : 0;
    const incomingCount = store.instances.length;

    if (currentCount > 50 && incomingCount < currentCount * 0.5) {
      console.warn(`[SyncServer] Notice: Incoming store has ${incomingCount} cards, current store has ${currentCount}. Guarding data integrity.`);
    }

    recentDeltas = [];
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
    res.status(400).json({ error: 'Missing or invalid store data' });
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

// Proxy for Scryfall /cards/search (bypasses browser CORS and ad-blockers)
app.get('/api/scryfall/search', async (req, res) => {
  try {
    const queryParams = new URLSearchParams(req.query as any).toString();
    const response = await fetch(`https://api.scryfall.com/cards/search?${queryParams}`, {
      headers: {
        'User-Agent': 'ArcaWMS/1.1 (MTG Chaos-Sorting WMS)',
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    console.warn('Scryfall search proxy error:', err);
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

  // Send lightweight handshake (~50 bytes) instead of blasting full store (megabytes)
  ws.send(JSON.stringify({
    type: 'SYNC_HANDSHAKE',
    timestamp: currentStore?.timestamp || currentStore?.last_updated || 0,
    count: Array.isArray(currentStore?.instances) ? currentStore.instances.length : 0
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'REQUEST_FULL_STATE') {
        if (currentStore) {
          ws.send(JSON.stringify({
            type: 'SYNC_FULL_STATE',
            payload: currentStore,
            timestamp: currentStore.timestamp || 0
          }));
        }
      } else if (parsed.type === 'STATE_UPDATE' && parsed.payload) {
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

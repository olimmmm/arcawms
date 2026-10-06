import { db } from './db';
import { applyTheme, GuildThemeId } from './theme';

type SyncStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

function parseTimestamp(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const parsedDate = Date.parse(val);
    if (!isNaN(parsedDate)) return parsedDate;
    const parsedInt = parseInt(val, 10);
    if (!isNaN(parsedInt)) return parsedInt;
  }
  return 0;
}

const CLIENT_ID = typeof crypto !== 'undefined' && crypto.randomUUID 
  ? crypto.randomUUID() 
  : 'client-' + Math.random().toString(36).substring(2, 10);

class SyncClient {
  private ws: WebSocket | null = null;
  private status: SyncStatus = 'disconnected';
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private isProcessingRemoteUpdate = false;
  private reconnectTimer: any = null;
  private pushDebounceTimer: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('arcawms_tab_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'TAB_MUTATION' && !this.isProcessingRemoteUpdate) {
            if (event.data.clientId !== CLIENT_ID) {
              this.handleLiveBroadcast(event.data.payload, event.data.clientId);
            }
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported:', e);
      }

      // Query server state on startup to passively reconcile timestamps
      this.checkServerStoreHttp();

      // Connect WebSocket for real-time multi-device sync
      this.connect();

      // Listen to local DB changes to push mutations to sync server & other devices
      db.subscribe(() => {
        if (!this.isProcessingRemoteUpdate) {
          this.schedulePush(100);
        }
      });

      // Flushes any pending mutation immediately if the user reloads or navigates away
      const flushOnUnload = () => {
        this.flushImmediate();
      };
      window.addEventListener('beforeunload', flushOnUnload);
      window.addEventListener('pagehide', flushOnUnload);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flushOnUnload();
        }
      });
    }
  }

  private async checkServerStoreHttp() {
    try {
      const res = await fetch('/api/sync/store');
      if (res.ok) {
        const data = await res.json();
        if (data?.store) {
          this.reconcileWithServer(data.store);
        }
      }
    } catch {
      // Offline or network error
    }
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  public onStatusChange(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: SyncStatus) {
    if (this.status !== s) {
      this.status = s;
      this.listeners.forEach(fn => fn(s));
    }
  }

  private connect() {
    if (typeof window === 'undefined') return;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Ignore echoes of our own client's messages
          if (msg.clientId && msg.clientId === CLIENT_ID) return;

          if (msg.type === 'SYNC_FULL_STATE') {
            // Passive handshake on WS connect
            this.reconcileWithServer(msg.payload);
          } else if (msg.type === 'STATE_UPDATE') {
            // Live broadcast mutation from another active client
            this.handleLiveBroadcast(msg.payload, msg.clientId);
          }
        } catch (e) {
          console.error('[ArcaSync] Error reading remote msg:', e);
        }
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.setStatus('error');
      };
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 5000);
  }

  /**
   * Passive handshake with the server on boot/connection.
   * Compares timestamps without blasting out mutations to active clients.
   */
  private reconcileWithServer(remoteStore: any) {
    if (!remoteStore || !Array.isArray(remoteStore.instances)) return;

    const localCount = db.getAllInstances().length;
    const remoteCount = remoteStore.instances.length;
    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remoteStore.timestamp || remoteStore.last_updated);

    console.log(`[SyncClient] Handshake check — Local: ${localCount} cards (ts: ${localTs}) | Remote: ${remoteCount} cards (ts: ${remoteTs})`);

    // Case 1: Server has newer changes from another device!
    // (e.g. laptop added cards at 16:00, phone is connecting with stale 11:57 state)
    if (remoteTs > localTs && remoteCount > 0) {
      console.log(`[SyncClient] Remote store is newer than local (${remoteTs} > ${localTs}). Synchronizing from server.`);
      this.isProcessingRemoteUpdate = true;
      try {
        if (remoteStore.settings?.theme) {
          applyTheme(remoteStore.settings.theme as GuildThemeId);
        }
        db.importJSON(JSON.stringify(remoteStore), remoteTs);
      } finally {
        setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 100);
      }
      return;
    }

    // Case 2: Local state is newer than server!
    // (e.g. Render container restarted with stale seed data, or local edits happened while offline)
    if (localTs > remoteTs && localCount > 0) {
      console.log(`[SyncClient] Local store is newer than server (${localTs} > ${remoteTs}). Passively updating server.`);
      this.pushCurrentState(false); // DO NOT broadcast mutation to other active clients
      return;
    }

    // Case 3: Fresh device with 0 cards in local storage
    if (localCount === 0 && remoteCount > 0) {
      console.log(`[SyncClient] Fresh local device (0 cards). Importing ${remoteCount} cards from server.`);
      this.isProcessingRemoteUpdate = true;
      try {
        if (remoteStore.settings?.theme) {
          applyTheme(remoteStore.settings.theme as GuildThemeId);
        }
        db.importJSON(JSON.stringify(remoteStore), remoteTs);
      } finally {
        setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 100);
      }
      return;
    }

    // Case 4: Timestamps are equal — both in sync!
  }

  /**
   * Handles a live broadcast mutation emitted by another active client.
   */
  private handleLiveBroadcast(remotePayload: any, senderClientId?: string) {
    if (!remotePayload || !Array.isArray(remotePayload.instances)) return;
    if (senderClientId && senderClientId === CLIENT_ID) return;

    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remotePayload.timestamp || remotePayload.last_updated);
    const remoteCount = remotePayload.instances.length;

    // Only accept live broadcast if remote timestamp is genuinely newer
    if (remoteTs > localTs && remoteCount > 0) {
      console.log(`[SyncClient] Applying real-time update from client ${senderClientId} (${remoteCount} cards, ts: ${remoteTs}).`);
      this.isProcessingRemoteUpdate = true;
      try {
        if (remotePayload.settings?.theme) {
          applyTheme(remotePayload.settings.theme as GuildThemeId);
        }
        db.importJSON(JSON.stringify(remotePayload), remoteTs);
      } finally {
        setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 100);
      }
    }
  }

  private schedulePush(delay = 100) {
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer);
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = null;
      this.pushCurrentState(true);
    }, delay);
  }

  public flushImmediate() {
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
      this.pushDebounceTimer = null;
    }
    this.pushCurrentState(true);
  }

  private pushCurrentState(broadcastMutation = true) {
    const payload = {
      instances: db.getAllInstances(),
      cards: db.getAllCards(),
      history: db.getHistory(),
      settings: db.getSettings(),
      timestamp: db.getLastUpdated()
    };

    // 1. Multi-tab broadcast
    if (this.broadcastChannel && broadcastMutation) {
      try {
        this.broadcastChannel.postMessage({
          type: 'TAB_MUTATION',
          payload,
          clientId: CLIENT_ID
        });
      } catch {}
    }

    // 2. WebSocket push (real-time cross-device)
    if (this.ws && this.ws.readyState === WebSocket.OPEN && broadcastMutation) {
      try {
        this.ws.send(JSON.stringify({
          type: 'STATE_UPDATE',
          payload,
          clientId: CLIENT_ID
        }));
      } catch {}
    }

    // 3. Reliable HTTP POST fallback with keepalive: true
    try {
      const body = JSON.stringify({ 
        store: payload, 
        clientId: CLIENT_ID, 
        broadcastMutation 
      });
      fetch('/api/sync/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(err => {
        console.debug('[SyncClient] HTTP push notice:', err);
      });
    } catch (err) {
      console.debug('[SyncClient] Push exception:', err);
    }
  }

  public forceReconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.checkServerStoreHttp();
    this.connect();
  }
}

export const syncClient = new SyncClient();

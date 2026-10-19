import { db } from './db';
import { applyTheme, GuildThemeId } from './theme';

export type SyncStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type CloudUploadState = 'idle' | 'syncing' | 'synced' | 'error';

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
  private uploadState: CloudUploadState = 'idle';
  private uploadListeners: Set<(state: CloudUploadState) => void> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private isProcessingRemoteUpdate = false;
  private reconnectTimer: any = null;
  private pushDebounceTimer: any = null;
  private syncedResetTimer: any = null;

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
          this.setUploadState('syncing');
          this.schedulePush(100);
        }
      });

      // Flushes any pending mutation immediately if the user reloads or navigates away
      const flushOnUnload = () => {
        this.flushImmediate();
      };
      window.addEventListener('beforeunload', (e) => {
        if (this.isSyncing()) {
          this.flushImmediate();
          e.preventDefault();
          e.returnValue = 'Cards are currently syncing to cloud server. Are you sure you want to exit?';
          return e.returnValue;
        }
        flushOnUnload();
      });
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
      await db.whenHydrated();
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

  public getUploadState(): CloudUploadState {
    return this.uploadState;
  }

  public onUploadStateChange(fn: (state: CloudUploadState) => void): () => void {
    this.uploadListeners.add(fn);
    fn(this.uploadState);
    return () => this.uploadListeners.delete(fn);
  }

  private setUploadState(s: CloudUploadState) {
    if (this.uploadState !== s) {
      this.uploadState = s;
      this.uploadListeners.forEach(fn => fn(s));
    }
  }

  public isSyncing(): boolean {
    return this.uploadState === 'syncing';
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
            db.whenHydrated().then(() => {
              this.reconcileWithServer(msg.payload);
            });
          } else if (msg.type === 'STATE_UPDATE') {
            // Live broadcast mutation from another active client
            db.whenHydrated().then(() => {
              this.handleLiveBroadcast(msg.payload, msg.clientId);
            });
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

    // Guard 1: Fresh local device with 0 cards -> adopt server collection
    if (localCount === 0 && remoteCount > 0) {
      console.log(`[SyncClient] Fresh local device (0 cards). Importing ${remoteCount} cards from server.`);
      this.applyRemoteStore(remoteStore, remoteTs);
      return;
    }

    // Guard 2: Protection against blank / default seed container wiping an established user collection
    // If local has an established collection (50+ cards) and remote is empty or default seed data (<= 28 cards),
    // never wipe local. Instead, seed the server container with the legitimate collection.
    if (localCount >= 50 && remoteCount <= 28) {
      console.warn(`[SyncClient] Remote store is an unseeded/cold container (${remoteCount} cards). Protecting local collection (${localCount} cards) and seeding server.`);
      this.pushCurrentState(false);
      return;
    }

    // Primary Rule: TRUE TIMESTAMP WINS
    // All legitimate actions (adding cards, removing cards, swapping, moving locations)
    // update the timestamp. The newer timestamp accurately reflects the latest user intent.
    if (remoteTs > localTs) {
      console.log(`[SyncClient] Remote timestamp is newer (${remoteTs} > ${localTs}). Synchronizing from server (${remoteCount} cards).`);
      this.applyRemoteStore(remoteStore, remoteTs);
      return;
    } else if (localTs > remoteTs) {
      console.log(`[SyncClient] Local timestamp is newer (${localTs} > ${remoteTs}). Updating server with local state (${localCount} cards).`);
      this.pushCurrentState(false);
      return;
    }

    // Equal timestamps: already in sync!
  }

  private applyRemoteStore(remoteStore: any, remoteTs: number) {
    this.isProcessingRemoteUpdate = true;
    try {
      if (remoteStore.settings?.theme) {
        applyTheme(remoteStore.settings.theme as GuildThemeId);
      }
      db.importJSON(JSON.stringify(remoteStore), remoteTs);
    } finally {
      setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 100);
    }
  }

  /**
   * Handles a live broadcast mutation emitted by another active client.
   */
  private handleLiveBroadcast(remotePayload: any, senderClientId?: string) {
    if (!remotePayload || !Array.isArray(remotePayload.instances)) return;
    if (senderClientId && senderClientId === CLIENT_ID) return;

    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remotePayload.timestamp || remotePayload.last_updated);
    const localCount = db.getAllInstances().length;
    const remoteCount = remotePayload.instances.length;

    // Safety guard against unseeded cold container broadcast
    if (localCount >= 50 && remoteCount <= 28) {
      return;
    }

    // True timestamp wins
    if (remoteTs > localTs) {
      console.log(`[SyncClient] Applying real-time update from client ${senderClientId} (${remoteCount} cards, ts: ${remoteTs}).`);
      this.applyRemoteStore(remotePayload, remoteTs);
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

  private async pushCurrentState(broadcastMutation = true) {
    this.setUploadState('syncing');

    const payload = {
      instances: db.getAllInstances(),
      cards: db.getAllCards(),
      custom_lists: db.getCustomLists(),
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

    // 3. Reliable HTTP POST fallback (no keepalive: true to prevent 64KB Fetch limit rejection on large collections)
    try {
      const body = JSON.stringify({ 
        store: payload, 
        clientId: CLIENT_ID, 
        broadcastMutation 
      });
      const res = await fetch('/api/sync/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (res.ok) {
        this.setUploadState('synced');
        if (this.syncedResetTimer) clearTimeout(this.syncedResetTimer);
        this.syncedResetTimer = setTimeout(() => {
          if (this.uploadState === 'synced') {
            this.setUploadState('idle');
          }
        }, 3000);
      } else {
        this.setUploadState('error');
      }
    } catch (err) {
      console.debug('[SyncClient] Push exception:', err);
      this.setUploadState('error');
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

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
              this.handleRemoteState(event.data.payload, true);
            }
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported:', e);
      }

      // Check if this browser already has cards in local storage
      const localCount = db.getAllInstances().length;
      const hasStoredData = db.hasLocalStoredInstances();

      if (hasStoredData && localCount > 0) {
        // LOCAL STORAGE IS AUTHORITATIVE FOR THIS DEVICE.
        // We do NOT pull or overwrite from server on startup.
        // Instead, push current local state to ensure server has latest copy.
        console.log(`[SyncClient] Local inventory found (${localCount} cards). Local state is authoritative.`);
        this.schedulePush(50);
      } else {
        // First visit or fresh device with 0 cards: pull from server
        this.checkServerStoreHttp();
      }

      // Connect WebSocket for real-time multi-device sync
      this.connect();

      // Listen to local DB changes to push to sync server
      db.subscribe(() => {
        if (!this.isProcessingRemoteUpdate) {
          this.schedulePush(100);
        }
      });

      // Flushes any pending push immediately if the user reloads or navigates away
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
          this.handleRemoteState(data.store, false);
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
        // Once connected: if we have local cards, guarantee server is up to date
        const localCount = db.getAllInstances().length;
        if (localCount > 0) {
          this.pushCurrentState();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // If message is from ourselves, ignore it
          if (msg.clientId && msg.clientId === CLIENT_ID) return;

          if (msg.type === 'SYNC_FULL_STATE') {
            // Server handshake / full state message
            this.handleRemoteState(msg.payload, false);
          } else if (msg.type === 'STATE_UPDATE') {
            // Live broadcast update from another client
            this.handleRemoteState(msg.payload, true);
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
   * Processes remote state.
   * @param remotePayload Store payload from server
   * @param isLiveBroadcast True if this came from an active multi-device broadcast during usage; false if from boot/connection handshake.
   */
  private handleRemoteState(remotePayload: any, isLiveBroadcast = false) {
    if (!remotePayload || !Array.isArray(remotePayload.instances)) return;

    const localCount = db.getAllInstances().length;
    const remoteCount = remotePayload.instances.length;
    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remotePayload.timestamp || remotePayload.last_updated);

    // CRITICAL PROTECTION RULE 1:
    // If this is an initial server handshake (page load / reconnect) and local storage has cards,
    // local storage is AUTHORITATIVE. NEVER overwrite local storage on boot!
    if (!isLiveBroadcast && localCount > 0) {
      console.log(`[SyncClient] Boot handshake: preserving populated local collection (${localCount} cards) and updating server.`);
      this.schedulePush(50);
      return;
    }

    // RULE 2: Never allow an empty remote store to wipe out a populated local collection
    if (remoteCount === 0 && localCount > 0) {
      console.warn('[SyncClient] Remote store is empty (0 cards) while local has', localCount, 'cards. Protecting local collection & updating server.');
      this.schedulePush(50);
      return;
    }

    // RULE 3: If local database has cards and local edits are newer or equal to remote, local ALWAYS wins
    if (localCount > 0 && localTs >= remoteTs && remoteTs > 0) {
      console.log('[SyncClient] Local state is newer or equal to server (local:', localTs, '>= remote:', remoteTs, '). Preserving local state & updating server.');
      this.schedulePush(50);
      return;
    }

    // RULE 4: If remote timestamp is missing or 0 and local has cards, protect local state
    if (remoteTs === 0 && localCount > 0) {
      console.warn('[SyncClient] Remote store has missing timestamp. Preserving local state.');
      this.schedulePush(50);
      return;
    }

    // RULE 5: If local has cards and remote has fewer cards, take an automatic safety snapshot before sync
    if (localCount > 0 && remoteCount < localCount) {
      console.warn('[SyncClient] Remote has fewer cards than local. Taking safety snapshot before sync.');
      db.saveSnapshot(`Safety snapshot before sync (${localCount} -> ${remoteCount} cards)`);
    }

    // Apply remote update
    this.isProcessingRemoteUpdate = true;
    try {
      if (remotePayload.settings?.theme) {
        applyTheme(remotePayload.settings.theme as GuildThemeId);
      }
      const jsonStr = JSON.stringify(remotePayload);
      db.importJSON(jsonStr, remoteTs || Date.now());
      console.log(`[SyncClient] Successfully synchronized ${remoteCount} cards from remote update.`);
    } catch (err) {
      console.error('[SyncClient] Error applying remote state:', err);
    } finally {
      setTimeout(() => {
        this.isProcessingRemoteUpdate = false;
      }, 100);
    }
  }

  private schedulePush(delay = 100) {
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer);
    this.pushDebounceTimer = setTimeout(() => {
      this.pushDebounceTimer = null;
      this.pushCurrentState();
    }, delay);
  }

  public flushImmediate() {
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
      this.pushDebounceTimer = null;
    }
    this.pushCurrentState();
  }

  private pushCurrentState() {
    const payload = {
      instances: db.getAllInstances(),
      cards: db.getAllCards(),
      history: db.getHistory(),
      settings: db.getSettings(),
      timestamp: db.getLastUpdated()
    };

    // 1. Multi-tab broadcast
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'TAB_MUTATION',
          payload,
          clientId: CLIENT_ID
        });
      } catch {}
    }

    // 2. WebSocket push (real-time cross-device)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
      const body = JSON.stringify({ store: payload, clientId: CLIENT_ID });
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
    this.pushCurrentState();
    this.connect();
  }
}

export const syncClient = new SyncClient();

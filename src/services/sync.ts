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
            this.handleRemoteState(event.data.payload);
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported:', e);
      }

      // Initial HTTP store check (reliably queries server state even if WS is slow or blocked)
      this.checkServerStoreHttp();

      // Connect WebSocket
      this.connect();

      // Listen to local DB changes to push to sync server (debounced)
      db.subscribe(() => {
        if (!this.isProcessingRemoteUpdate) {
          this.schedulePush();
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
          this.handleRemoteState(data.store);
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

    // Auto-detect WebSocket URL:
    // Works across local Vite dev proxy, LAN devices, Docker, and Render cloud hosting
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setStatus('connected');
        // Once connected, if local has cards, ensure server is up to date
        const localCount = db.getAllInstances().length;
        if (localCount > 0) {
          this.schedulePush();
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'SYNC_FULL_STATE' || msg.type === 'STATE_UPDATE') {
            this.handleRemoteState(msg.payload);
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

  private handleRemoteState(remotePayload: any) {
    if (!remotePayload || !Array.isArray(remotePayload.instances)) return;

    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remotePayload.timestamp || remotePayload.last_updated);
    const localCount = db.getAllInstances().length;
    const remoteCount = remotePayload.instances.length;

    // RULE 1: Never allow an empty remote store to wipe out a populated local collection
    if (remoteCount === 0 && localCount > 0) {
      console.warn('[SyncClient] Remote store is empty (0 cards) while local has', localCount, 'cards. Protecting local collection & updating server.');
      this.schedulePush();
      return;
    }

    // RULE 2: If local database has cards and local edits are newer or equal to remote, local ALWAYS wins
    if (localCount > 0 && localTs >= remoteTs && remoteTs > 0) {
      console.log('[SyncClient] Local state is newer or equal to server (local:', localTs, '>= remote:', remoteTs, '). Preserving local state & updating server.');
      this.schedulePush();
      return;
    }

    // RULE 3: If remote timestamp is missing/0 and local has cards, protect local state
    if (remoteTs === 0 && localCount > 0) {
      console.warn('[SyncClient] Remote store has missing timestamp. Preserving local state.');
      this.schedulePush();
      return;
    }

    // RULE 4: If local has cards and remote has fewer cards, take an automatic safety snapshot before sync
    if (localCount > 0 && remoteCount < localCount) {
      console.warn('[SyncClient] Remote has fewer cards than local. Taking safety snapshot before sync.');
      db.saveSnapshot(`Safety snapshot before sync (${localCount} -> ${remoteCount} cards)`);
    }

    this.isProcessingRemoteUpdate = true;
    try {
      if (remotePayload.settings?.theme) {
        applyTheme(remotePayload.settings.theme as GuildThemeId);
      }
      const jsonStr = JSON.stringify(remotePayload);
      db.importJSON(jsonStr, remoteTs || Date.now());
    } catch (err) {
      console.error('[SyncClient] Error applying remote state:', err);
    } finally {
      setTimeout(() => {
        this.isProcessingRemoteUpdate = false;
      }, 100);
    }
  }

  private schedulePush() {
    if (this.pushDebounceTimer) clearTimeout(this.pushDebounceTimer);
    this.pushDebounceTimer = setTimeout(() => {
      this.pushCurrentState();
    }, 250);
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
          payload
        });
      } catch {}
    }

    // 2. WebSocket push (real-time cross-device)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'STATE_UPDATE',
        payload
      }));
    }

    // 3. Reliable HTTP POST fallback (guaranteed persistence across sleep wakeups, dropped WS, and proxies)
    fetch('/api/sync/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: payload })
    }).catch(err => {
      console.debug('[SyncClient] HTTP push notice:', err);
    });
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

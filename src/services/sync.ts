import { db } from './db';
import { applyTheme, GuildThemeId } from './theme';

type SyncStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

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
    if (!remotePayload || !remotePayload.instances) return;

    // Check timestamps: only accept if remote is newer or local is uninitialized
    const localTs = db.getLastUpdated();
    const remoteTs = remotePayload.timestamp || 0;
    const localCount = db.getAllInstances().length;

    if (remoteTs > 0 && localTs > remoteTs && localCount > 0) {
      // Local state has newer changes! Push local state to server instead
      this.schedulePush();
      return;
    }

    this.isProcessingRemoteUpdate = true;
    try {
      if (remotePayload.settings?.theme) {
        applyTheme(remotePayload.settings.theme as GuildThemeId);
      }
      const jsonStr = JSON.stringify(remotePayload);
      db.importJSON(jsonStr, remoteTs || Date.now());
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
    }, 300);
  }

  private pushCurrentState() {
    const payload = {
      instances: db.getAllInstances(),
      cards: db.getAllCards(),
      history: db.getHistory(),
      settings: db.getSettings(),
      timestamp: db.getLastUpdated()
    };

    // Multi-tab broadcast
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'TAB_MUTATION',
          payload
        });
      } catch {}
    }

    // WebSocket push
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'STATE_UPDATE',
        payload
      }));
    }
  }

  public forceReconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.connect();
  }
}

export const syncClient = new SyncClient();

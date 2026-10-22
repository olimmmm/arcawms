import { db } from './db';
import { applyTheme, GuildThemeId } from './theme';
import { compressGzip, isGzipSupported } from './compression';

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

export function cleanHeaderAscii(val: string): string {
  if (!val) return '';
  return val.replace(/[^\x21-\x7E]/g, '');
}

export function cleanGithubToken(token: string): string {
  if (!token) return '';
  let cleaned = token.trim();
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, '');
  if (cleaned.toLowerCase().startsWith('bearer ')) {
    cleaned = cleaned.substring(7).trim();
  }
  return cleanHeaderAscii(cleaned);
}

export function cleanGistId(gistInput: string): string {
  if (!gistInput) return '';
  let cleaned = gistInput.trim();
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, '');
  const urlMatch = cleaned.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/i);
  if (urlMatch && urlMatch[1]) {
    return cleanHeaderAscii(urlMatch[1]);
  }
  return cleanHeaderAscii(cleaned);
}

export function getSyncHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const settings = db.getSettings();
    const token = cleanGithubToken(settings.githubToken || '');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const gistId = cleanGistId(settings.gistId || '');
    if (gistId) {
      headers['x-gist-id'] = gistId;
    }
  } catch (err) {
    console.debug('[SyncClient] Error building sync headers:', err);
  }
  return headers;
}

class SyncClient {
  private ws: WebSocket | null = null;
  private status: SyncStatus = 'disconnected';
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private uploadState: CloudUploadState = 'idle';
  private uploadListeners: Set<(state: CloudUploadState) => void> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private isProcessingRemoteUpdate = false;
  private isUserImporting = false;
  private isPushing = false;
  private hasPendingPush = false;
  private isCheckingServer = false;
  private reconnectTimer: any = null;
  private pushDebounceTimer: any = null;
  private syncedResetTimer: any = null;
  private errorResetTimer: any = null;
  private watchDogTimer: any = null;
  private pingTimer: any = null;
  private pollTimer: any = null;
  private wsFailCount = 0;

  public pauseSyncForImport() {
    this.isUserImporting = true;
    if (this.pushDebounceTimer) {
      clearTimeout(this.pushDebounceTimer);
      this.pushDebounceTimer = null;
    }
  }

  public resumeSync() {
    this.isUserImporting = false;
  }

  public async resumeSyncAndPush(): Promise<boolean> {
    this.isUserImporting = false;
    return await this.pushCurrentState(true);
  }

  private startBackgroundPolling() {
    this.stopBackgroundPolling();
    // In serverless environments without persistent WebSockets, poll lightweight metadata every 4s while tab is visible
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.checkServerStoreHttp();
        }
      }
    }, 4000);
  }

  private stopBackgroundPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('arcawms_tab_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'TAB_MUTATION' && !this.isProcessingRemoteUpdate) {
            if (event.data.clientId !== CLIENT_ID) {
              this.handleLiveBroadcast(event.data.payload, event.data.clientId);
            }
          } else if (event.data?.type === 'TAB_DELTA' && !this.isProcessingRemoteUpdate) {
            if (event.data.clientId !== CLIENT_ID && event.data.delta) {
              this.handleLiveDelta(event.data.delta, event.data.clientId);
            }
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel not supported:', e);
      }

      // Start background polling for cross-device updates in serverless mode
      this.startBackgroundPolling();

      // Connect WebSocket for real-time local/LAN multi-device sync
      this.connect();

      // CRITICAL: Await database hydration before checking server or attaching mutation listener.
      // This prevents the initial database load on boot from being treated as a local mutation
      // and overwriting newer cloud data from another device!
      db.whenHydrated().then(async () => {
        // Step 1: Reconcile with cloud store on boot BEFORE listening to any local mutations
        await this.checkServerStoreHttp();

        // Step 2: Now that hydration and initial server check are done, listen for legitimate user mutations
        db.subscribe(() => {
          if (!this.isProcessingRemoteUpdate && !this.isUserImporting) {
            this.setUploadState('syncing');
            this.schedulePush(100);
          }
        });
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
          this.stopBackgroundPolling();
        } else if (document.visibilityState === 'visible') {
          this.startBackgroundPolling();
          // Re-check cloud store on window focus for instant cross-device sync
          this.checkServerStoreHttp();
        }
      });
    }
  }

  private handleLiveDelta(delta: any, senderClientId?: string) {
    if (this.isUserImporting) return;
    if (senderClientId && senderClientId === CLIENT_ID) return;
    this.isProcessingRemoteUpdate = true;
    try {
      if (delta.settings?.theme) {
        applyTheme(delta.settings.theme as GuildThemeId);
      }
      db.applyDelta(delta);
    } finally {
      setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 250);
    }
  }

  private async checkServerStoreHttp() {
    if (this.isUserImporting || this.isCheckingServer) return;
    this.isCheckingServer = true;
    try {
      await db.whenHydrated();
      if (this.isUserImporting) return;

      const metaController = new AbortController();
      const metaTimeout = setTimeout(() => metaController.abort(), 8000);

      const res = await fetch(`/api/sync/meta?_t=${Date.now()}`, { 
        headers: getSyncHeaders(),
        cache: 'no-store',
        signal: metaController.signal
      });
      clearTimeout(metaTimeout);

      if (res.ok) {
        const meta = await res.json();

        // Auto-cache gistId if server resolved it and it's not saved locally yet
        if (meta?.gistId && db.getSettings().gistId !== meta.gistId) {
          db.updateSettings({ gistId: meta.gistId });
        }

        const localTs = parseTimestamp(db.getLastUpdated());
        const remoteTs = parseTimestamp(meta?.timestamp);
        const localCount = db.getAllInstances().length;
        const remoteCount = meta?.count || 0;

        // Guard: Cold server container vs established local.
        // ONLY trigger on initial startup if server is completely uninitialized (remoteTs === 0).
        if (localCount >= 50 && remoteCount <= 28 && remoteTs === 0) {
          this.schedulePush(200);
          return;
        }

        // Only download if server is actually newer!
        if (remoteTs > localTs) {
          let deltaSyncSucceeded = false;

          // FAST-PATH: Try Delta Sync first if local has established state
          if (localTs > 0 && localCount > 0) {
            try {
              const deltaController = new AbortController();
              const deltaTimeout = setTimeout(() => deltaController.abort(), 8000);

              const deltasRes = await fetch(`/api/sync/deltas?since=${localTs}&_t=${Date.now()}`, {
                headers: getSyncHeaders(),
                cache: 'no-store',
                signal: deltaController.signal
              });
              clearTimeout(deltaTimeout);

              if (deltasRes.ok) {
                const deltasData = await deltasRes.json();
                if (deltasData?.gistId && db.getSettings().gistId !== deltasData.gistId) {
                  db.updateSettings({ gistId: deltasData.gistId });
                }

                if (!deltasData.hasGap && Array.isArray(deltasData.deltas)) {
                  if (deltasData.deltas.length > 0) {
                    this.isProcessingRemoteUpdate = true;
                    try {
                      for (const d of deltasData.deltas) {
                        if (d.settings?.theme) {
                          applyTheme(d.settings.theme as GuildThemeId);
                        }
                        db.applyDelta(d);
                      }
                      console.log(`[SyncClient] Delta sync applied ${deltasData.deltas.length} deltas successfully.`);
                    } finally {
                      setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 250);
                    }
                  }
                  deltaSyncSucceeded = true;
                }
              }
            } catch (deltaErr) {
              console.debug('[SyncClient] Delta fetch failed, falling back to full store:', deltaErr);
            }
          }

          // FULL STORE FALLBACK: If delta sync had gaps or wasn't applicable
          if (!deltaSyncSucceeded) {
            const storeController = new AbortController();
            const storeTimeout = setTimeout(() => storeController.abort(), 12000);

            const storeRes = await fetch(`/api/sync/store?_t=${Date.now()}`, { 
              headers: getSyncHeaders(),
              cache: 'no-store',
              signal: storeController.signal
            });
            clearTimeout(storeTimeout);

            if (storeRes.ok) {
              const data = await storeRes.json();
              if (data?.gistId && db.getSettings().gistId !== data.gistId) {
                db.updateSettings({ gistId: data.gistId });
              }
              if (data?.store) {
                this.reconcileWithServer(data.store);
              }
            }
          }
        }
        // NOTE: We deliberately do NOT schedule a push here if localTs > remoteTs.
        // Legitimate user actions already schedule pushes via db.subscribe().
        // Pushing from a background poll creates infinite upload loops!
      }
    } catch {
      // Offline or network error
    } finally {
      this.isCheckingServer = false;
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
        this.wsFailCount = 0;
        this.setStatus('connected');
        this.startPingKeepAlive();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Ignore echoes of our own client's messages
          if (msg.clientId && msg.clientId === CLIENT_ID) return;

          if (msg.type === 'SYNC_HANDSHAKE') {
            // Lightweight handshake (~50 bytes) received from server
            db.whenHydrated().then(() => {
              const localTs = parseTimestamp(db.getLastUpdated());
              const remoteTs = parseTimestamp(msg.timestamp);
              const localCount = db.getAllInstances().length;
              const remoteCount = msg.count || 0;

              // Guard: Cold server container vs established local
              if (localCount >= 50 && remoteCount <= 28 && remoteTs === 0) {
                this.schedulePush(200);
                return;
              }

              if (remoteTs > localTs) {
                // Server actually has newer cards! Request full state payload
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({ type: 'REQUEST_FULL_STATE' }));
                }
              } else if (localTs > remoteTs) {
                // Local is newer! Push local collection to server
                this.schedulePush(200);
              }
              // If equal: PERFECT SYNC! 0 bytes downloaded!
            });
          } else if (msg.type === 'SYNC_FULL_STATE') {
            // Full state downloaded on explicit demand
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
        this.stopPingKeepAlive();
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.stopPingKeepAlive();
        this.setStatus('error');
      };
    } catch {
      this.stopPingKeepAlive();
      this.setStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private startPingKeepAlive() {
    this.stopPingKeepAlive();
    // 25s ping keeps Render reverse proxy from dropping idle connection (Render timeout is ~55-100s)
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING' }));
        } catch {}
      }
    }, 25000);
  }

  private stopPingKeepAlive() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.wsFailCount++;
    // If WebSockets are unavailable (e.g. running on Vercel serverless), back off to 60s
    const delay = this.wsFailCount > 3 ? 60000 : 5000;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Passive handshake with the server on boot/connection.
   * Compares timestamps without blasting out mutations to active clients.
   */
  private reconcileWithServer(remoteStore: any) {
    if (this.isUserImporting) return;
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
    if (localCount >= 50 && remoteCount <= 28 && remoteTs === 0) {
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
      db.importJSON(remoteStore, remoteTs);
    } finally {
      setTimeout(() => { this.isProcessingRemoteUpdate = false; }, 250);
    }
  }

  /**
   * Handles a live broadcast mutation emitted by another active client.
   */
  private handleLiveBroadcast(remotePayload: any, senderClientId?: string) {
    if (this.isUserImporting) return;
    if (!remotePayload || !Array.isArray(remotePayload.instances)) return;
    if (senderClientId && senderClientId === CLIENT_ID) return;

    const localTs = parseTimestamp(db.getLastUpdated());
    const remoteTs = parseTimestamp(remotePayload.timestamp || remotePayload.last_updated);
    const localCount = db.getAllInstances().length;
    const remoteCount = remotePayload.instances.length;

    // Safety guard against unseeded cold container broadcast
    if (localCount >= 50 && remoteCount <= 28 && remoteTs === 0) {
      return;
    }

    // True timestamp wins
    if (remoteTs > localTs) {
      console.log(`[SyncClient] Applying real-time update from client ${senderClientId} (${remoteCount} cards, ts: ${remoteTs}).`);
      this.applyRemoteStore(remotePayload, remoteTs);
    }
  }

  private schedulePush(delay = 120) {
    if (this.isUserImporting) return;
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

  private async pushCurrentState(broadcastMutation = true): Promise<boolean> {
    if (this.isUserImporting) return false;

    // Single-flight queue: if a push is already active, flag that a newer state
    // needs to be sent as soon as it completes, and return immediately.
    if (this.isPushing) {
      this.hasPendingPush = true;
      return true;
    }

    this.isPushing = true;
    this.hasPendingPush = false;
    this.setUploadState('syncing');

    // Watchdog timer: safety net so UI is NEVER permanently stuck in 'syncing'
    if (this.watchDogTimer) clearTimeout(this.watchDogTimer);
    this.watchDogTimer = setTimeout(() => {
      if (this.uploadState === 'syncing') {
        console.warn('[SyncClient] Push watchdog timeout reached (45s). Resetting to idle.');
        this.setUploadState('idle');
        this.isPushing = false;
      }
    }, 45000);

    try {
      // 1. FAST-PATH: DELTA SYNC
      // If we have pending deltas and fewer than 150 changes (typical everyday card actions),
      // send a tiny delta patch (~120 B - 2 KB) instead of full megabytes snapshot.
      const hasDeltas = db.hasPendingDeltas();
      const deltaCount = db.getPendingDeltaCount();
      const isDeltaCandidate = hasDeltas && !this.isUserImporting && deltaCount <= 150;

      if (isDeltaCandidate) {
        const delta = db.extractPendingDelta(CLIENT_ID);
        if (delta) {
          // Multi-tab broadcast
          if (this.broadcastChannel && broadcastMutation) {
            try {
              this.broadcastChannel.postMessage({
                type: 'TAB_DELTA',
                delta,
                clientId: CLIENT_ID
              });
            } catch {}
          }

          // Push delta to cloud API
          const body = JSON.stringify({
            type: 'delta',
            delta,
            clientId: CLIENT_ID
          });

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const res = await fetch('/api/sync/store', {
            method: 'POST',
            headers: getSyncHeaders(),
            body,
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const json = await res.json().catch(() => ({}));
            if (json?.gistId && db.getSettings().gistId !== json.gistId) {
              db.updateSettings({ gistId: json.gistId });
            }

            if (json.success !== false) {
              this.setUploadState('synced');
              if (this.syncedResetTimer) clearTimeout(this.syncedResetTimer);
              this.syncedResetTimer = setTimeout(() => {
                if (this.uploadState === 'synced') {
                  this.setUploadState('idle');
                }
              }, 2000);
              return true;
            }
          }

          console.warn('[SyncClient] Delta push was rejected or failed. Falling back to full snapshot.');
        }
      }

      // 2. FULL SNAPSHOT PUSH (Mass ingest, backup restore, or delta fallback)
      const { githubToken, gistId, ...safeSettings } = db.getSettings();

      const instances = db.getAllInstances();
      const customLists = db.getCustomLists();
      const history = db.getHistory().slice(0, 50);

      // Collect all card names and oracle IDs in active inventory, custom lists, and history
      const referencedNames = new Set<string>();
      const referencedOracles = new Set<string>();
      instances.forEach(inst => {
        if (inst.card_name) referencedNames.add(inst.card_name.trim().toLowerCase());
        if (inst.oracle_id) referencedOracles.add(inst.oracle_id);
      });
      customLists.forEach(list => {
        list.items?.forEach(item => {
          if (item.card_name) referencedNames.add(item.card_name.trim().toLowerCase());
          if (item.oracle_id) referencedOracles.add(item.oracle_id);
        });
      });
      history.forEach(item => {
        if (item.card_name) referencedNames.add(item.card_name.trim().toLowerCase());
      });

      // Bandwidth optimization: sync only cards used in active collection (~35 KB),
      // rather than the entire 5,000+ cached Scryfall search history (~2.85 MB)
      const syncedCards = db.getAllCards().filter(card => 
        referencedOracles.has(card.oracle_id) || referencedNames.has(card.name.trim().toLowerCase())
      );

      const payload = {
        instances,
        cards: syncedCards,
        custom_lists: customLists,
        history,
        settings: safeSettings,
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

      // 2. WebSocket push (real-time cross-device if connected)
      let pushedOverWs = false;
      if (this.ws && this.ws.readyState === WebSocket.OPEN && broadcastMutation) {
        try {
          this.ws.send(JSON.stringify({
            type: 'STATE_UPDATE',
            payload,
            clientId: CLIENT_ID
          }));
          pushedOverWs = true;
          db.clearPendingDeltas();
          this.setUploadState('synced');
          if (this.syncedResetTimer) clearTimeout(this.syncedResetTimer);
          this.syncedResetTimer = setTimeout(() => {
            if (this.uploadState === 'synced') {
              this.setUploadState('idle');
            }
          }, 2000);
          return true;
        } catch {
          pushedOverWs = false;
        }
      }

      // 3. Reliable HTTP POST fallback: only send if WebSocket is NOT connected, or on explicit unload
      if (!pushedOverWs) {
        let requestBody: string;
        const rawJson = JSON.stringify(payload);

        // Gzip compression for large payloads (> 50 KB, e.g. 15,000 card backups)
        if (rawJson.length > 50 * 1024 && isGzipSupported()) {
          try {
            const compressedBase64 = await compressGzip(rawJson);
            requestBody = JSON.stringify({
              compressed: true,
              data: compressedBase64,
              clientId: CLIENT_ID,
              broadcastMutation
            });
            console.log(`[SyncClient] Gzip compressed full snapshot (${(rawJson.length / 1024).toFixed(1)} KB -> ${(compressedBase64.length / 1024).toFixed(1)} KB)`);
          } catch (compErr) {
            console.warn('[SyncClient] Compression failed, sending raw JSON:', compErr);
            requestBody = JSON.stringify({
              store: payload,
              clientId: CLIENT_ID,
              broadcastMutation
            });
          }
        } else {
          requestBody = JSON.stringify({ 
            store: payload, 
            clientId: CLIENT_ID, 
            broadcastMutation 
          });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        const res = await fetch('/api/sync/store', {
          method: 'POST',
          headers: getSyncHeaders(),
          body: requestBody,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.status === 409) {
          // Conflict: Server has newer updates from another device! Pull newer changes
          console.log('[SyncClient] Server has newer changes from another device. Syncing down...');
          this.hasPendingPush = false;
          this.setUploadState('idle');
          await this.checkServerStoreHttp();
          return false;
        }

        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          // Auto-cache gistId if returned from server
          if (json?.gistId && db.getSettings().gistId !== json.gistId) {
            db.updateSettings({ gistId: json.gistId });
          }

          if (json.success !== false) {
            db.clearPendingDeltas();
            this.setUploadState('synced');
            if (this.syncedResetTimer) clearTimeout(this.syncedResetTimer);
            this.syncedResetTimer = setTimeout(() => {
              if (this.uploadState === 'synced') {
                this.setUploadState('idle');
              }
            }, 2000);
            return true;
          } else {
            console.warn('[SyncClient] Cloud store reported save failure:', json.error);
            this.setUploadState('error');
            if (this.errorResetTimer) clearTimeout(this.errorResetTimer);
            this.errorResetTimer = setTimeout(() => {
              if (this.uploadState === 'error') this.setUploadState('idle');
            }, 4000);
            return false;
          }
        } else {
          this.setUploadState('error');
          if (this.errorResetTimer) clearTimeout(this.errorResetTimer);
          this.errorResetTimer = setTimeout(() => {
            if (this.uploadState === 'error') this.setUploadState('idle');
          }, 4000);
          return false;
        }
      }
      return false;
    } catch (err: any) {
      console.debug('[SyncClient] Push exception:', err);
      this.setUploadState('error');
      if (this.errorResetTimer) clearTimeout(this.errorResetTimer);
      this.errorResetTimer = setTimeout(() => {
        if (this.uploadState === 'error') this.setUploadState('idle');
      }, 4000);
      return false;
    } finally {
      if (this.watchDogTimer) clearTimeout(this.watchDogTimer);
      this.isPushing = false;
      // If another mutation arrived while pushing, dispatch the next push immediately
      if (this.hasPendingPush) {
        this.schedulePush(50);
      }
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

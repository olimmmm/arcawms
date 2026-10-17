/**
 * GitHub Gist Cloud Storage Provider for ArcaWMS
 *
 * Persists collection state to a private GitHub Gist so that inventory data is never lost
 * when cloud hosting (Render free tier) spins down, reboots, or redeploys.
 */

const GITHUB_API_URL = 'https://api.github.com';
const GIST_FILENAME = 'arcawms_store.json';
const GIST_DESCRIPTION = 'ArcaWMS Cloud Storage Backup (Do not delete)';

export class GistStoreService {
  private token: string;
  private gistId: string | null = null;
  private isSaving = false;
  private pendingPayload: any = null;
  private initialized = false;

  constructor() {
    this.token = (process.env.GITHUB_TOKEN || process.env.GITHUB_GIST_TOKEN || '').trim();
    this.gistId = (process.env.GIST_ID || '').trim() || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.token);
  }

  public getGistId(): string | null {
    return this.gistId;
  }

  /**
   * Initializes the Gist store.
   * If GIST_ID is set in env, uses that.
   * Otherwise, checks the user's account for an existing ArcaWMS backup gist.
   * If none exists, creates a new private gist automatically.
   */
  public async init(): Promise<void> {
    if (!this.isConfigured() || this.initialized) return;

    try {
      if (this.gistId) {
        console.log(`[GistStore] Using configured GIST_ID: ${this.gistId}`);
        this.initialized = true;
        return;
      }

      console.log('[GistStore] Checking GitHub account for existing ArcaWMS backup gist...');
      const listRes = await fetch(`${GITHUB_API_URL}/gists?per_page=100`, {
        headers: this.getHeaders()
      });

      if (listRes.ok) {
        const gists: any[] = await listRes.json();
        const existing = gists.find(g => 
          g.description === GIST_DESCRIPTION || (g.files && g.files[GIST_FILENAME])
        );

        if (existing) {
          this.gistId = existing.id;
          console.log(`[GistStore] Found existing ArcaWMS backup gist: ${this.gistId}`);
          this.initialized = true;
          return;
        }
      } else {
        console.warn(`[GistStore] Listing gists returned HTTP ${listRes.status}`);
      }

      // If not found, create a new private Gist
      console.log('[GistStore] Creating new private backup gist on GitHub...');
      const createRes = await fetch(`${GITHUB_API_URL}/gists`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify({
                initialized_at: new Date().toISOString(),
                instances: [],
                cards: [],
                timestamp: 0
              }, null, 2)
            }
          }
        })
      });

      if (createRes.ok) {
        const created = await createRes.json();
        this.gistId = created.id;
        console.log(`[GistStore] Successfully created new private backup gist! ID: ${this.gistId}`);
        this.initialized = true;
      } else {
        const errText = await createRes.text();
        console.error(`[GistStore] Failed to create backup gist: HTTP ${createRes.status}`, errText);
      }
    } catch (err) {
      console.error('[GistStore] Error initializing Gist storage:', err);
    }
  }

  /**
   * Loads the latest collection state from the GitHub Gist.
   */
  public async load(): Promise<any | null> {
    if (!this.isConfigured()) return null;
    await this.init();
    if (!this.gistId) return null;

    try {
      console.log(`[GistStore] Fetching latest snapshot from GitHub Gist ${this.gistId}...`);
      const res = await fetch(`${GITHUB_API_URL}/gists/${this.gistId}`, {
        headers: this.getHeaders()
      });

      if (!res.ok) {
        console.warn(`[GistStore] Failed to fetch Gist: HTTP ${res.status}`);
        return null;
      }

      const gist = await res.json();
      const file = gist.files && gist.files[GIST_FILENAME];
      if (!file) {
        console.log('[GistStore] Gist file not found or empty.');
        return null;
      }

      let content = file.content;
      // If content was truncated by GitHub (>1MB file), fetch the raw content
      if (file.truncated && file.raw_url) {
        console.log('[GistStore] Gist file is truncated (>1MB), fetching full raw content...');
        const rawRes = await fetch(file.raw_url, {
          headers: this.getHeaders()
        });
        if (rawRes.ok) {
          content = await rawRes.text();
        }
      }

      if (content) {
        const parsed = JSON.parse(content);
        if (parsed && (Array.isArray(parsed.instances) || parsed.timestamp)) {
          console.log(`[GistStore] Loaded snapshot from Gist (${parsed.instances?.length || 0} cards, timestamp: ${parsed.timestamp})`);
          return parsed;
        }
      }
    } catch (err) {
      console.error('[GistStore] Error loading from Gist:', err);
    }
    return null;
  }

  /**
   * Saves the collection state to the GitHub Gist.
   */
  public async save(data: any): Promise<boolean> {
    if (!this.isConfigured()) return false;
    await this.init();
    if (!this.gistId) return false;

    if (this.isSaving) {
      this.pendingPayload = data;
      return true;
    }

    this.isSaving = true;
    try {
      const body = JSON.stringify({
        description: GIST_DESCRIPTION,
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(data, null, 2)
          }
        }
      });

      const res = await fetch(`${GITHUB_API_URL}/gists/${this.gistId}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body
      });

      if (res.ok) {
        console.log(`[GistStore] Successfully saved backup to GitHub Gist (${data.instances?.length || 0} cards).`);
        return true;
      } else {
        const errText = await res.text();
        console.error(`[GistStore] Failed to update Gist: HTTP ${res.status}`, errText);
      }
    } catch (err) {
      console.error('[GistStore] Error saving to Gist:', err);
    } finally {
      this.isSaving = false;
      if (this.pendingPayload) {
        const next = this.pendingPayload;
        this.pendingPayload = null;
        this.save(next);
      }
    }
    return false;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ArcaWMS-SyncServer',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }
}

export const gistStore = new GistStoreService();

const GITHUB_API_URL = 'https://api.github.com';
const GIST_FILENAME = 'arcawms_store.json';
const GIST_DESCRIPTION = 'ArcaWMS Cloud Storage Backup (Do not delete)';

let cachedGistId: string | null = (process.env.GIST_ID || '').trim() || null;

function getToken(): string {
  return (process.env.GITHUB_TOKEN || process.env.GITHUB_GIST_TOKEN || '').trim();
}

function getHeaders(): Record<string, string> {
  const token = getToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ArcaWMS-VercelServerless',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

export function isGistConfigured(): boolean {
  return Boolean(getToken());
}

export async function getGistId(): Promise<string | null> {
  if (cachedGistId) return cachedGistId;
  if (!isGistConfigured()) return null;

  try {
    const listRes = await fetch(`${GITHUB_API_URL}/gists?per_page=100`, {
      headers: getHeaders()
    });

    if (listRes.ok) {
      const gists: any[] = await listRes.json();
      const existing = gists.find(g =>
        g.description === GIST_DESCRIPTION || (g.files && g.files[GIST_FILENAME])
      );
      if (existing) {
        cachedGistId = existing.id;
        return cachedGistId;
      }
    }

    // Create if not found
    const createRes = await fetch(`${GITHUB_API_URL}/gists`, {
      method: 'POST',
      headers: getHeaders(),
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
            })
          }
        }
      })
    });

    if (createRes.ok) {
      const created = await createRes.json();
      cachedGistId = created.id;
      return cachedGistId;
    }
  } catch (err) {
    console.error('[Vercel Gist] Error resolving Gist ID:', err);
  }
  return null;
}

export async function loadGistStore(): Promise<any | null> {
  const gistId = await getGistId();
  if (!gistId) return null;

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      headers: getHeaders()
    });

    if (!res.ok) return null;

    const gist = await res.json();
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file) return null;

    let content = file.content;
    if (file.truncated && file.raw_url) {
      const rawRes = await fetch(file.raw_url, { headers: getHeaders() });
      if (rawRes.ok) content = await rawRes.text();
    }

    if (content) {
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[Vercel Gist] Error loading store:', err);
  }
  return null;
}

export async function saveGistStore(data: any): Promise<boolean> {
  const gistId = await getGistId();
  if (!gistId) return false;

  try {
    const body = JSON.stringify({
      description: GIST_DESCRIPTION,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data)
        }
      }
    });

    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body
    });

    return res.ok;
  } catch (err) {
    console.error('[Vercel Gist] Error saving store:', err);
    return false;
  }
}

export async function getGistMeta(): Promise<{ timestamp: number; count: number }> {
  const store = await loadGistStore();
  if (!store) return { timestamp: 0, count: 0 };
  return {
    timestamp: store.timestamp || store.last_updated || 0,
    count: Array.isArray(store.instances) ? store.instances.length : 0
  };
}

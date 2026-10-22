import type { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_API_URL = 'https://api.github.com';
const GIST_FILENAME = 'arcawms_store.json';
const GIST_DESCRIPTION = 'ArcaWMS Cloud Storage Backup (Do not delete)';

let cachedGistId: string | null = (process.env.GIST_ID || '').trim() || null;

function cleanAscii(val: any): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[^\x21-\x7E]/g, '').trim();
}

function getToken(req?: any): string {
  let token = '';
  const auth = req?.headers?.authorization || req?.headers?.Authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    token = auth.substring(7).trim();
  } else if (req?.query?.token && typeof req.query.token === 'string') {
    token = req.query.token.trim();
  } else if (req?.body?.token && typeof req.body.token === 'string') {
    token = req.body.token.trim();
  } else {
    token = (process.env.GITHUB_TOKEN || process.env.GITHUB_GIST_TOKEN || '').trim();
  }
  return cleanAscii(token);
}

function getCustomGistId(req?: any): string | null {
  let id = '';
  const headerId = req?.headers?.['x-gist-id'];
  if (headerId && typeof headerId === 'string' && headerId.trim()) {
    id = headerId.trim();
  } else if (req?.query?.gistId && typeof req.query.gistId === 'string') {
    id = req.query.gistId.trim();
  } else if (req?.body?.gistId && typeof req.body.gistId === 'string') {
    id = req.body.gistId.trim();
  } else {
    id = (process.env.GIST_ID || '').trim();
  }

  const cleaned = cleanAscii(id);
  if (!cleaned) return cachedGistId;
  const urlMatch = cleaned.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/i);
  return (urlMatch && urlMatch[1]) ? urlMatch[1] : cleaned;
}

function getHeaders(req?: any): Record<string, string> {
  const token = getToken(req);
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ArcaWMS-VercelServerless',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function getGistId(req?: any): Promise<string | null> {
  const customId = getCustomGistId(req);
  if (customId) return customId;
  if (cachedGistId) return cachedGistId;
  const token = getToken(req);
  if (!token) return null;

  try {
    const listRes = await fetch(`${GITHUB_API_URL}/gists?per_page=100`, {
      headers: getHeaders(req)
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
      headers: getHeaders(req),
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

async function loadGistStore(req?: any): Promise<any | null> {
  const gistId = await getGistId(req);
  if (!gistId) return null;

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      headers: getHeaders(req)
    });

    if (!res.ok) return null;

    const gist = await res.json();
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file) return null;

    let content = file.content;
    if (file.truncated && file.raw_url) {
      const rawRes = await fetch(file.raw_url, { headers: getHeaders(req) });
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

async function getGistQuickMeta(req?: any): Promise<{ timestamp: number; count: number } | null> {
  const gistId = await getGistId(req);
  if (!gistId) return null;

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      headers: getHeaders(req)
    });
    if (!res.ok) return null;
    const gist = await res.json();
    const metaFile = gist.files && gist.files['arcawms_meta.json'];
    if (metaFile && metaFile.content) {
      try {
        const meta = JSON.parse(metaFile.content);
        return { timestamp: meta.timestamp || 0, count: meta.count || 0 };
      } catch {}
    }
  } catch {}
  return null;
}

async function saveGistStore(data: any, req?: any): Promise<{ success: boolean; error?: string }> {
  const gistId = await getGistId(req);
  if (!gistId) return { success: false, error: 'No Gist ID available' };

  try {
    // SECURITY: Ensure no secrets or tokens are ever written to the Gist store!
    if (data && typeof data === 'object' && data.settings && typeof data.settings === 'object') {
      const { githubToken, gistId: _gId, token, ...safeSettings } = data.settings;
      data.settings = safeSettings;
    }

    const timestamp = data.timestamp || data.last_updated || Date.now();
    const count = Array.isArray(data.instances) ? data.instances.length : 0;
    const metaContent = JSON.stringify({
      timestamp,
      count,
      updated_at: new Date().toISOString()
    });

    const body = JSON.stringify({
      description: GIST_DESCRIPTION,
      files: {
        'arcawms_meta.json': {
          content: metaContent
        },
        [GIST_FILENAME]: {
          content: JSON.stringify(data)
        }
      }
    });

    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      method: 'PATCH',
      headers: getHeaders(req),
      body
    });

    if (!res.ok) {
      const errData: any = await res.json().catch(() => ({}));
      return { 
        success: false, 
        error: `GitHub PATCH error (${res.status}): ${errData?.message || res.statusText}` 
      };
    }

    return { success: true };
  } catch (err: any) {
    console.error('[Vercel Gist] Error saving store:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gist-id');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      const store = await loadGistStore(req);
      return res.status(200).json({ store });
    }

    if (req.method === 'POST') {
      let storeData = req.body?.store;
      if (!storeData && typeof req.body === 'string') {
        try {
          const parsed = JSON.parse(req.body);
          storeData = parsed.store;
        } catch {}
      }

      if (storeData && Array.isArray(storeData.instances)) {
        const incomingTs = storeData.timestamp || storeData.last_updated || 0;

        // Stale timestamp conflict check: prevent an older device from wiping a newer cloud store
        const existingMeta = await getGistQuickMeta(req);
        if (existingMeta && existingMeta.timestamp > incomingTs) {
          return res.status(409).json({ 
            success: false, 
            conflict: true, 
            serverTimestamp: existingMeta.timestamp, 
            clientTimestamp: incomingTs 
          });
        }

        const result = await saveGistStore(storeData, req);
        if (!result.success) {
          return res.status(502).json({ success: false, error: result.error });
        }
        return res.status(200).json({ success: true, timestamp: incomingTs });
      }
      return res.status(400).json({ error: 'Missing or invalid store data' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('[store] Handler error:', err);
    return res.status(500).json({
      error: err?.message || String(err)
    });
  }
}

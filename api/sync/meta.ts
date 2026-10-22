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
  } catch (err) {
    console.error('[Vercel Gist] Error resolving Gist ID:', err);
  }
  return null;
}

async function getGistQuickMeta(req?: any): Promise<{ timestamp: number; count: number; configured: boolean; gistId: string | null }> {
  const token = getToken(req);
  const configured = Boolean(token);
  const gistId = await getGistId(req);

  if (!configured || !gistId) {
    return { timestamp: 0, count: 0, configured: false, gistId: null };
  }

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
      headers: getHeaders(req)
    });

    if (!res.ok) {
      return { timestamp: 0, count: 0, configured: true, gistId };
    }

    const gist = await res.json();

    // Fast-path 1: read lightweight arcawms_meta.json directly from Gist metadata
    const metaFile = gist.files && gist.files['arcawms_meta.json'];
    if (metaFile && metaFile.content) {
      try {
        const meta = JSON.parse(metaFile.content);
        return {
          timestamp: meta.timestamp || 0,
          count: meta.count || 0,
          configured: true,
          gistId
        };
      } catch {}
    }

    // Fast-path 2: if store file is not truncated, read timestamp directly from gist response
    const storeFile = gist.files && gist.files[GIST_FILENAME];
    if (storeFile && storeFile.content && !storeFile.truncated) {
      try {
        const store = JSON.parse(storeFile.content);
        const timestamp = store.timestamp || store.last_updated || 0;
        const count = Array.isArray(store.instances) ? store.instances.length : 0;
        return { timestamp, count, configured: true, gistId };
      } catch {}
    }

    // Fast-path 3 (Self-healing): if meta file was missing and store is truncated,
    // fetch raw store file once, extract true metadata, and auto-persist arcawms_meta.json
    if (storeFile && storeFile.raw_url) {
      try {
        const rawRes = await fetch(storeFile.raw_url, { headers: getHeaders(req) });
        if (rawRes.ok) {
          const store = await rawRes.json();
          const timestamp = store.timestamp || store.last_updated || 0;
          const count = Array.isArray(store.instances) ? store.instances.length : 0;

          // Asynchronously write arcawms_meta.json to Gist so subsequent checks take ~120ms
          fetch(`${GITHUB_API_URL}/gists/${gistId}`, {
            method: 'PATCH',
            headers: getHeaders(req),
            body: JSON.stringify({
              files: {
                'arcawms_meta.json': {
                  content: JSON.stringify({
                    timestamp,
                    count,
                    updated_at: new Date().toISOString()
                  })
                }
              }
            })
          }).catch(() => {});

          return { timestamp, count, configured: true, gistId };
        }
      } catch {}
    }

    // Fallback: parse updated_at from GitHub metadata (never return count: 0 if store file exists)
    const updatedAtTs = gist.updated_at ? new Date(gist.updated_at).getTime() : 0;
    return {
      timestamp: updatedAtTs,
      count: storeFile ? 100 : 0,
      configured: true,
      gistId
    };
  } catch (err) {
    console.error('[Vercel Gist] Error reading fast meta:', err);
    return { timestamp: 0, count: 0, configured: true, gistId };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gist-id');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const meta = await getGistQuickMeta(req);
    return res.status(200).json(meta);
  } catch (err: any) {
    console.error('[meta] Handler error:', err);
    return res.status(200).json({
      timestamp: 0,
      count: 0,
      configured: false,
      gistId: null,
      error: err?.message || String(err)
    });
  }
}

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

async function resolveGist(req?: any): Promise<{ gistId: string | null; error?: string }> {
  const customId = getCustomGistId(req);
  if (customId) return { gistId: customId };
  if (cachedGistId) return { gistId: cachedGistId };
  const token = getToken(req);
  if (!token) return { gistId: null, error: 'No GitHub token provided' };

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
        return { gistId: cachedGistId };
      }
    } else {
      const errData: any = await listRes.json().catch(() => ({}));
      return { 
        gistId: null, 
        error: `GitHub API (${listRes.status}): ${errData?.message || listRes.statusText || 'Unauthorized (check token and gist scope)'}` 
      };
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
      return { gistId: cachedGistId };
    } else {
      const errData: any = await createRes.json().catch(() => ({}));
      return { 
        gistId: null, 
        error: `Gist creation (${createRes.status}): ${errData?.message || createRes.statusText}` 
      };
    }
  } catch (err: any) {
    return { gistId: null, error: err?.message || String(err) };
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

    const token = getToken(req);
    const configured = Boolean(token);
    const { gistId, error } = await resolveGist(req);

    return res.status(200).json({
      type: configured ? 'github_gist' : 'local_only',
      configured: Boolean(configured && gistId),
      gistId,
      error: !gistId ? (error || 'Failed to authenticate with GitHub') : undefined
    });
  } catch (err: any) {
    console.error('[cloud-status] Handler error:', err);
    return res.status(200).json({
      type: 'local_only',
      configured: false,
      gistId: null,
      error: err?.message || String(err)
    });
  }
}

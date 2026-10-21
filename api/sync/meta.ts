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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gist-id');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const token = getToken(req);
    const configured = Boolean(token);
    const gistId = await getGistId(req);

    if (!configured || !gistId) {
      return res.status(200).json({ timestamp: 0, count: 0, configured: false, gistId: null });
    }

    const store = await loadGistStore(req);
    if (!store) {
      return res.status(200).json({ timestamp: 0, count: 0, configured: true, gistId });
    }

    return res.status(200).json({
      timestamp: store.timestamp || store.last_updated || 0,
      count: Array.isArray(store.instances) ? store.instances.length : 0,
      configured: true,
      gistId
    });
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

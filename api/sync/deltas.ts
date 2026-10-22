import type { VercelRequest, VercelResponse } from '@vercel/node';

const GITHUB_API_URL = 'https://api.github.com';
const DELTAS_FILENAME = 'arcawms_deltas.json';
const META_FILENAME = 'arcawms_meta.json';
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gist-id');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const gistId = await getGistId(req);
    if (!gistId) {
      return res.status(400).json({ error: 'No Gist ID available' });
    }

    const sinceParam = req.query.since;
    const since = typeof sinceParam === 'string' ? (parseInt(sinceParam, 10) || 0) : 0;

    const gistRes = await fetch(`${GITHUB_API_URL}/gists/${gistId}?_t=${Date.now()}`, {
      headers: {
        ...getHeaders(req),
        'Cache-Control': 'no-cache, no-store'
      }
    });

    if (!gistRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch Gist from GitHub' });
    }

    const gist = await gistRes.json();
    let deltas: any[] = [];
    const deltasFile = gist.files && gist.files[DELTAS_FILENAME];

    if (deltasFile && deltasFile.content) {
      try {
        const parsed = JSON.parse(deltasFile.content);
        if (Array.isArray(parsed)) deltas = parsed;
      } catch {}
    } else if (deltasFile && deltasFile.raw_url) {
      try {
        const rawRes = await fetch(deltasFile.raw_url, {
          headers: {
            ...getHeaders(req),
            'Cache-Control': 'no-cache, no-store'
          }
        });
        if (rawRes.ok) {
          const rawParsed = await rawRes.json();
          if (Array.isArray(rawParsed)) deltas = rawParsed;
        }
      } catch {}
    }

    let metaTimestamp = 0;
    const metaFile = gist.files && gist.files[META_FILENAME];
    if (metaFile && metaFile.content) {
      try {
        const meta = JSON.parse(metaFile.content);
        metaTimestamp = meta.timestamp || 0;
      } catch {}
    }

    const filtered = deltas.filter(d => (d.timestamp || 0) > since);

    // Can client fast-path apply deltas?
    // If the oldest delta in the log is > since, or if deltas log was reset (e.g. after a full snapshot),
    // there is a gap and full store sync is required.
    const oldestInLog = deltas.length > 0 ? (deltas[0].timestamp || 0) : 0;
    const hasGap = (since > 0 && deltas.length > 0 && since < oldestInLog) || (metaTimestamp > since && deltas.length === 0);

    return res.status(200).json({
      deltas: filtered,
      hasGap,
      totalDeltasInLog: deltas.length,
      serverTimestamp: metaTimestamp,
      gistId
    });
  } catch (err: any) {
    console.error('[deltas] Handler error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

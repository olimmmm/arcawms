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

function applyDeltasToSnapshot(store: any, deltas: any[]): void {
  if (!store || !Array.isArray(store.instances) || !Array.isArray(deltas) || deltas.length === 0) return;
  const instMap = new Map<string, any>(store.instances.map((i: any) => [i.instance_id, i]));
  const listMap = new Map<string, any>((store.custom_lists || []).map((l: any) => [l.id, l]));
  const cardMap = new Map<string, any>((store.cards || []).map((c: any) => [c.oracle_id, c]));

  for (const delta of deltas) {
    if (delta.instances?.delete && Array.isArray(delta.instances.delete)) {
      for (const id of delta.instances.delete) instMap.delete(id);
    }
    if (delta.instances?.upsert && Array.isArray(delta.instances.upsert)) {
      for (const inst of delta.instances.upsert) {
        if (inst && inst.instance_id) instMap.set(inst.instance_id, inst);
      }
    }
    if (delta.lists?.delete && Array.isArray(delta.lists.delete)) {
      for (const id of delta.lists.delete) listMap.delete(id);
    }
    if (delta.lists?.upsert && Array.isArray(delta.lists.upsert)) {
      for (const list of delta.lists.upsert) {
        if (list && list.id) listMap.set(list.id, list);
      }
    }
    if (delta.cards && Array.isArray(delta.cards)) {
      for (const c of delta.cards) {
        if (c && c.oracle_id) cardMap.set(c.oracle_id, c);
      }
    }
    if (delta.settings && typeof delta.settings === 'object') {
      store.settings = { ...(store.settings || {}), ...delta.settings };
    }
    if (delta.timestamp && delta.timestamp > (store.timestamp || 0)) {
      store.timestamp = delta.timestamp;
    }
  }

  store.instances = Array.from(instMap.values());
  store.custom_lists = Array.from(listMap.values());
  store.cards = Array.from(cardMap.values());
}

async function loadGistStore(req?: any): Promise<any | null> {
  const gistId = await getGistId(req);
  if (!gistId) return null;

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}?_t=${Date.now()}`, {
      headers: {
        ...getHeaders(req),
        'Cache-Control': 'no-cache, no-store'
      }
    });

    if (!res.ok) return null;

    const gist = await res.json();
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file) return null;

    let content = file.content;
    if (file.truncated && file.raw_url) {
      const rawRes = await fetch(file.raw_url, { 
        headers: {
          ...getHeaders(req),
          'Cache-Control': 'no-cache, no-store'
        }
      });
      if (rawRes.ok) content = await rawRes.text();
    }

    if (content) {
      const store = JSON.parse(content);

      // Merge rolling deltas into snapshot so full store response is 100% current
      const deltasFile = gist.files && gist.files['arcawms_deltas.json'];
      let deltas: any[] = [];
      if (deltasFile && deltasFile.content) {
        try {
          const parsed = JSON.parse(deltasFile.content);
          if (Array.isArray(parsed)) deltas = parsed;
        } catch {}
      } else if (deltasFile && deltasFile.raw_url) {
        try {
          const rawDeltas = await fetch(deltasFile.raw_url, {
            headers: {
              ...getHeaders(req),
              'Cache-Control': 'no-cache, no-store'
            }
          });
          if (rawDeltas.ok) {
            const rawParsed = await rawDeltas.json();
            if (Array.isArray(rawParsed)) deltas = rawParsed;
          }
        } catch {}
      }

      if (Array.isArray(deltas) && deltas.length > 0) {
        const storeTs = store.timestamp || store.last_updated || 0;
        const pendingDeltas = deltas.filter(d => (d.timestamp || 0) > storeTs);
        if (pendingDeltas.length > 0) {
          applyDeltasToSnapshot(store, pendingDeltas);
        }
      }

      return store;
    }
  } catch (err) {
    console.error('[Vercel Gist] Error loading store:', err);
  }
  return null;
}

async function getGistQuickMeta(gistId: string, req?: any): Promise<{ timestamp: number; count: number } | null> {
  if (!gistId) return null;

  try {
    const res = await fetch(`${GITHUB_API_URL}/gists/${gistId}?_t=${Date.now()}`, {
      headers: {
        ...getHeaders(req),
        'Cache-Control': 'no-cache, no-store'
      }
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

async function saveGistDelta(delta: any, gistId: string, req?: any): Promise<{ success: boolean; error?: string; timestamp?: number }> {
  if (!gistId) return { success: false, error: 'No Gist ID available' };

  try {
    const timestamp = delta.timestamp || Date.now();

    // Fetch existing deltas log from Gist
    const gistRes = await fetch(`${GITHUB_API_URL}/gists/${gistId}?_t=${Date.now()}`, {
      headers: {
        ...getHeaders(req),
        'Cache-Control': 'no-cache, no-store'
      }
    });

    let deltas: any[] = [];
    let count = 0;

    if (gistRes.ok) {
      const gist = await gistRes.json();
      const deltasFile = gist.files && gist.files['arcawms_deltas.json'];
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

      const metaFile = gist.files && gist.files['arcawms_meta.json'];
      if (metaFile && metaFile.content) {
        try {
          const meta = JSON.parse(metaFile.content);
          count = meta.count || 0;
        } catch {}
      }
    }

    // Append incoming delta and keep the rolling window of the last 50 deltas
    deltas.push(delta);
    if (deltas.length > 50) {
      deltas = deltas.slice(deltas.length - 50);
    }

    // Keep count accurate: use count provided directly in delta if present, or fallback to existing meta count
    if (typeof delta.count === 'number') {
      count = delta.count;
    } else if (delta.instances?.delete && Array.isArray(delta.instances.delete)) {
      count = Math.max(0, count - delta.instances.delete.length);
    }

    const metaContent = JSON.stringify({
      timestamp,
      count,
      deltaCount: deltas.length,
      updated_at: new Date().toISOString()
    });

    // Write ONLY arcawms_deltas.json and arcawms_meta.json (~10 KB total, zero touch to arcawms_store.json)
    const body = JSON.stringify({
      description: GIST_DESCRIPTION,
      files: {
        'arcawms_meta.json': {
          content: metaContent
        },
        'arcawms_deltas.json': {
          content: JSON.stringify(deltas)
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

    return { success: true, timestamp };
  } catch (err: any) {
    console.error('[Vercel Gist] Error saving delta:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

async function saveGistStore(data: any, gistId: string, req?: any): Promise<{ success: boolean; error?: string }> {
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
      deltaCount: 0,
      updated_at: new Date().toISOString()
    });

    const body = JSON.stringify({
      description: GIST_DESCRIPTION,
      files: {
        'arcawms_meta.json': {
          content: metaContent
        },
        'arcawms_deltas.json': {
          content: '[]'
        },
        [GIST_FILENAME]: {
          content: typeof data === 'string' ? data : JSON.stringify(data)
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const gistId = await getGistId(req);

    if (req.method === 'GET') {
      const store = await loadGistStore(req);
      return res.status(200).json({ store, gistId });
    }

    if (req.method === 'POST') {
      if (!gistId) {
        return res.status(400).json({ success: false, error: 'No Gist ID available' });
      }

      let bodyData = req.body;
      if (typeof bodyData === 'string') {
        try {
          bodyData = JSON.parse(bodyData);
        } catch {}
      }

      // Decompress if client sent gzip-compressed snapshot
      if (bodyData?.compressed && bodyData?.data) {
        try {
          const rawBuffer = Buffer.from(bodyData.data, 'base64');
          const decompStream = new Blob([rawBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
          const decompText = await new Response(decompStream).text();
          bodyData = JSON.parse(decompText);
        } catch (decompErr: any) {
          console.error('[store] Decompression error:', decompErr);
          return res.status(400).json({ error: 'Failed to decompress compressed sync payload' });
        }
      }

      // 1. Handle Delta Sync Mode (~120 B - 2 KB)
      if (bodyData?.type === 'delta' || bodyData?.delta) {
        const delta = bodyData.delta || bodyData;
        const result = await saveGistDelta(delta, gistId, req);
        if (!result.success) {
          return res.status(502).json({ success: false, error: result.error, gistId });
        }
        return res.status(200).json({ success: true, type: 'delta', timestamp: result.timestamp, gistId });
      }

      // 2. Handle Full Snapshot Mode (backup restore or mass ingest)
      let storeData = bodyData?.store || bodyData;

      if (storeData && Array.isArray(storeData.instances)) {
        const incomingTs = storeData.timestamp || storeData.last_updated || 0;

        const result = await saveGistStore(storeData, gistId, req);
        if (!result.success) {
          return res.status(502).json({ success: false, error: result.error, gistId });
        }
        return res.status(200).json({ success: true, type: 'snapshot', timestamp: incomingTs, gistId });
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

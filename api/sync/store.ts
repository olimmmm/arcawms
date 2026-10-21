import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadGistStore, saveGistStore } from '../_gist';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    const { store } = req.body || {};
    if (store && Array.isArray(store.instances)) {
      const saved = await saveGistStore(store, req);
      return res.status(200).json({ success: saved, timestamp: store.timestamp || 0 });
    }
    return res.status(400).json({ error: 'Missing or invalid store data' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

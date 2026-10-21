import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGistMeta } from '../_gist';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gist-id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const meta = await getGistMeta(req);
  return res.status(200).json(meta);
}

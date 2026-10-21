import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGistId, isGistConfigured } from '../_gist';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const configured = isGistConfigured();
  const gistId = await getGistId();
  return res.status(200).json({
    type: configured ? 'github_gist' : 'local_only',
    configured,
    gistId
  });
}

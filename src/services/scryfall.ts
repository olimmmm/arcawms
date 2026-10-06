import { ScryfallCard } from '../types';
import { db, generateUUID } from './db';

export const CARD_BACK_IMAGE = 'https://cards.scryfall.io/back.jpg';

/**
 * Universal Scryfall image URL builder with redirect support
 */
export function getScryfallImageFallback(cardName: string): string {
  if (!cardName || !cardName.trim()) return CARD_BACK_IMAGE;
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName.trim())}&format=image`;
}

/**
 * Normalizes raw Scryfall API json into our lean ArcaWMS schema
 */
export function normalizeScryfallCard(raw: any): ScryfallCard {
  let imageUrl = '';
  if (raw.image_uris?.normal) {
    imageUrl = raw.image_uris.normal;
  } else if (raw.image_uris?.large) {
    imageUrl = raw.image_uris.large;
  } else if (raw.card_faces && raw.card_faces[0]?.image_uris?.normal) {
    imageUrl = raw.card_faces[0].image_uris.normal;
  } else if (raw.image_uris?.small) {
    imageUrl = raw.image_uris.small;
  } else if (raw.name) {
    imageUrl = getScryfallImageFallback(raw.name);
  } else {
    imageUrl = CARD_BACK_IMAGE;
  }

  let oracleText = raw.oracle_text || '';
  if (!oracleText && raw.card_faces) {
    oracleText = raw.card_faces.map((f: any) => `${f.name}: ${f.oracle_text || ''}`).join('\n//\n');
  }

  // Reliable Multi-Tier Pricing: EUR -> USD conversion -> Foil EUR -> Foil USD
  let priceEur = 0;
  if (raw.prices?.eur && !isNaN(parseFloat(raw.prices.eur))) {
    priceEur = parseFloat(raw.prices.eur);
  } else if (raw.prices?.usd && !isNaN(parseFloat(raw.prices.usd))) {
    priceEur = parseFloat(raw.prices.usd) * 0.92; // Convert USD to EUR
  } else if (raw.prices?.eur_foil && !isNaN(parseFloat(raw.prices.eur_foil))) {
    priceEur = parseFloat(raw.prices.eur_foil);
  } else if (raw.prices?.usd_foil && !isNaN(parseFloat(raw.prices.usd_foil))) {
    priceEur = parseFloat(raw.prices.usd_foil) * 0.92;
  }

  return {
    oracle_id: raw.oracle_id || raw.id || generateUUID(),
    name: raw.name || 'Unknown Card',
    mana_cost: raw.mana_cost || (raw.card_faces ? raw.card_faces[0]?.mana_cost : ''),
    cmc: typeof raw.cmc === 'number' ? raw.cmc : 0,
    type_line: raw.type_line || '',
    colors: raw.colors || (raw.card_faces ? raw.card_faces[0]?.colors : []) || [],
    color_identity: raw.color_identity || [],
    rarity: raw.rarity || 'common',
    image_url_normal: imageUrl,
    price_eur: Math.round(priceEur * 100) / 100,
    oracle_text: oracleText
  };
}

// In-memory cache for fast lookups
const scryfallMemoryCache = new Map<string, ScryfallCard>();

/**
 * Throttle helper to respect Scryfall's 10 requests/sec API rate limit
 */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * High-performance Batch Card Fetching using Scryfall's /cards/collection endpoint.
 * Fetches up to 75 cards in a SINGLE HTTP request, retrieving high-speed CDN images & prices.
 */
export async function fetchScryfallCardsBatch(cardNames: string[]): Promise<Map<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const toFetch: string[] = [];

  for (const name of cardNames) {
    const clean = name.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    const cached = scryfallMemoryCache.get(lower);
    if (cached && cached.price_eur > 0 && cached.image_url_normal.startsWith('https://cards.scryfall.io')) {
      result.set(lower, cached);
    } else {
      toFetch.push(clean);
    }
  }

  const uniqueNames = Array.from(new Set(toFetch));
  if (uniqueNames.length === 0) return result;

  // Process in chunks of up to 75 (Scryfall collection limit)
  const CHUNK_SIZE = 75;
  for (let i = 0; i < uniqueNames.length; i += CHUNK_SIZE) {
    const chunk = uniqueNames.slice(i, i + CHUNK_SIZE);
    const identifiers = chunk.map(name => ({ name }));

    let data: any = null;

    // 1. Direct browser fetch without forbidden User-Agent header (standard CORS)
    try {
      const res = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ identifiers })
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch {
      data = null;
    }

    // 2. If direct call failed (CORS block, network, ad-blocker), fallback to server proxy
    if (!data) {
      try {
        const proxyRes = await fetch('/api/scryfall/collection', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ identifiers })
        });
        if (proxyRes.ok) {
          data = await proxyRes.json();
        }
      } catch (proxyErr) {
        console.warn('Backend proxy fetch also failed:', proxyErr);
      }
    }

    if (data && data.data) {
      const returnedCards = data.data || [];
      for (const raw of returnedCards) {
        const norm = normalizeScryfallCard(raw);
        const lower = norm.name.toLowerCase();
        scryfallMemoryCache.set(lower, norm);
        scryfallMemoryCache.set(norm.oracle_id, norm);
        result.set(lower, norm);

        // Also index front face if double-faced e.g. "Delver of Secrets // Insectile Aberration"
        if (norm.name.includes(' // ')) {
          const front = norm.name.split(' // ')[0].toLowerCase();
          scryfallMemoryCache.set(front, norm);
          result.set(front, norm);
        }

        db.upsertCard(norm);
      }

      // Handle cards not found in exact collection batch (try fuzzy lookup)
      if (data.not_found && Array.isArray(data.not_found)) {
        for (const nf of data.not_found) {
          if (nf.name) {
            await sleep(80); // rate limit pause
            const single = await fetchScryfallCardByName(nf.name);
            if (single) {
              result.set(single.name.toLowerCase(), single);
              db.upsertCard(single);
            }
          }
        }
      }
    } else {
      console.warn('Scryfall batch fetch returned no data for chunk');
    }

    if (i + CHUNK_SIZE < uniqueNames.length) {
      await sleep(100); // 100ms interval between chunks
    }
  }

  return result;
}

/**
 * Fetch a single card by name from Scryfall (exact or fuzzy)
 */
export async function fetchScryfallCardByName(cardName: string): Promise<ScryfallCard | null> {
  const cleanName = cardName.trim().toLowerCase();
  const cached = scryfallMemoryCache.get(cleanName);
  if (cached && cached.price_eur > 0 && cached.image_url_normal.startsWith('https://cards.scryfall.io')) {
    return cached;
  }

  try {
    const encoded = encodeURIComponent(cardName.trim());
    let res = await fetch(`https://api.scryfall.com/cards/named?exact=${encoded}`, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      // Try fuzzy if exact not found
      await sleep(80);
      res = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encoded}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
    }

    if (!res.ok) return null;

    const data = await res.json();
    const normalized = normalizeScryfallCard(data);
    scryfallMemoryCache.set(cleanName, normalized);
    scryfallMemoryCache.set(normalized.name.toLowerCase(), normalized);
    scryfallMemoryCache.set(normalized.oracle_id, normalized);
    db.upsertCard(normalized);
    return normalized;
  } catch (err) {
    console.warn(`Failed to fetch card "${cardName}" from Scryfall:`, err);
    return null;
  }
}

/**
 * Background Card Metadata & Price Auto-Enricher
 * Scans the database for cards with missing CDN images or €0.00 prices,
 * and fetches them in fast 75-card batches from Scryfall.
 */
let isEnriching = false;

export async function enrichMissingCards(): Promise<number> {
  if (isEnriching) return 0;
  isEnriching = true;

  try {
    const allInstances = db.getAllInstances();
    const allCards = db.getAllCards();

    const cardMap = new Map<string, ScryfallCard>();
    allCards.forEach(c => {
      const existing = cardMap.get(c.name.toLowerCase());
      if (!existing || (c.price_eur > 0 && existing.price_eur === 0)) {
        cardMap.set(c.name.toLowerCase(), c);
      }
      cardMap.set(c.oracle_id, c);
    });

    const namesToEnrich = new Set<string>();

    for (const inst of allInstances) {
      const meta = cardMap.get(inst.card_name.toLowerCase()) || cardMap.get(inst.oracle_id);
      const needsImage = !meta || !meta.image_url_normal || !meta.image_url_normal.startsWith('https://cards.scryfall.io');
      const needsPrice = !meta || !meta.price_eur || meta.price_eur === 0;

      if (needsImage || needsPrice) {
        namesToEnrich.add(inst.card_name.trim());
      }
    }

    for (const c of allCards) {
      const needsImage = !c.image_url_normal || !c.image_url_normal.startsWith('https://cards.scryfall.io');
      const needsPrice = !c.price_eur || c.price_eur === 0;

      if (needsImage || needsPrice) {
        namesToEnrich.add(c.name.trim());
      }
    }

    if (namesToEnrich.size === 0) {
      db.healAndDeduplicateCards();
      return 0;
    }

    const namesList = Array.from(namesToEnrich);
    const fetchedMap = await fetchScryfallCardsBatch(namesList);

    let updatedCount = 0;
    for (const card of fetchedMap.values()) {
      db.upsertCard(card);
      updatedCount++;
    }

    db.healAndDeduplicateCards();
    return updatedCount;
  } catch (e) {
    console.warn('Error during auto-enrichment:', e);
    return 0;
  } finally {
    isEnriching = false;
  }
}

/**
 * Autocomplete card names for search bar
 */
export async function scryfallAutocomplete(prefix: string): Promise<string[]> {
  if (!prefix || prefix.length < 2) return [];
  try {
    const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(prefix)}`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

/**
 * Live search against Scryfall API using full Scryfall syntax
 */
export async function searchScryfallAPI(query: string): Promise<ScryfallCard[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=name`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((c: any) => {
      const norm = normalizeScryfallCard(c);
      scryfallMemoryCache.set(norm.name.toLowerCase(), norm);
      return norm;
    });
  } catch {
    return [];
  }
}

/**
 * Syntax Token definition
 */
interface SyntaxToken {
  type: 'term' | 'or';
  field?: string;
  op?: string;
  value?: string;
  negated?: boolean;
  rawText?: string;
}

/**
 * Robust Scryfall Syntax Parser supporting:
 * - cmc:3, cmc=3, cmc<=2, cmc>=4, cmc<2, cmc>3, cmc!=3
 * - mv:3 (alias for cmc)
 * - t:creature, type:instant
 * - c:u, c:rg, c:colorless
 * - id:wubrg, ci:esper
 * - o:"draw a card"
 * - r:rare, r:mythic
 * - Plain words & negation -t:land
 */
export function parseSyntaxQuery(query: string): SyntaxToken[][] {
  const orGroups: SyntaxToken[][] = [];
  const orParts = query.split(/\s+or\s+/i);

  for (const group of orParts) {
    const tokens: SyntaxToken[] = [];
    // Match field:value, field<=value, or "quoted phrases"
    const regex = /(-?)([a-zA-Z]+)([:=><!]=?|!=)(".*?"|'.*?'|\S+)|(".*?"|'.*?'|\S+)/g;
    let match;

    while ((match = regex.exec(group)) !== null) {
      if (match[2]) {
        const negated = match[1] === '-';
        const field = match[2].toLowerCase();
        const op = match[3];
        let val = match[4].replace(/^["']|["']$/g, '');
        tokens.push({ type: 'term', field, op, value: val, negated });
      } else if (match[5]) {
        let text = match[5].replace(/^["']|["']$/g, '');
        const negated = text.startsWith('-');
        if (negated) text = text.substring(1);
        tokens.push({ type: 'term', rawText: text, negated });
      }
    }

    if (tokens.length > 0) {
      orGroups.push(tokens);
    }
  }

  return orGroups;
}

const COLOR_ALIAS_MAP: Record<string, string[]> = {
  // Guilds
  azorius: ['W', 'U'],
  dimir: ['U', 'B'],
  rakdos: ['B', 'R'],
  gruul: ['R', 'G'],
  selesnya: ['W', 'G'],
  orzhov: ['W', 'B'],
  golgari: ['B', 'G'],
  simic: ['U', 'G'],
  izzet: ['U', 'R'],
  boros: ['W', 'R'],
  // Shards / Wedges
  esper: ['W', 'U', 'B'],
  grixis: ['U', 'B', 'R'],
  jund: ['B', 'R', 'G'],
  naya: ['W', 'R', 'G'],
  bant: ['W', 'U', 'G'],
  abzan: ['W', 'B', 'G'],
  jeskai: ['U', 'R', 'W'],
  sultai: ['B', 'G', 'U'],
  mardu: ['R', 'W', 'B'],
  temur: ['G', 'U', 'R'],
  // 4-Color
  glint: ['U', 'B', 'R', 'G'],
  dune: ['W', 'B', 'R', 'G'],
  ink: ['W', 'U', 'R', 'G'],
  witch: ['W', 'U', 'B', 'G'],
  yore: ['W', 'U', 'B', 'R'],
  // 5-Color
  wubrg: ['W', 'U', 'B', 'R', 'G'],
  fivecolor: ['W', 'U', 'B', 'R', 'G'],
};

export function parseAllowedColors(val: string): { isColorless: boolean; allowedColors: string[] } {
  const cleanVal = val.toLowerCase().trim();
  if (cleanVal === 'c' || cleanVal === 'colorless') {
    return { isColorless: true, allowedColors: [] };
  }
  if (COLOR_ALIAS_MAP[cleanVal]) {
    return { isColorless: false, allowedColors: COLOR_ALIAS_MAP[cleanVal] };
  }
  const chars = Array.from(new Set(cleanVal.toUpperCase().split('').filter(c => ['W', 'U', 'B', 'R', 'G'].includes(c))));
  return { isColorless: chars.length === 0, allowedColors: chars };
}

/**
 * Evaluates whether a card matches the parsed Scryfall syntax tokens
 */
export function cardMatchesSyntax(card: ScryfallCard, orGroups: SyntaxToken[][]): boolean {
  if (orGroups.length === 0) return true;

  return orGroups.some(tokens => {
    return tokens.every(token => {
      let matches = false;

      if (token.field) {
        const field = token.field;
        const val = token.value?.toLowerCase() || '';

        switch (field) {
          case 'cmc':
          case 'mv': {
            const numVal = parseFloat(val);
            if (isNaN(numVal)) return true;
            if (token.op === '<=' || token.op === '=<') matches = card.cmc <= numVal;
            else if (token.op === '>=' || token.op === '=>') matches = card.cmc >= numVal;
            else if (token.op === '<') matches = card.cmc < numVal;
            else if (token.op === '>') matches = card.cmc > numVal;
            else if (token.op === '!=' || token.op === '<>') matches = card.cmc !== numVal;
            else matches = card.cmc === numVal;
            break;
          }
          case 't':
          case 'type':
            matches = card.type_line.toLowerCase().includes(val);
            break;
          case 'c':
          case 'color': {
            if (val === 'c' || val === 'colorless') {
              matches = card.colors.length === 0;
            } else {
              const reqColors = val.toUpperCase().split('');
              matches = reqColors.every(c => card.colors.includes(c));
            }
            break;
          }
          case 'id':
          case 'ci':
          case 'identity': {
            const { isColorless, allowedColors } = parseAllowedColors(val);
            const cardId = card.color_identity || [];

            if (isColorless) {
              matches = cardId.length === 0;
            } else if (token.op === '=') {
              matches = cardId.length === allowedColors.length && cardId.every(c => allowedColors.includes(c));
            } else if (token.op === '>=') {
              matches = allowedColors.every(c => cardId.includes(c));
            } else if (token.op === '>') {
              matches = allowedColors.every(c => cardId.includes(c)) && cardId.length > allowedColors.length;
            } else if (token.op === '<') {
              matches = cardId.every(c => allowedColors.includes(c)) && cardId.length < allowedColors.length;
            } else {
              // MTG Commander identity inclusion (subsetting):
              // All colors in cardId must be contained in allowedColors (colorless cards cardId=[] trivially match)
              matches = cardId.every(c => allowedColors.includes(c));
            }
            break;
          }
          case 'o':
          case 'oracle':
            matches = (card.oracle_text || '').toLowerCase().includes(val);
            break;
          case 'r':
          case 'rarity':
            matches = card.rarity.toLowerCase() === val;
            break;
          case 'name':
          case 'n':
            matches = card.name.toLowerCase().includes(val);
            break;
          default:
            matches = card.name.toLowerCase().includes(val);
        }
      } else if (token.rawText) {
        const lowerText = token.rawText.toLowerCase();
        // Plain text search targets card names ONLY
        matches = card.name.toLowerCase().includes(lowerText);
      }

      return token.negated ? !matches : matches;
    });
  });
}

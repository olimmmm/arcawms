import { ScryfallCard } from '../types';
import { generateUUID } from './db';

/**
 * Universal Scryfall image URL builder with redirect support
 */
export function getScryfallImageFallback(cardName: string): string {
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
  } else if (raw.name) {
    imageUrl = getScryfallImageFallback(raw.name);
  }

  let oracleText = raw.oracle_text || '';
  if (!oracleText && raw.card_faces) {
    oracleText = raw.card_faces.map((f: any) => `${f.name}: ${f.oracle_text || ''}`).join('\n//\n');
  }

  let priceEur = 0;
  if (raw.prices?.eur) {
    priceEur = parseFloat(raw.prices.eur) || 0;
  } else if (raw.prices?.usd) {
    priceEur = (parseFloat(raw.prices.usd) || 0) * 0.92;
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
 * Fetch a single card by name from Scryfall
 */
export async function fetchScryfallCardByName(cardName: string): Promise<ScryfallCard | null> {
  const cleanName = cardName.trim().toLowerCase();
  if (scryfallMemoryCache.has(cleanName)) {
    return scryfallMemoryCache.get(cleanName)!;
  }

  try {
    const encoded = encodeURIComponent(cardName.trim());
    const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encoded}`, {
      headers: {
        'User-Agent': 'ArcaWMS/1.0',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      // Try fuzzy if exact not found
      const fuzzyRes = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encoded}`, {
        headers: {
          'User-Agent': 'ArcaWMS/1.0',
          'Accept': 'application/json'
        }
      });
      if (!fuzzyRes.ok) return null;
      const data = await fuzzyRes.json();
      const normalized = normalizeScryfallCard(data);
      scryfallMemoryCache.set(cleanName, normalized);
      scryfallMemoryCache.set(normalized.name.toLowerCase(), normalized);
      return normalized;
    }

    const data = await res.json();
    const normalized = normalizeScryfallCard(data);
    scryfallMemoryCache.set(cleanName, normalized);
    scryfallMemoryCache.set(normalized.name.toLowerCase(), normalized);
    return normalized;
  } catch (err) {
    console.warn(`Failed to fetch card "${cardName}" from Scryfall:`, err);
    return null;
  }
}

/**
 * Autocomplete card names for search bar
 */
export async function scryfallAutocomplete(prefix: string): Promise<string[]> {
  if (!prefix || prefix.length < 2) return [];
  try {
    const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(prefix)}`, {
      headers: { 'User-Agent': 'ArcaWMS/1.0' }
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
      headers: { 'User-Agent': 'ArcaWMS/1.0' }
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
export function parseSyntaxQuery(queryString: string): SyntaxToken[][] {
  const normalized = queryString.trim();
  if (!normalized) return [];

  // Match:
  // 1. field:op?value (e.g. cmc:3, cmc<=2, cmc:<=2, t:creature, o:"draw a card")
  // 2. "quoted phrase"
  // 3. standalone words
  const tokenRegex = /(-)?([a-zA-Z]+)([:=<>!]+)("([^"]+)"|([^\s()]+))|("([^"]+)")|(\S+)/g;

  const clauses: SyntaxToken[][] = [[]];

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(normalized)) !== null) {
    const isNegated = !!match[1];
    const field = match[2]?.toLowerCase();
    const rawOp = match[3];
    const valWithQuotes = match[5];
    const valWithoutQuotes = match[6];
    const quotedString = match[8];
    const standaloneWord = match[9];

    const currentClause = clauses[clauses.length - 1];

    if (standaloneWord && standaloneWord.toLowerCase() === 'or') {
      clauses.push([]);
      continue;
    }

    if (field && rawOp) {
      const value = (valWithQuotes !== undefined ? valWithQuotes : valWithoutQuotes) || '';
      currentClause.push({
        type: 'term',
        field,
        op: rawOp,
        value: value.toLowerCase(),
        negated: isNegated
      });
      continue;
    }

    if (quotedString !== undefined) {
      currentClause.push({
        type: 'term',
        rawText: quotedString.toLowerCase(),
        negated: isNegated
      });
      continue;
    }

    if (standaloneWord) {
      let word = standaloneWord.toLowerCase();
      let neg = false;
      if (word.startsWith('-')) {
        neg = true;
        word = word.slice(1);
      }
      if (word) {
        currentClause.push({
          type: 'term',
          rawText: word,
          negated: neg
        });
      }
    }
  }

  return clauses.filter(c => c.length > 0);
}

function matchToken(card: ScryfallCard, token: SyntaxToken): boolean {
  if (token.type !== 'term') return true;

  let matches = false;

  if (token.field) {
    const val = token.value || '';
    const rawOp = token.op || ':';

    switch (token.field) {
      case 'cmc':
      case 'mv': {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          // Normalize operator: ":<=" -> "<=", ":" -> "=", ":>=" -> ">=", etc.
          let cleanOp = rawOp.replace(/^:/, '');
          if (!cleanOp || cleanOp === ':') cleanOp = '=';

          if (cleanOp === '<=') matches = card.cmc <= num;
          else if (cleanOp === '>=') matches = card.cmc >= num;
          else if (cleanOp === '<') matches = card.cmc < num;
          else if (cleanOp === '>') matches = card.cmc > num;
          else if (cleanOp === '!=' || cleanOp === '<>') matches = card.cmc !== num;
          else matches = card.cmc === num; // '=' or ':'
        }
        break;
      }

      case 't':
      case 'type':
        matches = card.type_line.toLowerCase().includes(val);
        break;

      case 'o':
      case 'oracle':
        matches = (card.oracle_text || '').toLowerCase().includes(val);
        break;

      case 'c':
      case 'color': {
        const cardColors = (card.colors || []).map(c => c.toLowerCase());
        if (val === 'c' || val === 'colorless') {
          matches = cardColors.length === 0;
        } else if (val === 'm' || val === 'multicolor') {
          matches = cardColors.length > 1;
        } else {
          const needed = val.split('');
          matches = needed.every(n => {
            const mapped = n === 'w' ? 'w' : n === 'u' ? 'u' : n === 'b' ? 'b' : n === 'r' ? 'r' : n === 'g' ? 'g' : n;
            return cardColors.includes(mapped);
          });
        }
        break;
      }

      case 'id':
      case 'ci': {
        const cardIdentity = (card.color_identity || []).map(c => c.toLowerCase());
        if (val === 'c' || val === 'colorless') {
          matches = cardIdentity.length === 0;
        } else {
          const allowedColors = new Set(val.split(''));
          matches = cardIdentity.every(c => allowedColors.has(c));
        }
        break;
      }

      case 'r':
      case 'rarity':
        matches = card.rarity.toLowerCase().startsWith(val);
        break;

      default:
        matches = card.name.toLowerCase().includes(val) || 
                  card.type_line.toLowerCase().includes(val);
        break;
    }
  } else if (token.rawText) {
    const txt = token.rawText;
    matches = card.name.toLowerCase().includes(txt) ||
              card.type_line.toLowerCase().includes(txt) ||
              (card.oracle_text || '').toLowerCase().includes(txt);
  }

  return token.negated ? !matches : matches;
}

export function cardMatchesSyntax(card: ScryfallCard, clauses: SyntaxToken[][]): boolean {
  if (clauses.length === 0) return true;
  return clauses.some(clause => clause.every(token => matchToken(card, token)));
}

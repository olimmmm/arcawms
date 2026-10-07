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
const alreadyCheckedEnrichNames = new Set<string>();

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
      const clean = inst.card_name.trim().toLowerCase();
      if (alreadyCheckedEnrichNames.has(clean)) continue;
      const meta = cardMap.get(clean) || cardMap.get(inst.oracle_id);
      const needsImage = !meta || !meta.image_url_normal || !meta.image_url_normal.startsWith('https://cards.scryfall.io');
      const needsPrice = !meta || !meta.price_eur || meta.price_eur === 0;

      if (needsImage || needsPrice) {
        namesToEnrich.add(inst.card_name.trim());
      }
    }

    for (const c of allCards) {
      const clean = c.name.trim().toLowerCase();
      if (alreadyCheckedEnrichNames.has(clean)) continue;
      const needsImage = !c.image_url_normal || !c.image_url_normal.startsWith('https://cards.scryfall.io');
      const needsPrice = !c.price_eur || c.price_eur === 0;

      if (needsImage || needsPrice) {
        namesToEnrich.add(c.name.trim());
      }
    }

    // Mark as checked so we never loop on cards that have no EUR market price or are unresolvable
    for (const name of namesToEnrich) {
      alreadyCheckedEnrichNames.add(name.toLowerCase());
    }

    if (namesToEnrich.size === 0) {
      return 0;
    }

    const namesList = Array.from(namesToEnrich);
    const fetchedMap = await fetchScryfallCardsBatch(namesList);

    const cardsToUpsert = Array.from(fetchedMap.values());
    if (cardsToUpsert.length > 0) {
      db.upsertCardsBatch(cardsToUpsert);
    }

    return cardsToUpsert.length;
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
 * - p:5, p<=2, p>10, price:3 (EUR market price comparisons)
 * - otag:removal, otag:threaten (Scryfall functional tags)
 * - t:creature, type:instant
 * - c:u, c<=wu, c>=r, c=wu (Color comparisons with MTG set logic)
 * - id:w, id<=wu, id>=esper, id=wu (Commander Identity comparisons)
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
    // Operators supported: <=, >=, =<, =>, !=, ==, <, >, =, :
    const regex = /(-?)([a-zA-Z_-]+)(<=|>=|=<|=>|!=|==|<|>|=|:)(".*?"|'.*?'|\S+)|(".*?"|'.*?'|\S+)/g;
    let match;

    while ((match = regex.exec(group)) !== null) {
      if (match[2]) {
        const negated = match[1] === '-';
        const field = match[2].toLowerCase();
        let op = match[3];
        let val = match[4].replace(/^["']|["']$/g, '');

        // If op was ':' but val starts with an operator (e.g. id:<=wu or p:>=5)
        if (op === ':') {
          const nestedOp = val.match(/^(<=|>=|=<|=>|!=|==|<|>|=)(.*)$/);
          if (nestedOp) {
            op = nestedOp[1];
            val = nestedOp[2].trim().replace(/^["']|["']$/g, '');
          }
        }

        // Normalize operators
        if (op === '=<') op = '<=';
        if (op === '=>') op = '>=';
        if (op === '==') op = '=';

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
  // Single Colors
  white: ['W'],
  blue: ['U'],
  black: ['B'],
  red: ['R'],
  green: ['G'],
  colorless: [],
  c: [],
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
    const mapped = COLOR_ALIAS_MAP[cleanVal];
    return { isColorless: mapped.length === 0, allowedColors: mapped };
  }
  const chars = Array.from(new Set(cleanVal.toUpperCase().split('').filter(c => ['W', 'U', 'B', 'R', 'G'].includes(c))));
  return { isColorless: chars.length === 0, allowedColors: chars };
}

/**
 * Standard MTG Color & Commander Identity Set Evaluator
 * Supports:
 * - <= (subset of: all card colors must be in target; colorless is trivially subset)
 * - <  (strict proper subset of)
 * - >= (superset of: card contains at least all target colors)
 * - >  (strict proper superset of)
 * - =  (exact match: exact set of colors)
 * - != (not exact match)
 * - :  (default: subset for Commander Identity, superset for Color)
 */
export function matchColorSet(
  cardColors: string[] | undefined,
  targetColors: string[],
  isColorlessTarget: boolean,
  op: string = ':',
  isCommanderIdentity: boolean = false
): boolean {
  const cardSet = new Set((cardColors || []).map(c => c.toUpperCase()));
  const targetSet = new Set(targetColors.map(c => c.toUpperCase()));

  let normalizedOp = op;
  if (normalizedOp === '=<') normalizedOp = '<=';
  if (normalizedOp === '=>') normalizedOp = '>=';
  if (normalizedOp === '==') normalizedOp = '=';

  if (normalizedOp === ':') {
    if (isCommanderIdentity) {
      // Commander Identity default is subset (<=) per deck legality rules
      normalizedOp = '<=';
    } else {
      // Color default (c:) in MTG Scryfall is superset (>=) (contains target colors)
      normalizedOp = isColorlessTarget ? '=' : '>=';
    }
  }

  if (isColorlessTarget) {
    switch (normalizedOp) {
      case '<=':
      case '=':
        return cardSet.size === 0;
      case '<':
        return false;
      case '>=':
        return true;
      case '>':
      case '!=':
        return cardSet.size > 0;
      default:
        return cardSet.size === 0;
    }
  }

  switch (normalizedOp) {
    case '<=':
      // Subset: every color on the card must be in targetSet (colorless cards cardSet.size === 0 match)
      return Array.from(cardSet).every(c => targetSet.has(c));
    case '<':
      // Strict proper subset
      return Array.from(cardSet).every(c => targetSet.has(c)) && cardSet.size < targetSet.size;
    case '>=':
      // Superset: card has at least all colors in target
      return Array.from(targetSet).every(c => cardSet.has(c));
    case '>':
      // Strict proper superset: card has all target colors and at least one more
      return Array.from(targetSet).every(c => cardSet.has(c)) && cardSet.size > targetSet.size;
    case '=':
      // Exact match
      return cardSet.size === targetSet.size && Array.from(cardSet).every(c => targetSet.has(c));
    case '!=':
      return !(cardSet.size === targetSet.size && Array.from(cardSet).every(c => targetSet.has(c)));
    default:
      return Array.from(targetSet).every(c => cardSet.has(c));
  }
}

/**
 * Common Scryfall Oracle / Functional Tag mapping for offline and local inventory evaluation
 */
export const COMMON_ORACLE_TAGS: Record<string, RegExp> = {
  removal: /\b(destroy target|exile target|deals? \d+ damage to target|target (creature|permanent|player|planeswalker|artifact|enchantment) gets -\d+|return target [^.]+ to its owner's hand|counter target)\b/i,
  threaten: /\bgain control of target (creature|permanent) until end of turn\b/i,
  ramp: /(search your library for (a|an|up to \d+) (basic )?land|(add|adds)\s*(\{[a-z0-9/]+\}|\w+\s+mana)|put (a|an|target) land card (from your hand |onto the battlefield))/i,
  draw: /\bdraw(s)? (a|\d+|X) card(s)?\b/i,
  'card-draw': /\bdraw(s)? (a|\d+|X) card(s)?\b/i,
  tutor: /\bsearch your library for a (card|creature|artifact|enchantment|instant|sorcery|land)\b/i,
  counterspell: /\bcounter target\b/i,
  counter: /\bcounter target\b/i,
  wipe: /\b(destroy all|exile all|deals? \d+ damage to each (creature|permanent))\b/i,
  boardwipe: /\b(destroy all|exile all|deals? \d+ damage to each (creature|permanent))\b/i,
  wrath: /\b(destroy all|exile all)\b/i,
  bounce: /\breturn target [^.]+ to its owner's hand\b/i,
  burn: /\bdeals? \d+ damage to (any target|target (player|opponent|creature))\b/i,
  reanimate: /\breturn (target )?(creature|permanent) card from your graveyard to the battlefield\b/i,
  anthem: /\bcreatures you control get \+[0-9]+\/\+[0-9]+/i,
  sacrifice: /\bsacrifice (a|an|another)\b/i,
  'sac-outlet': /\bsacrifice a (creature|permanent|artifact):/i,
  lifegain: /\bgain(s)? \d+ life\b/i,
  mill: /\bmill(s)? \d+ card/i,
  cantrip: /\bdraw a card\b/i,
  token: /\bcreate(s)? (a|\d+|an|X) [^.]+ token/i,
  tokens: /\bcreate(s)? (a|\d+|an|X) [^.]+ token/i,
  blink: /\bexile (target|another) [^.]+, then return (it|that card)\b/i,
  flicker: /\bexile (target|another) [^.]+, then return (it|that card)\b/i,
  hatebear: /\b(can't cast|players can't|opponents can't|spells cost \{\d+\} more)\b/i,
  stax: /\b(can't cast|players can't|opponents can't|spells cost \{\d+\} more|enter the battlefield tapped)\b/i,
  protection: /\b(protection from|hexproof|indestructible|ward \{\d+\})\b/i,
  hexproof: /\bhexproof\b/i,
  indestructible: /\bindestructible\b/i,
  ward: /\bward(\s*\{|\b)/i,
  'extra-turn': /\btake an extra turn\b/i,
  'grave-hate': /\bexile (all|target) (cards? from (target|a) )?graveyard/i,
  drain: /\b(target opponent loses \d+ life and you gain|deals? \d+ damage .+ you gain \d+ life)\b/i,
  clone: /\byou may have [^.]+ enter the battlefield as a copy\b/i,
  recursion: /\breturn target [^.]+ from your graveyard to your hand\b/i,
  evasion: /\b(flying|menace|trample|unblockable|can't be blocked|shadow|fear|intimidate|horsemanship)\b/i,
  flying: /\bflying\b/i,
  trample: /\btrample\b/i,
  menace: /\bmenace\b/i,
  deathtouch: /\bdeathtouch\b/i,
  lifelink: /\blifelink\b/i,
  haste: /\bhaste\b/i,
  vigilance: /\bvigilance\b/i,
  firststrike: /\bfirst strike\b/i,
  doublestrike: /\bdouble strike\b/i,
  scry: /\bscry \d+\b/i,
};

export function cardMatchesTag(card: ScryfallCard, tag: string): boolean {
  if (!tag) return true;
  const normalizedTag = tag.toLowerCase().replace(/['"_\s]+/g, '-');
  
  if (COMMON_ORACLE_TAGS[normalizedTag]) {
    if (COMMON_ORACLE_TAGS[normalizedTag].test(card.oracle_text || '')) {
      return true;
    }
  }

  const rawWord = normalizedTag.replace(/-/g, '');
  if (COMMON_ORACLE_TAGS[rawWord]) {
    if (COMMON_ORACLE_TAGS[rawWord].test(card.oracle_text || '')) {
      return true;
    }
  }

  const text = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const searchWord = tag.toLowerCase().replace(/[-_]+/g, ' ');

  return text.includes(searchWord) || typeLine.includes(searchWord) || text.includes(normalizedTag);
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
        const op = token.op || ':';

        switch (field) {
          case 'cmc':
          case 'mv':
          case 'manavalue': {
            const numVal = parseFloat(val);
            if (isNaN(numVal)) return true;
            if (op === '<=') matches = card.cmc <= numVal;
            else if (op === '>=') matches = card.cmc >= numVal;
            else if (op === '<') matches = card.cmc < numVal;
            else if (op === '>') matches = card.cmc > numVal;
            else if (op === '!=') matches = card.cmc !== numVal;
            else matches = card.cmc === numVal;
            break;
          }
          case 'p':
          case 'price':
          case 'eur':
          case 'usd': {
            const numVal = parseFloat(val);
            if (isNaN(numVal)) return true;
            const price = typeof card.price_eur === 'number' ? card.price_eur : 0;
            if (op === '<=') matches = price <= numVal;
            else if (op === '>=') matches = price >= numVal;
            else if (op === '<') matches = price < numVal;
            else if (op === '>') matches = price > numVal;
            else if (op === '!=') matches = Math.abs(price - numVal) >= 0.01;
            else matches = Math.abs(price - numVal) < 0.01;
            break;
          }
          case 't':
          case 'type':
            matches = card.type_line.toLowerCase().includes(val);
            break;
          case 'c':
          case 'color':
          case 'colors': {
            const { isColorless, allowedColors } = parseAllowedColors(val);
            matches = matchColorSet(card.colors, allowedColors, isColorless, op, false);
            break;
          }
          case 'id':
          case 'ci':
          case 'identity':
          case 'commander': {
            const { isColorless, allowedColors } = parseAllowedColors(val);
            matches = matchColorSet(card.color_identity, allowedColors, isColorless, op, true);
            break;
          }
          case 'otag':
          case 'tag':
          case 'function': {
            matches = cardMatchesTag(card, val);
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

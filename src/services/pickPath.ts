import { CardInstance, PickItem, ScryfallCard } from '../types';

export interface ParsedCoordinate {
  unit: number;
  drawer: 'A' | 'B' | 'C';
  batch_index: number;
  valid: boolean;
  formatted: string;
}

/**
 * Parses coordinate string like '3.B.11'
 */
export function parseLocationId(location_id: string | null | undefined): ParsedCoordinate {
  if (!location_id) {
    return { unit: 999, drawer: 'C', batch_index: 999, valid: false, formatted: 'In Decks' };
  }

  const cleaned = location_id.trim().toUpperCase();
  const parts = cleaned.split(/[.\-_/]/);

  if (parts.length >= 3) {
    const unit = parseInt(parts[0], 10);
    const drawer = parts[1].toUpperCase() as 'A' | 'B' | 'C';
    const batch_index = parseInt(parts[2], 10);

    if (!isNaN(unit) && ['A', 'B', 'C'].includes(drawer) && !isNaN(batch_index)) {
      const formatted = `${unit}.${drawer}.${String(batch_index).padStart(2, '0')}`;
      return { unit, drawer, batch_index, valid: true, formatted };
    }
  }

  return { unit: 999, drawer: 'C', batch_index: 999, valid: false, formatted: location_id };
}

export function formatLocationId(unit: number, drawer: 'A' | 'B' | 'C', batch_index: number): string {
  return `${unit}.${drawer}.${String(batch_index).padStart(2, '0')}`;
}

export interface SmartBatchLocation {
  unit: number;
  drawer: 'A' | 'B' | 'C';
  batchIndex: number;
}

/**
 * Automatically selects the first available Unit and the first Drawer within that unit
 * that contains strictly fewer than 12 non-empty batches.
 * 
 * @param instances Array of card instances
 * @param totalUnits Current total dynamic units
 */
export function getSmartDefaultBatchLocation(
  instances: CardInstance[],
  totalUnits = 9
): SmartBatchLocation {
  const DRAWERS: ('A' | 'B' | 'C')[] = ['A', 'B', 'C'];

  // Map: `${unit}.${drawer}` -> Set<number> containing non-empty batch indices
  const drawerBatches = new Map<string, Set<number>>();

  for (const inst of instances) {
    if (inst.state !== 'A' || !inst.location_id) continue;
    const coord = parseLocationId(inst.location_id);
    if (!coord.valid || coord.unit < 1) continue;

    const key = `${coord.unit}.${coord.drawer}`;
    if (!drawerBatches.has(key)) {
      drawerBatches.set(key, new Set<number>());
    }
    drawerBatches.get(key)!.add(coord.batch_index);
  }

  // Scan Units 1..totalUnits in order, and Drawers A, B, C in order
  for (let u = 1; u <= totalUnits; u++) {
    for (const d of DRAWERS) {
      const key = `${u}.${d}`;
      const activeBatches = drawerBatches.get(key) || new Set<number>();

      // Condition: strictly fewer than 12 non-empty batches
      if (activeBatches.size < 12) {
        let nextBatch = 1;
        while (activeBatches.has(nextBatch)) {
          nextBatch++;
        }
        return {
          unit: u,
          drawer: d,
          batchIndex: nextBatch
        };
      }
    }
  }

  return {
    unit: 1,
    drawer: 'A',
    batchIndex: 1
  };
}

/**
 * Hierarchical 3-tier non-backtracking sorting:
 * 1. Unit (1 -> 9)
 * 2. Drawer (A -> C)
 * 3. Batch (1 -> 12+)
 */
export function compareLocations(locA: string | null | undefined, locB: string | null | undefined): number {
  const a = parseLocationId(locA);
  const b = parseLocationId(locB);

  if (a.valid && !b.valid) return -1;
  if (!a.valid && b.valid) return 1;
  if (!a.valid && !b.valid) return 0;

  if (a.unit !== b.unit) return a.unit - b.unit;
  if (a.drawer !== b.drawer) return a.drawer.localeCompare(b.drawer);
  return a.batch_index - b.batch_index;
}

/**
 * Cleans a single line from a decklist or inventory export.
 * Strips foil tags, set codes, collector numbers (e.g. "3 Carrion Feeder (EMA) 84").
 */
export function cleanCardLine(rawLine: string): { name: string; count: number } | null {
  let line = rawLine.trim();
  if (!line || line.startsWith('//') || line.startsWith('#') || line.toLowerCase().startsWith('sideboard') || line.toLowerCase().startsWith('commander')) {
    return null;
  }

  // 1. Remove foil tags like *F*, *foil*, [foil], (foil)
  line = line.replace(/\s*\*F\*\s*/gi, ' ')
             .replace(/\s*\*foil\*\s*/gi, ' ')
             .replace(/\s*\[foil\]\s*/gi, ' ')
             .replace(/\s*\(foil\)\s*/gi, ' ');

  // 2. Remove set code and collector number from common formats:
  // e.g. " (EMA) 84", " [EMA] 84", " (EMA) #84", " (EMA) 84/249", " (EMA:84)"
  line = line.replace(/\s*[\(\[][A-Za-z0-9_-]{2,6}[\)\]]?\s*#?[0-9A-Za-z*#★_\/-]*.*$/g, '');

  // 3. Extract quantity prefix (e.g. "3", "3x", "3X")
  const match = line.match(/^(\d+)[xX]?\s+(.+)$/);
  let count = 1;
  let cardName = line;

  if (match) {
    count = parseInt(match[1], 10);
    cardName = match[2].trim();
  }

  // 4. Clean extra spaces
  cardName = cardName.trim().replace(/\s{2,}/g, ' ');

  if (!cardName) return null;
  return { name: cardName, count: isNaN(count) || count < 1 ? 1 : count };
}

/**
 * Parses pasted decklist or wants list while preserving encounter order
 */
export function parseDecklistText(rawText: string): { name: string; count: number }[] {
  const lines = rawText.split(/\r?\n/);
  const items: { name: string; count: number }[] = [];

  for (const rawLine of lines) {
    const cleaned = cleanCardLine(rawLine);
    if (!cleaned) continue;

    const key = cleaned.name.toLowerCase();
    const existingIndex = items.findIndex(i => i.name.toLowerCase() === key);
    if (existingIndex >= 0) {
      items[existingIndex].count += cleaned.count;
    } else {
      items.push({ name: cleaned.name, count: cleaned.count });
    }
  }

  return items;
}

/**
 * Helper to group card items by name and output standard MTG text format (e.g. "4 Lightning Bolt\n1 Sol Ring")
 */
export function formatAsMtgText(items: { card_name: string; count?: number }[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.card_name.trim();
    if (!name) continue;
    const addCount = typeof item.count === 'number' && item.count > 0 ? item.count : 1;
    counts.set(name, (counts.get(name) || 0) + addCount);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => `${count} ${name}`)
    .join('\n');
}

/**
 * Generate linear pick route with 4-tier waterfall:
 * 1. Units (State A - Chaos Drawers)
 * 2. Decks / Brewing (State B - Real Cards)
 * 3. Proxies (Proxy Box State P or State B Proxies)
 * 4. Missing (Unowned)
 */
export function generatePickRoute(
  wantedList: { name: string; count: number }[],
  allInstances: CardInstance[],
  cardDictionary: Map<string, ScryfallCard>
): PickItem[] {
  const route: PickItem[] = [];

  const instancesByName = new Map<string, CardInstance[]>();
  for (const inst of allInstances) {
    const key = inst.card_name.toLowerCase();
    if (!instancesByName.has(key)) instancesByName.set(key, []);
    instancesByName.get(key)!.push(inst);
  }

  const allocated = new Set<string>();

  for (const wanted of wantedList) {
    const key = wanted.name.toLowerCase();
    const available = instancesByName.get(key) || [];

    let needed = wanted.count;

    // 1. Waterfall Tier 1: Cards located in Units (Chaos Drawers, State A)
    const inChaosInstances = available
      .filter(i => i.state === 'A' && !allocated.has(i.instance_id))
      .sort((a, b) => compareLocations(a.location_id, b.location_id));

    for (const inst of inChaosInstances) {
      if (needed <= 0) break;
      allocated.add(inst.instance_id);

      const coord = parseLocationId(inst.location_id);
      const metadata = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id);

      route.push({
        id: `pick-${inst.instance_id}`,
        card_name: inst.card_name,
        instance_id: inst.instance_id,
        oracle_id: inst.oracle_id,
        location_id: inst.location_id,
        unit: coord.unit,
        drawer: coord.drawer,
        batch_index: coord.batch_index,
        status: 'pending',
        inChaos: true,
        is_proxy: false,
        category: 'units',
        card_metadata: metadata,
        original_instance: inst
      });
      needed--;
    }

    // 2. Waterfall Tier 2: Real cards located in Decks / Brewing (State B, non-proxy)
    if (needed > 0) {
      const inDecksInstances = available.filter(
        i => i.state === 'B' && !i.is_proxy && !allocated.has(i.instance_id)
      );
      for (const inst of inDecksInstances) {
        if (needed <= 0) break;
        allocated.add(inst.instance_id);

        const metadata = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id);

        route.push({
          id: `pick-${inst.instance_id}`,
          card_name: inst.card_name,
          instance_id: inst.instance_id,
          oracle_id: inst.oracle_id,
          location_id: null,
          status: 'pending',
          inChaos: false,
          is_proxy: false,
          category: 'decks',
          card_metadata: metadata,
          original_instance: inst
        });
        needed--;
      }
    }

    // 3. Waterfall Tier 3: Proxies located in Proxy Box (State P) or in Decks (State B with is_proxy)
    if (needed > 0) {
      const proxyInstances = available.filter(
        i => (i.state === 'P' || Boolean(i.is_proxy)) && !allocated.has(i.instance_id)
      );
      for (const inst of proxyInstances) {
        if (needed <= 0) break;
        allocated.add(inst.instance_id);

        const metadata = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id);

        route.push({
          id: `pick-${inst.instance_id}`,
          card_name: inst.card_name,
          instance_id: inst.instance_id,
          oracle_id: inst.oracle_id,
          location_id: inst.state === 'P' ? 'Proxy Box' : 'Decks / Brewing (Proxy)',
          status: 'pending',
          inChaos: false,
          is_proxy: true,
          category: 'proxies',
          card_metadata: metadata,
          original_instance: inst
        });
        needed--;
      }
    }

    // 4. Waterfall Tier 4: Cards NOT in collection at all (Unowned / Missing)
    while (needed > 0) {
      const metadata = cardDictionary.get(wanted.name.toLowerCase());
      route.push({
        id: `unowned-${wanted.name}-${needed}`,
        card_name: wanted.name,
        location_id: null,
        status: 'missing',
        inChaos: false,
        is_proxy: false,
        category: 'missing',
        card_metadata: metadata
      });
      needed--;
    }
  }

  // Sort: In-Chaos items first by 3-tier coordinate (Unit -> Drawer -> Batch), then Decks, then Proxies, then Missing
  const categoryOrder: Record<string, number> = {
    units: 0,
    decks: 1,
    proxies: 2,
    missing: 3
  };

  route.sort((a, b) => {
    const orderA = categoryOrder[a.category || 'units'] ?? 9;
    const orderB = categoryOrder[b.category || 'units'] ?? 9;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    if (a.inChaos && b.inChaos) {
      return compareLocations(a.location_id, b.location_id);
    }

    return a.card_name.localeCompare(b.card_name);
  });

  return route;
}

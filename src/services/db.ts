import { ActivityLogItem, CardInstance, InventoryStats, ScryfallCard } from '../types';
import { parseLocationId } from './pickPath';

const STORAGE_KEY_INSTANCES = 'arcawms_instances_v2';
const STORAGE_KEY_CARDS = 'arcawms_cards_v2';
const STORAGE_KEY_HISTORY = 'arcawms_history_v2';
const STORAGE_KEY_LAST_UPDATED = 'arcawms_last_updated_v2';

export function generateUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const SEED_CARDS: ScryfallCard[] = [
  {
    oracle_id: '4c78d0a0-07bf-4e78-be7c-bc7d853697eb',
    name: 'Sol Ring',
    mana_cost: '{1}',
    cmc: 1,
    type_line: 'Artifact',
    colors: [],
    color_identity: [],
    rarity: 'uncommon',
    image_url_normal: 'https://cards.scryfall.io/normal/front/8/e/8ee443cc-e17a-493b-9c93-1f9e141a30e4.jpg?1789644446',
    price_eur: 1.45,
    oracle_text: '{T}: Add {C}{C}.'
  },
  {
    oracle_id: 'b1544f21-7e98-461b-aed5-e748b0168c52',
    name: 'Swords to Plowshares',
    mana_cost: '{W}',
    cmc: 1,
    type_line: 'Instant',
    colors: ['W'],
    color_identity: ['W'],
    rarity: 'uncommon',
    image_url_normal: 'https://cards.scryfall.io/normal/front/f/7/f7e12477-d59f-442b-a678-1be746d0b7be.jpg?1789599810',
    price_eur: 1.59,
    oracle_text: 'Exile target creature. Its controller gains life equal to its power.'
  },
  {
    oracle_id: '5def9f38-0a0b-4e8d-9f9d-29dcb46520b4',
    name: 'Esper Sentinel',
    mana_cost: '{W}',
    cmc: 1,
    type_line: 'Artifact Creature — Human Soldier',
    colors: ['W'],
    color_identity: ['W'],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/f/3/f3537373-ef54-4578-9d05-6216420ee349.jpg?1783926893',
    price_eur: 39.52,
    oracle_text: 'Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature\'s power.'
  },
  {
    oracle_id: 'e6963236-0929-4d64-9a00-47bfae6b4c3b',
    name: 'Lightning Bolt',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'uncommon',
    image_url_normal: 'https://cards.scryfall.io/normal/front/f/2/f29ba16f-c8fb-42fe-aabf-87089cb214a7.jpg',
    price_eur: 1.20,
    oracle_text: 'Lightning Bolt deals 3 damage to any target.'
  },
  {
    oracle_id: 'cc97c41d-4078-4333-8758-c0b029ea97ea',
    name: 'Counterspell',
    mana_cost: '{U}{U}',
    cmc: 2,
    type_line: 'Instant',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'uncommon',
    image_url_normal: 'https://cards.scryfall.io/normal/front/a/4/a4570110-dd69-424f-aa93-010ab39b7d83.jpg',
    price_eur: 1.50,
    oracle_text: 'Counter target spell.'
  },
  {
    oracle_id: '9a2243d6-4ae8-410a-8d19-d0076a91795c',
    name: 'Rhystic Study',
    mana_cost: '{2}{U}',
    cmc: 3,
    type_line: 'Enchantment',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/d/6/d6914dba-0d27-4055-ac34-b3ebf5802221.jpg',
    price_eur: 38.50,
    oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.'
  },
  {
    oracle_id: '50cb1a48-038b-4a57-b08e-59918737df98',
    name: 'Demonic Tutor',
    mana_cost: '{1}{B}',
    cmc: 2,
    type_line: 'Sorcery',
    colors: ['B'],
    color_identity: ['B'],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/3/b/3bdbc231-5316-4abd-9d8d-d87cff2c9847.jpg',
    price_eur: 42.00,
    oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.'
  },
  {
    oracle_id: 'd75b9c82-1b49-4c3e-a1b5-aeef57d6644b',
    name: 'Cyclonic Rift',
    mana_cost: '{1}{U}',
    cmc: 2,
    type_line: 'Instant',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/d/f/dfb7c4b9-f2f4-4d4e-baf2-86551c8150fe.jpg?1783913339',
    price_eur: 37.53,
    oracle_text: 'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U}'
  },
  {
    oracle_id: 'ea5103f5-27e0-4eb1-902c-7f34652d6bf3',
    name: 'Orcish Bowmasters',
    mana_cost: '{1}{B}',
    cmc: 2,
    type_line: 'Creature — Orc Archer',
    colors: ['B'],
    color_identity: ['B'],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/7/c/7c024bae-5631-4e20-ac69-df392ac9e109.jpg?1783916299',
    price_eur: 35.73,
    oracle_text: 'Flash\nWhen Orcish Bowmasters enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, Orcish Bowmasters deals 1 damage to any target. Then amass Orcs 1.'
  },
  {
    oracle_id: '37108cd4-bbab-4ce3-9ed6-f60e8422e703',
    name: 'Ragavan, Nimble Pilferer',
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Legendary Creature — Monkey Pirate',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/a/9/a9738cda-adb1-47fb-9f4c-ecd930228c4d.jpg?1783926839',
    price_eur: 33.82,
    oracle_text: 'Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player\'s library. Until end of turn, you may cast that card.\nDash {1}{R}'
  },
  {
    oracle_id: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538',
    name: 'The One Ring',
    mana_cost: '{4}',
    cmc: 4,
    type_line: 'Legendary Artifact',
    colors: [],
    color_identity: [],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/d/5/d5806e68-1054-458e-866d-1f2470f682b2.jpg?1790212038',
    price_eur: 95.98,
    oracle_text: 'Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.\nAt the beginning of your upkeep, you lose 1 life for each burden counter on The One Ring.\n{T}: Put a burden counter on The One Ring, then draw a card for each burden counter on The One Ring.'
  },
  {
    oracle_id: '36cd2364-d113-47d1-b2c4-b088d9eb88dd',
    name: 'Brainstorm',
    mana_cost: '{U}',
    cmc: 1,
    type_line: 'Instant',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'common',
    image_url_normal: 'https://cards.scryfall.io/normal/front/e/c/ec7d6864-7b6b-4f74-8474-9b9ec96b1d33.jpg?1789599806',
    price_eur: 1.89,
    oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.'
  },
  {
    oracle_id: '956381ba-6d37-4a8a-846c-bad79222dbee',
    name: 'Force of Will',
    mana_cost: '{3}{U}{U}',
    cmc: 5,
    type_line: 'Instant',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/8/9/89f612d6-7c59-4a7b-a87d-45f789e88ba5.jpg?1789015964',
    price_eur: 52.16,
    oracle_text: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.'
  },
  {
    oracle_id: '0895c9b7-ae7d-4bb3-af17-3b75deb50a25',
    name: 'Command Tower',
    mana_cost: '',
    cmc: 0,
    type_line: 'Land',
    colors: [],
    color_identity: [],
    rarity: 'common',
    image_url_normal: 'https://cards.scryfall.io/normal/front/1/a/1ac6cb62-45da-4e9a-84c6-09e6eacf0664.jpg?1789644465',
    price_eur: 0.17,
    oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.'
  },
  {
    oracle_id: 'fc0707c7-d504-4ccf-a0d2-3eb6e26e7a57',
    name: 'Bloodstained Mire',
    mana_cost: '',
    cmc: 0,
    type_line: 'Land',
    colors: [],
    color_identity: [],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/5/7/579743fe-f71e-4cb2-8629-d6b02ed1591d.jpg?1783911241',
    price_eur: 17.70,
    oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for a Swamp or Mountain card, put it onto the battlefield, then shuffle.'
  },
  {
    oracle_id: '17039058-822d-409f-938c-b727a366ba63',
    name: 'Steam Vents',
    mana_cost: '',
    cmc: 0,
    type_line: 'Land — Island Mountain',
    colors: [],
    color_identity: ['R', 'U'],
    rarity: 'rare',
    image_url_normal: 'https://cards.scryfall.io/normal/front/a/8/a83903c7-fd51-4526-aed2-359e946fea36.jpg?1784036844',
    price_eur: 17.50,
    oracle_text: '({T}: Add {U} or {R}.)\nAs this land enters, you may pay 2 life. If you don\'t, it enters tapped.'
  },
  {
    oracle_id: '153376c9-dffd-458c-8ce3-a4c8269bc4e9',
    name: 'Smothering Tithe',
    mana_cost: '{3}{W}',
    cmc: 4,
    type_line: 'Enchantment',
    colors: ['W'],
    color_identity: ['W'],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/8/6/861b5889-0183-4bee-afeb-a4b2aa700a8e.jpg?1783915712',
    price_eur: 43.31,
    oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.'
  },
  {
    oracle_id: 'e87906d2-db1a-4e19-b910-adb4eb339945',
    name: 'Urza, Lord High Artificer',
    mana_cost: '{2}{U}{U}',
    cmc: 4,
    type_line: 'Legendary Creature — Human Artificer',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'mythic',
    image_url_normal: 'https://cards.scryfall.io/normal/front/7/b/7b7a348a-51f7-4dc5-8fe7-1c70fea5e050.jpg?1783915686',
    price_eur: 14.23,
    oracle_text: 'When Urza enters, create a 0/0 colorless Construct artifact creature token with "This token gets +1/+1 for each artifact you control."'
  }
];

export const SEED_INSTANCES: CardInstance[] = [
  { instance_id: 'i-001', oracle_id: '4c78d0a0-07bf-4e78-be7c-bc7d853697eb', card_name: 'Sol Ring', state: 'A', location_id: '1.A.01' },
  { instance_id: 'i-002', oracle_id: '4c78d0a0-07bf-4e78-be7c-bc7d853697eb', card_name: 'Sol Ring', state: 'A', location_id: '3.B.11' },
  { instance_id: 'i-003', oracle_id: 'b1544f21-7e98-461b-aed5-e748b0168c52', card_name: 'Swords to Plowshares', state: 'A', location_id: '3.B.11' },
  { instance_id: 'i-004', oracle_id: '5def9f38-0a0b-4e8d-9f9d-29dcb46520b4', card_name: 'Esper Sentinel', state: 'A', location_id: '6.B.02' },
  { instance_id: 'i-005', oracle_id: 'e6963236-0929-4d64-9a00-47bfae6b4c3b', card_name: 'Lightning Bolt', state: 'A', location_id: '1.A.03' },
  { instance_id: 'i-006', oracle_id: 'e6963236-0929-4d64-9a00-47bfae6b4c3b', card_name: 'Lightning Bolt', state: 'A', location_id: '2.C.04' },
  { instance_id: 'i-007', oracle_id: 'e6963236-0929-4d64-9a00-47bfae6b4c3b', card_name: 'Lightning Bolt', state: 'A', location_id: '3.B.11' },
  { instance_id: 'i-008', oracle_id: 'e6963236-0929-4d64-9a00-47bfae6b4c3b', card_name: 'Lightning Bolt', state: 'A', location_id: '4.C.02' },
  { instance_id: 'i-009', oracle_id: 'cc97c41d-4078-4333-8758-c0b029ea97ea', card_name: 'Counterspell', state: 'A', location_id: '2.A.05' },
  { instance_id: 'i-010', oracle_id: 'cc97c41d-4078-4333-8758-c0b029ea97ea', card_name: 'Counterspell', state: 'A', location_id: '5.B.08' },
  { instance_id: 'i-011', oracle_id: '9a2243d6-4ae8-410a-8d19-d0076a91795c', card_name: 'Rhystic Study', state: 'A', location_id: '3.B.11' },
  { instance_id: 'i-012', oracle_id: '50cb1a48-038b-4a57-b08e-59918737df98', card_name: 'Demonic Tutor', state: 'A', location_id: '4.C.02' },
  { instance_id: 'i-013', oracle_id: 'd75b9c82-1b49-4c3e-a1b5-aeef57d6644b', card_name: 'Cyclonic Rift', state: 'A', location_id: '5.A.08' },
  { instance_id: 'i-014', oracle_id: 'ea5103f5-27e0-4eb1-902c-7f34652d6bf3', card_name: 'Orcish Bowmasters', state: 'A', location_id: '7.B.04' },
  { instance_id: 'i-015', oracle_id: '37108cd4-bbab-4ce3-9ed6-f60e8422e703', card_name: 'Ragavan, Nimble Pilferer', state: 'A', location_id: '8.A.01' },
  { instance_id: 'i-016', oracle_id: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538', card_name: 'The One Ring', state: 'A', location_id: '9.C.12' },
  { instance_id: 'i-017', oracle_id: '36cd2364-d113-47d1-b2c4-b088d9eb88dd', card_name: 'Brainstorm', state: 'A', location_id: '1.A.01' },
  { instance_id: 'i-018', oracle_id: '0895c9b7-ae7d-4bb3-af17-3b75deb50a25', card_name: 'Command Tower', state: 'A', location_id: '2.B.06' },
  { instance_id: 'i-019', oracle_id: 'fc0707c7-d504-4ccf-a0d2-3eb6e26e7a57', card_name: 'Bloodstained Mire', state: 'A', location_id: '4.C.02' },
  { instance_id: 'i-020', oracle_id: '17039058-822d-409f-938c-b727a366ba63', card_name: 'Steam Vents', state: 'A', location_id: '5.A.08' },

  { instance_id: 'i-021', oracle_id: '4c78d0a0-07bf-4e78-be7c-bc7d853697eb', card_name: 'Sol Ring', state: 'B', location_id: null },
  { instance_id: 'i-022', oracle_id: '956381ba-6d37-4a8a-846c-bad79222dbee', card_name: 'Force of Will', state: 'B', location_id: null },
  { instance_id: 'i-023', oracle_id: 'e87906d2-db1a-4e19-b910-adb4eb339945', card_name: 'Urza, Lord High Artificer', state: 'B', location_id: null },
  { instance_id: 'i-024', oracle_id: '153376c9-dffd-458c-8ce3-a4c8269bc4e9', card_name: 'Smothering Tithe', state: 'B', location_id: null },
  { instance_id: 'i-025', oracle_id: 'cc97c41d-4078-4333-8758-c0b029ea97ea', card_name: 'Counterspell', state: 'B', location_id: null },
  { instance_id: 'i-026', oracle_id: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538', card_name: 'The One Ring', state: 'P', location_id: 'Proxy Box', is_proxy: true },
  { instance_id: 'i-027', oracle_id: '4c78d0a0-07bf-4e78-be7c-bc7d853697eb', card_name: 'Sol Ring', state: 'B', location_id: null, is_proxy: true },
  { instance_id: 'i-028', oracle_id: '50cb1a48-038b-4a57-b08e-59918737df98', card_name: 'Demonic Tutor', state: 'A', location_id: '4.C.02', is_for_sale: true }
];

export const INITIAL_HISTORY: ActivityLogItem[] = [
  { id: 'h-1', type: 'added', card_name: 'Sol Ring', count: 2, to_location: '1.A.01', timestamp: new Date(Date.now() - 3600000 * 24 * 3).toISOString(), details: 'Batch ingested into Unit 1' },
  { id: 'h-2', type: 'moved', card_name: 'Force of Will', from_location: '1.A.01', to_location: 'Brewing/Decks', timestamp: new Date(Date.now() - 3600000 * 24 * 2).toISOString(), details: 'Checked out to brewing tray' },
  { id: 'h-3', type: 'added', card_name: 'The One Ring', count: 1, to_location: '9.C.12', timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), details: 'Ingested into Unit 9 Drawer C' }
];

class ArcaDatabase {
  private instances: Map<string, CardInstance> = new Map();
  private cards: Map<string, ScryfallCard> = new Map();
  private history: ActivityLogItem[] = [];
  private listeners: Set<() => void> = new Set();
  private initialized = false;
  private lastUpdated: number = 0;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;

    try {
      const storedTs = localStorage.getItem(STORAGE_KEY_LAST_UPDATED);
      if (storedTs) {
        this.lastUpdated = parseInt(storedTs, 10) || 0;
      } else {
        this.lastUpdated = 0;
      }
    } catch {
      this.lastUpdated = 0;
    }

    try {
      const storedCards = localStorage.getItem(STORAGE_KEY_CARDS);
      if (storedCards) {
        const parsed: ScryfallCard[] = JSON.parse(storedCards);
        parsed.forEach(c => this.cards.set(c.oracle_id, c));
      } else {
        SEED_CARDS.forEach(c => this.cards.set(c.oracle_id, c));
        this.saveCards();
      }
    } catch {
      SEED_CARDS.forEach(c => this.cards.set(c.oracle_id, c));
    }

    try {
      const storedInst = localStorage.getItem(STORAGE_KEY_INSTANCES);
      if (storedInst) {
        const parsed: CardInstance[] = JSON.parse(storedInst);
        parsed.forEach(inst => this.instances.set(inst.instance_id, inst));
      } else {
        SEED_INSTANCES.forEach(inst => this.instances.set(inst.instance_id, inst));
        this.saveInstances();
      }
    } catch {
      SEED_INSTANCES.forEach(inst => this.instances.set(inst.instance_id, inst));
    }

    try {
      const storedHist = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (storedHist) {
        this.history = JSON.parse(storedHist);
      } else {
        this.history = [...INITIAL_HISTORY];
        this.saveHistory();
      }
    } catch {
      this.history = [...INITIAL_HISTORY];
    }

    this.healAndDeduplicateCards();
    this.initialized = true;
  }

  public getLastUpdated(): number {
    return this.lastUpdated;
  }

  public hasLocalStoredInstances(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_INSTANCES);
      return stored !== null && stored !== '[]';
    } catch {
      return false;
    }
  }

  private safeSetItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[ArcaDB] Quota warning on ${key}. Pruning snapshots to reclaim space.`);
      try {
        localStorage.removeItem('arcawms_snapshots_v1');
        localStorage.setItem(key, value);
      } catch (err) {
        console.error(`[ArcaDB] Critical: failed to write ${key} to localStorage:`, err);
      }
    }
  }

  private touchUpdated(ts?: number) {
    this.lastUpdated = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    this.safeSetItem(STORAGE_KEY_LAST_UPDATED, String(this.lastUpdated));
  }

  private saveInstances() {
    this.safeSetItem(STORAGE_KEY_INSTANCES, JSON.stringify(Array.from(this.instances.values())));
  }

  private saveCards() {
    this.safeSetItem(STORAGE_KEY_CARDS, JSON.stringify(Array.from(this.cards.values())));
  }

  private saveHistory() {
    this.safeSetItem(STORAGE_KEY_HISTORY, JSON.stringify(this.history.slice(0, 100)));
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  public getAllCards(): ScryfallCard[] {
    return Array.from(this.cards.values());
  }

  public getCard(oracleIdOrName: string): ScryfallCard | undefined {
    if (!oracleIdOrName) return undefined;
    const clean = oracleIdOrName.trim().toLowerCase();

    // 1. Direct oracle_id match if it already has a valid market price
    if (this.cards.has(oracleIdOrName)) {
      const byId = this.cards.get(oracleIdOrName);
      if (byId && byId.price_eur > 0) return byId;
    }

    // 2. Name-based search: find canonical card with real market price
    let bestByName: ScryfallCard | undefined;
    for (const card of this.cards.values()) {
      if (card.name.trim().toLowerCase() === clean) {
        if (card.price_eur > 0) return card;
        if (!bestByName) bestByName = card;
      }
    }

    // 3. Search across all cards if oracle_id matches with price
    for (const card of this.cards.values()) {
      if (card.oracle_id === oracleIdOrName) {
        if (card.price_eur > 0) return card;
        if (!bestByName) bestByName = card;
      }
    }

    if (bestByName) return bestByName;
    return this.cards.get(oracleIdOrName);
  }

  public upsertCard(card: ScryfallCard) {
    const cleanName = card.name.trim().toLowerCase();

    // Preserve existing price if incoming card has price 0 but existing had valid price
    const existing = this.getCard(cleanName);
    if (existing && existing.price_eur > 0 && (!card.price_eur || card.price_eur === 0)) {
      card.price_eur = existing.price_eur;
      if (!card.image_url_normal || !card.image_url_normal.startsWith('https://cards.scryfall.io')) {
        card.image_url_normal = existing.image_url_normal;
      }
    }

    // 1. Remove any dummy/stale duplicate card entries with the same name
    for (const [id, c] of this.cards.entries()) {
      if (c.name.trim().toLowerCase() === cleanName && id !== card.oracle_id) {
        this.cards.delete(id);
      }
    }

    // 2. Store canonical card
    this.cards.set(card.oracle_id, card);
    this.saveCards();

    // 3. Heal any instances whose card_name matches so they point to the canonical oracle_id
    let instancesHealed = false;
    for (const [instId, inst] of this.instances.entries()) {
      if (inst.card_name.trim().toLowerCase() === cleanName) {
        if (inst.oracle_id !== card.oracle_id || inst.card_name !== card.name) {
          this.instances.set(instId, {
            ...inst,
            card_name: card.name,
            oracle_id: card.oracle_id,
            updated_at: new Date().toISOString()
          });
          instancesHealed = true;
        }
      }
    }

    if (instancesHealed) {
      this.saveInstances();
    }

    this.notify();
  }

  public upsertCardsBatch(cardsList: ScryfallCard[]) {
    if (!cardsList || cardsList.length === 0) return;

    let instancesHealed = false;

    for (const card of cardsList) {
      const cleanName = card.name.trim().toLowerCase();

      // Preserve existing price if incoming card has price 0 but existing had valid price
      const existing = this.getCard(cleanName);
      if (existing && existing.price_eur > 0 && (!card.price_eur || card.price_eur === 0)) {
        card.price_eur = existing.price_eur;
        if (!card.image_url_normal || !card.image_url_normal.startsWith('https://cards.scryfall.io')) {
          card.image_url_normal = existing.image_url_normal;
        }
      }

      // 1. Remove duplicate card entries with same name
      for (const [id, c] of this.cards.entries()) {
        if (c.name.trim().toLowerCase() === cleanName && id !== card.oracle_id) {
          this.cards.delete(id);
        }
      }

      // 2. Store canonical card
      this.cards.set(card.oracle_id, card);

      // 3. Heal any instances whose card_name matches
      for (const [instId, inst] of this.instances.entries()) {
        if (inst.card_name.trim().toLowerCase() === cleanName) {
          if (inst.oracle_id !== card.oracle_id || inst.card_name !== card.name) {
            this.instances.set(instId, {
              ...inst,
              card_name: card.name,
              oracle_id: card.oracle_id,
              updated_at: new Date().toISOString()
            });
            instancesHealed = true;
          }
        }
      }
    }

    this.saveCards();
    if (instancesHealed) {
      this.saveInstances();
    }
    this.notify();
  }

  /**
   * Scans collection to reconcile dummy UUIDs with real Scryfall cards
   * and link all physical card instances to canonical market prices.
   */
  public healAndDeduplicateCards(): void {
    const cardsByName = new Map<string, ScryfallCard[]>();
    for (const card of this.cards.values()) {
      const key = card.name.trim().toLowerCase();
      if (!cardsByName.has(key)) cardsByName.set(key, []);
      cardsByName.get(key)!.push(card);
    }

    let modified = false;

    for (const [name, cardList] of cardsByName.entries()) {
      // Sort: best card first (has price > 0, has CDN image)
      cardList.sort((a, b) => {
        const aPrice = a.price_eur || 0;
        const bPrice = b.price_eur || 0;
        if (aPrice > 0 && bPrice === 0) return -1;
        if (bPrice > 0 && aPrice === 0) return 1;
        const aCdn = a.image_url_normal?.startsWith('https://cards.scryfall.io') ? 1 : 0;
        const bCdn = b.image_url_normal?.startsWith('https://cards.scryfall.io') ? 1 : 0;
        if (aCdn !== bCdn) return bCdn - aCdn;
        return bPrice - aPrice;
      });

      const canonical = cardList[0];

      // Remove stale/dummy duplicate cards
      if (cardList.length > 1) {
        for (let i = 1; i < cardList.length; i++) {
          this.cards.delete(cardList[i].oracle_id);
          modified = true;
        }
      }

      // Link all instances of this card name to the canonical oracle_id
      for (const [instId, inst] of this.instances.entries()) {
        if (inst.card_name.trim().toLowerCase() === name) {
          if (inst.oracle_id !== canonical.oracle_id) {
            this.instances.set(instId, {
              ...inst,
              oracle_id: canonical.oracle_id
            });
            modified = true;
          }
        }
      }
    }

    if (modified) {
      this.saveCards();
      this.saveInstances();
      this.notify();
    }
  }

  public getAllInstances(): CardInstance[] {
    return Array.from(this.instances.values());
  }

  public getInstance(instanceId: string): CardInstance | undefined {
    return this.instances.get(instanceId);
  }

  public createInstance(instance: Omit<CardInstance, 'instance_id'>): CardInstance {
    // Storage Units CANNOT contain proxies!
    if (instance.is_proxy && instance.state === 'A') {
      throw new Error('Storage Units CANNOT contain proxies. Proxies must be stored in Proxy Box or Decks/Brewing.');
    }

    const isProxy = !!instance.is_proxy;
    const isForSale = !!instance.is_for_sale;
    let state = instance.state;
    if (!state) {
      state = isProxy ? 'P' : 'A';
    }
    const locationId = state === 'P' ? 'Proxy Box' : (state === 'B' ? null : (instance.location_id || '1.A.01'));

    const newInst: CardInstance = {
      ...instance,
      state,
      location_id: locationId,
      is_proxy: isProxy,
      is_for_sale: isForSale,
      instance_id: generateUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.instances.set(newInst.instance_id, newInst);
    this.saveInstances();
    this.touchUpdated();

    const locLabel = newInst.location_id || (newInst.state === 'B' ? 'Brewing/Decks' : (newInst.state === 'P' ? 'Proxy Box' : 'Storage'));

    this.logActivity({
      type: 'added',
      card_name: newInst.card_name,
      count: 1,
      to_location: locLabel,
      details: newInst.is_proxy ? `Added proxy into ${locLabel}` : `Added into ${locLabel}`,
      instance_id: newInst.instance_id,
      instance_snapshot: { ...newInst }
    });

    this.notify();
    return newInst;
  }

  /**
   * Check out card from Chaos Drawer or Proxy Box to Decks/Brewing
   */
  public checkoutToDecks(instanceId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      const fromLoc = existing.location_id || (existing.state === 'P' ? 'Proxy Box' : 'Drawer');
      this.instances.set(instanceId, {
        ...existing,
        state: 'B',
        location_id: null,
        updated_at: new Date().toISOString()
      });
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'moved',
        card_name: existing.card_name,
        count: 1,
        from_location: fromLoc,
        to_location: 'Brewing/Decks',
        details: `Checked out from ${fromLoc} to Brewing pool`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
  }

  /**
   * Return card from Decks back into Chaos Drawer coordinate.
   * Storage Units CANNOT contain proxies.
   */
  public returnToChaos(instanceId: string, locationId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      if (existing.is_proxy) {
        throw new Error('Storage Units CANNOT contain proxies. Proxies must be stored in Proxy Box.');
      }

      this.instances.set(instanceId, {
        ...existing,
        state: 'A',
        location_id: locationId,
        updated_at: new Date().toISOString()
      });
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'moved',
        card_name: existing.card_name,
        count: 1,
        from_location: 'Brewing/Decks',
        to_location: locationId,
        details: `Returned from brewing to drawer ${locationId}`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
  }

  /**
   * Return proxy card from Decks/Brewing back into Proxy Box.
   */
  public returnToProxyBox(instanceId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      const fromLoc = existing.location_id || (existing.state === 'B' ? 'Brewing/Decks' : 'Drawer');
      this.instances.set(instanceId, {
        ...existing,
        state: 'P',
        location_id: 'Proxy Box',
        is_proxy: true,
        updated_at: new Date().toISOString()
      });
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'moved',
        card_name: existing.card_name,
        count: 1,
        from_location: fromLoc,
        to_location: 'Proxy Box',
        details: `Returned from brewing to Proxy Box`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
  }

  /**
   * Move card into Proxy Box (flags as proxy and routes to Proxy Box)
   */
  public moveToProxyBox(instanceId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      const fromLoc = existing.location_id || (existing.state === 'B' ? 'Brewing/Decks' : 'Drawer');
      this.instances.set(instanceId, {
        ...existing,
        state: 'P',
        location_id: 'Proxy Box',
        is_proxy: true,
        updated_at: new Date().toISOString()
      });
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'moved',
        card_name: existing.card_name,
        count: 1,
        from_location: fromLoc,
        to_location: 'Proxy Box',
        details: `Moved to Proxy Box`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
  }

  /**
   * Toggle proxy status on a card instance.
   * If toggled to proxy while in a storage unit (State A), automatically relocates to Proxy Box (State P)
   * since storage units cannot contain proxies.
   */
  public toggleProxy(instanceId: string): { success: boolean; is_proxy: boolean; relocatedToProxyBox: boolean } {
    const existing = this.instances.get(instanceId);
    if (!existing) return { success: false, is_proxy: false, relocatedToProxyBox: false };

    const nextIsProxy = !existing.is_proxy;
    let nextState = existing.state;
    let nextLoc = existing.location_id;
    let relocated = false;

    if (nextIsProxy) {
      // Storage Units CANNOT contain proxies!
      if (existing.state === 'A') {
        nextState = 'P';
        nextLoc = 'Proxy Box';
        relocated = true;
      }
    } else {
      // Real card in Proxy Box moves out to Decks/Brewing
      if (existing.state === 'P') {
        nextState = 'B';
        nextLoc = null;
      }
    }

    const updated: CardInstance = {
      ...existing,
      is_proxy: nextIsProxy,
      state: nextState,
      location_id: nextLoc,
      updated_at: new Date().toISOString()
    };

    this.instances.set(instanceId, updated);
    this.saveInstances();
    this.touchUpdated();

    this.logActivity({
      type: 'moved',
      card_name: existing.card_name,
      from_location: existing.location_id || (existing.state === 'B' ? 'Brewing/Decks' : 'Proxy Box'),
      to_location: nextLoc || (nextState === 'B' ? 'Brewing/Decks' : 'Proxy Box'),
      details: nextIsProxy 
        ? (relocated ? 'Marked as Proxy and relocated to Proxy Box' : 'Marked as Proxy')
        : 'Marked as Real Card',
      instance_id: instanceId,
      instance_snapshot: { ...existing }
    });

    this.notify();
    return { success: true, is_proxy: nextIsProxy, relocatedToProxyBox: relocated };
  }

  /**
   * Toggle 'For Sale' status for a card instance.
   */
  public toggleForSale(instanceId: string): boolean {
    const existing = this.instances.get(instanceId);
    if (!existing) return false;

    const nextForSale = !existing.is_for_sale;
    const updated: CardInstance = {
      ...existing,
      is_for_sale: nextForSale,
      updated_at: new Date().toISOString()
    };

    this.instances.set(instanceId, updated);
    this.saveInstances();
    this.touchUpdated();

    this.logActivity({
      type: 'moved',
      card_name: existing.card_name,
      details: nextForSale ? 'Marked as For Sale (eBay)' : 'Removed from For Sale',
      instance_id: instanceId,
      instance_snapshot: { ...existing }
    });

    this.notify();
    return nextForSale;
  }

  /**
   * Update drawer coordinate for an instance
   */
  public updateLocation(instanceId: string, locationId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      if (existing.is_proxy) {
        throw new Error('Storage Units CANNOT contain proxies.');
      }
      const oldLoc = existing.location_id;
      this.instances.set(instanceId, {
        ...existing,
        state: 'A',
        location_id: locationId,
        updated_at: new Date().toISOString()
      });
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'moved',
        card_name: existing.card_name,
        count: 1,
        from_location: oldLoc,
        to_location: locationId,
        details: `Relocated from ${oldLoc} to ${locationId}`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
  }

  /**
   * Delete card instance (traded, sold, or removed from collection)
   */
  public deleteInstance(instanceId: string): boolean {
    const existing = this.instances.get(instanceId);
    const res = this.instances.delete(instanceId);
    if (res && existing) {
      this.saveInstances();
      this.touchUpdated();

      this.logActivity({
        type: 'removed',
        card_name: existing.card_name,
        count: 1,
        from_location: existing.location_id || 'Brewing/Decks',
        details: `Removed from collection (Sold / Traded)`,
        instance_id: instanceId,
        instance_snapshot: { ...existing }
      });

      this.notify();
    }
    return res;
  }

  /**
   * Restore an instance (for on-page undo)
   */
  public restoreInstance(instance: CardInstance): void {
    this.instances.set(instance.instance_id, instance);
    this.saveInstances();
    this.touchUpdated();

    this.logActivity({
      type: 'added',
      card_name: instance.card_name,
      count: 1,
      to_location: instance.location_id || 'Brewing/Decks',
      details: `Restored back to ${instance.location_id || 'Brewing'} (Undo)`,
      instance_id: instance.instance_id,
      instance_snapshot: { ...instance }
    });

    this.notify();
  }

  // History access
  public getHistory(): ActivityLogItem[] {
    return [...this.history];
  }

  public logActivity(item: Omit<ActivityLogItem, 'id' | 'timestamp'>) {
    const newEntry: ActivityLogItem = {
      ...item,
      id: generateUUID(),
      timestamp: new Date().toISOString()
    };
    this.history.unshift(newEntry);
    this.saveHistory();
  }

  /**
   * Toggles undo / redo for a specific history log item.
   * If not undone, takes cards back to where they were before that action.
   * If already undone, re-applies the original action (undoing the undo!).
   */
  public undoActivity(logId: string): boolean {
    const item = this.history.find(h => h.id === logId);
    if (!item) return false;

    const isCurrentlyUndone = !!item.undone;

    if (!isCurrentlyUndone) {
      // === PERFORM UNDO ===
      // Take cards back to where they were before that action
      if (item.type === 'moved') {
        let inst = item.instance_id ? this.instances.get(item.instance_id) : undefined;
        if (!inst) {
          for (const cand of this.instances.values()) {
            if (cand.card_name.trim().toLowerCase() === item.card_name.trim().toLowerCase()) {
              if (item.to_location === 'Brewing/Decks' && cand.state === 'B') {
                inst = cand;
                break;
              } else if (cand.location_id === item.to_location) {
                inst = cand;
                break;
              }
            }
          }
        }

        if (inst) {
          const wasInBrewing = item.from_location === 'Brewing/Decks' || !item.from_location;
          const wasInProxyBox = item.from_location === 'Proxy Box';
          const restoredState: 'A' | 'B' | 'P' = wasInProxyBox ? 'P' : (wasInBrewing ? 'B' : 'A');
          const restoredLoc = wasInProxyBox ? 'Proxy Box' : (wasInBrewing ? null : (item.from_location || null));

          this.instances.set(inst.instance_id, {
            ...inst,
            state: restoredState,
            location_id: restoredLoc,
            updated_at: new Date().toISOString()
          });
          this.saveInstances();
          this.touchUpdated();
        }
      } else if (item.type === 'added') {
        let inst = item.instance_id ? this.instances.get(item.instance_id) : undefined;
        if (!inst) {
          for (const cand of this.instances.values()) {
            if (cand.card_name.trim().toLowerCase() === item.card_name.trim().toLowerCase()) {
              if (item.to_location === 'Brewing/Decks' && cand.state === 'B') {
                inst = cand;
                break;
              } else if (item.to_location === 'Proxy Box' && cand.state === 'P') {
                inst = cand;
                break;
              } else if (cand.location_id === item.to_location) {
                inst = cand;
                break;
              }
            }
          }
        }

        if (inst) {
          item.instance_snapshot = { ...inst };
          this.instances.delete(inst.instance_id);
          this.saveInstances();
          this.touchUpdated();
        }
      } else if (item.type === 'removed') {
        const meta = this.getCard(item.card_name);
        const wasInBrewing = item.from_location === 'Brewing/Decks' || !item.from_location;
        const wasInProxyBox = item.from_location === 'Proxy Box';
        const restoredState: 'A' | 'B' | 'P' = wasInProxyBox ? 'P' : (wasInBrewing ? 'B' : 'A');
        const restoredLoc = wasInProxyBox ? 'Proxy Box' : (wasInBrewing ? null : (item.from_location || '1.A.01'));
        const restored: CardInstance = item.instance_snapshot || {
          instance_id: item.instance_id || generateUUID(),
          oracle_id: meta?.oracle_id || generateUUID(),
          card_name: meta?.name || item.card_name,
          state: restoredState,
          location_id: restoredLoc,
          is_proxy: wasInProxyBox || false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        this.instances.set(restored.instance_id, restored);
        this.saveInstances();
        this.touchUpdated();
      }

      item.undone = true;
      this.saveHistory();
      this.notify();
      return true;
    } else {
      // === PERFORM REDO (UNDO-ABLE UNDO) ===
      if (item.type === 'moved') {
        let inst = item.instance_id ? this.instances.get(item.instance_id) : undefined;
        if (!inst) {
          for (const cand of this.instances.values()) {
            if (cand.card_name.trim().toLowerCase() === item.card_name.trim().toLowerCase()) {
              if (item.from_location === 'Brewing/Decks' && cand.state === 'B') {
                inst = cand;
                break;
              } else if (item.from_location === 'Proxy Box' && cand.state === 'P') {
                inst = cand;
                break;
              } else if (cand.location_id === item.from_location) {
                inst = cand;
                break;
              }
            }
          }
        }

        if (inst) {
          const isGoingToBrewing = item.to_location === 'Brewing/Decks' || !item.to_location;
          const isGoingToProxyBox = item.to_location === 'Proxy Box';
          const targetState: 'A' | 'B' | 'P' = isGoingToProxyBox ? 'P' : (isGoingToBrewing ? 'B' : 'A');
          const targetLoc = isGoingToProxyBox ? 'Proxy Box' : (isGoingToBrewing ? null : (item.to_location || null));

          this.instances.set(inst.instance_id, {
            ...inst,
            state: targetState,
            location_id: targetLoc,
            updated_at: new Date().toISOString()
          });
          this.saveInstances();
          this.touchUpdated();
        }
      } else if (item.type === 'added') {
        const meta = this.getCard(item.card_name);
        const isGoingToBrewing = item.to_location === 'Brewing/Decks';
        const isGoingToProxyBox = item.to_location === 'Proxy Box';
        const targetState: 'A' | 'B' | 'P' = isGoingToProxyBox ? 'P' : (isGoingToBrewing ? 'B' : 'A');
        const targetLoc = isGoingToProxyBox ? 'Proxy Box' : (isGoingToBrewing ? null : (item.to_location || '1.A.01'));

        const restored: CardInstance = item.instance_snapshot || {
          instance_id: item.instance_id || generateUUID(),
          oracle_id: meta?.oracle_id || generateUUID(),
          card_name: meta?.name || item.card_name,
          state: targetState,
          location_id: targetLoc,
          is_proxy: isGoingToProxyBox || false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        this.instances.set(restored.instance_id, restored);
        this.saveInstances();
        this.touchUpdated();
      } else if (item.type === 'removed') {
        if (item.instance_id && this.instances.has(item.instance_id)) {
          this.instances.delete(item.instance_id);
        } else {
          for (const [id, cand] of this.instances.entries()) {
            if (cand.card_name.trim().toLowerCase() === item.card_name.trim().toLowerCase()) {
              this.instances.delete(id);
              break;
            }
          }
        }
        this.saveInstances();
        this.touchUpdated();
      }

      item.undone = false;
      this.saveHistory();
      this.notify();
      return true;
    }
  }

  public clearHistory(): void {
    this.history = [];
    this.saveHistory();
    this.touchUpdated();
    this.notify();
  }

  public getStats(): InventoryStats {
    let inChaos = 0;
    let inDecks = 0;
    let proxyCount = 0;
    let totalEur = 0;
    const unique = new Set<string>();

    for (const inst of this.instances.values()) {
      unique.add(inst.card_name.toLowerCase());
      if (inst.is_proxy) {
        proxyCount++;
      }
      if (inst.state === 'A') inChaos++;
      else if (inst.state === 'B') inDecks++;

      // Proxies MUST always be calculated with a price of £0
      if (!inst.is_proxy) {
        const meta = this.getCard(inst.card_name) || this.getCard(inst.oracle_id);
        if (meta && meta.price_eur) {
          totalEur += meta.price_eur;
        }
      }
    }

    return {
      inChaosCount: inChaos,
      inDecksCount: inDecks,
      proxyCount,
      totalCount: this.instances.size,
      totalEurValue: Math.round(totalEur * 100) / 100,
      uniqueCardCount: unique.size
    };
  }

  public exportCSV(): string {
    const instances = this.getAllInstances();
    const rows = [
      ['Card Name', 'State', 'Drawer Location', 'Is Proxy', 'For Sale', 'Mana Cost', 'CMC', 'Type Line', 'Price EUR', 'Oracle ID']
    ];

    for (const inst of instances) {
      const meta = this.getCard(inst.card_name) || this.getCard(inst.oracle_id);
      const isProxy = !!inst.is_proxy;
      const price = isProxy ? '0.00' : (meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00');
      const stateLabel = inst.state === 'A'
        ? 'Chaos Drawers'
        : (inst.state === 'P' ? 'Proxy Box' : 'Decks / Brewing');

      rows.push([
        `"${inst.card_name.replace(/"/g, '""')}"`,
        stateLabel,
        inst.location_id || (inst.state === 'P' ? 'Proxy Box' : 'Diffused / In Decks'),
        isProxy ? 'Yes' : 'No',
        inst.is_for_sale ? 'Yes' : 'No',
        `"${meta?.mana_cost || ''}"`,
        String(meta?.cmc ?? ''),
        `"${(meta?.type_line || '').replace(/"/g, '""')}"`,
        price,
        inst.oracle_id || ''
      ]);
    }

    return rows.map(r => r.join(',')).join('\n');
  }

  public getSnapshots(): Array<{ id: string; timestamp: string; label: string; cardCount: number }> {
    try {
      const raw = localStorage.getItem('arcawms_snapshots_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.map((s: any) => ({
          id: s.id,
          timestamp: s.timestamp,
          label: s.label,
          cardCount: s.cardCount
        }));
      }
    } catch {}
    return [];
  }

  public saveSnapshot(label = 'Collection Snapshot'): void {
    try {
      const raw = localStorage.getItem('arcawms_snapshots_v1');
      const existing = raw ? JSON.parse(raw) : [];
      const newSnap = {
        id: generateUUID(),
        timestamp: new Date().toISOString(),
        label,
        cardCount: this.instances.size,
        instances: Array.from(this.instances.values())
        // Omit full cards array to prevent localStorage quota exhaustion on mobile
      };
      const updated = [newSnap, ...existing].slice(0, 3);
      this.safeSetItem('arcawms_snapshots_v1', JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save snapshot:', e);
    }
  }

  public restoreSnapshot(snapshotId: string): boolean {
    try {
      const raw = localStorage.getItem('arcawms_snapshots_v1');
      if (!raw) return false;
      const snaps = JSON.parse(raw);
      const snap = snaps.find((s: any) => s.id === snapshotId);
      if (!snap) return false;

      this.instances.clear();
      snap.instances.forEach((inst: CardInstance) => this.instances.set(inst.instance_id, inst));
      if (snap.cards && Array.isArray(snap.cards)) {
        snap.cards.forEach((c: ScryfallCard) => this.cards.set(c.oracle_id, c));
      }
      this.saveInstances();
      this.saveCards();
      this.touchUpdated();
      this.logActivity({
        type: 'added',
        card_name: `Restored: ${snap.label}`,
        count: snap.cardCount,
        to_location: 'Collection',
        details: `Restored snapshot from ${new Date(snap.timestamp).toLocaleString()}`
      });
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  public getSettings(): { theme: string; unitCount?: number } {
    try {
      const raw = localStorage.getItem('arcawms_settings_v1');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { theme: 'orzhov', unitCount: 9 };
  }

  public updateSettings(settings: Partial<{ theme: string; unitCount?: number }>) {
    const current = this.getSettings();
    const next = { ...current, ...settings };
    try {
      localStorage.setItem('arcawms_settings_v1', JSON.stringify(next));
    } catch {}
    this.touchUpdated();
    this.notify();
  }

  public getUnitCount(): number {
    const settings = this.getSettings();
    let maxInstanceUnit = 9;
    for (const inst of this.instances.values()) {
      if (inst.state === 'A' && inst.location_id) {
        const p = parseLocationId(inst.location_id);
        if (p.valid && p.unit > maxInstanceUnit && p.unit < 999) {
          maxInstanceUnit = p.unit;
        }
      }
    }
    const configured = typeof settings.unitCount === 'number' && settings.unitCount > 0 ? settings.unitCount : 9;
    return Math.max(configured, maxInstanceUnit);
  }

  public addUnit(): number {
    const current = this.getUnitCount();
    const next = current + 1;
    this.updateSettings({ unitCount: next });
    return next;
  }

  public canRemoveUnit(unitNumber: number): boolean {
    if (unitNumber <= 1) return false;
    return !Array.from(this.instances.values()).some(inst => {
      if (inst.state !== 'A' || !inst.location_id) return false;
      const p = parseLocationId(inst.location_id);
      return p.valid && p.unit === unitNumber;
    });
  }

  public removeLastUnit(): boolean {
    const current = this.getUnitCount();
    if (current <= 1 || !this.canRemoveUnit(current)) return false;
    this.updateSettings({ unitCount: current - 1 });
    return true;
  }

  public exportJSON(): string {
    return JSON.stringify({
      cards: Array.from(this.cards.values()),
      instances: Array.from(this.instances.values()),
      history: this.history,
      settings: this.getSettings(),
      last_updated: this.lastUpdated,
      exported_at: new Date().toISOString()
    }, null, 2);
  }

  public importJSON(jsonStr: string, remoteTimestamp?: number): { success: boolean; count: number; error?: string } {
    try {
      if (!jsonStr || typeof jsonStr !== 'string') {
        return { success: false, count: 0, error: 'Empty or invalid backup data' };
      }

      let data: any;
      try {
        data = JSON.parse(jsonStr);
      } catch (parseErr: any) {
        return { success: false, count: 0, error: `Invalid JSON format: ${parseErr.message}` };
      }

      if (!data || typeof data !== 'object') {
        return { success: false, count: 0, error: 'Backup data must be a JSON object or array' };
      }

      // Backwards compatibility: If imported data is a top-level array, treat as instances
      let rawInstances: any[] = [];
      if (Array.isArray(data)) {
        rawInstances = data;
        data = { instances: rawInstances, cards: [], history: [], settings: {} };
      } else if (Array.isArray(data.instances)) {
        rawInstances = data.instances;
      } else if (Array.isArray(data.collection)) {
        rawInstances = data.collection;
      } else if (Array.isArray(data.cards_instances)) {
        rawInstances = data.cards_instances;
      } else {
        return { success: false, count: 0, error: 'No card instances found in backup file' };
      }

      // 1. Sanitize & normalize card instances (guarantees no undefined fields)
      let highestUnitFound = 9;
      const cleanInstances: CardInstance[] = [];

      for (const raw of rawInstances) {
        if (!raw || typeof raw !== 'object') continue;
        const cardName = String(raw.card_name || raw.name || 'Unknown Card').trim();
        if (!cardName) continue;

        const isProxy = Boolean(raw.is_proxy || raw.proxy);
        const isForSale = Boolean(raw.is_for_sale || raw.for_sale);

        let state: 'A' | 'B' | 'P' = 'A';
        let locationId: string | null = null;

        if (raw.state === 'P' || (isProxy && raw.state !== 'B' && (!raw.location_id || raw.location_id === 'Proxy Box'))) {
          state = 'P';
          locationId = 'Proxy Box';
        } else if (raw.state === 'B') {
          state = 'B';
          locationId = null;
        } else {
          state = 'A';
        }

        // Storage Units CANNOT contain proxies!
        if (isProxy && state === 'A') {
          state = 'P';
          locationId = 'Proxy Box';
        }

        if (state === 'A') {
          if (raw.location_id) {
            locationId = String(raw.location_id).trim();
            const parsed = parseLocationId(locationId);
            if (parsed.valid && parsed.unit > highestUnitFound && parsed.unit < 999) {
              highestUnitFound = parsed.unit;
            }
          } else {
            locationId = '1.A.01';
          }
        }

        cleanInstances.push({
          instance_id: String(raw.instance_id || generateUUID()),
          oracle_id: String(raw.oracle_id || ''),
          card_name: cardName,
          state,
          location_id: locationId,
          is_proxy: isProxy,
          is_for_sale: isForSale,
          created_at: raw.created_at || new Date().toISOString(),
          updated_at: raw.updated_at || new Date().toISOString()
        });
      }

      // 2. Cards dictionary (safely initialized to empty map/array if missing in older backups)
      if (data.cards && Array.isArray(data.cards)) {
        data.cards.forEach((c: any) => {
          if (c && typeof c === 'object' && (c.oracle_id || c.name)) {
            const oracleId = c.oracle_id || generateUUID();
            this.cards.set(oracleId, {
              oracle_id: oracleId,
              name: String(c.name || '').trim(),
              mana_cost: c.mana_cost,
              cmc: typeof c.cmc === 'number' ? c.cmc : 0,
              type_line: c.type_line || 'Magic Card',
              colors: Array.isArray(c.colors) ? c.colors : [],
              color_identity: Array.isArray(c.color_identity) ? c.color_identity : [],
              rarity: c.rarity || 'common',
              image_url_normal: c.image_url_normal || '',
              price_eur: typeof c.price_eur === 'number' ? c.price_eur : 0,
              oracle_text: c.oracle_text
            });
          }
        });
        this.saveCards();
      }

      // 3. Activity History (safely initialized to empty array if missing)
      if (data.history && Array.isArray(data.history)) {
        this.history = data.history.filter((h: any) => h && typeof h === 'object');
        this.saveHistory();
      }

      // 4. Settings & Dynamic Units (gracefully accept older backups with original 9 units)
      const currentSettings = this.getSettings();
      const importedSettings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
      const targetUnitCount = typeof importedSettings.unitCount === 'number' && importedSettings.unitCount > 0
        ? Math.max(importedSettings.unitCount, highestUnitFound)
        : Math.max(currentSettings.unitCount || 9, highestUnitFound, 9);

      this.updateSettings({
        theme: importedSettings.theme || currentSettings.theme || 'orzhov',
        unitCount: targetUnitCount
      });

      // 5. Pre-import snapshot for instant rollback protection
      if (this.instances.size > 0) {
        this.saveSnapshot(`Backup before import (${this.instances.size} cards)`);
      }

      // 6. Overwrite active instances with normalized collection
      this.instances.clear();
      cleanInstances.forEach((inst: CardInstance) => this.instances.set(inst.instance_id, inst));
      this.saveInstances();

      this.touchUpdated(remoteTimestamp || data.timestamp || data.last_updated || Date.now());
      this.healAndDeduplicateCards();
      this.notify();

      return { success: true, count: cleanInstances.length };
    } catch (err: any) {
      console.error('[ArcaDB] Import error:', err);
      return { success: false, count: 0, error: err.message || 'Unknown import error' };
    }
  }

  public resetToSample(): void {
    this.saveSnapshot('Auto snapshot before sample reset');
    this.cards.clear();
    this.instances.clear();
    this.history = [...INITIAL_HISTORY];
    SEED_CARDS.forEach(c => this.cards.set(c.oracle_id, c));
    SEED_INSTANCES.forEach(inst => this.instances.set(inst.instance_id, inst));
    this.saveCards();
    this.saveInstances();
    this.saveHistory();
    this.notify();
  }
}

export const db = new ArcaDatabase();

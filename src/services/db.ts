import { ActivityLogItem, CardInstance, InventoryStats, ScryfallCard, CustomList, CustomListItem, SyncDeltaPayload, InstanceDelta, ListDelta } from '../types';
import { parseLocationId, normalizeCardName, getFrontFaceName } from './pickPath';
import { idbGet, idbSet } from './idb';

const STORAGE_KEY_INSTANCES = 'arcawms_instances_v2';
const STORAGE_KEY_CARDS = 'arcawms_cards_v2';
const STORAGE_KEY_HISTORY = 'arcawms_history_v2';
const STORAGE_KEY_LAST_UPDATED = 'arcawms_last_updated_v2';
const STORAGE_KEY_CUSTOM_LISTS = 'arcawms_custom_lists_v2';

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

export const SEED_CUSTOM_LISTS: CustomList[] = [
  {
    id: 'list-wants-default',
    name: 'Wants',
    description: 'Wishlist of cards to acquire or trade for',
    created_at: new Date(Date.now() - 3600000 * 24 * 7).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 24 * 7).toISOString(),
    items: [
      {
        id: 'item-w1',
        card_name: 'Cyclonic Rift',
        oracle_id: 'd75b9c82-1b49-4c3e-a1b5-aeef57d6644b',
        count: 1,
        notes: 'Need 1 for EDH deck',
        added_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString()
      },
      {
        id: 'item-w2',
        card_name: 'The One Ring',
        oracle_id: '3aa83ed2-f48b-4ce6-a614-2c54ddf50538',
        count: 1,
        notes: 'Extended art preferred',
        added_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString()
      }
    ]
  },
  {
    id: 'list-favourites-default',
    name: 'Favourites',
    description: 'Highlight binder & prized collection cards',
    created_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
    items: [
      {
        id: 'item-f1',
        card_name: 'Smothering Tithe',
        oracle_id: '153376c9-dffd-458c-8ce3-a4c8269bc4e9',
        count: 1,
        notes: 'Enchantment staple',
        added_at: new Date(Date.now() - 3600000 * 24 * 4).toISOString()
      }
    ]
  }
];

function cleanTokenAscii(val?: string): string {
  if (!val || typeof val !== 'string') return '';
  let cleaned = val.trim().replace(/^["'`]|["'`]$/g, '');
  if (cleaned.toLowerCase().startsWith('bearer ')) {
    cleaned = cleaned.substring(7).trim();
  }
  return cleaned.replace(/[^\x21-\x7E]/g, '');
}

function cleanGistIdAscii(val?: string): string {
  if (!val || typeof val !== 'string') return '';
  let cleaned = val.trim().replace(/^["'`]|["'`]$/g, '');
  const urlMatch = cleaned.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/i);
  if (urlMatch && urlMatch[1]) {
    cleaned = urlMatch[1];
  }
  return cleaned.replace(/[^\x21-\x7E]/g, '');
}

class ArcaDatabase {
  private instances: Map<string, CardInstance> = new Map();
  private cards: Map<string, ScryfallCard> = new Map();
  private cardsByName: Map<string, ScryfallCard> = new Map();
  private instancesByName: Map<string, Set<string>> = new Map();
  private customLists: Map<string, CustomList> = new Map();
  private history: ActivityLogItem[] = [];
  private snapshots: any[] = [];
  private listeners: Set<() => void> = new Set();
  private initialized = false;
  private lastUpdated: number = 0;
  private hydrationPromise: Promise<void>;

  // === DELTA TRACKER FOR MICRO-EDITS ===
  private pendingUpsertInstances: Map<string, CardInstance> = new Map();
  private pendingDeleteInstances: Set<string> = new Set();
  private pendingUpsertLists: Map<string, CustomList> = new Map();
  private pendingDeleteLists: Set<string> = new Set();
  private pendingCards: Map<string, ScryfallCard> = new Map();
  private pendingSettings: Record<string, any> = {};
  private isApplyingDelta = false;

  private recordInstanceMutation(inst: CardInstance) {
    if (this.isApplyingDelta) return;
    this.pendingDeleteInstances.delete(inst.instance_id);
    this.pendingUpsertInstances.set(inst.instance_id, { ...inst });
  }

  private recordInstanceDeletion(instanceId: string) {
    if (this.isApplyingDelta) return;
    this.pendingUpsertInstances.delete(instanceId);
    this.pendingDeleteInstances.add(instanceId);
  }

  private recordListMutation(list: CustomList) {
    if (this.isApplyingDelta) return;
    this.pendingDeleteLists.delete(list.id);
    this.pendingUpsertLists.set(list.id, { ...list, items: [...list.items] });
  }

  private recordListDeletion(listId: string) {
    if (this.isApplyingDelta) return;
    this.pendingUpsertLists.delete(listId);
    this.pendingDeleteLists.add(listId);
  }

  private recordCardMutation(card: ScryfallCard) {
    if (this.isApplyingDelta) return;
    this.pendingCards.set(card.oracle_id, { ...card });
  }

  private recordSettingsMutation(settings: Record<string, any>) {
    if (this.isApplyingDelta) return;
    Object.assign(this.pendingSettings, settings);
  }

  constructor() {
    this.init();
    this.hydrationPromise = this.hydrateFromIndexedDB();
  }

  public whenHydrated(): Promise<void> {
    return this.hydrationPromise;
  }

  private updateCardNameIndex(card: ScryfallCard) {
    const rawKey = card.name.trim().toLowerCase();
    const normKey = normalizeCardName(card.name);
    const frontKey = getFrontFaceName(card.name).toLowerCase();

    const keys = Array.from(new Set([rawKey, normKey, frontKey]));
    for (const key of keys) {
      if (!key) continue;
      const existing = this.cardsByName.get(key);
      if (!existing) {
        this.cardsByName.set(key, card);
        continue;
      }

      // 1. Prioritize smart-resolved cards over un-resolved cards
      if (!existing.is_smart_resolved && card.is_smart_resolved) {
        this.cardsByName.set(key, card);
        continue;
      }
      if (existing.is_smart_resolved && !card.is_smart_resolved) {
        continue;
      }

      // 2. Prioritize cards with valid non-zero prices
      const existingHasPrice = existing.price_eur > 0;
      const newHasPrice = card.price_eur > 0;
      if (!existingHasPrice && newHasPrice) {
        this.cardsByName.set(key, card);
      } else if (existingHasPrice && newHasPrice && card.price_eur < existing.price_eur) {
        this.cardsByName.set(key, card);
      }
    }
  }

  private addInstanceToNameIndex(inst: CardInstance) {
    const rawKey = inst.card_name.trim().toLowerCase();
    const normKey = normalizeCardName(inst.card_name);
    const frontKey = getFrontFaceName(inst.card_name).toLowerCase();

    const keys = new Set([rawKey, normKey, frontKey]);
    for (const key of keys) {
      if (!key) continue;
      let set = this.instancesByName.get(key);
      if (!set) {
        set = new Set<string>();
        this.instancesByName.set(key, set);
      }
      set.add(inst.instance_id);
    }
  }

  private removeInstanceFromNameIndex(inst: CardInstance) {
    const rawKey = inst.card_name.trim().toLowerCase();
    const normKey = normalizeCardName(inst.card_name);
    const frontKey = getFrontFaceName(inst.card_name).toLowerCase();

    const keys = new Set([rawKey, normKey, frontKey]);
    for (const key of keys) {
      if (!key) continue;
      const set = this.instancesByName.get(key);
      if (set) {
        set.delete(inst.instance_id);
        if (set.size === 0) {
          this.instancesByName.delete(key);
        }
      }
    }
  }

  public rebuildIndexes() {
    this.cardsByName.clear();
    for (const card of this.cards.values()) {
      if (card.price_eur > 0 && card.image_url_normal && card.image_url_normal.startsWith('https://cards.scryfall.io')) {
        card.is_smart_resolved = true;
      }
      this.updateCardNameIndex(card);
    }
    this.instancesByName.clear();
    for (const inst of this.instances.values()) {
      this.addInstanceToNameIndex(inst);
    }
  }

  private init() {
    if (this.initialized) return;

    // Fast-path: read lastUpdated timestamp if available
    try {
      const storedTs = localStorage.getItem(STORAGE_KEY_LAST_UPDATED);
      this.lastUpdated = storedTs ? (parseInt(storedTs, 10) || 0) : 0;
    } catch {
      this.lastUpdated = 0;
    }

    this.snapshots = [];
    // Full hydration is handled asynchronously by hydrateFromIndexedDB() from IndexedDB
  }

  private async hydrateFromIndexedDB(): Promise<void> {
    try {
      const [idbTs, idbInst, idbCards, idbLists, idbHist, idbSnaps] = await Promise.all([
        idbGet<number>(STORAGE_KEY_LAST_UPDATED),
        idbGet<CardInstance[]>(STORAGE_KEY_INSTANCES),
        idbGet<ScryfallCard[]>(STORAGE_KEY_CARDS),
        idbGet<CustomList[]>(STORAGE_KEY_CUSTOM_LISTS),
        idbGet<ActivityLogItem[]>(STORAGE_KEY_HISTORY),
        idbGet<any[]>('arcawms_snapshots_v1')
      ]);

      // CASE A: IndexedDB already contains instances (standard state)
      if (Array.isArray(idbInst) && idbInst.length > 0) {
        this.instances.clear();
        idbInst.forEach(inst => this.instances.set(inst.instance_id, inst));

        if (Array.isArray(idbCards) && idbCards.length > 0) {
          this.cards.clear();
          idbCards.forEach(c => this.cards.set(c.oracle_id, c));
        }

        if (Array.isArray(idbLists) && idbLists.length > 0) {
          this.customLists.clear();
          idbLists.forEach(l => this.customLists.set(l.id, l));
        }

        if (Array.isArray(idbHist) && idbHist.length > 0) {
          this.history = idbHist;
        }

        if (Array.isArray(idbSnaps) && idbSnaps.length > 0) {
          this.snapshots = idbSnaps;
        }

        if (typeof idbTs === 'number' && idbTs > 0) {
          this.lastUpdated = idbTs;
        }

        // Clean up legacy localStorage storage keys to reclaim the 5MB browser quota
        try {
          localStorage.removeItem(STORAGE_KEY_INSTANCES);
          localStorage.removeItem(STORAGE_KEY_CARDS);
          localStorage.removeItem(STORAGE_KEY_HISTORY);
          localStorage.removeItem(STORAGE_KEY_CUSTOM_LISTS);
          localStorage.removeItem('arcawms_snapshots_v1');
        } catch {}
      }
      // CASE B: IndexedDB is empty — check for legacy localStorage data to migrate
      else {
        let migrated = false;
        try {
          const storedInst = localStorage.getItem(STORAGE_KEY_INSTANCES);
          if (storedInst) {
            const parsed: CardInstance[] = JSON.parse(storedInst);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.instances.clear();
              parsed.forEach(inst => this.instances.set(inst.instance_id, inst));
              migrated = true;
            }
          }

          const storedCards = localStorage.getItem(STORAGE_KEY_CARDS);
          if (storedCards) {
            const parsed: ScryfallCard[] = JSON.parse(storedCards);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.cards.clear();
              parsed.forEach(c => this.cards.set(c.oracle_id, c));
            }
          }

          const storedLists = localStorage.getItem(STORAGE_KEY_CUSTOM_LISTS);
          if (storedLists) {
            const parsed: CustomList[] = JSON.parse(storedLists);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.customLists.clear();
              parsed.forEach(l => this.customLists.set(l.id, l));
            }
          }

          const storedHist = localStorage.getItem(STORAGE_KEY_HISTORY);
          if (storedHist) {
            const parsed = JSON.parse(storedHist);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.history = parsed;
            }
          }

          const storedSnaps = localStorage.getItem('arcawms_snapshots_v1');
          if (storedSnaps) {
            const parsed = JSON.parse(storedSnaps);
            if (Array.isArray(parsed) && parsed.length > 0) {
              this.snapshots = parsed;
            }
          }

          const storedTs = localStorage.getItem(STORAGE_KEY_LAST_UPDATED);
          if (storedTs) {
            this.lastUpdated = parseInt(storedTs, 10) || Date.now();
          }
        } catch {}

        if (migrated && this.instances.size > 0) {
          console.log(`[ArcaDB] Migrated ${this.instances.size} cards from localStorage to IndexedDB`);
          await Promise.all([
            idbSet(STORAGE_KEY_INSTANCES, Array.from(this.instances.values())),
            idbSet(STORAGE_KEY_CARDS, Array.from(this.cards.values())),
            idbSet(STORAGE_KEY_CUSTOM_LISTS, Array.from(this.customLists.values())),
            idbSet(STORAGE_KEY_HISTORY, this.history),
            idbSet(STORAGE_KEY_LAST_UPDATED, this.lastUpdated),
            idbSet('arcawms_snapshots_v1', this.snapshots)
          ]);
          try {
            localStorage.removeItem(STORAGE_KEY_INSTANCES);
            localStorage.removeItem(STORAGE_KEY_CARDS);
            localStorage.removeItem(STORAGE_KEY_HISTORY);
            localStorage.removeItem(STORAGE_KEY_CUSTOM_LISTS);
            localStorage.removeItem('arcawms_snapshots_v1');
          } catch {}
        } else {
          // CASE C: Brand new user with no data anywhere — load seed data
          SEED_CARDS.forEach(c => this.cards.set(c.oracle_id, c));
          SEED_INSTANCES.forEach(inst => this.instances.set(inst.instance_id, inst));
          SEED_CUSTOM_LISTS.forEach(l => this.customLists.set(l.id, { ...l, items: [...l.items] }));
          this.history = [...INITIAL_HISTORY];
          this.lastUpdated = Date.now();

          await Promise.all([
            idbSet(STORAGE_KEY_INSTANCES, Array.from(this.instances.values())),
            idbSet(STORAGE_KEY_CARDS, Array.from(this.cards.values())),
            idbSet(STORAGE_KEY_CUSTOM_LISTS, Array.from(this.customLists.values())),
            idbSet(STORAGE_KEY_HISTORY, this.history),
            idbSet(STORAGE_KEY_LAST_UPDATED, this.lastUpdated)
          ]);
        }
      }

      this.rebuildIndexes();
      this.healAndDeduplicateCards();
      this.initialized = true;
      this.notify();
    } catch (err) {
      console.warn('[ArcaDB] Error hydrating from IndexedDB:', err);
      this.initialized = true;
      this.notify();
    }
  }

  public getLastUpdated(): number {
    return this.lastUpdated;
  }

  public hasLocalStoredInstances(): boolean {
    return this.instances.size > 0;
  }

  private touchUpdated(ts?: number) {
    if (typeof ts === 'number' && ts > 0) {
      this.lastUpdated = ts;
    } else {
      this.lastUpdated = Math.max(Date.now(), (this.lastUpdated || 0) + 1);
    }
    idbSet(STORAGE_KEY_LAST_UPDATED, this.lastUpdated);
    try {
      localStorage.setItem(STORAGE_KEY_LAST_UPDATED, String(this.lastUpdated));
    } catch {}
  }

  private saveInstances() {
    idbSet(STORAGE_KEY_INSTANCES, Array.from(this.instances.values()));
  }

  private saveCards() {
    idbSet(STORAGE_KEY_CARDS, Array.from(this.cards.values()));
  }

  private saveHistory() {
    idbSet(STORAGE_KEY_HISTORY, this.history.slice(0, 100));
  }

  private saveCustomLists() {
    idbSet(STORAGE_KEY_CUSTOM_LISTS, Array.from(this.customLists.values()));
  }

  // === CUSTOM LISTS CRUD & ITEM MANAGEMENT ===
  public getCustomLists(): CustomList[] {
    const lists = Array.from(this.customLists.values());
    // Enrich items with cached card metadata if available
    return lists.map(list => ({
      ...list,
      items: list.items.map(item => ({
        ...item,
        card_metadata: item.card_metadata || this.getCard(item.card_name) || (item.oracle_id ? this.getCard(item.oracle_id) : undefined)
      }))
    })).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  public getCustomList(id: string): CustomList | undefined {
    const list = this.customLists.get(id);
    if (!list) return undefined;
    return {
      ...list,
      items: list.items.map(item => ({
        ...item,
        card_metadata: item.card_metadata || this.getCard(item.card_name) || (item.oracle_id ? this.getCard(item.oracle_id) : undefined)
      }))
    };
  }

  public createCustomList(name: string, description?: string): CustomList {
    const cleanName = name.trim() || 'Untitled List';
    const newList: CustomList = {
      id: generateUUID(),
      name: cleanName,
      description: description?.trim() || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: []
    };
    this.customLists.set(newList.id, newList);
    this.recordListMutation(newList);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return newList;
  }

  public renameCustomList(id: string, name: string, description?: string): boolean {
    const existing = this.customLists.get(id);
    if (!existing) return false;
    existing.name = name.trim() || existing.name;
    if (description !== undefined) {
      existing.description = description.trim();
    }
    existing.updated_at = new Date().toISOString();
    this.recordListMutation(existing);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return true;
  }

  public deleteCustomList(id: string): boolean {
    if (!this.customLists.has(id)) return false;
    this.customLists.delete(id);
    this.recordListDeletion(id);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return true;
  }

  public addCardToCustomList(
    listId: string,
    cardName: string,
    count = 1,
    metadata?: ScryfallCard,
    notes?: string
  ): CustomListItem | null {
    const list = this.customLists.get(listId);
    if (!list) return null;

    const cleanName = cardName.trim();
    if (!cleanName) return null;

    if (metadata) {
      this.upsertCard(metadata);
    }
    const resolvedMeta = metadata || this.getCard(cleanName);

    const existingIdx = list.items.findIndex(
      i => i.card_name.trim().toLowerCase() === cleanName.toLowerCase()
    );

    let updatedItem: CustomListItem;
    if (existingIdx >= 0) {
      list.items[existingIdx].count += count;
      if (notes) {
        list.items[existingIdx].notes = notes;
      }
      if (resolvedMeta && !list.items[existingIdx].oracle_id) {
        list.items[existingIdx].oracle_id = resolvedMeta.oracle_id;
      }
      updatedItem = { ...list.items[existingIdx], card_metadata: resolvedMeta };
    } else {
      updatedItem = {
        id: generateUUID(),
        card_name: resolvedMeta ? resolvedMeta.name : cleanName,
        oracle_id: resolvedMeta?.oracle_id,
        count: Math.max(1, count),
        notes: notes || '',
        added_at: new Date().toISOString(),
        card_metadata: resolvedMeta
      };
      list.items.push(updatedItem);
    }

    list.updated_at = new Date().toISOString();
    this.recordListMutation(list);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return updatedItem;
  }

  public addCardsToCustomListBulk(
    listId: string,
    itemsToAdd: { name: string; count: number; metadata?: ScryfallCard; notes?: string }[]
  ): number {
    const list = this.customLists.get(listId);
    if (!list || !itemsToAdd || itemsToAdd.length === 0) return 0;

    const cardsToUpsert: ScryfallCard[] = [];
    const itemMap = new Map<string, CustomListItem>();
    for (const item of list.items) {
      itemMap.set(item.card_name.trim().toLowerCase(), item);
    }

    let addedCount = 0;
    for (const item of itemsToAdd) {
      const cleanName = item.name.trim();
      if (!cleanName) continue;

      if (item.metadata) {
        cardsToUpsert.push(item.metadata);
      }
      const resolvedMeta = item.metadata || this.getCard(cleanName);
      const lower = cleanName.toLowerCase();
      const existing = itemMap.get(lower);

      if (existing) {
        existing.count += item.count;
        if (item.notes) existing.notes = item.notes;
        if (resolvedMeta && !existing.oracle_id) {
          existing.oracle_id = resolvedMeta.oracle_id;
        }
      } else {
        const newItem: CustomListItem = {
          id: generateUUID(),
          card_name: resolvedMeta ? resolvedMeta.name : cleanName,
          oracle_id: resolvedMeta?.oracle_id,
          count: Math.max(1, item.count),
          notes: item.notes || '',
          added_at: new Date().toISOString(),
          card_metadata: resolvedMeta
        };
        list.items.push(newItem);
        itemMap.set(lower, newItem);
      }
      addedCount += item.count;
    }

    if (cardsToUpsert.length > 0) {
      this.upsertCardsBatch(cardsToUpsert);
    }

    list.updated_at = new Date().toISOString();
    this.recordListMutation(list);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return addedCount;
  }

  public removeCardFromCustomList(listId: string, itemId: string): boolean {
    const list = this.customLists.get(listId);
    if (!list) return false;

    const initialLen = list.items.length;
    list.items = list.items.filter(i => i.id !== itemId);
    if (list.items.length !== initialLen) {
      list.updated_at = new Date().toISOString();
      this.saveCustomLists();
      this.touchUpdated();
      this.notify();
      return true;
    }
    return false;
  }

  public updateCustomListItemCount(listId: string, itemId: string, count: number): boolean {
    const list = this.customLists.get(listId);
    if (!list) return false;

    if (count <= 0) {
      return this.removeCardFromCustomList(listId, itemId);
    }

    const item = list.items.find(i => i.id === itemId);
    if (!item) return false;

    item.count = count;
    list.updated_at = new Date().toISOString();
    this.recordListMutation(list);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return true;
  }

  public updateCustomListItemNotes(listId: string, itemId: string, notes: string): boolean {
    const list = this.customLists.get(listId);
    if (!list) return false;

    const item = list.items.find(i => i.id === itemId);
    if (!item) return false;

    item.notes = notes;
    list.updated_at = new Date().toISOString();
    this.recordListMutation(list);
    this.saveCustomLists();
    this.touchUpdated();
    this.notify();
    return true;
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

    // 1. O(1) Fast lookup by card name
    const byName = this.cardsByName.get(clean);
    if (byName) return byName;

    // 2. O(1) Fast lookup by oracle_id
    const byId = this.cards.get(oracleIdOrName);
    if (byId) {
      const canonical = this.cardsByName.get(byId.name.trim().toLowerCase());
      if (canonical) {
        if (canonical.is_smart_resolved && !byId.is_smart_resolved) return canonical;
        if (canonical.price_eur > 0 && canonical.price_eur < byId.price_eur) return canonical;
      }
      return byId;
    }

    // 3. Fallback: oracle_id might match lowercase clean
    const byIdClean = this.cards.get(clean);
    if (byIdClean) {
      const canonical = this.cardsByName.get(byIdClean.name.trim().toLowerCase());
      if (canonical) {
        if (canonical.is_smart_resolved && !byIdClean.is_smart_resolved) return canonical;
        if (canonical.price_eur > 0 && canonical.price_eur < byIdClean.price_eur) return canonical;
      }
      return byIdClean;
    }

    // 4. Fallback: Normalized MDFC or front-face name lookup
    const norm = normalizeCardName(clean);
    if (norm && norm !== clean) {
      const byNorm = this.cardsByName.get(norm);
      if (byNorm) return byNorm;
    }
    const front = getFrontFaceName(clean).toLowerCase();
    if (front && front !== clean) {
      const byFront = this.cardsByName.get(front);
      if (byFront) return byFront;
    }

    return undefined;
  }

  public upsertCard(card: ScryfallCard) {
    const cleanName = card.name.trim().toLowerCase();

    // Preserve existing price if incoming card has price 0 but existing had valid price
    const existing = this.cardsByName.get(cleanName) || this.cards.get(card.oracle_id);
    if (existing && existing.price_eur > 0 && (!card.price_eur || card.price_eur === 0)) {
      card.price_eur = existing.price_eur;
      if (!card.image_url_normal || !card.image_url_normal.startsWith('https://cards.scryfall.io')) {
        card.image_url_normal = existing.image_url_normal;
      }
    }
    if (card.is_smart_resolved === undefined && existing?.is_smart_resolved) {
      card.is_smart_resolved = true;
    }

    // 1. Remove duplicate card entries with same name
    if (existing && existing.oracle_id !== card.oracle_id) {
      this.cards.delete(existing.oracle_id);
    }

    // 2. Store canonical card
    this.cards.set(card.oracle_id, card);
    this.recordCardMutation(card);
    this.updateCardNameIndex(card);
    this.saveCards();

    // 3. Heal only instances that match this card_name using the instancesByName index
    let instancesHealed = false;
    const healKeys = new Set([cleanName, normalizeCardName(card.name), getFrontFaceName(card.name).toLowerCase()]);
    for (const k of healKeys) {
      if (!k) continue;
      const matchingInstanceIds = this.instancesByName.get(k);
      if (matchingInstanceIds) {
        for (const instId of matchingInstanceIds) {
          const inst = this.instances.get(instId);
          if (inst && (inst.oracle_id !== card.oracle_id || inst.card_name !== card.name)) {
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
      const existing = this.cardsByName.get(cleanName) || this.cards.get(card.oracle_id);
      if (existing && existing.price_eur > 0 && (!card.price_eur || card.price_eur === 0)) {
        card.price_eur = existing.price_eur;
        if (!card.image_url_normal || !card.image_url_normal.startsWith('https://cards.scryfall.io')) {
          card.image_url_normal = existing.image_url_normal;
        }
      }
      if (card.is_smart_resolved === undefined && existing?.is_smart_resolved) {
        card.is_smart_resolved = true;
      }

      // 1. Remove duplicate card entries with same name
      if (existing && existing.oracle_id !== card.oracle_id) {
        this.cards.delete(existing.oracle_id);
      }

      // 2. Store canonical card
      this.cards.set(card.oracle_id, card);
      this.updateCardNameIndex(card);

      // 3. Heal any instances whose card_name matches using instancesByName
      const healKeys = new Set([cleanName, normalizeCardName(card.name), getFrontFaceName(card.name).toLowerCase()]);
      for (const k of healKeys) {
        if (!k) continue;
        const matchingInstanceIds = this.instancesByName.get(k);
        if (matchingInstanceIds) {
          for (const instId of matchingInstanceIds) {
            const inst = this.instances.get(instId);
            if (inst && (inst.oracle_id !== card.oracle_id || inst.card_name !== card.name)) {
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
      // Sort: best card first (smart-resolved, has price > 0, has CDN image, lowest non-zero price)
      cardList.sort((a, b) => {
        // 1. Prioritize smart-resolved cards
        if (a.is_smart_resolved && !b.is_smart_resolved) return -1;
        if (!a.is_smart_resolved && b.is_smart_resolved) return 1;

        const aPrice = a.price_eur || 0;
        const bPrice = b.price_eur || 0;
        if (aPrice > 0 && bPrice === 0) return -1;
        if (bPrice > 0 && aPrice === 0) return 1;
        const aCdn = a.image_url_normal?.startsWith('https://cards.scryfall.io') ? 1 : 0;
        const bCdn = b.image_url_normal?.startsWith('https://cards.scryfall.io') ? 1 : 0;
        if (aCdn !== bCdn) return bCdn - aCdn;
        return aPrice - bPrice;
      });

      const canonical = cardList[0];
      if (canonical.price_eur > 0 && canonical.image_url_normal && canonical.image_url_normal.startsWith('https://cards.scryfall.io')) {
        canonical.is_smart_resolved = true;
      }
      this.cardsByName.set(name, canonical);

      // Remove stale/dummy duplicate cards
      if (cardList.length > 1) {
        for (let i = 1; i < cardList.length; i++) {
          this.cards.delete(cardList[i].oracle_id);
          modified = true;
        }
      }
    }

    // Link all instances of this card name to the canonical oracle_id in a single O(N) pass
    for (const [instId, inst] of this.instances.entries()) {
      const canonical = this.cardsByName.get(inst.card_name.trim().toLowerCase());
      if (canonical && (inst.oracle_id !== canonical.oracle_id || inst.card_name !== canonical.name)) {
        this.instances.set(instId, {
          ...inst,
          card_name: canonical.name,
          oracle_id: canonical.oracle_id
        });
        modified = true;
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
    this.recordInstanceMutation(newInst);
    this.addInstanceToNameIndex(newInst);
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
   * Batch creates multiple card instances, performing a single disk write and single notification
   */
  public createInstancesBatch(instancesToAdd: Omit<CardInstance, 'instance_id'>[]): CardInstance[] {
    if (!instancesToAdd || instancesToAdd.length === 0) return [];

    const now = new Date().toISOString();
    const created: CardInstance[] = [];
    const logGroups = new Map<string, { card_name: string; count: number; to_location: string; is_proxy: boolean; sample: CardInstance }>();

    for (const instance of instancesToAdd) {
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
        created_at: now,
        updated_at: now
      };

      this.instances.set(newInst.instance_id, newInst);
      this.recordInstanceMutation(newInst);
      this.addInstanceToNameIndex(newInst);
      created.push(newInst);

      const locLabel = newInst.location_id || (newInst.state === 'B' ? 'Brewing/Decks' : (newInst.state === 'P' ? 'Proxy Box' : 'Storage'));
      const groupKey = `${newInst.card_name}|${locLabel}|${isProxy ? '1' : '0'}`;
      if (!logGroups.has(groupKey)) {
        logGroups.set(groupKey, {
          card_name: newInst.card_name,
          count: 0,
          to_location: locLabel,
          is_proxy: isProxy,
          sample: newInst
        });
      }
      logGroups.get(groupKey)!.count += 1;
    }

    this.saveInstances();
    this.touchUpdated();

    for (const group of logGroups.values()) {
      this.logActivity({
        type: 'added',
        card_name: group.card_name,
        count: group.count,
        to_location: group.to_location,
        details: group.is_proxy ? `Added ${group.count}x proxy into ${group.to_location}` : `Added ${group.count}x into ${group.to_location}`,
        instance_id: group.sample.instance_id,
        instance_snapshot: { ...group.sample }
      });
    }

    this.notify();
    return created;
  }

  /**
   * Check out card from Chaos Drawer or Proxy Box to Decks/Brewing
   */
  public checkoutToDecks(instanceId: string): void {
    const existing = this.instances.get(instanceId);
    if (existing) {
      const fromLoc = existing.location_id || (existing.state === 'P' ? 'Proxy Box' : 'Drawer');
      const updatedInst: CardInstance = {
        ...existing,
        state: 'B',
        location_id: null,
        updated_at: new Date().toISOString()
      };
      this.instances.set(instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
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

      const updatedInst: CardInstance = {
        ...existing,
        state: 'A',
        location_id: locationId,
        updated_at: new Date().toISOString()
      };
      this.instances.set(instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
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
   * Batch returns multiple cards from Decks back into Chaos Drawers.
   * Storage Units CANNOT contain proxies.
   */
  public returnToChaosBatch(updates: { instanceId: string; locationId: string }[]): void {
    if (!updates || updates.length === 0) return;

    const now = new Date().toISOString();
    let modified = false;
    const logGroups = new Map<string, { card_name: string; count: number; to_location: string; sample: CardInstance }>();

    for (const update of updates) {
      const existing = this.instances.get(update.instanceId);
      if (!existing) continue;

      if (existing.is_proxy) {
        throw new Error('Storage Units CANNOT contain proxies. Proxies must be stored in Proxy Box.');
      }

      const updatedInst: CardInstance = {
        ...existing,
        state: 'A',
        location_id: update.locationId,
        updated_at: now
      };
      this.instances.set(update.instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
      modified = true;

      const groupKey = `${existing.card_name}|${update.locationId}`;
      if (!logGroups.has(groupKey)) {
        logGroups.set(groupKey, {
          card_name: existing.card_name,
          count: 0,
          to_location: update.locationId,
          sample: updatedInst
        });
      }
      logGroups.get(groupKey)!.count += 1;
    }

    if (modified) {
      this.saveInstances();
      this.touchUpdated();

      for (const group of logGroups.values()) {
        this.logActivity({
          type: 'moved',
          card_name: group.card_name,
          count: group.count,
          from_location: 'Brewing/Decks',
          to_location: group.to_location,
          details: `Returned ${group.count}x from brewing to drawer ${group.to_location}`,
          instance_id: group.sample.instance_id,
          instance_snapshot: { ...group.sample }
        });
      }

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
      const updatedInst: CardInstance = {
        ...existing,
        state: 'P',
        location_id: 'Proxy Box',
        is_proxy: true,
        updated_at: new Date().toISOString()
      };
      this.instances.set(instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
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
      const updatedInst: CardInstance = {
        ...existing,
        state: 'P',
        location_id: 'Proxy Box',
        is_proxy: true,
        updated_at: new Date().toISOString()
      };
      this.instances.set(instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
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
    this.recordInstanceMutation(updated);
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
    this.recordInstanceMutation(updated);
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
      const updatedInst: CardInstance = {
        ...existing,
        state: 'A',
        location_id: locationId,
        updated_at: new Date().toISOString()
      };
      this.instances.set(instanceId, updatedInst);
      this.recordInstanceMutation(updatedInst);
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
      this.recordInstanceDeletion(instanceId);
      this.removeInstanceFromNameIndex(existing);
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
    const sanitized: CardInstance = {
      ...instance,
      is_proxy: instance.state === 'A' ? false : (instance.state === 'P' ? true : !!instance.is_proxy),
      updated_at: new Date().toISOString()
    };
    this.instances.set(sanitized.instance_id, sanitized);
    this.recordInstanceMutation(sanitized);
    this.addInstanceToNameIndex(sanitized);
    this.saveInstances();
    this.touchUpdated();

    this.logActivity({
      type: 'added',
      card_name: sanitized.card_name,
      count: 1,
      to_location: sanitized.location_id || (sanitized.state === 'B' ? 'Brewing/Decks' : 'Proxy Box'),
      details: `Restored back to ${sanitized.location_id || (sanitized.state === 'B' ? 'Brewing' : 'Proxy Box')} (Undo)`,
      instance_id: sanitized.instance_id,
      instance_snapshot: { ...sanitized }
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
    if (this.history.length > 100) {
      this.history.length = 100;
    }
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
          if (item.instance_snapshot) {
            const restoredState = item.instance_snapshot.state;
            const restoredIsProxy = restoredState === 'A' ? false : (restoredState === 'P' ? true : !!item.instance_snapshot.is_proxy);
            this.instances.set(inst.instance_id, {
              ...item.instance_snapshot,
              state: restoredState,
              is_proxy: restoredIsProxy,
              updated_at: new Date().toISOString()
            });
          } else {
            const wasInBrewing = item.from_location === 'Brewing/Decks' || !item.from_location;
            const wasInProxyBox = item.from_location === 'Proxy Box';
            const restoredState: 'A' | 'B' | 'P' = wasInProxyBox ? 'P' : (wasInBrewing ? 'B' : 'A');
            const restoredLoc = wasInProxyBox ? 'Proxy Box' : (wasInBrewing ? null : (item.from_location || null));
            const restoredIsProxy = restoredState === 'P' ? true : (restoredState === 'A' ? false : !!inst.is_proxy);

            this.instances.set(inst.instance_id, {
              ...inst,
              state: restoredState,
              location_id: restoredLoc,
              is_proxy: restoredIsProxy,
              updated_at: new Date().toISOString()
            });
          }
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

        if (restored.state === 'A') {
          restored.is_proxy = false;
        }

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
          const targetIsProxy = targetState === 'P' ? true : (targetState === 'A' ? false : !!inst.is_proxy);

          this.instances.set(inst.instance_id, {
            ...inst,
            state: targetState,
            location_id: targetLoc,
            is_proxy: targetIsProxy,
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

        if (restored.state === 'A') {
          restored.is_proxy = false;
        }

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
      // Storage units CANNOT contain proxies: only count if not in State A
      if (inst.is_proxy && inst.state !== 'A') {
        proxyCount++;
      }
      if (inst.state === 'A') inChaos++;
      else if (inst.state === 'B') inDecks++;

      // Proxies MUST always be calculated with a price of £0
      if (!inst.is_proxy || inst.state === 'A') {
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
      ['Card Name', 'State', 'Drawer Location', 'Is Proxy', 'For Sale', 'In Custom Lists', 'Mana Cost', 'CMC', 'Type Line', 'Price EUR', 'Oracle ID']
    ];

    const listMembership = new Map<string, string[]>();
    for (const list of this.customLists.values()) {
      for (const item of list.items) {
        const key = item.card_name.trim().toLowerCase();
        if (!listMembership.has(key)) listMembership.set(key, []);
        if (!listMembership.get(key)!.includes(list.name)) {
          listMembership.get(key)!.push(list.name);
        }
      }
    }

    for (const inst of instances) {
      const meta = this.getCard(inst.card_name) || this.getCard(inst.oracle_id);
      const isProxy = !!inst.is_proxy;
      const price = isProxy ? '0.00' : (meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00');
      const stateLabel = inst.state === 'A'
        ? 'Chaos Drawers'
        : (inst.state === 'P' ? 'Proxy Box' : 'Decks / Brewing');
      const inLists = listMembership.get(inst.card_name.trim().toLowerCase())?.join('; ') || 'None';

      rows.push([
        `"${inst.card_name.replace(/"/g, '""')}"`,
        stateLabel,
        inst.location_id || (inst.state === 'P' ? 'Proxy Box' : 'Diffused / In Decks'),
        isProxy ? 'Yes' : 'No',
        inst.is_for_sale ? 'Yes' : 'No',
        `"${inLists.replace(/"/g, '""')}"`,
        `"${meta?.mana_cost || ''}"`,
        String(meta?.cmc ?? ''),
        `"${(meta?.type_line || '').replace(/"/g, '""')}"`,
        price,
        inst.oracle_id || ''
      ]);
    }

    return rows.map(r => r.join(',')).join('\n');
  }

  public exportCustomListsCSV(listId?: string): string {
    const lists = listId ? [this.customLists.get(listId)].filter(Boolean) as CustomList[] : Array.from(this.customLists.values());
    const rows = [
      ['List Name', 'Card Name', 'Quantity', 'Notes', 'Mana Cost', 'CMC', 'Type Line', 'Price EUR', 'Oracle ID']
    ];

    for (const list of lists) {
      for (const item of list.items) {
        const meta = this.getCard(item.card_name) || (item.oracle_id ? this.getCard(item.oracle_id) : undefined);
        const price = meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00';
        rows.push([
          `"${list.name.replace(/"/g, '""')}"`,
          `"${item.card_name.replace(/"/g, '""')}"`,
          String(item.count || 1),
          `"${(item.notes || '').replace(/"/g, '""')}"`,
          `"${meta?.mana_cost || ''}"`,
          String(meta?.cmc ?? ''),
          `"${(meta?.type_line || '').replace(/"/g, '""')}"`,
          price,
          item.oracle_id || meta?.oracle_id || ''
        ]);
      }
    }

    return rows.map(r => r.join(',')).join('\n');
  }

  public getSnapshots(): Array<{ id: string; timestamp: string; label: string; cardCount: number }> {
    return this.snapshots.map((s: any) => ({
      id: s.id,
      timestamp: s.timestamp,
      label: s.label,
      cardCount: s.cardCount
    }));
  }

  public saveSnapshot(label = 'Collection Snapshot'): void {
    try {
      const newSnap = {
        id: generateUUID(),
        timestamp: new Date().toISOString(),
        label,
        cardCount: this.instances.size,
        instances: Array.from(this.instances.values())
      };
      this.snapshots = [newSnap, ...this.snapshots].slice(0, 5);
      idbSet('arcawms_snapshots_v1', this.snapshots);
      try {
        localStorage.removeItem('arcawms_snapshots_v1');
      } catch {}
    } catch (e) {
      console.warn('Failed to save snapshot:', e);
    }
  }

  public restoreSnapshot(snapshotId: string): boolean {
    try {
      const snap = this.snapshots.find((s: any) => s.id === snapshotId);
      if (!snap) return false;

      this.instances.clear();
      snap.instances.forEach((inst: CardInstance) => this.instances.set(inst.instance_id, inst));
      if (snap.cards && Array.isArray(snap.cards)) {
        snap.cards.forEach((c: ScryfallCard) => this.cards.set(c.oracle_id, c));
      }
      this.rebuildIndexes();
      this.saveInstances();
      this.saveCards();
      this.clearPendingDeltas();
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

  public getSettings(): { theme: string; unitCount?: number; githubToken?: string; gistId?: string } {
    let theme = 'orzhov';
    let unitCount = 9;
    try {
      const raw = localStorage.getItem('arcawms_settings_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.theme) theme = parsed.theme;
        if (typeof parsed.unitCount === 'number') unitCount = parsed.unitCount;
        // Cleanse secrets from settings if previously stored there
        if (parsed.githubToken) {
          localStorage.setItem('arcawms_cloud_auth_token', cleanTokenAscii(parsed.githubToken));
          delete parsed.githubToken;
          localStorage.setItem('arcawms_settings_v1', JSON.stringify(parsed));
        }
        if (parsed.gistId) {
          localStorage.setItem('arcawms_cloud_gist_id', cleanGistIdAscii(parsed.gistId));
          delete parsed.gistId;
          localStorage.setItem('arcawms_settings_v1', JSON.stringify(parsed));
        }
      }
    } catch {}

    const githubToken = cleanTokenAscii(localStorage.getItem('arcawms_cloud_auth_token') || '');
    const gistId = cleanGistIdAscii(localStorage.getItem('arcawms_cloud_gist_id') || '');

    return { 
      theme, 
      unitCount, 
      githubToken: githubToken || undefined, 
      gistId: gistId || undefined 
    };
  }

  public updateSettings(settings: Partial<{ theme: string; unitCount?: number; githubToken?: string; gistId?: string }>) {
    const current = this.getSettings();
    const nextTheme = settings.theme || current.theme;
    const nextUnitCount = settings.unitCount !== undefined ? settings.unitCount : current.unitCount;

    // Never store auth credentials in the general settings object
    try {
      localStorage.setItem('arcawms_settings_v1', JSON.stringify({
        theme: nextTheme,
        unitCount: nextUnitCount
      }));
    } catch {}

    if (settings.theme !== undefined || settings.unitCount !== undefined) {
      this.recordSettingsMutation({ theme: nextTheme, unitCount: nextUnitCount });
    }

    // Store auth credentials in private dedicated storage keys
    if (settings.githubToken !== undefined) {
      const cleanToken = cleanTokenAscii(settings.githubToken);
      if (cleanToken) {
        localStorage.setItem('arcawms_cloud_auth_token', cleanToken);
      } else {
        localStorage.removeItem('arcawms_cloud_auth_token');
      }
    }

    if (settings.gistId !== undefined) {
      const cleanGist = cleanGistIdAscii(settings.gistId);
      if (cleanGist) {
        localStorage.setItem('arcawms_cloud_gist_id', cleanGist);
      } else {
        localStorage.removeItem('arcawms_cloud_gist_id');
      }
    }

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
    const { githubToken, gistId, ...safeSettings } = this.getSettings();
    return JSON.stringify({
      cards: Array.from(this.cards.values()),
      instances: Array.from(this.instances.values()),
      custom_lists: Array.from(this.customLists.values()),
      history: this.history,
      settings: safeSettings,
      last_updated: this.lastUpdated,
      exported_at: new Date().toISOString()
    }, null, 2);
  }

  public importJSON(jsonInput: string | any, remoteTimestamp?: number): { success: boolean; count: number; error?: string } {
    try {
      let data: any;
      if (typeof jsonInput === 'string') {
        if (!jsonInput.trim()) {
          return { success: false, count: 0, error: 'Empty or invalid backup data' };
        }
        try {
          data = JSON.parse(jsonInput);
        } catch (parseErr: any) {
          return { success: false, count: 0, error: `Invalid JSON format: ${parseErr.message}` };
        }
      } else if (jsonInput && typeof jsonInput === 'object') {
        data = jsonInput;
      } else {
        return { success: false, count: 0, error: 'Empty or invalid backup data' };
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
            const isSmartResolved = Boolean(
              c.is_smart_resolved || 
              (c.price_eur > 0 && c.image_url_normal && c.image_url_normal.startsWith('https://cards.scryfall.io'))
            );
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
              oracle_text: c.oracle_text,
              is_smart_resolved: isSmartResolved
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

      // 4. Custom Lists (backwards-compatible: restore from backup or keep safe defaults)
      if (data.custom_lists && Array.isArray(data.custom_lists)) {
        this.customLists.clear();
        for (const rawList of data.custom_lists) {
          if (!rawList || typeof rawList !== 'object' || !rawList.name) continue;
          const listId = String(rawList.id || generateUUID());
          const cleanItems: CustomListItem[] = [];
          if (Array.isArray(rawList.items)) {
            for (const item of rawList.items) {
              if (!item || !item.card_name) continue;
              cleanItems.push({
                id: String(item.id || generateUUID()),
                card_name: String(item.card_name).trim(),
                oracle_id: item.oracle_id ? String(item.oracle_id) : undefined,
                count: typeof item.count === 'number' && item.count > 0 ? item.count : 1,
                notes: item.notes ? String(item.notes) : undefined,
                added_at: item.added_at || new Date().toISOString()
              });
            }
          }
          this.customLists.set(listId, {
            id: listId,
            name: String(rawList.name).trim(),
            description: rawList.description ? String(rawList.description) : undefined,
            created_at: rawList.created_at || new Date().toISOString(),
            updated_at: rawList.updated_at || new Date().toISOString(),
            items: cleanItems
          });
        }
        this.saveCustomLists();
      } else if (this.customLists.size === 0) {
        SEED_CUSTOM_LISTS.forEach(l => this.customLists.set(l.id, { ...l, items: [...l.items] }));
        this.saveCustomLists();
      }

      // 5. Settings & Dynamic Units (gracefully accept older backups with original 9 units)
      const currentSettings = this.getSettings();
      const importedSettings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
      const targetUnitCount = typeof importedSettings.unitCount === 'number' && importedSettings.unitCount > 0
        ? Math.max(importedSettings.unitCount, highestUnitFound)
        : Math.max(currentSettings.unitCount || 9, highestUnitFound, 9);

      this.updateSettings({
        theme: importedSettings.theme || currentSettings.theme || 'orzhov',
        unitCount: targetUnitCount
      });

      // 6. Pre-import snapshot for instant rollback protection (only for deliberate user file restores)
      if (!remoteTimestamp && this.instances.size > 0) {
        this.saveSnapshot(`Backup before import (${this.instances.size} cards)`);
      }

      // 7. Overwrite active instances with normalized collection
      this.instances.clear();
      cleanInstances.forEach((inst: CardInstance) => this.instances.set(inst.instance_id, inst));
      this.rebuildIndexes();
      this.saveInstances();

      // Clear any pending delta mutations so an import is treated as a clean baseline
      this.clearPendingDeltas();

      // If remoteTimestamp is passed, this import comes from an automated cloud sync.
      // If remoteTimestamp is omitted, this is a deliberate user-initiated backup restore.
      // Deliberate user restores MUST receive a fresh Date.now() timestamp so they take priority
      // over any older server state and immediately push to the cloud.
      const effectiveTimestamp = remoteTimestamp ? remoteTimestamp : Date.now();
      this.touchUpdated(effectiveTimestamp);
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
    this.customLists.clear();
    this.history = [...INITIAL_HISTORY];
    SEED_CARDS.forEach(c => this.cards.set(c.oracle_id, c));
    SEED_INSTANCES.forEach(inst => this.instances.set(inst.instance_id, inst));
    SEED_CUSTOM_LISTS.forEach(l => this.customLists.set(l.id, { ...l, items: [...l.items] }));
    this.rebuildIndexes();
    this.saveCards();
    this.saveInstances();
    this.saveCustomLists();
    this.saveHistory();
    this.clearPendingDeltas();
    this.touchUpdated();
    this.notify();
  }

  // === PUBLIC DELTA SYNC INTERFACE ===

  public hasPendingDeltas(): boolean {
    return (
      this.pendingUpsertInstances.size > 0 ||
      this.pendingDeleteInstances.size > 0 ||
      this.pendingUpsertLists.size > 0 ||
      this.pendingDeleteLists.size > 0 ||
      this.pendingCards.size > 0 ||
      Object.keys(this.pendingSettings).length > 0
    );
  }

  public getPendingDeltaCount(): number {
    return (
      this.pendingUpsertInstances.size +
      this.pendingDeleteInstances.size +
      this.pendingUpsertLists.size +
      this.pendingDeleteLists.size +
      this.pendingCards.size
    );
  }

  public extractPendingDelta(clientId: string): SyncDeltaPayload | null {
    if (!this.hasPendingDeltas()) return null;

    const delta: SyncDeltaPayload = {
      deltaId: generateUUID(),
      clientId,
      timestamp: this.lastUpdated,
      count: this.instances.size,
      instances: {
        upsert: this.pendingUpsertInstances.size > 0 ? Array.from(this.pendingUpsertInstances.values()) : undefined,
        delete: this.pendingDeleteInstances.size > 0 ? Array.from(this.pendingDeleteInstances.values()) : undefined
      },
      lists: {
        upsert: this.pendingUpsertLists.size > 0 ? Array.from(this.pendingUpsertLists.values()) : undefined,
        delete: this.pendingDeleteLists.size > 0 ? Array.from(this.pendingDeleteLists.values()) : undefined
      },
      cards: this.pendingCards.size > 0 ? Array.from(this.pendingCards.values()) : undefined,
      settings: Object.keys(this.pendingSettings).length > 0 ? { ...this.pendingSettings } : undefined
    };

    this.clearPendingDeltas();
    return delta;
  }

  public clearPendingDeltas(): void {
    this.pendingUpsertInstances.clear();
    this.pendingDeleteInstances.clear();
    this.pendingUpsertLists.clear();
    this.pendingDeleteLists.clear();
    this.pendingCards.clear();
    this.pendingSettings = {};
  }

  public applyDelta(delta: SyncDeltaPayload): { success: boolean; changesCount: number } {
    if (!delta || typeof delta !== 'object') return { success: false, changesCount: 0 };

    this.isApplyingDelta = true;
    let changesCount = 0;

    try {
      // 1. Delete instances
      if (delta.instances?.delete && Array.isArray(delta.instances.delete)) {
        for (const id of delta.instances.delete) {
          const existing = this.instances.get(id);
          if (existing) {
            this.removeInstanceFromNameIndex(existing);
            this.instances.delete(id);
            changesCount++;
          }
        }
      }

      // 2. Upsert instances
      if (delta.instances?.upsert && Array.isArray(delta.instances.upsert)) {
        for (const inst of delta.instances.upsert) {
          if (!inst || !inst.instance_id) continue;
          const existing = this.instances.get(inst.instance_id);
          this.instances.set(inst.instance_id, { ...inst });
          if (existing) {
            this.removeInstanceFromNameIndex(existing);
          }
          this.addInstanceToNameIndex(inst);
          changesCount++;
        }
      }

      // 3. Delete lists
      if (delta.lists?.delete && Array.isArray(delta.lists.delete)) {
        for (const id of delta.lists.delete) {
          if (this.customLists.delete(id)) {
            changesCount++;
          }
        }
      }

      // 4. Upsert lists
      if (delta.lists?.upsert && Array.isArray(delta.lists.upsert)) {
        for (const list of delta.lists.upsert) {
          if (!list || !list.id) continue;
          this.customLists.set(list.id, { ...list, items: Array.isArray(list.items) ? [...list.items] : [] });
          changesCount++;
        }
      }

      // 5. Cards metadata
      if (delta.cards && Array.isArray(delta.cards)) {
        for (const card of delta.cards) {
          if (card && card.oracle_id) {
            this.cards.set(card.oracle_id, card);
            this.updateCardNameIndex(card);
            changesCount++;
          }
        }
      }

      // 6. Settings
      if (delta.settings && typeof delta.settings === 'object') {
        this.updateSettings({ ...delta.settings });
      }

      if (changesCount > 0) {
        this.saveInstances();
        this.saveCustomLists();
        this.saveCards();
      }

      if (delta.timestamp && delta.timestamp > this.lastUpdated) {
        this.touchUpdated(delta.timestamp);
      } else if (changesCount > 0 && typeof delta.timestamp === 'number') {
        this.touchUpdated(delta.timestamp);
      }

      this.notify();
      return { success: true, changesCount };
    } catch (err) {
      console.error('[ArcaDB] Error applying delta:', err);
      return { success: false, changesCount: 0 };
    } finally {
      this.isApplyingDelta = false;
    }
  }
}

export const db = new ArcaDatabase();

export type CardLocationState = 'chaos' | 'decks' | 'proxies';

export interface ScryfallCard {
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  rarity: string;
  image_url_normal: string;
  price_eur: number;
  oracle_text?: string;
}

export interface CardInstance {
  instance_id: string;
  oracle_id: string;
  card_name: string;
  location_id: string | null; // e.g. '3.B.11' if in Chaos Drawers, null if in Decks/Brewing, 'Proxy Box' if in Proxy Box
  state: 'A' | 'B' | 'P';      // 'A' = in Chaos Drawers, 'B' = in Decks/Brewing, 'P' = in Proxy Box
  is_proxy?: boolean;         // true if card is a proxy
  is_for_sale?: boolean;      // true if card is marked for sale (eBay, etc.)
  created_at?: string;
  updated_at?: string;
}

export interface InventoryStats {
  inChaosCount: number;  // State A
  inDecksCount: number;  // State B (Brewing / Decks)
  proxyCount?: number;   // Total proxies (State P or in Decks)
  totalCount: number;    // Total owned (A + B + P)
  totalEurValue: number;
  uniqueCardCount: number;
}

export interface PickItem {
  id: string;
  card_name: string;
  instance_id?: string;
  oracle_id?: string;
  location_id: string | null;
  unit?: number;
  drawer?: 'A' | 'B' | 'C';
  batch_index?: number;
  status: 'pending' | 'pulled_brew' | 'pulled_trade' | 'skipped' | 'missing';
  inChaos: boolean;
  card_metadata?: ScryfallCard;
  original_instance?: CardInstance;
}

export interface IngestItem {
  card_name: string;
  count: number;
  metadata?: ScryfallCard;
}

export interface ActivityLogItem {
  id: string;
  type: 'added' | 'moved' | 'removed';
  card_name: string;
  count?: number;
  from_location?: string | null;
  to_location?: string | null;
  timestamp: string;
  details?: string;
  instance_id?: string;
  instance_snapshot?: CardInstance;
  undone?: boolean;
}

export interface CustomListItem {
  id: string;
  card_name: string;
  oracle_id?: string;
  count: number;
  notes?: string;
  added_at: string;
  card_metadata?: ScryfallCard;
}

export interface CustomList {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  items: CustomListItem[];
}

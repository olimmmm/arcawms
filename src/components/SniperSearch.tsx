import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  MapPin, 
  Edit3, 
  Trash2, 
  Plus, 
  X, 
  Sparkles,
  ArrowRight,
  RotateCcw,
  Check,
  Layers,
  ShoppingBag,
  Undo2,
  ArrowUpDown
} from 'lucide-react';
import { CardInstance, ScryfallCard } from '../types';
import { db } from '../services/db';
import { 
  parseSyntaxQuery, 
  cardMatchesSyntax, 
  searchScryfallAPI, 
  scryfallAutocomplete, 
  getScryfallImageFallback, 
  CARD_BACK_IMAGE 
} from '../services/scryfall';
import { formatLocationId, parseLocationId, getSmartDefaultBatchLocation } from '../services/pickPath';
import { playSound, triggerHaptic } from '../services/audio';

export type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'cmc_asc'
  | 'cmc_desc'
  | 'quantity_desc'
  | 'quantity_asc'
  | 'color_identity'
  | 'price_desc'
  | 'price_asc'
  | 'type'
  | 'none';

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name_asc', label: 'Name (A → Z)' },
  { value: 'name_desc', label: 'Name (Z → A)' },
  { value: 'cmc_asc', label: 'Mana Value (Low → High)' },
  { value: 'cmc_desc', label: 'Mana Value (High → Low)' },
  { value: 'quantity_desc', label: 'Quantity (High → Low)' },
  { value: 'quantity_asc', label: 'Quantity (Low → High)' },
  { value: 'color_identity', label: 'Colour Identity (WUBRG)' },
  { value: 'price_desc', label: 'Price (High → Low)' },
  { value: 'price_asc', label: 'Price (Low → High)' },
  { value: 'type', label: 'Primary Card Type' },
];

const WUBRG_ORDER: Record<string, number> = { W: 1, U: 2, B: 3, R: 4, G: 5 };

function getColorIdentitySortKey(identity?: string[]): string {
  if (!identity || identity.length === 0) return '0_colorless';
  const sorted = [...identity].sort((a, b) => (WUBRG_ORDER[a] || 99) - (WUBRG_ORDER[b] || 99)).join('');
  return `${identity.length}_${sorted}`;
}

function getPrimaryTypeSortRank(typeLine?: string): number {
  if (!typeLine) return 99;
  const lower = typeLine.toLowerCase();
  if (lower.includes('creature')) return 1;
  if (lower.includes('planeswalker')) return 2;
  if (lower.includes('battle')) return 3;
  if (lower.includes('instant')) return 4;
  if (lower.includes('sorcery')) return 5;
  if (lower.includes('artifact')) return 6;
  if (lower.includes('enchantment')) return 7;
  if (lower.includes('land')) return 8;
  return 9;
}

function compareByOption(
  a: ScryfallCard,
  b: ScryfallCard,
  option: SortOption,
  quantityMap?: Map<string, number>
): number {
  switch (option) {
    case 'name_asc':
      return a.name.localeCompare(b.name);
    case 'name_desc':
      return b.name.localeCompare(a.name);
    case 'cmc_asc':
      return (a.cmc ?? 0) - (b.cmc ?? 0);
    case 'cmc_desc':
      return (b.cmc ?? 0) - (a.cmc ?? 0);
    case 'quantity_desc': {
      const qA = quantityMap ? (quantityMap.get(a.oracle_id) ?? quantityMap.get(a.name.trim().toLowerCase()) ?? 0) : 0;
      const qB = quantityMap ? (quantityMap.get(b.oracle_id) ?? quantityMap.get(b.name.trim().toLowerCase()) ?? 0) : 0;
      return qB - qA;
    }
    case 'quantity_asc': {
      const qA = quantityMap ? (quantityMap.get(a.oracle_id) ?? quantityMap.get(a.name.trim().toLowerCase()) ?? 0) : 0;
      const qB = quantityMap ? (quantityMap.get(b.oracle_id) ?? quantityMap.get(b.name.trim().toLowerCase()) ?? 0) : 0;
      return qA - qB;
    }
    case 'price_desc':
      return (b.price_eur ?? 0) - (a.price_eur ?? 0);
    case 'price_asc':
      return (a.price_eur ?? 0) - (b.price_eur ?? 0);
    case 'color_identity': {
      const keyA = getColorIdentitySortKey(a.color_identity);
      const keyB = getColorIdentitySortKey(b.color_identity);
      return keyA.localeCompare(keyB);
    }
    case 'type':
      return getPrimaryTypeSortRank(a.type_line) - getPrimaryTypeSortRank(b.type_line);
    case 'none':
    default:
      return 0;
  }
}

export function sortCards(
  cards: ScryfallCard[],
  primarySort: SortOption = 'name_asc',
  secondarySort: SortOption = 'none',
  quantityMap?: Map<string, number>
): ScryfallCard[] {
  return [...cards].sort((a, b) => {
    let diff = compareByOption(a, b, primarySort, quantityMap);
    if (diff !== 0) return diff;
    if (secondarySort && secondarySort !== 'none' && secondarySort !== primarySort) {
      diff = compareByOption(a, b, secondarySort, quantityMap);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
}

export const SniperSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'inventory' | 'global'>('inventory');
  const [globalResults, setGlobalResults] = useState<ScryfallCard[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [primarySort, setPrimarySort] = useState<SortOption>(() => {
    return (localStorage.getItem('arcawms_search_sort_primary') as SortOption) ||
      (localStorage.getItem('arcawms_search_sort') as SortOption) ||
      'name_asc';
  });
  const [secondarySort, setSecondarySort] = useState<SortOption>(() => {
    return (localStorage.getItem('arcawms_search_sort_secondary') as SortOption) || 'cmc_asc';
  });

  // Session state to support on-page UNDO for cards moved or removed on this page (persists across refresh)
  const SESSION_KEY_MOVED = 'arcawms_recently_moved_session';
  const SESSION_KEY_REMOVED = 'arcawms_recently_removed_session';

  const [recentlyMoved, setRecentlyMovedState] = useState<Map<string, { fromLoc: string }>>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_MOVED);
      if (raw) return new Map(JSON.parse(raw));
    } catch {}
    return new Map();
  });

  const [recentlyRemoved, setRecentlyRemovedState] = useState<Map<string, CardInstance>>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_REMOVED);
      if (raw) return new Map(JSON.parse(raw));
    } catch {}
    return new Map();
  });

  const setRecentlyMoved = (updater: React.SetStateAction<Map<string, { fromLoc: string }>>) => {
    setRecentlyMovedState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        sessionStorage.setItem(SESSION_KEY_MOVED, JSON.stringify(Array.from(next.entries())));
      } catch {}
      return next;
    });
  };

  const setRecentlyRemoved = (updater: React.SetStateAction<Map<string, CardInstance>>) => {
    setRecentlyRemovedState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        sessionStorage.setItem(SESSION_KEY_REMOVED, JSON.stringify(Array.from(next.entries())));
      } catch {}
      return next;
    });
  };

  // Editing coordinate modal
  const [editingInstance, setEditingInstance] = useState<CardInstance | null>(null);
  const [editUnit, setEditUnit] = useState(1);
  const [editDrawer, setEditDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [editBatch, setEditBatch] = useState<number | ''>(1);

  // Return to Chaos Drawer modal
  const [returningInstance, setReturningInstance] = useState<CardInstance | null>(null);
  const [returnUnit, setReturnUnit] = useState(1);
  const [returnDrawer, setReturnDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [returnBatch, setReturnBatch] = useState<number | ''>(1);

  // Add new copy modal
  const [quickAddCard, setQuickAddCard] = useState<ScryfallCard | null>(null);
  const [addUnit, setAddUnit] = useState(1);
  const [addDrawer, setAddDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [addBatch, setAddBatch] = useState<number | ''>(1);
  const [addAsProxy, setAddAsProxy] = useState<boolean>(false);

  // Top-left card menu state & toast
  const [cardMenuOpenId, setCardMenuOpenId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
    }, 3500);
  };

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [cards, setCards] = useState<ScryfallCard[]>(() => db.getAllCards());
  const [unitCount, setUnitCount] = useState<number>(() => db.getUnitCount());

  useEffect(() => {
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setCards(db.getAllCards());
      setUnitCount(db.getUnitCount());
    });
  }, []);

  // Autocomplete
  useEffect(() => {
    if (query.length >= 2 && !query.includes(':')) {
      scryfallAutocomplete(query).then(res => setSuggestions(res.slice(0, 5)));
    } else {
      setSuggestions([]);
    }
  }, [query]);

  // Global Scryfall Search
  useEffect(() => {
    if (scope === 'global' && query.trim().length >= 2) {
      const timer = setTimeout(async () => {
        setIsSearchingGlobal(true);
        const results = await searchScryfallAPI(query);
        setGlobalResults(results);
        setIsSearchingGlobal(false);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setGlobalResults([]);
    }
  }, [query, scope]);

  // Group instances by oracle_id and card_name
  const instancesByOracleId = useMemo(() => {
    const map = new Map<string, CardInstance[]>();
    for (const inst of instances) {
      if (inst.oracle_id) {
        if (!map.has(inst.oracle_id)) map.set(inst.oracle_id, []);
        map.get(inst.oracle_id)!.push(inst);
      }
      const nameKey = inst.card_name.trim().toLowerCase();
      if (!map.has(nameKey)) map.set(nameKey, []);
      map.get(nameKey)!.push(inst);
    }
    return map;
  }, [instances]);

  // Filter local inventory cards by Scryfall syntax
  const filteredCards = useMemo(() => {
    if (scope === 'global') return globalResults;

    const clauses = parseSyntaxQuery(query);

    // Deduplicate cards by name, prioritizing canonical card with market price
    const dedupedMap = new Map<string, ScryfallCard>();
    for (const card of cards) {
      const key = card.name.trim().toLowerCase();
      const existing = dedupedMap.get(key);
      if (!existing || (card.price_eur > 0 && existing.price_eur === 0)) {
        dedupedMap.set(key, card);
      }
    }
    const dedupedCards = Array.from(dedupedMap.values());

    return dedupedCards.filter(card => {
      const cleanName = card.name.trim().toLowerCase();
      const instancesForCard = [
        ...(instancesByOracleId.get(card.oracle_id) || []),
        ...(instancesByOracleId.get(cleanName) || [])
      ];
      const hasInstances = instancesForCard.length > 0;
      const hasRemoved = Array.from(recentlyRemoved.values()).some(
        r => r.oracle_id === card.oracle_id || r.card_name.trim().toLowerCase() === cleanName
      );
      if (!hasInstances && !hasRemoved && !query.trim()) return false;
      if (!query.trim()) return true;
      return cardMatchesSyntax(card, clauses);
    });
  }, [cards, query, scope, globalResults, instancesByOracleId, recentlyRemoved]);

  const executeGlobalSearch = async (searchTerm: string) => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) return;
    setIsSearchingGlobal(true);
    setSuggestions([]);
    const results = await searchScryfallAPI(searchTerm.trim());
    setGlobalResults(results);
    setIsSearchingGlobal(false);
  };

  const handlePrimarySortChange = (newSort: SortOption) => {
    setPrimarySort(newSort);
    localStorage.setItem('arcawms_search_sort_primary', newSort);
    localStorage.setItem('arcawms_search_sort', newSort);
    playSound('click');
  };

  const handleSecondarySortChange = (newSort: SortOption) => {
    setSecondarySort(newSort);
    localStorage.setItem('arcawms_search_sort_secondary', newSort);
    playSound('click');
  };

  // Quantity map for fast and accurate quantity-based sorting across chaos and decks
  const cardQuantityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const card of cards) {
      const cleanName = card.name.trim().toLowerCase();
      const rawInstances = [
        ...(instancesByOracleId.get(card.oracle_id) || []),
        ...(instancesByOracleId.get(cleanName) || [])
      ];
      const count = new Set(rawInstances.map(i => i.instance_id)).size;
      map.set(card.oracle_id, count);
      map.set(cleanName, count);
    }
    return map;
  }, [cards, instancesByOracleId]);

  const sortedCards = useMemo(() => {
    return sortCards(filteredCards, primarySort, secondarySort, cardQuantityMap);
  }, [filteredCards, primarySort, secondarySort, cardQuantityMap]);

  const addSyntaxPill = (filterText: string) => {
    playSound('click');
    setQuery(prev => (prev.trim() ? `${prev.trim()} ${filterText}` : filterText));
  };

  // 1. Pull to Brew & Decks
  const handlePullToBrew = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    const origLoc = inst.location_id || '1.A.01';
    db.checkoutToDecks(inst.instance_id);

    setRecentlyMoved(prev => {
      const next = new Map(prev);
      next.set(inst.instance_id, { fromLoc: origLoc });
      return next;
    });
  };

  // Undo Move to Brew
  const handleUndoMoveToBrew = (instanceId: string) => {
    playSound('click');
    triggerHaptic('light');
    const record = recentlyMoved.get(instanceId);
    if (record) {
      db.returnToChaos(instanceId, record.fromLoc);
      setRecentlyMoved(prev => {
        const next = new Map(prev);
        next.delete(instanceId);
        return next;
      });
    }
  };

  // 2. Remove for Sales & Trades
  const handleRemoveForTrade = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('heavy');
    const snapshot: CardInstance = { ...inst };
    if (recentlyMoved.has(inst.instance_id)) {
      snapshot.location_id = recentlyMoved.get(inst.instance_id)!.fromLoc;
      snapshot.state = 'A';
      setRecentlyMoved(prev => {
        const next = new Map(prev);
        next.delete(inst.instance_id);
        return next;
      });
    }

    db.deleteInstance(inst.instance_id);

    setRecentlyRemoved(prev => {
      const next = new Map(prev);
      next.set(inst.instance_id, snapshot);
      return next;
    });
  };

  // Undo Remove
  const handleUndoRemove = (instanceId: string) => {
    playSound('click');
    triggerHaptic('light');
    const saved = recentlyRemoved.get(instanceId);
    if (saved) {
      db.restoreInstance(saved);
      setRecentlyRemoved(prev => {
        const next = new Map(prev);
        next.delete(instanceId);
        return next;
      });
    }
  };

  // Open return to chaos modal
  const handleOpenReturnModal = (inst: CardInstance) => {
    playSound('click');
    setReturningInstance(inst);
  };

  const handleConfirmReturn = () => {
    if (!returningInstance) return;
    playSound('success');
    triggerHaptic('medium');
    const effBatch = typeof returnBatch === 'number' && returnBatch >= 1 ? returnBatch : 1;
    const locId = formatLocationId(returnUnit, returnDrawer, effBatch);
    db.returnToChaos(returningInstance.instance_id, locId);
    setReturningInstance(null);
  };

  // Edit coordinate modal
  const handleOpenEdit = (inst: CardInstance) => {
    playSound('click');
    const coord = parseLocationId(inst.location_id);
    setEditUnit(coord.valid ? coord.unit : 1);
    setEditDrawer(coord.valid ? coord.drawer : 'A');
    setEditBatch(coord.valid ? coord.batch_index : 1);
    setEditingInstance(inst);
  };

  const handleSaveEdit = () => {
    if (!editingInstance) return;
    playSound('success');
    const effBatch = typeof editBatch === 'number' && editBatch >= 1 ? editBatch : 1;
    const locId = formatLocationId(editUnit, editDrawer, effBatch);
    db.updateLocation(editingInstance.instance_id, locId);
    setEditingInstance(null);
  };

  // Open Quick Add with smart default batch location (< 12 non-empty batches)
  const handleOpenQuickAdd = (card: ScryfallCard, defaultProxy = false) => {
    playSound('click');
    const smart = getSmartDefaultBatchLocation(db.getAllInstances(), db.getUnitCount());
    setAddUnit(smart.unit);
    setAddDrawer(smart.drawer);
    setAddBatch(smart.batchIndex);
    setAddAsProxy(defaultProxy);
    setQuickAddCard(card);
  };

  // Add new physical copy (standard storage drawer or proxy box)
  const handleConfirmQuickAdd = () => {
    if (!quickAddCard) return;
    playSound('success');
    triggerHaptic('medium');
    db.upsertCard(quickAddCard);

    if (addAsProxy) {
      db.createInstance({
        oracle_id: quickAddCard.oracle_id,
        card_name: quickAddCard.name,
        state: 'P',
        location_id: 'Proxy Box',
        is_proxy: true,
      });
      showToast(`Added proxy of "${quickAddCard.name}" to Offline Proxy Box`);
    } else {
      const effBatch = typeof addBatch === 'number' && addBatch >= 1 ? addBatch : 1;
      const locId = formatLocationId(addUnit, addDrawer, effBatch);
      db.createInstance({
        oracle_id: quickAddCard.oracle_id,
        card_name: quickAddCard.name,
        state: 'A',
        location_id: locId,
        is_proxy: false,
      });
      showToast(`Added copy of "${quickAddCard.name}" to ${locId}`);
    }
    setQuickAddCard(null);
  };

  // Toggle Proxy status on card
  const handleToggleProxy = (inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    const res = db.toggleProxy(inst.instance_id);
    setCardMenuOpenId(null);
    if (res.relocatedToProxyBox) {
      showToast(`Marked "${inst.card_name}" as Proxy ➔ relocated to Proxy Box`);
    } else if (res.is_proxy) {
      showToast(`Marked "${inst.card_name}" as Proxy`);
    } else {
      showToast(`Marked "${inst.card_name}" as Real Card`);
    }
  };

  // Toggle For Sale status on card (red border)
  const handleToggleForSale = (inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    const isForSale = db.toggleForSale(inst.instance_id);
    setCardMenuOpenId(null);
    if (isForSale) {
      showToast(`"${inst.card_name}" marked FOR SALE (Red Border active)`);
    } else {
      showToast(`"${inst.card_name}" removed from sale`);
    }
  };

  // Move proxy card back into Proxy Box from Decks/Brewing
  const handleMoveToProxyBox = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    db.returnToProxyBox(inst.instance_id);
    setCardMenuOpenId(null);
    showToast(`"${inst.card_name}" moved to Proxy Box`);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Search Header */}
      <div className="space-y-3">
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setSuggestions([]);
                  if (scope === 'global' && query.trim().length >= 2) {
                    executeGlobalSearch(query);
                  }
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  setSuggestions([]);
                }
              }}
              placeholder='Search card name or Scryfall syntax (e.g. cmc<=2, p<=5, id<=wu, otag:removal)...'
              className="w-full bg-slate-900 border border-slate-700/80 rounded-2xl pl-12 pr-10 py-3.5 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-lg font-sans"
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(''); playSound('click'); }}
                className="absolute right-3.5 p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Autocomplete */}
          {suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-30 divide-y divide-slate-800 overflow-hidden">
              {suggestions.map((name, idx) => (
                <button
                  key={idx}
                  onClick={() => { setQuery(name); setSuggestions([]); playSound('click'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-amber-500/10 hover:text-amber-400 flex items-center justify-between"
                >
                  <span>{name}</span>
                  <span className="text-xs text-slate-500 font-mono">Select</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Syntax Shortcut Pills & Scope */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 font-mono">
            <span className="text-slate-500 text-[11px] mr-1">QUICK FILTERS:</span>
            <button onClick={() => addSyntaxPill('cmc:1')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">cmc:1</button>
            <button onClick={() => addSyntaxPill('cmc:2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">cmc:2</button>
            <button onClick={() => addSyntaxPill('cmc<=2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">cmc&lt;=2</button>
            <button onClick={() => addSyntaxPill('p<=2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">p&lt;=2</button>
            <button onClick={() => addSyntaxPill('t:creature')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">t:creature</button>
            <button onClick={() => addSyntaxPill('c:u')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">c:u</button>
            <button onClick={() => addSyntaxPill('id<=wu')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">id&lt;=wu</button>
            <button onClick={() => addSyntaxPill('otag:removal')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">otag:removal</button>
            <button onClick={() => addSyntaxPill('o:"draw"')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">o:draw</button>
          </div>

          <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[11px]">
            <button
              onClick={() => { setScope('inventory'); playSound('click'); }}
              className={`px-2.5 py-1 rounded-md transition ${
                scope === 'inventory' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              My Cards
            </button>
            <button
              onClick={() => { setScope('global'); playSound('click'); }}
              className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 ${
                scope === 'global' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Scryfall</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Collection Results Header with Sorting */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-1 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>
            {query.trim() ? 'Matching cards:' : 'Full collection:'}{' '}
            <strong className="text-white font-bold">{sortedCards.length}</strong>
          </span>
          {query.trim() && (
            <span className="text-slate-500">
              for &quot;<span className="text-amber-400">{query}</span>&quot;
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-slate-400 font-bold">Sort:</span>
            <select
              value={primarySort}
              onChange={(e) => handlePrimarySortChange(e.target.value as SortOption)}
              aria-label="Primary Sort"
              className="bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 font-sans cursor-pointer transition shadow"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={`prim-${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[11px]">then</span>
            <select
              value={secondarySort}
              onChange={(e) => handleSecondarySortChange(e.target.value as SortOption)}
              aria-label="Secondary Sort"
              className="bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 font-sans cursor-pointer transition shadow"
            >
              <option value="none">None</option>
              {SORT_OPTIONS.map(opt => (
                <option key={`sec-${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isSearchingGlobal && (
        <div className="p-8 text-center text-slate-400 text-xs">
          Searching Scryfall database...
        </div>
      )}

      {/* Cards List */}
      <div className="space-y-4">
        {sortedCards.length === 0 && !isSearchingGlobal && (
          <div className="p-10 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-xs">
            No cards matched &quot;{query}&quot;. Try switching to Scryfall search or clearing filters.
          </div>
        )}

        {sortedCards.map((card) => {
          const rawInstances = [
            ...(instancesByOracleId.get(card.oracle_id) || []),
            ...(instancesByOracleId.get(card.name.trim().toLowerCase()) || [])
          ];
          const cardInstances = Array.from(new Map(rawInstances.map(i => [i.instance_id, i])).values());
          
          // Also look for recently removed instances for this card to show on-page undo
          const removedForCard = Array.from(recentlyRemoved.values()).filter(
            r => r.oracle_id === card.oracle_id || r.card_name.trim().toLowerCase() === card.name.trim().toLowerCase()
          );

          const cardHasForSale = cardInstances.some(i => i.is_for_sale);
          const cardHasBrewProxy = cardInstances.some(i => i.is_proxy && i.state === 'B');

          return (
            <div
              key={card.oracle_id}
              className={`bg-slate-900 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row gap-4 sm:gap-5 transition-all ${
                cardHasForSale
                  ? 'border-2 border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
                  : 'border border-slate-800'
              }`}
            >
              {/* Reliable Card Image with Automatic Fallback & Top-Left '+' Menu */}
              <div className={`relative w-24 sm:w-28 shrink-0 rounded-xl overflow-hidden bg-slate-950 self-start shadow transition-all ${
                cardHasForSale
                  ? 'border-for-sale'
                  : cardHasBrewProxy
                  ? 'border-proxy-theme'
                  : 'border border-slate-800'
              }`}>
                <img
                  src={card.image_url_normal || getScryfallImageFallback(card.name)}
                  alt={card.name}
                  loading="lazy"
                  className="w-full h-auto object-cover"
                  onError={(e) => {
                    e.currentTarget.src = CARD_BACK_IMAGE;
                  }}
                />

                {/* Top-Left `+` Menu Button */}
                <div className="absolute top-1.5 left-1.5 z-20">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardMenuOpenId(cardMenuOpenId === card.oracle_id ? null : card.oracle_id);
                    }}
                    className={`h-6 w-6 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${
                      cardMenuOpenId === card.oracle_id
                        ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                        : 'bg-slate-950/85 hover:bg-slate-900 text-white border border-slate-700/80 hover:border-amber-400'
                    }`}
                    title="Card options menu"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  {cardMenuOpenId === card.oracle_id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 top-7 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-30 space-y-1 text-xs animate-in fade-in"
                    >
                      {cardInstances.length === 0 ? (
                        <div className="space-y-1">
                          <div className="text-[10px] text-slate-400 font-mono px-2 py-0.5 font-bold">ADD TO COLLECTION</div>
                          <button
                            type="button"
                            onClick={() => { setCardMenuOpenId(null); handleOpenQuickAdd(card, false); }}
                            className="w-full px-2 py-1.5 rounded-lg text-left flex items-center gap-1.5 hover:bg-slate-800 text-slate-200 cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5 text-amber-400" />
                            <span>+ Add Real Copy</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCardMenuOpenId(null); handleOpenQuickAdd(card, true); }}
                            className="w-full px-2 py-1.5 rounded-lg text-left flex items-center gap-1.5 hover:bg-slate-800 text-purple-300 cursor-pointer"
                          >
                            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                            <span>+ Add Proxy (to Proxy Box)</span>
                          </button>
                        </div>
                      ) : cardInstances.length === 1 ? (
                        <div className="space-y-1">
                          <div className="text-[10px] text-slate-400 font-mono px-2 py-0.5 font-bold">
                            CARD STATUS
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleProxy(cardInstances[0])}
                            className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                              <span>{cardInstances[0].is_proxy ? 'Mark as Real Card' : 'Mark as Proxy'}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleForSale(cardInstances[0])}
                            className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                              <span>{cardInstances[0].is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-56 overflow-y-auto">
                          <div className="text-[10px] text-slate-400 font-mono px-2 py-0.5 font-bold">
                            MANAGE COPIES ({cardInstances.length})
                          </div>
                          {cardInstances.map((inst, cIdx) => (
                            <div key={inst.instance_id} className="p-1.5 rounded bg-slate-950/60 border border-slate-800 space-y-1">
                              <div className="text-[10px] text-amber-400 font-mono font-bold flex justify-between">
                                <span>Copy #{cIdx + 1}</span>
                                <span className="text-slate-400 truncate max-w-[90px]">{inst.location_id || (inst.state === 'B' ? 'Brewing' : 'Proxy Box')}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() => handleToggleProxy(inst)}
                                  className={`px-1.5 py-1 rounded text-center border font-mono cursor-pointer ${
                                    inst.is_proxy
                                      ? 'bg-purple-950/60 border-purple-500/50 text-purple-300'
                                      : 'bg-slate-900 border-slate-700 text-slate-300'
                                  }`}
                                >
                                  {inst.is_proxy ? 'Proxy ✓' : 'Real'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleForSale(inst)}
                                  className={`px-1.5 py-1 rounded text-center border font-mono cursor-pointer ${
                                    inst.is_for_sale
                                      ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 font-bold'
                                      : 'bg-slate-900 border-slate-700 text-slate-300'
                                  }`}
                                >
                                  {inst.is_for_sale ? 'Sale ✓' : 'Keep'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status Badges Overlay on Image */}
                <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 pointer-events-none">
                  {cardHasForSale && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-600/90 text-white font-mono font-black text-[9px] shadow uppercase tracking-wider">
                      FOR SALE
                    </span>
                  )}
                  {cardHasBrewProxy && !cardHasForSale && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-600/90 text-white font-mono font-black text-[9px] shadow uppercase tracking-wider">
                      PROXY
                    </span>
                  )}
                </div>
              </div>

              {/* Card Details & Copies */}
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <span>{card.name}</span>
                      {card.mana_cost && (
                        <span className="text-xs font-mono text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                          {card.mana_cost}
                        </span>
                      )}
                    </h2>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {card.type_line} • CMC {card.cmc} • <span className="text-emerald-400 font-mono font-medium">€{card.price_eur ? card.price_eur.toFixed(2) : '0.00'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleOpenQuickAdd(card, false)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 text-amber-400" />
                      <span>+ Add Copy</span>
                    </button>
                    <button
                      onClick={() => handleOpenQuickAdd(card, true)}
                      className="px-2.5 py-1.5 rounded-lg bg-purple-950/40 hover:bg-purple-900/50 text-xs text-purple-300 hover:text-white flex items-center gap-1.5 border border-purple-800/50 transition cursor-pointer"
                      title="Add as proxy to Offline Proxy Box"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      <span>+ Proxy</span>
                    </button>
                  </div>
                </div>

                {/* Copies list */}
                <div className="space-y-2 pt-1">
                  {cardInstances.length === 0 && removedForCard.length === 0 ? (
                    <div className="text-xs text-slate-500 italic">
                      None in your inventory. Tap &quot;+ Add Copy&quot; to assign a drawer coordinate or &quot;+ Proxy&quot; for Proxy Box.
                    </div>
                  ) : (
                    <>
                      {/* Recently removed copies (with instant on-page Undo) */}
                      {removedForCard.map((rem) => (
                        <div
                          key={`rem-${rem.instance_id}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/60 gap-2 text-xs transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-mono-coordinate font-black text-sm border border-rose-500/40 line-through flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5 text-rose-400" />
                              <span>{rem.location_id || 'DRAWER'}</span>
                            </span>
                            <span className="text-rose-300 font-mono text-[11px] font-bold">
                              Removed for Trade / Sale
                            </span>
                          </div>

                          <button
                            onClick={() => handleUndoRemove(rem.instance_id)}
                            className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer self-end sm:self-auto"
                            title="Undo remove and restore back to collection"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            <span>REMOVED (UNDO ↺)</span>
                          </button>
                        </div>
                      ))}

                      {/* Active copies */}
                      {cardInstances.map((inst) => {
                        const isInChaos = inst.state === 'A';
                        const isInProxyBox = inst.state === 'P' || (inst.is_proxy && inst.state !== 'B');
                        const isInBrewing = inst.state === 'B';
                        const isProxy = !!inst.is_proxy;
                        const isForSale = !!inst.is_for_sale;
                        const recentlyMovedBrew = recentlyMoved.has(inst.instance_id);

                        const borderClass = isForSale
                          ? 'border-for-sale bg-rose-950/20'
                          : (isInBrewing && isProxy)
                          ? 'border-proxy-theme bg-purple-950/20'
                          : recentlyMovedBrew 
                          ? 'bg-blue-950/30 border-blue-800/60' 
                          : 'bg-slate-950 border-slate-800/80';

                        return (
                          <div
                            key={inst.instance_id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-xl border gap-2 text-xs transition relative ${borderClass}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              {isInChaos ? (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 font-mono-coordinate font-black text-sm border border-amber-500/40 flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span>{inst.location_id || 'UNASSIGNED'}</span>
                                  </span>
                                  <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">In Chaos Drawer</span>
                                </div>
                              ) : isInProxyBox ? (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-300 font-mono font-bold text-xs border border-purple-500/40 flex items-center gap-1">
                                    <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                    <span>Proxy Box</span>
                                  </span>
                                  <span className="text-purple-300/80 font-mono text-[11px] font-medium">£0.00 (Proxy)</span>
                                </div>
                              ) : recentlyMovedBrew ? (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 font-mono-coordinate font-black text-sm border border-blue-500/40 flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5 text-blue-400" />
                                    <span>{recentlyMoved.get(inst.instance_id)?.fromLoc}</span>
                                  </span>
                                  <span className="text-blue-300 font-mono text-[11px] font-bold">➔ In Decks / Brewing</span>
                                  {isProxy && (
                                    <span className="text-purple-300 font-mono text-[11px] font-bold">(Proxy £0.00)</span>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 font-mono text-xs border border-blue-500/30 font-bold">
                                    In Decks / Brewing
                                  </span>
                                  {isProxy && (
                                    <span className="text-purple-300 font-mono text-[11px] font-bold">Proxy • £0.00</span>
                                  )}
                                </div>
                              )}

                              {isForSale && (
                                <span className="px-2 py-0.5 rounded bg-rose-500/25 text-rose-300 font-mono text-[10px] font-black border border-rose-500/50 uppercase tracking-wider">
                                  FOR SALE (eBay)
                                </span>
                              )}
                            </div>

                            {/* Actions & Dropdown */}
                            <div className="flex items-center gap-2 self-end sm:self-auto relative">
                              {isInChaos ? (
                                <>
                                  {/* Option 1: Pull to Brewing */}
                                  <button
                                    onClick={() => handlePullToBrew(inst)}
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                                    title="Add to brewing and decks pool"
                                  >
                                    <Layers className="h-3 w-3" />
                                    <span>To Brew</span>
                                  </button>

                                  {/* Option 2: Remove for Trade/Sale */}
                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 font-mono text-xs flex items-center gap-1 cursor-pointer"
                                    title="Remove from collection for sales and trades"
                                  >
                                    <ShoppingBag className="h-3 w-3 text-rose-400" />
                                    <span>Trade / Sell</span>
                                  </button>

                                  {/* Edit coordinate */}
                                  <button
                                    onClick={() => handleOpenEdit(inst)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 cursor-pointer"
                                    title="Change coordinate"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : isInProxyBox ? (
                                <>
                                  {/* Proxy Box Options: To Brew or Remove */}
                                  <button
                                    onClick={() => handlePullToBrew(inst)}
                                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                                    title="Move proxy into Active Decks / Brewing pool"
                                  >
                                    <Layers className="h-3 w-3" />
                                    <span>To Brew</span>
                                  </button>

                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                                    title="Remove proxy from collection"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : recentlyMovedBrew ? (
                                <>
                                  {/* In Brew: If just moved on this page, show Undo button */}
                                  <button
                                    onClick={() => handleUndoMoveToBrew(inst.instance_id)}
                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-xs flex items-center gap-1 shadow cursor-pointer"
                                    title="Undo pull and return to drawer coordinate"
                                  >
                                    <Undo2 className="h-3 w-3" />
                                    <span>IN BREW (UNDO ↺)</span>
                                  </button>

                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                                    title="Remove from collection"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : isProxy ? (
                                <>
                                  {/* Proxy in Brewing: Rule says can only return to Proxy Box, NOT units */}
                                  <button
                                    onClick={() => handleMoveToProxyBox(inst)}
                                    className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                                    title="Return proxy back to Proxy Box"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    <span>To Proxy Box</span>
                                  </button>

                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                                    title="Remove from collection"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleOpenReturnModal(inst)}
                                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                                    title="Return to Chaos Drawers"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    <span>Return to Drawers</span>
                                  </button>

                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                                    title="Remove from collection"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}

                              {/* Copy Individual Options Menu Toggle */}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCardMenuOpenId(cardMenuOpenId === inst.instance_id ? null : inst.instance_id);
                                  }}
                                  className={`p-1.5 rounded-lg transition border cursor-pointer ${
                                    cardMenuOpenId === inst.instance_id
                                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                                      : 'text-slate-400 hover:text-white bg-slate-900 border-slate-700/80 hover:bg-slate-800'
                                  }`}
                                  title="Copy status settings"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>

                                {cardMenuOpenId === inst.instance_id && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="absolute right-0 top-8 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 text-xs animate-in fade-in"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleToggleProxy(inst)}
                                      className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                        <span>{inst.is_proxy ? 'Mark as Real Card' : 'Mark as Proxy'}</span>
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleForSale(inst)}
                                      className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                                        <span>{inst.is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                                      </span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL: Return to Chaos Drawers */}
      {returningInstance && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-amber-400" />
              Return {returningInstance.card_name} to Drawers
            </h3>

            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">UNIT</label>
                <select
                  value={returnUnit}
                  onChange={(e) => setReturnUnit(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  {Array.from({ length: unitCount }, (_, i) => i + 1).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">DRAWER</label>
                <select
                  value={returnDrawer}
                  onChange={(e) => setReturnDrawer(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  <option value="A">A (Left)</option>
                  <option value="B">B (Middle)</option>
                  <option value="C">C (Right)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">BATCH</label>
                <input
                  type="number"
                  min={1}
                  value={returnBatch}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setReturnBatch('');
                    } else {
                      const p = parseInt(val, 10);
                      if (!isNaN(p)) setReturnBatch(p);
                    }
                  }}
                  onBlur={() => {
                    if (returnBatch === '' || returnBatch < 1) {
                      setReturnBatch(1);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setReturningInstance(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReturn}
                className="px-3 py-1.5 rounded-lg bg-amber-500 font-bold text-slate-950"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Edit Coordinate */}
      {editingInstance && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-400" />
              Edit Drawer Coordinate
            </h3>

            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">UNIT</label>
                <select
                  value={editUnit}
                  onChange={(e) => setEditUnit(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  {Array.from({ length: unitCount }, (_, i) => i + 1).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">DRAWER</label>
                <select
                  value={editDrawer}
                  onChange={(e) => setEditDrawer(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  <option value="A">A (Left)</option>
                  <option value="B">B (Middle)</option>
                  <option value="C">C (Right)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">BATCH</label>
                <input
                  type="number"
                  min={1}
                  value={editBatch}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setEditBatch('');
                    } else {
                      const p = parseInt(val, 10);
                      if (!isNaN(p)) setEditBatch(p);
                    }
                  }}
                  onBlur={() => {
                    if (editBatch === '' || editBatch < 1) {
                      setEditBatch(1);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setEditingInstance(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1.5 rounded-lg bg-amber-500 font-bold text-slate-950"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 border border-slate-700 text-slate-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-mono backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-500 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* MODAL: Index New Copy */}
      {quickAddCard && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="h-4 w-4 text-amber-400" />
              <span>Add Physical Copy of {quickAddCard.name}</span>
            </h3>

            {/* Proxy Toggle Checkbox */}
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <input
                type="checkbox"
                id="quick-add-proxy"
                checked={addAsProxy}
                onChange={(e) => setAddAsProxy(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 text-purple-600 focus:ring-purple-500 bg-slate-900 cursor-pointer"
              />
              <label htmlFor="quick-add-proxy" className="text-xs font-mono text-slate-200 cursor-pointer flex items-center gap-1.5 select-none">
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span>Index as Proxy (Offline Proxy Box)</span>
              </label>
            </div>

            {addAsProxy ? (
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-800/40 text-xs font-mono text-purple-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                  <span>TARGET STORAGE: Offline Proxy Box</span>
                </div>
                <div className="text-[11px] text-purple-300/80">
                  Storage Units cannot contain proxies. This card will be valued at £0.00 and stored in the Proxy Box.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">UNIT</label>
                  <select
                    value={addUnit}
                    onChange={(e) => setAddUnit(parseInt(e.target.value, 10))}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                  >
                    {Array.from({ length: unitCount }, (_, i) => i + 1).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">DRAWER</label>
                  <select
                    value={addDrawer}
                    onChange={(e) => setAddDrawer(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                  >
                    <option value="A">A (Left)</option>
                    <option value="B">B (Middle)</option>
                    <option value="C">C (Right)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">BATCH</label>
                  <input
                    type="number"
                    min={1}
                    value={addBatch}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setAddBatch('');
                      } else {
                        const p = parseInt(val, 10);
                        if (!isNaN(p)) setAddBatch(p);
                      }
                    }}
                    onBlur={() => {
                      if (addBatch === '' || addBatch < 1) {
                        setAddBatch(1);
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setQuickAddCard(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmQuickAdd}
                className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer shadow ${
                  addAsProxy
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {addAsProxy ? 'Index as Proxy' : 'Index Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

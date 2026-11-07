import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  ArrowUpDown,
  Bookmark,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { CardInstance, ScryfallCard, CustomList } from '../types';
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
import { useDebouncedSearch } from '../hooks/useDebounce';
import { useWindowVirtualList } from '../hooks/useWindowVirtual';
import { SniperCardItem } from './SniperCardItem';

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

interface SniperSearchProps {
  isActive?: boolean;
}

export const SniperSearch: React.FC<SniperSearchProps> = React.memo(({ isActive = true }) => {
  const {
    input: searchInput,
    setInput: setSearchInput,
    debounced: debouncedQuery,
    deferred: deferredQuery,
    setImmediate: setQueryImmediate,
    clear: clearQuery,
    isPending: isSearchPending
  } = useDebouncedSearch('', 300);

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

  const setRecentlyMoved = useCallback((updater: React.SetStateAction<Map<string, { fromLoc: string }>>) => {
    setRecentlyMovedState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        sessionStorage.setItem(SESSION_KEY_MOVED, JSON.stringify(Array.from(next.entries())));
      } catch {}
      return next;
    });
  }, []);

  const setRecentlyRemoved = useCallback((updater: React.SetStateAction<Map<string, CardInstance>>) => {
    setRecentlyRemovedState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        sessionStorage.setItem(SESSION_KEY_REMOVED, JSON.stringify(Array.from(next.entries())));
      } catch {}
      return next;
    });
  }, []);

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
  const [listSubmenuOpenId, setListSubmenuOpenId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastUndoAction, setToastUndoAction] = useState<(() => void) | null>(null);

  const showToast = useCallback((msg: string, onUndo?: () => void) => {
    setToastMessage(msg);
    setToastUndoAction(onUndo ? () => onUndo : null);
    setTimeout(() => {
      setToastMessage(prev => (prev === msg ? null : prev));
      setToastUndoAction(null);
    }, 4500);
  }, []);

  // Close open card dropdown menu when clicking anywhere outside
  useEffect(() => {
    const handleClickOutside = () => {
      setCardMenuOpenId(null);
      setListSubmenuOpenId(null);
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [cards, setCards] = useState<ScryfallCard[]>(() => db.getAllCards());
  const [unitCount, setUnitCount] = useState<number>(() => db.getUnitCount());
  const [customLists, setCustomLists] = useState<CustomList[]>(() => db.getCustomLists());

  useEffect(() => {
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setCards(db.getAllCards());
      setUnitCount(db.getUnitCount());
      setCustomLists(db.getCustomLists());
    });
  }, []);

  // Autocomplete
  useEffect(() => {
    if (debouncedQuery.length >= 2 && !debouncedQuery.includes(':')) {
      scryfallAutocomplete(debouncedQuery).then(res => setSuggestions(res.slice(0, 5)));
    } else {
      setSuggestions([]);
    }
  }, [debouncedQuery]);

  // Global Scryfall Search
  useEffect(() => {
    if (scope === 'global' && debouncedQuery.trim().length >= 2) {
      setIsSearchingGlobal(true);
      const timer = setTimeout(async () => {
        const results = await searchScryfallAPI(debouncedQuery);
        setGlobalResults(results);
        setIsSearchingGlobal(false);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setGlobalResults([]);
    }
  }, [debouncedQuery, scope]);

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

    const clauses = parseSyntaxQuery(deferredQuery);

    // Deduplicate cards by name, prioritizing canonical card with market price
    const dedupedMap = new Map<string, ScryfallCard>();
    for (const card of cards) {
      const key = card.name.trim().toLowerCase();
      const existing = dedupedMap.get(key);
      if (!existing || existing.price_eur === 0 || (card.price_eur > 0 && card.price_eur < existing.price_eur)) {
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
      if (!hasInstances && !hasRemoved && !deferredQuery.trim()) return false;
      if (!deferredQuery.trim()) return true;
      return cardMatchesSyntax(card, clauses);
    });
  }, [cards, deferredQuery, scope, globalResults, instancesByOracleId, recentlyRemoved]);

  const executeGlobalSearch = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) return;
    setIsSearchingGlobal(true);
    setSuggestions([]);
    const results = await searchScryfallAPI(searchTerm.trim());
    setGlobalResults(results);
    setIsSearchingGlobal(false);
  }, []);

  const handlePrimarySortChange = useCallback((newSort: SortOption) => {
    setPrimarySort(newSort);
    localStorage.setItem('arcawms_search_sort_primary', newSort);
    localStorage.setItem('arcawms_search_sort', newSort);
    playSound('click');
  }, []);

  const handleSecondarySortChange = useCallback((newSort: SortOption) => {
    setSecondarySort(newSort);
    localStorage.setItem('arcawms_search_sort_secondary', newSort);
    playSound('click');
  }, []);

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

  const addSyntaxPill = useCallback((filterText: string) => {
    playSound('click');
    setSearchInput(prev => {
      const next = prev.trim() ? `${prev.trim()} ${filterText}` : filterText;
      setQueryImmediate(next);
      return next;
    });
  }, [setQueryImmediate, setSearchInput]);

  const handleToggleCardMenu = useCallback((id: string | null) => {
    setCardMenuOpenId(id);
    setListSubmenuOpenId(null);
  }, []);

  const handleToggleSubmenu = useCallback((id: string | null) => {
    setListSubmenuOpenId(id);
  }, []);

  // 1. Pull to Brew & Decks
  const handlePullToBrew = useCallback((inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    const origLoc = inst.location_id || '1.A.01';
    db.checkoutToDecks(inst.instance_id);

    setRecentlyMoved(prev => {
      const next = new Map(prev);
      next.set(inst.instance_id, { fromLoc: origLoc });
      return next;
    });
  }, [setRecentlyMoved]);

  // Undo Move to Brew
  const handleUndoMoveToBrew = useCallback((instanceId: string) => {
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
  }, [recentlyMoved, setRecentlyMoved]);

  // 2. Remove for Sales & Trades
  const handleRemoveForTrade = useCallback((inst: CardInstance) => {
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
  }, [recentlyMoved, setRecentlyMoved, setRecentlyRemoved]);

  // Undo Remove
  const handleUndoRemove = useCallback((instanceId: string) => {
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
  }, [recentlyRemoved, setRecentlyRemoved]);

  // Open return to chaos modal
  const handleOpenReturnModal = useCallback((inst: CardInstance) => {
    playSound('click');
    setReturningInstance(inst);
  }, []);

  const handleConfirmReturn = useCallback(() => {
    if (!returningInstance) return;
    playSound('success');
    triggerHaptic('medium');
    const effBatch = typeof returnBatch === 'number' && returnBatch >= 1 ? returnBatch : 1;
    const locId = formatLocationId(returnUnit, returnDrawer, effBatch);
    db.returnToChaos(returningInstance.instance_id, locId);
    setReturningInstance(null);
  }, [returningInstance, returnBatch, returnUnit, returnDrawer]);

  // Edit coordinate modal
  const handleOpenEdit = useCallback((inst: CardInstance) => {
    playSound('click');
    const coord = parseLocationId(inst.location_id);
    setEditUnit(coord.valid ? coord.unit : 1);
    setEditDrawer(coord.valid ? coord.drawer : 'A');
    setEditBatch(coord.valid ? coord.batch_index : 1);
    setEditingInstance(inst);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingInstance) return;
    playSound('success');
    const effBatch = typeof editBatch === 'number' && editBatch >= 1 ? editBatch : 1;
    const locId = formatLocationId(editUnit, editDrawer, effBatch);
    db.updateLocation(editingInstance.instance_id, locId);
    setEditingInstance(null);
  }, [editingInstance, editBatch, editUnit, editDrawer]);

  // Open Quick Add with smart default batch location (< 12 non-empty batches)
  const handleOpenQuickAdd = useCallback((card: ScryfallCard, defaultProxy = false) => {
    playSound('click');
    const smart = getSmartDefaultBatchLocation(db.getAllInstances(), db.getUnitCount());
    setAddUnit(smart.unit);
    setAddDrawer(smart.drawer);
    setAddBatch(smart.batchIndex);
    setAddAsProxy(defaultProxy);
    setQuickAddCard(card);
  }, []);

  // Add new physical copy (standard storage drawer or proxy box)
  const handleConfirmQuickAdd = useCallback(() => {
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
  }, [quickAddCard, addAsProxy, addBatch, addUnit, addDrawer, showToast]);

  // Toggle Proxy status on card
  const handleToggleProxy = useCallback((inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    const snapshot: CardInstance = { ...inst };
    const res = db.toggleProxy(inst.instance_id);
    setCardMenuOpenId(null);
    const revert = () => {
      playSound('success');
      triggerHaptic('medium');
      db.restoreInstance(snapshot);
      showToast(`Reverted "${inst.card_name}" back to original state`);
    };
    if (res.relocatedToProxyBox) {
      showToast(`Marked "${inst.card_name}" as Proxy ➔ relocated to Proxy Box`, revert);
    } else if (res.is_proxy) {
      showToast(`Marked "${inst.card_name}" as Proxy`, revert);
    } else {
      showToast(`Marked "${inst.card_name}" as Real Card`, revert);
    }
  }, [showToast]);

  // Toggle For Sale status on card (red border)
  const handleToggleForSale = useCallback((inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    const isForSale = db.toggleForSale(inst.instance_id);
    setCardMenuOpenId(null);
    if (isForSale) {
      showToast(`"${inst.card_name}" marked FOR SALE (Red Border active)`);
    } else {
      showToast(`"${inst.card_name}" removed from sale`);
    }
  }, [showToast]);

  // Move proxy card back into Proxy Box from Decks/Brewing
  const handleMoveToProxyBox = useCallback((inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    db.returnToProxyBox(inst.instance_id);
    setCardMenuOpenId(null);
    showToast(`"${inst.card_name}" moved to Proxy Box`);
  }, [showToast]);

  // Add to custom list
  const handleAddCardToList = useCallback((cardName: string, listId: string, listName: string, metadata?: ScryfallCard) => {
    playSound('success');
    triggerHaptic('light');
    const addedItem = db.addCardToCustomList(listId, cardName, 1, metadata);
    setCardMenuOpenId(null);
    setListSubmenuOpenId(null);
    showToast(`Added "${cardName}" to ${listName}`, () => {
      if (addedItem) {
        db.removeCardFromCustomList(listId, addedItem.id);
        playSound('skip');
        triggerHaptic('light');
      }
    });
  }, [showToast]);

  const handleQuickCreateListAndAdd = useCallback((cardName: string, metadata?: ScryfallCard) => {
    const name = window.prompt('Enter new custom list name (e.g. EDH Wishlist, Binder):');
    if (!name || !name.trim()) return;
    playSound('click');
    const newList = db.createCustomList(name.trim());
    const addedItem = db.addCardToCustomList(newList.id, cardName, 1, metadata);
    setCardMenuOpenId(null);
    setListSubmenuOpenId(null);
    showToast(`Created "${newList.name}" & added "${cardName}"`, () => {
      if (addedItem) {
        db.removeCardFromCustomList(newList.id, addedItem.id);
        playSound('skip');
        triggerHaptic('light');
      }
    });
  }, [showToast]);

  // Window Virtualizer: render only visible cards to keep navigation, DOM, and typing ultra-fast
  const { listRef, virtualItems, totalSize, scrollMargin, virtualizer } = useWindowVirtualList({
    items: sortedCards,
    estimateSize: 180,
    overscan: 6,
    isActive,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Search Header */}
      <div className="space-y-3">
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setSuggestions([]);
                  setQueryImmediate(searchInput);
                  if (scope === 'global' && searchInput.trim().length >= 2) {
                    executeGlobalSearch(searchInput);
                  }
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  setSuggestions([]);
                }
              }}
              placeholder='Search card name or Scryfall syntax (e.g. cmc<=2, p<=5, id<=wu, otag:removal)...'
              className="w-full bg-slate-900 border border-slate-700/80 rounded-2xl pl-12 pr-10 py-3.5 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-theme-primary shadow-lg font-sans"
              autoFocus
            />
            {searchInput && (
              <button
                onClick={() => { clearQuery(); playSound('click'); }}
                className="absolute right-3.5 p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                title="Clear search"
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
                  onClick={() => { setQueryImmediate(name); setSuggestions([]); playSound('click'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-theme-subtle hover:text-theme-primary flex items-center justify-between cursor-pointer"
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
            <button onClick={() => addSyntaxPill('cmc:1')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">cmc:1</button>
            <button onClick={() => addSyntaxPill('cmc:2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">cmc:2</button>
            <button onClick={() => addSyntaxPill('cmc<=2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">cmc&lt;=2</button>
            <button onClick={() => addSyntaxPill('p<=2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">p&lt;=2</button>
            <button onClick={() => addSyntaxPill('t:creature')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">t:creature</button>
            <button onClick={() => addSyntaxPill('c:u')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">c:u</button>
            <button onClick={() => addSyntaxPill('id<=wu')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">id&lt;=wu</button>
            <button onClick={() => addSyntaxPill('otag:removal')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">otag:removal</button>
            <button onClick={() => addSyntaxPill('o:"draw"')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 cursor-pointer">o:draw</button>
          </div>

          <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[11px]">
            <button
              onClick={() => { setScope('inventory'); playSound('click'); }}
              className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                scope === 'inventory' ? 'bg-theme-primary text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              My Cards
            </button>
            <button
              onClick={() => { setScope('global'); playSound('click'); }}
              className={`px-2.5 py-1 rounded-md transition flex items-center gap-1 cursor-pointer ${
                scope === 'global' ? 'bg-theme-primary text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
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
            {deferredQuery.trim() ? 'Matching cards:' : 'Full collection:'}{' '}
            <strong className="text-white font-bold">{sortedCards.length}</strong>
          </span>
          {deferredQuery.trim() && (
            <span className="text-slate-500">
              for &quot;<span className="text-theme-accent">{deferredQuery}</span>&quot;
            </span>
          )}
          {isSearchPending && (
            <Loader2 className="h-3 w-3 animate-spin text-theme-accent ml-1" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-theme-accent" />
            <span className="text-slate-400 font-bold">Sort:</span>
            <select
              value={primarySort}
              onChange={(e) => handlePrimarySortChange(e.target.value as SortOption)}
              aria-label="Primary Sort"
              className="bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-theme-primary font-sans cursor-pointer transition shadow"
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
              className="bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-theme-primary font-sans cursor-pointer transition shadow"
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

      {/* Cards List with Window Virtualization */}
      <div>
        {sortedCards.length === 0 && !isSearchingGlobal && (
          <div className="p-10 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-xs">
            No cards matched &quot;{deferredQuery || searchInput}&quot;. Try switching to Scryfall search or clearing filters.
          </div>
        )}

        {sortedCards.length > 0 && (
          <div
            ref={listRef}
            style={{
              height: `${totalSize}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const card = sortedCards[virtualItem.index];
              if (!card) return null;

              const rawInstances = [
                ...(instancesByOracleId.get(card.oracle_id) || []),
                ...(instancesByOracleId.get(card.name.trim().toLowerCase()) || [])
              ];
              const cardInstances = Array.from(new Map(rawInstances.map(i => [i.instance_id, i])).values());

              const removedForCard = Array.from(recentlyRemoved.values()).filter(
                r => r.oracle_id === card.oracle_id || r.card_name.trim().toLowerCase() === card.name.trim().toLowerCase()
              );

              const isAnyCardMenuOpen = cardMenuOpenId === card.oracle_id || cardInstances.some(i => i.instance_id === cardMenuOpenId);

              return (
                <div
                  key={card.oracle_id || virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="pb-4"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                    zIndex: isAnyCardMenuOpen ? 30 : 1,
                  }}
                >
                  <SniperCardItem
                    card={card}
                    cardInstances={cardInstances}
                    removedForCard={removedForCard}
                    isAnyCardMenuOpen={isAnyCardMenuOpen}
                    cardMenuOpenId={cardMenuOpenId}
                    listSubmenuOpenId={listSubmenuOpenId}
                    customLists={customLists}
                    recentlyMoved={recentlyMoved}
                    onToggleCardMenu={handleToggleCardMenu}
                    onToggleSubmenu={handleToggleSubmenu}
                    onOpenQuickAdd={handleOpenQuickAdd}
                    onToggleProxy={handleToggleProxy}
                    onToggleForSale={handleToggleForSale}
                    onAddCardToList={handleAddCardToList}
                    onQuickCreateListAndAdd={handleQuickCreateListAndAdd}
                    onUndoRemove={handleUndoRemove}
                    onPullToBrew={handlePullToBrew}
                    onRemoveForTrade={handleRemoveForTrade}
                    onOpenEdit={handleOpenEdit}
                    onUndoMoveToBrew={handleUndoMoveToBrew}
                    onMoveToProxyBox={handleMoveToProxyBox}
                    onOpenReturn={handleOpenReturnModal}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: Return to Chaos Drawers */}
      {returningInstance && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-theme-accent" />
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
                className="px-3 py-1.5 rounded-lg bg-theme-accent hover:bg-theme-accent-hover font-bold text-slate-950 cursor-pointer shadow"
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
              <MapPin className="h-4 w-4 text-theme-accent" />
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
                className="px-3 py-1.5 rounded-lg bg-theme-accent hover:bg-theme-accent-hover font-bold text-slate-950 cursor-pointer shadow"
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
          <Sparkles className="h-4 w-4 text-theme-accent shrink-0" />
          <span>{toastMessage}</span>
          {toastUndoAction && (
            <button
              onClick={() => {
                toastUndoAction();
                setToastMessage(null);
                setToastUndoAction(null);
              }}
              className="ml-2 px-2.5 py-1 rounded bg-theme-accent-subtle text-theme-accent hover:bg-theme-accent/30 font-bold border border-theme-accent-subtle cursor-pointer flex items-center gap-1 shadow"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Undo ↺</span>
            </button>
          )}
          <button 
            onClick={() => { setToastMessage(null); setToastUndoAction(null); }}
            className="ml-1 text-slate-500 hover:text-white cursor-pointer"
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
              <Plus className="h-4 w-4 text-theme-accent" />
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
                    : 'bg-theme-accent hover:bg-theme-accent-hover text-slate-950'
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
});

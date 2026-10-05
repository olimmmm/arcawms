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
  Undo2
} from 'lucide-react';
import { CardInstance, ScryfallCard } from '../types';
import { db } from '../services/db';
import { 
  parseSyntaxQuery, 
  cardMatchesSyntax, 
  searchScryfallAPI, 
  scryfallAutocomplete, 
  getScryfallImageFallback, 
  CARD_BACK_IMAGE, 
  enrichMissingCards 
} from '../services/scryfall';
import { formatLocationId, parseLocationId } from '../services/pickPath';
import { playSound, triggerHaptic } from '../services/audio';

export const SniperSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'inventory' | 'global'>('inventory');
  const [globalResults, setGlobalResults] = useState<ScryfallCard[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Session state to support on-page UNDO for cards moved or removed on this page
  const [recentlyMoved, setRecentlyMoved] = useState<Map<string, { fromLoc: string }>>(new Map());
  const [recentlyRemoved, setRecentlyRemoved] = useState<Map<string, CardInstance>>(new Map());

  // Editing coordinate modal
  const [editingInstance, setEditingInstance] = useState<CardInstance | null>(null);
  const [editUnit, setEditUnit] = useState(1);
  const [editDrawer, setEditDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [editBatch, setEditBatch] = useState(1);

  // Return to Chaos Drawer modal
  const [returningInstance, setReturningInstance] = useState<CardInstance | null>(null);
  const [returnUnit, setReturnUnit] = useState(1);
  const [returnDrawer, setReturnDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [returnBatch, setReturnBatch] = useState(1);

  // Add new copy modal
  const [quickAddCard, setQuickAddCard] = useState<ScryfallCard | null>(null);
  const [addUnit, setAddUnit] = useState(1);
  const [addDrawer, setAddDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [addBatch, setAddBatch] = useState(1);

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [cards, setCards] = useState<ScryfallCard[]>(() => db.getAllCards());

  useEffect(() => {
    enrichMissingCards();
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setCards(db.getAllCards());
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

  // Group instances by oracle_id or card_name
  const instancesByOracleId = useMemo(() => {
    const map = new Map<string, CardInstance[]>();
    for (const inst of instances) {
      const key = inst.oracle_id || inst.card_name.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inst);
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
      const hasInstances = (instancesByOracleId.get(card.oracle_id) || instancesByOracleId.get(card.name.toLowerCase()) || []).length > 0;
      const hasRemoved = Array.from(recentlyRemoved.values()).some(
        r => r.oracle_id === card.oracle_id || r.card_name.toLowerCase() === card.name.toLowerCase()
      );
      if (!hasInstances && !hasRemoved && !query.trim()) return false;
      if (!query.trim()) return true;
      return cardMatchesSyntax(card, clauses);
    });
  }, [cards, query, scope, globalResults, instancesByOracleId, recentlyRemoved]);

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
    const locId = formatLocationId(returnUnit, returnDrawer, returnBatch);
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
    const locId = formatLocationId(editUnit, editDrawer, editBatch);
    db.updateLocation(editingInstance.instance_id, locId);
    setEditingInstance(null);
  };

  // Add new physical copy
  const handleConfirmQuickAdd = () => {
    if (!quickAddCard) return;
    playSound('success');
    triggerHaptic('medium');
    const locId = formatLocationId(addUnit, addDrawer, addBatch);
    db.upsertCard(quickAddCard);
    db.createInstance({
      oracle_id: quickAddCard.oracle_id,
      card_name: quickAddCard.name,
      state: 'A',
      location_id: locId
    });
    setQuickAddCard(null);
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
              placeholder='Search card name or Scryfall syntax (e.g. cmc:3, t:creature, c:u)...'
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
            <button onClick={() => addSyntaxPill('cmc:3')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">cmc:3</button>
            <button onClick={() => addSyntaxPill('cmc<=2')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">cmc&lt;=2</button>
            <button onClick={() => addSyntaxPill('t:creature')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">t:creature</button>
            <button onClick={() => addSyntaxPill('c:u')} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">c:u</button>
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

      {isSearchingGlobal && (
        <div className="p-8 text-center text-slate-400 text-xs">
          Searching Scryfall database...
        </div>
      )}

      {/* Cards List */}
      <div className="space-y-4">
        {filteredCards.length === 0 && !isSearchingGlobal && (
          <div className="p-10 text-center bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-400 text-xs">
            No cards matched &quot;{query}&quot;. Try switching to Scryfall search or clearing filters.
          </div>
        )}

        {filteredCards.map((card) => {
          const cardInstances = (instancesByOracleId.get(card.oracle_id) || instancesByOracleId.get(card.name.toLowerCase()) || []);
          
          // Also look for recently removed instances for this card to show on-page undo
          const removedForCard = Array.from(recentlyRemoved.values()).filter(
            r => r.oracle_id === card.oracle_id || r.card_name.toLowerCase() === card.name.toLowerCase()
          );

          return (
            <div
              key={card.oracle_id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row gap-4 sm:gap-5"
            >
              {/* Reliable Card Image with Automatic Fallback */}
              <div className="w-24 sm:w-28 shrink-0 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 self-start shadow">
                <img
                  src={card.image_url_normal || getScryfallImageFallback(card.name)}
                  alt={card.name}
                  loading="lazy"
                  className="w-full h-auto object-cover"
                  onError={(e) => {
                    e.currentTarget.src = CARD_BACK_IMAGE;
                  }}
                />
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

                  <button
                    onClick={() => { setQuickAddCard(card); playSound('click'); }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 border border-slate-700 transition"
                  >
                    <Plus className="h-3.5 w-3.5 text-amber-400" />
                    <span>+ Add Copy</span>
                  </button>
                </div>

                {/* Copies list */}
                <div className="space-y-2 pt-1">
                  {cardInstances.length === 0 && removedForCard.length === 0 ? (
                    <div className="text-xs text-slate-500 italic">
                      None in your inventory. Tap &quot;+ Add Copy&quot; to assign a drawer coordinate.
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
                        const recentlyMovedBrew = recentlyMoved.has(inst.instance_id);

                        return (
                          <div
                            key={inst.instance_id}
                            className={`flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-xl border gap-2 text-xs transition ${
                              recentlyMovedBrew 
                                ? 'bg-blue-950/30 border-blue-800/60' 
                                : 'bg-slate-950 border-slate-800/80'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              {isInChaos ? (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 font-mono-coordinate font-black text-sm border border-amber-500/40 flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span>{inst.location_id || 'UNASSIGNED'}</span>
                                  </span>
                                  <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">In Chaos Drawer</span>
                                </div>
                              ) : recentlyMovedBrew ? (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 font-mono-coordinate font-black text-sm border border-blue-500/40 flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5 text-blue-400" />
                                    <span>{recentlyMoved.get(inst.instance_id)?.fromLoc}</span>
                                  </span>
                                  <span className="text-blue-300 font-mono text-[11px] font-bold">➔ In Decks / Brewing</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 font-mono text-xs border border-blue-500/30 font-bold">
                                    In Decks / Brewing
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Dual Pull Options & Actions */}
                            <div className="flex items-center gap-2 self-end sm:self-auto">
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
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
                                    title="Change coordinate"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
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

                                  {/* Can also remove from brew for trade */}
                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800"
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

                                  {/* Can also remove from brew for trade */}
                                  <button
                                    onClick={() => handleRemoveForTrade(inst)}
                                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800"
                                    title="Remove from collection"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
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
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((u) => <option key={u} value={u}>{u}</option>)}
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
                  onChange={(e) => setReturnBatch(Math.max(1, parseInt(e.target.value, 10) || 1))}
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
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((u) => <option key={u} value={u}>{u}</option>)}
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
                  onChange={(e) => setEditBatch(Math.max(1, parseInt(e.target.value, 10) || 1))}
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

      {/* MODAL: Index New Copy */}
      {quickAddCard && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="h-4 w-4 text-amber-400" />
              Add Physical Copy of {quickAddCard.name}
            </h3>

            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">UNIT</label>
                <select
                  value={addUnit}
                  onChange={(e) => setAddUnit(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((u) => <option key={u} value={u}>{u}</option>)}
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
                  onChange={(e) => setAddBatch(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setQuickAddCard(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmQuickAdd}
                className="px-3 py-1.5 rounded-lg bg-amber-500 font-bold text-slate-950"
              >
                Index Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

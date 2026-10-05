import React, { useState, useMemo, useEffect } from 'react';
import { 
  Boxes, 
  MapPin, 
  ChevronLeft, 
  Eye, 
  Layers, 
  Sparkles,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Search,
  X
} from 'lucide-react';
import { CardInstance, ScryfallCard } from '../types';
import { db } from '../services/db';
import { formatLocationId, parseLocationId } from '../services/pickPath';
import { getScryfallImageFallback, CARD_BACK_IMAGE, enrichMissingCards } from '../services/scryfall';
import { playSound, triggerHaptic } from '../services/audio';

export const SkeuomorphicViewer: React.FC = () => {
  // Navigation levels:
  // level 1: cabinet (view all 9 units x 3 drawers)
  // level 2: drawer (inside open drawer, see dividers/batches)
  // level 3: batch (inside a batch, flip through cards)
  // level 4: brewing (inside diffuse decks/brewing pool)
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<'A' | 'B' | 'C' | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [isViewingBrewing, setIsViewingBrewing] = useState<boolean>(false);
  const [brewingSearchQuery, setBrewingSearchQuery] = useState<string>('');

  // Return to Chaos Drawer modal from brewing
  const [returningInstance, setReturningInstance] = useState<CardInstance | null>(null);
  const [returnUnit, setReturnUnit] = useState<number>(1);
  const [returnDrawer, setReturnDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [returnBatch, setReturnBatch] = useState<number>(1);

  // Card zoom preview
  const [previewCard, setPreviewCard] = useState<CardInstance | null>(null);

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [cards, setCards] = useState<ScryfallCard[]>(() => db.getAllCards());

  useEffect(() => {
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setCards(db.getAllCards());
    });
  }, []);

  useEffect(() => {
    enrichMissingCards();
  }, [selectedBatch, selectedDrawer, selectedUnit]);

  const cardDictionary = useMemo(() => {
    const map = new Map<string, ScryfallCard>();
    for (const c of cards) {
      const existing = map.get(c.name.toLowerCase());
      if (!existing || (c.price_eur > 0 && existing.price_eur === 0)) {
        map.set(c.name.toLowerCase(), c);
      }
      map.set(c.oracle_id, c);
    }
    return map;
  }, [cards]);

  // Index cards into Units -> Drawers -> Batches
  const warehouseMap = useMemo(() => {
    // 9 units, each with A, B, C
    const data: Record<number, Record<'A' | 'B' | 'C', Map<number, CardInstance[]>>> = {};

    for (let u = 1; u <= 9; u++) {
      data[u] = {
        A: new Map(),
        B: new Map(),
        C: new Map()
      };
    }

    for (const inst of instances) {
      if (inst.state !== 'A' || !inst.location_id) continue;
      const coord = parseLocationId(inst.location_id);
      if (!coord.valid || coord.unit < 1 || coord.unit > 9) continue;

      const unitDrawers = data[coord.unit];
      if (unitDrawers && unitDrawers[coord.drawer]) {
        const batchMap = unitDrawers[coord.drawer];
        if (!batchMap.has(coord.batch_index)) {
          batchMap.set(coord.batch_index, []);
        }
        batchMap.get(coord.batch_index)!.push(inst);
      }
    }

    return data;
  }, [instances]);

  // Cards currently in Active Decks & Brewing pool (State B)
  const brewingCards = useMemo(() => {
    return instances.filter(inst => inst.state === 'B');
  }, [instances]);

  const brewingEurValue = useMemo(() => {
    return brewingCards.reduce((acc, inst) => {
      const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);
      return acc + (meta?.price_eur || 0);
    }, 0);
  }, [brewingCards, cardDictionary]);

  const filteredBrewingCards = useMemo(() => {
    if (!brewingSearchQuery.trim()) return brewingCards;
    const q = brewingSearchQuery.toLowerCase();
    return brewingCards.filter(inst => inst.card_name.toLowerCase().includes(q));
  }, [brewingCards, brewingSearchQuery]);

  // Open Drawer action
  const handleOpenDrawer = (unit: number, drawer: 'A' | 'B' | 'C') => {
    playSound('pull');
    triggerHaptic('medium');
    setSelectedUnit(unit);
    setSelectedDrawer(drawer);
    setSelectedBatch(null);
    setIsViewingBrewing(false);
  };

  // Open Brewing Pool action
  const handleOpenBrewing = () => {
    playSound('pull');
    triggerHaptic('medium');
    setIsViewingBrewing(true);
    setSelectedUnit(null);
    setSelectedDrawer(null);
    setSelectedBatch(null);
  };

  // Return card to chaos drawer from brewing
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

  // Remove card for trade/sale from brewing
  const handleRemoveForTrade = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    db.deleteInstance(inst.instance_id);
  };

  // Open Batch action
  const handleOpenBatch = (batchIndex: number) => {
    playSound('click');
    triggerHaptic('light');
    setSelectedBatch(batchIndex);
  };

  // Back actions
  const handleBackToCabinet = () => {
    playSound('skip');
    setSelectedUnit(null);
    setSelectedDrawer(null);
    setSelectedBatch(null);
    setIsViewingBrewing(false);
  };

  const handleBackToDrawer = () => {
    playSound('skip');
    setSelectedBatch(null);
  };

  // Checkout directly from viewer
  const handleCheckoutCard = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    db.checkoutToDecks(inst.instance_id);
  };

  // Active batches inside selected drawer
  const activeBatchesInDrawer = useMemo(() => {
    if (!selectedUnit || !selectedDrawer) return [];
    const batchMap = warehouseMap[selectedUnit]?.[selectedDrawer];
    if (!batchMap) return [];
    return Array.from(batchMap.entries()).sort((a, b) => a[0] - b[0]);
  }, [selectedUnit, selectedDrawer, warehouseMap]);

  // Active cards inside selected batch
  const activeCardsInBatch = useMemo(() => {
    if (!selectedUnit || !selectedDrawer || selectedBatch === null) return [];
    return warehouseMap[selectedUnit]?.[selectedDrawer]?.get(selectedBatch) || [];
  }, [selectedUnit, selectedDrawer, selectedBatch, warehouseMap]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* LEVEL 1: SKEUOMORPHIC CABINET VIEW */}
      {selectedUnit === null && !isViewingBrewing && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Boxes className="h-5 w-5 text-amber-400" />
                Physical Chaos Cabinet (9 Units × 3 Drawers)
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any physical drawer to slide it open and browse batch dividers.
              </p>
            </div>
          </div>

          {/* Realistic Cabinet Frame */}
          <div className="bg-gradient-to-b from-stone-900 via-neutral-900 to-stone-950 p-4 sm:p-6 rounded-3xl border-4 border-stone-800 shadow-2xl space-y-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((u) => {
              const uDrawers = warehouseMap[u];

              return (
                <div key={u} className="space-y-1">
                  <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold text-stone-500 uppercase tracking-widest">
                    <span>UNIT {u}</span>
                  </div>

                  {/* 3 Drawer Columns | A | | B | | C | */}
                  <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
                    {(['A', 'B', 'C'] as const).map((d) => {
                      const batchMap = uDrawers?.[d];
                      const totalCards = Array.from(batchMap?.values() || []).reduce((acc, l) => acc + l.length, 0);
                      const batchCount = batchMap?.size || 0;

                      return (
                        <button
                          key={d}
                          onClick={() => handleOpenDrawer(u, d)}
                          className="group relative bg-gradient-to-b from-neutral-800 via-neutral-850 to-neutral-900 hover:from-neutral-750 hover:to-neutral-800 border-2 border-stone-700/80 hover:border-amber-500/80 rounded-xl p-3 sm:p-4 text-center shadow-lg hover:shadow-amber-500/10 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer flex flex-col items-center justify-between min-h-[82px] sm:min-h-[96px]"
                        >
                          {/* Stamped Brass Drawer Label Plate */}
                          <div className="bg-gradient-to-b from-amber-600/30 to-amber-900/40 border border-amber-500/40 rounded px-2.5 py-0.5 shadow-inner">
                            <span className="font-mono-coordinate font-black text-amber-300 text-xs sm:text-sm tracking-wider">
                              {u}.{d}
                            </span>
                          </div>

                          {/* Recessed Metal Drawer Handle Pull */}
                          <div className="w-12 sm:w-16 h-2 sm:h-2.5 rounded-full bg-gradient-to-b from-stone-950 to-neutral-800 border border-stone-700 shadow-inner my-1 group-hover:bg-amber-500/30 transition-colors" />

                          {/* Batch & Card Count Badge */}
                          <div className="text-[10px] sm:text-[11px] font-mono text-stone-400">
                            {totalCards > 0 ? (
                              <span className="text-amber-400/90 font-bold">
                                {totalCards} cards ({batchCount} b)
                              </span>
                            ) : (
                              <span className="text-stone-600">Empty</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* SKEUOMORPHIC DECKS & BREWING SHELF (BELOW ALL 9 CHAOS UNITS) */}
            <div className="pt-4 border-t-2 border-stone-800/90 mt-2">
              <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold text-blue-400 uppercase tracking-widest mb-1.5">
                <span>DIFFUSE DECKS & BREWING COMPARTMENT</span>
                <span>{brewingCards.length} CARDS</span>
              </div>

              <button
                onClick={handleOpenBrewing}
                className="w-full group relative bg-gradient-to-b from-blue-950/30 via-neutral-850 to-neutral-900 hover:from-blue-900/40 hover:to-neutral-850 border-2 border-blue-900/70 hover:border-blue-400 rounded-2xl p-4 sm:p-5 text-left shadow-xl hover:shadow-blue-500/10 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3.5">
                  {/* Skeuomorphic Deck Compartment Tag */}
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 group-hover:scale-105 transition-transform shadow-inner">
                    <Layers className="h-6 w-6" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-base">
                        Decks & Brewing Pool
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 font-mono text-xs font-bold">
                        {brewingCards.length} Cards
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5">
                      Diffuse cards pulled for play, deckbuilding, or testing (outside Chaos Drawers).
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right">
                    <span className="text-[10px] font-mono uppercase text-stone-400 block font-bold">MARKET VALUE</span>
                    <span className="text-sm font-bold font-mono text-emerald-400">
                      €{brewingEurValue.toFixed(2)}
                    </span>
                  </div>

                  <div className="px-4 py-2 rounded-xl bg-blue-600 group-hover:bg-blue-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md">
                    <span>Inspect Pool</span>
                    <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEVEL 2: INSIDE OPEN DRAWER (Batch Dividers View) */}
      {selectedUnit !== null && selectedDrawer !== null && selectedBatch === null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBackToCabinet}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 shadow"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to Cabinet</span>
            </button>

            <div className="text-right">
              <span className="text-xs font-mono uppercase text-slate-400 font-bold block">
                INSIDE OPEN DRAWER:
              </span>
              <span className="text-lg font-black text-amber-400 font-mono-coordinate">
                Unit {selectedUnit} ➔ Drawer {selectedDrawer}
              </span>
            </div>
          </div>

          {/* Skeuomorphic Top-Down Drawer Cavity */}
          <div className="bg-gradient-to-b from-neutral-950 via-stone-900 to-neutral-950 p-6 rounded-3xl border-4 border-stone-800 shadow-2xl space-y-4">
            <div className="text-xs font-mono text-stone-400 flex items-center justify-between border-b border-stone-800 pb-2">
              <span>PHYSICAL BATCH DIVIDERS ({activeBatchesInDrawer.length} BATCHES)</span>
              <span>Click a divider to inspect cards inside</span>
            </div>

            {activeBatchesInDrawer.length === 0 ? (
              <div className="p-12 text-center text-stone-500 text-xs italic">
                This drawer currently contains no active card batches.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                {activeBatchesInDrawer.map(([bIndex, batchCards]) => {
                  const coordStr = `${selectedUnit}.${selectedDrawer}.${String(bIndex).padStart(2, '0')}`;

                  return (
                    <button
                      key={bIndex}
                      onClick={() => handleOpenBatch(bIndex)}
                      className="group relative bg-gradient-to-b from-amber-700/20 via-neutral-900 to-neutral-950 hover:from-amber-600/30 hover:to-neutral-900 border-2 border-stone-700 hover:border-amber-500 rounded-2xl p-4 text-left shadow-lg hover:shadow-amber-500/10 hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between h-36"
                    >
                      {/* Top Physical Divider Tab */}
                      <div className="flex items-center justify-between w-full">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono-coordinate font-black text-xs">
                          {coordStr}
                        </span>
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      </div>

                      {/* Stack Texture Line */}
                      <div className="space-y-1 my-2 opacity-60 group-hover:opacity-100 transition-opacity">
                        <div className="h-0.5 bg-stone-700 w-full rounded" />
                        <div className="h-0.5 bg-stone-700 w-4/5 rounded" />
                        <div className="h-0.5 bg-stone-700 w-2/3 rounded" />
                      </div>

                      {/* Count & Details */}
                      <div>
                        <div className="text-sm font-bold text-white font-mono">
                          {batchCards.length} Cards
                        </div>
                        <div className="text-[10px] text-stone-400 truncate">
                          e.g. {batchCards[0]?.card_name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* LEVEL 3: INSIDE BATCH (Card Images Gallery) */}
      {selectedUnit !== null && selectedDrawer !== null && selectedBatch !== null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBackToDrawer}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 shadow"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to Drawer {selectedUnit}.{selectedDrawer}</span>
            </button>

            <div className="text-right">
              <span className="text-xs font-mono uppercase text-slate-400 font-bold block">
                INSPECTING BATCH:
              </span>
              <span className="text-lg font-black text-amber-400 font-mono-coordinate">
                {selectedUnit}.{selectedDrawer}.{String(selectedBatch).padStart(2, '0')} ({activeCardsInBatch.length} Cards)
              </span>
            </div>
          </div>

          {/* Cards Gallery */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {activeCardsInBatch.map((inst) => {
                const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);

                return (
                  <div
                    key={inst.instance_id}
                    className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-amber-500/60 transition flex flex-col justify-between"
                  >
                    {/* Card Image */}
                    <div className="relative aspect-[5/7] bg-black overflow-hidden group">
                      <img
                        src={meta?.image_url_normal || getScryfallImageFallback(inst.card_name)}
                        alt={inst.card_name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        onError={(e) => {
                          e.currentTarget.src = CARD_BACK_IMAGE;
                        }}
                      />

                      <div className="absolute bottom-1 right-1 bg-slate-950/90 text-emerald-400 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-emerald-900/50">
                        €{meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00'}
                      </div>
                    </div>

                    {/* Card Info & Quick Pull Button */}
                    <div className="p-2.5 space-y-1.5">
                      <div className="text-xs font-bold text-white truncate" title={inst.card_name}>
                        {inst.card_name}
                      </div>

                      <button
                        onClick={() => handleCheckoutCard(inst)}
                        className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer"
                      >
                        <ArrowRight className="h-3 w-3" />
                        <span>Check Out</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* LEVEL 4: INSIDE DECKS & BREWING SHELF */}
      {isViewingBrewing && selectedUnit === null && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              onClick={handleBackToCabinet}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 shadow cursor-pointer self-start"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to Chaos Cabinet</span>
            </button>

            <div className="text-left sm:text-right">
              <span className="text-xs font-mono uppercase text-blue-400 font-bold block flex items-center sm:justify-end gap-1.5">
                <Layers className="h-4 w-4" />
                <span>INSPECTING DECKS & BREWING POOL</span>
              </span>
              <span className="text-lg font-black text-white font-mono">
                {brewingCards.length} Cards <span className="text-emerald-400 font-normal text-sm sm:text-base">(€{brewingEurValue.toFixed(2)})</span>
              </span>
            </div>
          </div>

          {/* Search/filter within brewing cards */}
          {brewingCards.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={brewingSearchQuery}
                onChange={(e) => setBrewingSearchQuery(e.target.value)}
                placeholder="Filter cards in brewing..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Cards Gallery */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl">
            {filteredBrewingCards.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs italic">
                {brewingCards.length === 0 
                  ? 'No cards currently in active decks or brewing pool. Check out cards from chaos drawers to see them here!' 
                  : `No cards matching "${brewingSearchQuery}" in brewing.`}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredBrewingCards.map((inst) => {
                  const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);

                  return (
                    <div
                      key={inst.instance_id}
                      className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-lg hover:border-blue-500/60 transition flex flex-col justify-between"
                    >
                      {/* Card Image */}
                      <div className="relative aspect-[5/7] bg-black overflow-hidden group">
                        <img
                          src={meta?.image_url_normal || getScryfallImageFallback(inst.card_name)}
                          alt={inst.card_name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            e.currentTarget.src = CARD_BACK_IMAGE;
                          }}
                        />

                        <div className="absolute bottom-1 right-1 bg-slate-950/90 text-emerald-400 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-emerald-900/50">
                          €{meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00'}
                        </div>
                      </div>

                      {/* Card Info & Actions */}
                      <div className="p-2.5 space-y-2">
                        <div className="text-xs font-bold text-white truncate" title={inst.card_name}>
                          {inst.card_name}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* Return to Chaos Drawers button */}
                          <button
                            onClick={() => handleOpenReturnModal(inst)}
                            className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer transition"
                            title="Return card to physical Chaos drawer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Return</span>
                          </button>

                          {/* Trade / Sell */}
                          <button
                            onClick={() => handleRemoveForTrade(inst)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                            title="Remove from collection (Trade / Sell)"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Return from Brewing to Chaos Drawers */}
      {returningInstance && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-amber-400" />
              <span>Return {returningInstance.card_name} to Drawers</span>
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

            <div className="flex justify-end gap-2 text-xs font-mono">
              <button
                onClick={() => setReturningInstance(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReturn}
                className="px-4 py-1.5 rounded-lg bg-theme-primary font-bold shadow"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
  CheckCircle2
} from 'lucide-react';
import { CardInstance, ScryfallCard } from '../types';
import { db } from '../services/db';
import { parseLocationId } from '../services/pickPath';
import { getScryfallImageFallback } from '../services/scryfall';
import { playSound, triggerHaptic } from '../services/audio';

export const SkeuomorphicViewer: React.FC = () => {
  // Navigation levels:
  // level 1: cabinet (view all 9 units x 3 drawers)
  // level 2: drawer (inside open drawer, see dividers/batches)
  // level 3: batch (inside a batch, flip through cards)
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<'A' | 'B' | 'C' | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);

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

  const cardDictionary = useMemo(() => {
    const map = new Map<string, ScryfallCard>();
    for (const c of cards) {
      map.set(c.oracle_id, c);
      map.set(c.name.toLowerCase(), c);
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

  // Open Drawer action
  const handleOpenDrawer = (unit: number, drawer: 'A' | 'B' | 'C') => {
    playSound('pull');
    triggerHaptic('medium');
    setSelectedUnit(unit);
    setSelectedDrawer(drawer);
    setSelectedBatch(null);
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
      {selectedUnit === null && (
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
                const meta = cardDictionary.get(inst.oracle_id) || cardDictionary.get(inst.card_name.toLowerCase());

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
                          e.currentTarget.src = getScryfallImageFallback(inst.card_name);
                        }}
                      />

                      {meta?.price_eur ? (
                        <div className="absolute bottom-1 right-1 bg-slate-950/90 text-emerald-400 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-emerald-900/50">
                          €{meta.price_eur.toFixed(2)}
                        </div>
                      ) : null}
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
    </div>
  );
};

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Boxes, 
  MapPin, 
  ChevronLeft, 
  Layers, 
  Sparkles,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Search,
  X,
  Plus,
  Minus,
  Undo2,
  ShoppingBag
} from 'lucide-react';
import { CardInstance, ScryfallCard } from '../types';
import { db, generateUUID } from '../services/db';
import { formatLocationId, parseLocationId } from '../services/pickPath';
import { getScryfallImageFallback, CARD_BACK_IMAGE } from '../services/scryfall';
import { playSound, triggerHaptic } from '../services/audio';

interface UndoAction {
  id: string;
  type: 'checkout' | 'remove' | 'relocate' | 'return';
  instance: CardInstance;
  cardName: string;
  previousLocation: string | null;
  previousState: 'A' | 'B' | 'P';
  message: string;
  timestamp: number;
}

export const SkeuomorphicViewer: React.FC = () => {
  // Navigation levels:
  // level 1: cabinet (view dynamic units x 3 drawers)
  // level 2: drawer (inside open drawer, see dividers/batches)
  // level 3: batch (inside a batch, flip through cards)
  // level 4: brewing (inside diffuse decks/brewing pool)
  // level 5: proxy box (inside dedicated proxy storage box)
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [selectedDrawer, setSelectedDrawer] = useState<'A' | 'B' | 'C' | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null);
  const [isViewingBrewing, setIsViewingBrewing] = useState<boolean>(false);
  const [brewingSearchQuery, setBrewingSearchQuery] = useState<string>('');
  const [isViewingProxyBox, setIsViewingProxyBox] = useState<boolean>(false);
  const [proxySearchQuery, setProxySearchQuery] = useState<string>('');
  const [cardMenuOpenId, setCardMenuOpenId] = useState<string | null>(null);

  // Dynamic storage units count
  const [unitCount, setUnitCount] = useState<number>(() => db.getUnitCount());

  // Return to Chaos Drawer modal from brewing
  const [returningInstance, setReturningInstance] = useState<CardInstance | null>(null);
  const [returnUnit, setReturnUnit] = useState<number>(1);
  const [returnDrawer, setReturnDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [returnBatch, setReturnBatch] = useState<number | ''>(1);

  // Relocate modal for moving card between drawer batches
  const [relocatingInstance, setRelocatingInstance] = useState<CardInstance | null>(null);
  const [relocateUnit, setRelocateUnit] = useState<number>(1);
  const [relocateDrawer, setRelocateDrawer] = useState<'A' | 'B' | 'C'>('A');
  const [relocateBatch, setRelocateBatch] = useState<number | ''>(1);

  // Undo notification state
  const [activeUndo, setActiveUndo] = useState<UndoAction | null>(null);
  const [undoProgress, setUndoProgress] = useState<number>(100);
  const undoTimerRef = useRef<any>(null);

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [cards, setCards] = useState<ScryfallCard[]>(() => db.getAllCards());

  useEffect(() => {
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setCards(db.getAllCards());
      setUnitCount(db.getUnitCount());
    });
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearInterval(undoTimerRef.current);
      }
    };
  }, []);

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

  // Dynamic Units list
  const unitsList = useMemo(() => {
    const list: number[] = [];
    for (let u = 1; u <= unitCount; u++) {
      list.push(u);
    }
    return list;
  }, [unitCount]);

  // Index cards into Units -> Drawers -> Batches dynamically
  const warehouseMap = useMemo(() => {
    const data: Record<number, Record<'A' | 'B' | 'C', Map<number, CardInstance[]>>> = {};

    for (let u = 1; u <= unitCount; u++) {
      data[u] = {
        A: new Map(),
        B: new Map(),
        C: new Map()
      };
    }

    for (const inst of instances) {
      if (inst.state !== 'A' || !inst.location_id) continue;
      const coord = parseLocationId(inst.location_id);
      if (!coord.valid || coord.unit < 1) continue;

      // Auto-expand dynamic map if any instance is stored in a higher unit
      if (!data[coord.unit]) {
        data[coord.unit] = {
          A: new Map(),
          B: new Map(),
          C: new Map()
        };
      }

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
  }, [instances, unitCount]);

  // Cards currently in Active Decks & Brewing pool (State B)
  const brewingCards = useMemo(() => {
    return instances.filter(inst => inst.state === 'B');
  }, [instances]);

  // Proxies MUST always be calculated with a price of £0
  const brewingEurValue = useMemo(() => {
    return brewingCards.reduce((acc, inst) => {
      if (inst.is_proxy) return acc;
      const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);
      return acc + (meta?.price_eur || 0);
    }, 0);
  }, [brewingCards, cardDictionary]);

  const filteredBrewingCards = useMemo(() => {
    if (!brewingSearchQuery.trim()) return brewingCards;
    const q = brewingSearchQuery.toLowerCase();
    return brewingCards.filter(inst => inst.card_name.toLowerCase().includes(q));
  }, [brewingCards, brewingSearchQuery]);

  // Cards currently in Offline Proxy Box (State P)
  const proxyBoxCards = useMemo(() => {
    return instances.filter(inst => inst.state === 'P' || (inst.is_proxy && inst.state !== 'B' && inst.state !== 'A'));
  }, [instances]);

  const filteredProxyBoxCards = useMemo(() => {
    if (!proxySearchQuery.trim()) return proxyBoxCards;
    const q = proxySearchQuery.toLowerCase();
    return proxyBoxCards.filter(inst => inst.card_name.toLowerCase().includes(q));
  }, [proxyBoxCards, proxySearchQuery]);

  // Close open card dropdown menu when clicking anywhere outside
  useEffect(() => {
    const handleClickOutside = () => setCardMenuOpenId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Trigger an undoable action with countdown progress bar
  const triggerUndoableAction = (
    type: 'checkout' | 'remove' | 'relocate' | 'return',
    inst: CardInstance,
    execute: () => void,
    message: string
  ) => {
    const snapshot: CardInstance = { ...inst };
    execute();

    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const action: UndoAction = {
      id: generateUUID(),
      type,
      instance: snapshot,
      cardName: inst.card_name,
      previousLocation: inst.location_id,
      previousState: inst.state,
      message,
      timestamp: Date.now()
    };

    setActiveUndo(action);
    setUndoProgress(100);

    const duration = 8000;
    const interval = 100;
    const decrement = (interval / duration) * 100;

    undoTimerRef.current = setInterval(() => {
      setUndoProgress((prev) => {
        if (prev <= decrement) {
          clearInterval(undoTimerRef.current);
          undoTimerRef.current = null;
          setActiveUndo(null);
          return 0;
        }
        return prev - decrement;
      });
    }, interval);
  };

  // Perform Undo reversal
  const handleUndo = () => {
    if (!activeUndo) return;
    playSound('success');
    triggerHaptic('medium');

    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const { type, instance, previousLocation } = activeUndo;

    if (type === 'checkout') {
      if (instance.is_proxy || instance.state === 'P' || previousLocation === 'Proxy Box') {
        db.returnToProxyBox(instance.instance_id);
      } else if (previousLocation) {
        db.returnToChaos(instance.instance_id, previousLocation);
      } else {
        db.restoreInstance(instance);
      }
    } else if (type === 'remove') {
      db.restoreInstance(instance);
    } else if (type === 'relocate') {
      if (previousLocation === 'Proxy Box') {
        db.moveToProxyBox(instance.instance_id);
      } else if (previousLocation) {
        db.updateLocation(instance.instance_id, previousLocation);
      } else {
        db.restoreInstance(instance);
      }
    } else if (type === 'return') {
      db.checkoutToDecks(instance.instance_id);
    }

    setActiveUndo(null);
  };

  // Navigation handlers
  const handleOpenDrawer = (unit: number, drawer: 'A' | 'B' | 'C') => {
    playSound('pull');
    triggerHaptic('medium');
    setSelectedUnit(unit);
    setSelectedDrawer(drawer);
    setSelectedBatch(null);
    setIsViewingBrewing(false);
    setIsViewingProxyBox(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleOpenBrewing = () => {
    playSound('pull');
    triggerHaptic('medium');
    setIsViewingBrewing(true);
    setIsViewingProxyBox(false);
    setSelectedUnit(null);
    setSelectedDrawer(null);
    setSelectedBatch(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleOpenProxyBox = () => {
    playSound('pull');
    triggerHaptic('medium');
    setIsViewingProxyBox(true);
    setIsViewingBrewing(false);
    setSelectedUnit(null);
    setSelectedDrawer(null);
    setSelectedBatch(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleOpenBatch = (batchIndex: number) => {
    playSound('click');
    triggerHaptic('light');
    setSelectedBatch(batchIndex);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleBackToCabinet = () => {
    playSound('skip');
    setSelectedUnit(null);
    setSelectedDrawer(null);
    setSelectedBatch(null);
    setIsViewingBrewing(false);
    setIsViewingProxyBox(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleBackToDrawer = () => {
    playSound('skip');
    setSelectedBatch(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // Toggle Proxy status on card
  const handleToggleProxy = (inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    const res = db.toggleProxy(inst.instance_id);
    setCardMenuOpenId(null);
    if (res.relocatedToProxyBox) {
      triggerUndoableAction(
        'relocate',
        inst,
        () => {},
        `Marked "${inst.card_name}" as Proxy ➔ relocated to Proxy Box`
      );
    }
  };

  // Toggle For Sale status on card
  const handleToggleForSale = (inst: CardInstance) => {
    playSound('click');
    triggerHaptic('light');
    db.toggleForSale(inst.instance_id);
    setCardMenuOpenId(null);
  };

  // Return proxy to Proxy Box from Decks/Brewing
  const handleReturnProxyToBox = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    triggerUndoableAction(
      'return',
      inst,
      () => db.returnToProxyBox(inst.instance_id),
      `Returned proxy "${inst.card_name}" to Proxy Box`
    );
  };

  // Dynamic unit management
  const handleAddUnit = () => {
    playSound('success');
    triggerHaptic('medium');
    const newCount = db.addUnit();
    setUnitCount(newCount);
  };

  const handleRemoveLastUnit = () => {
    if (db.canRemoveUnit(unitCount)) {
      if (window.confirm(`Remove empty Unit ${unitCount}?`)) {
        playSound('click');
        triggerHaptic('light');
        db.removeLastUnit();
        setUnitCount(db.getUnitCount());
      }
    }
  };

  // Card Routing Action 1: Check out to Decks / Brewing
  const handleCheckoutCard = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    const loc = inst.location_id || 'Drawer';
    triggerUndoableAction(
      'checkout',
      inst,
      () => db.checkoutToDecks(inst.instance_id),
      `Checked out "${inst.card_name}" from ${loc} to Decks/Brewing`
    );
  };

  // Card Routing Action 2: Remove entirely (Sold / Traded away)
  const handleRemoveCard = (inst: CardInstance) => {
    playSound('pull');
    triggerHaptic('medium');
    const loc = inst.location_id || (inst.state === 'B' ? 'Brewing' : 'Drawer');
    triggerUndoableAction(
      'remove',
      inst,
      () => db.deleteInstance(inst.instance_id),
      `Removed "${inst.card_name}" from ${loc} (Sold / Traded)`
    );
  };

  // Card Routing Action 3: Relocate to another Drawer Batch
  const handleOpenRelocateModal = (inst: CardInstance) => {
    playSound('click');
    const parsed = parseLocationId(inst.location_id);
    setRelocateUnit(parsed.valid ? parsed.unit : (selectedUnit || 1));
    setRelocateDrawer(parsed.valid ? parsed.drawer : (selectedDrawer || 'A'));
    setRelocateBatch(parsed.valid ? parsed.batch_index : (selectedBatch || 1));
    setRelocatingInstance(inst);
  };

  const handleConfirmRelocate = () => {
    if (!relocatingInstance) return;
    playSound('success');
    triggerHaptic('medium');
    const effBatch = typeof relocateBatch === 'number' && relocateBatch >= 1 ? relocateBatch : 1;
    const newLoc = formatLocationId(relocateUnit, relocateDrawer, effBatch);
    const oldLoc = relocatingInstance.location_id || 'unassigned';
    triggerUndoableAction(
      'relocate',
      relocatingInstance,
      () => db.updateLocation(relocatingInstance.instance_id, newLoc),
      `Relocated "${relocatingInstance.card_name}" from ${oldLoc} to ${newLoc}`
    );
    setRelocatingInstance(null);
  };

  // Brewing Return modal actions
  const handleOpenReturnModal = (inst: CardInstance) => {
    playSound('click');
    setReturningInstance(inst);
    setReturnUnit(1);
    setReturnDrawer('A');
    setReturnBatch(1);
  };

  const handleConfirmReturn = () => {
    if (!returningInstance) return;
    playSound('success');
    triggerHaptic('medium');
    const effBatch = typeof returnBatch === 'number' && returnBatch >= 1 ? returnBatch : 1;
    const locId = formatLocationId(returnUnit, returnDrawer, effBatch);
    triggerUndoableAction(
      'return',
      returningInstance,
      () => db.returnToChaos(returningInstance.instance_id, locId),
      `Returned "${returningInstance.card_name}" to Chaos drawer ${locId}`
    );
    setReturningInstance(null);
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

  const currentBatchCoordinate = selectedUnit && selectedDrawer && selectedBatch !== null 
    ? formatLocationId(selectedUnit, selectedDrawer, selectedBatch) 
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 relative">
      {/* LEVEL 1: SKEUOMORPHIC CABINET VIEW */}
      {selectedUnit === null && !isViewingBrewing && !isViewingProxyBox && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Boxes className="h-5 w-5 text-amber-400" />
                Physical Chaos Cabinet ({unitsList.length} Units × 3 Drawers)
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any physical drawer to slide it open and browse batch dividers.
              </p>
            </div>

            <button
              onClick={handleAddUnit}
              className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-600/30 to-amber-700/30 hover:from-amber-600/40 hover:to-amber-500/40 border border-amber-500/50 hover:border-amber-400 text-amber-300 font-mono text-xs font-bold flex items-center gap-1.5 shadow-md transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ Add Unit {unitCount + 1}</span>
            </button>
          </div>

          {/* Realistic Cabinet Frame with Dynamic Storage Units */}
          <div className="bg-gradient-to-b from-stone-900 via-neutral-900 to-stone-950 p-4 sm:p-6 rounded-3xl border-4 border-stone-800 shadow-2xl space-y-3">
            {unitsList.map((u) => {
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
                          type="button"
                          onClick={() => handleOpenDrawer(u, d)}
                          className="group relative bg-gradient-to-b from-neutral-800 via-neutral-850 to-neutral-900 hover:from-neutral-750 hover:to-neutral-800 border-2 border-stone-700/80 hover:border-amber-500/80 rounded-xl p-3 sm:p-4 text-center shadow-lg hover:shadow-amber-500/10 sm:hover:-translate-y-0.5 active:scale-[0.98] transition-all cursor-pointer flex flex-col items-center justify-between min-h-[82px] sm:min-h-[96px] touch-manipulation"
                        >
                          {/* Stamped Brass Drawer Label Plate */}
                          <div className="bg-gradient-to-b from-amber-600/30 to-amber-900/40 border border-amber-500/40 rounded px-2.5 py-0.5 shadow-inner pointer-events-none">
                            <span className="font-mono-coordinate font-black text-amber-300 text-xs sm:text-sm tracking-wider">
                              {u}.{d}
                            </span>
                          </div>

                          {/* Recessed Metal Drawer Handle Pull */}
                          <div className="w-12 sm:w-16 h-2 sm:h-2.5 rounded-full bg-gradient-to-b from-stone-950 to-neutral-800 border border-stone-700 shadow-inner my-1 group-hover:bg-amber-500/30 transition-colors pointer-events-none" />

                          {/* Batch & Card Count Badge */}
                          <div className="text-[10px] sm:text-[11px] font-mono text-stone-400 pointer-events-none">
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

            {/* Cabinet Expansion & Management Controls */}
            <div className="flex items-center justify-between pt-2 px-1 border-t border-stone-800/60 mt-3">
              <button
                onClick={handleAddUnit}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600/20 to-amber-800/30 hover:from-amber-600/30 hover:to-amber-700/40 border border-amber-500/40 hover:border-amber-400 text-amber-300 font-mono text-xs font-bold flex items-center gap-2 shadow transition cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add Storage Unit {unitCount + 1}</span>
              </button>

              {unitCount > 1 && db.canRemoveUnit(unitCount) && (
                <button
                  onClick={handleRemoveLastUnit}
                  className="px-3 py-1.5 rounded-xl bg-stone-900/80 hover:bg-rose-950/40 border border-stone-800 hover:border-rose-700/50 text-stone-400 hover:text-rose-300 font-mono text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                  title={`Remove empty Unit ${unitCount}`}
                >
                  <Minus className="h-3.5 w-3.5" />
                  <span>Remove Unit {unitCount}</span>
                </button>
              )}
            </div>

            {/* SKEUOMORPHIC DECKS & BREWING SHELF (BELOW ALL CHAOS UNITS) */}
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

            {/* SKEUOMORPHIC OFFLINE PROXY BOX COMPARTMENT (PARALLEL TOP-LEVEL SECTION) */}
            <div className="pt-3 border-t border-stone-800/80 mt-2">
              <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold text-purple-400 uppercase tracking-widest mb-1.5">
                <span>OFFLINE PROXY BOX STORAGE</span>
                <span>{proxyBoxCards.length} PROXIES</span>
              </div>

              <button
                type="button"
                onClick={handleOpenProxyBox}
                className="w-full group relative bg-gradient-to-b from-purple-950/30 via-neutral-850 to-neutral-900 hover:from-purple-900/40 hover:to-neutral-850 border-2 border-purple-900/70 hover:border-purple-400 rounded-2xl p-4 sm:p-5 text-left shadow-xl hover:shadow-purple-500/10 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 group-hover:scale-105 transition-transform shadow-inner">
                    <Sparkles className="h-6 w-6" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-base">
                        Proxy Box
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 font-mono text-xs font-bold">
                        {proxyBoxCards.length} Proxies
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5">
                      Dedicated offline storage for proxy card copies (£0 valuation, separate from storage units).
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right">
                    <span className="text-[10px] font-mono uppercase text-stone-400 block font-bold">MARKET VALUE</span>
                    <span className="text-sm font-bold font-mono text-purple-300">
                      £0.00 (Fixed £0)
                    </span>
                  </div>

                  <div className="px-4 py-2 rounded-xl bg-purple-600 group-hover:bg-purple-500 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow-md">
                    <span>Inspect Proxy Box</span>
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
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 shadow cursor-pointer"
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
                      type="button"
                      onClick={() => handleOpenBatch(bIndex)}
                      className="group relative bg-gradient-to-b from-amber-700/20 via-neutral-900 to-neutral-950 hover:from-amber-600/30 hover:to-neutral-900 border-2 border-stone-700 hover:border-amber-500 rounded-2xl p-4 text-left shadow-lg hover:shadow-amber-500/10 sm:hover:-translate-y-1 active:scale-[0.98] transition-all cursor-pointer flex flex-col justify-between h-36 touch-manipulation"
                    >
                      {/* Top Physical Divider Tab */}
                      <div className="flex items-center justify-between w-full pointer-events-none">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono-coordinate font-black text-xs">
                          {coordStr}
                        </span>
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      </div>

                      {/* Stack Texture Line */}
                      <div className="space-y-1 my-2 opacity-60 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="h-0.5 bg-stone-700 w-full rounded" />
                        <div className="h-0.5 bg-stone-700 w-4/5 rounded" />
                        <div className="h-0.5 bg-stone-700 w-2/3 rounded" />
                      </div>

                      {/* Count & Details */}
                      <div className="pointer-events-none">
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

      {/* LEVEL 3: INSIDE BATCH (Card Images Gallery & Actions) */}
      {selectedUnit !== null && selectedDrawer !== null && selectedBatch !== null && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBackToDrawer}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 flex items-center gap-1.5 shadow cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>Back to Drawer {selectedUnit}.{selectedDrawer}</span>
            </button>

            <div className="text-right">
              <span className="text-xs font-mono uppercase text-slate-400 font-bold block">
                INSPECTING BATCH:
              </span>
              <span className="text-lg font-black text-amber-400 font-mono-coordinate">
                {currentBatchCoordinate} ({activeCardsInBatch.length} Cards)
              </span>
            </div>
          </div>

          {/* Cards Gallery */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4">
            {/* Inline batch-level undo banner if an action was just performed in this batch */}
            {activeUndo && activeUndo.previousLocation === currentBatchCoordinate && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border-2 border-amber-500/40 flex items-center justify-between gap-3 text-xs animate-in fade-in">
                <div className="flex items-center gap-2 text-amber-300 min-w-0">
                  <RotateCcw className="h-4 w-4 shrink-0 text-amber-400" />
                  <span className="truncate">{activeUndo.message}</span>
                </div>
                <button
                  onClick={handleUndo}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs flex items-center gap-1 shadow cursor-pointer shrink-0"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>UNDO ↺</span>
                </button>
              </div>
            )}

            {activeCardsInBatch.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs italic">
                This batch currently contains no cards.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {activeCardsInBatch.map((inst) => {
                  const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);

                  return (
                    <div
                      key={inst.instance_id}
                      className={`bg-slate-950 border rounded-2xl overflow-hidden shadow-lg transition flex flex-col justify-between ${
                        inst.is_for_sale ? 'border-for-sale' : 'border-slate-800 hover:border-amber-500/60'
                      }`}
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

                        {/* Top-Left `+` Menu Button */}
                        <div className="absolute top-1.5 left-1.5 z-20">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCardMenuOpenId(cardMenuOpenId === inst.instance_id ? null : inst.instance_id);
                            }}
                            className={`h-6 w-6 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${
                              cardMenuOpenId === inst.instance_id
                                ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                                : 'bg-slate-950/85 hover:bg-slate-900 text-white border border-slate-700/80 hover:border-amber-400'
                            }`}
                            title="Card options"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>

                          {cardMenuOpenId === inst.instance_id && (
                            <div 
                              onClick={(e) => e.stopPropagation()} 
                              className="absolute left-0 top-7 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 text-xs animate-in fade-in"
                            >
                              <button
                                type="button"
                                onClick={() => handleToggleProxy(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                  <span>Mark as Proxy</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleForSale(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                                  <span>{inst.is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                                </span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Status Badges */}
                        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 pointer-events-none">
                          {inst.is_for_sale && (
                            <span className="bg-rose-600/95 text-white font-mono font-black text-[9px] px-1.5 py-0.5 rounded shadow tracking-wider uppercase border border-rose-400/50">
                              FOR SALE
                            </span>
                          )}
                        </div>

                        <div className="absolute bottom-1 right-1 bg-slate-950/90 text-emerald-400 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-emerald-900/50">
                          €{meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00'}
                        </div>
                      </div>

                      {/* Card Info & Routing Actions */}
                      <div className="p-2.5 space-y-2">
                        <div className="text-xs font-bold text-white truncate" title={inst.card_name}>
                          {inst.card_name}
                        </div>

                        {/* Routing Actions */}
                        <div className="space-y-1.5">
                          {/* 1. Move to Decks / Brewing (Check Out) */}
                          <button
                            onClick={() => handleCheckoutCard(inst)}
                            className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-mono font-bold text-[11px] flex items-center justify-center gap-1.5 shadow cursor-pointer transition"
                            title="Check out to Active Decks & Brewing pool"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            <span>To Decks / Brewing</span>
                          </button>

                          <div className="grid grid-cols-2 gap-1.5">
                            {/* 2. Relocate to another Drawer Batch */}
                            <button
                              onClick={() => handleOpenRelocateModal(inst)}
                              className="py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 font-mono text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                              title="Relocate to another drawer batch"
                            >
                              <MapPin className="h-3 w-3 text-amber-400" />
                              <span>Relocate</span>
                            </button>

                            {/* 3. Remove entirely (Sold / Traded) */}
                            <button
                              onClick={() => handleRemoveCard(inst)}
                              className="py-1 px-2 rounded-lg bg-slate-800 hover:bg-rose-950/70 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800 font-mono text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                              title="Remove entirely from collection (Sold / Traded)"
                            >
                              <Trash2 className="h-3 w-3 text-rose-400" />
                              <span>Remove</span>
                            </button>
                          </div>
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
                      className={`bg-slate-950 border rounded-2xl overflow-hidden shadow-lg transition flex flex-col justify-between ${
                        inst.is_for_sale 
                          ? 'border-for-sale' 
                          : (inst.is_proxy ? 'border-proxy-theme' : 'border-slate-800 hover:border-blue-500/60')
                      }`}
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

                        {/* Top-Left `+` Menu Button */}
                        <div className="absolute top-1.5 left-1.5 z-20">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCardMenuOpenId(cardMenuOpenId === inst.instance_id ? null : inst.instance_id);
                            }}
                            className={`h-6 w-6 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${
                              cardMenuOpenId === inst.instance_id
                                ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                                : 'bg-slate-950/85 hover:bg-slate-900 text-white border border-slate-700/80 hover:border-amber-400'
                            }`}
                            title="Card options"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>

                          {cardMenuOpenId === inst.instance_id && (
                            <div 
                              onClick={(e) => e.stopPropagation()} 
                              className="absolute left-0 top-7 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 text-xs animate-in fade-in"
                            >
                              <button
                                type="button"
                                onClick={() => handleToggleProxy(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                  <span>{inst.is_proxy ? 'Mark as Real Card' : 'Mark as Proxy'}</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleForSale(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                                  <span>{inst.is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                                </span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Status Badges */}
                        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 pointer-events-none">
                          {inst.is_for_sale && (
                            <span className="bg-rose-600/95 text-white font-mono font-black text-[9px] px-1.5 py-0.5 rounded shadow tracking-wider uppercase border border-rose-400/50">
                              FOR SALE
                            </span>
                          )}
                          {inst.is_proxy && (
                            <span className="bg-purple-900/90 text-purple-200 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow border border-purple-500/40">
                              PROXY
                            </span>
                          )}
                        </div>

                        {/* Price Badge */}
                        <div className="absolute bottom-1 right-1 bg-slate-950/90 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-slate-800">
                          {inst.is_proxy ? (
                            <span className="text-purple-300">£0.00 (Proxy)</span>
                          ) : (
                            <span className="text-emerald-400">€{meta?.price_eur ? meta.price_eur.toFixed(2) : '0.00'}</span>
                          )}
                        </div>
                      </div>

                      {/* Card Info & Actions */}
                      <div className="p-2.5 space-y-2">
                        <div className="text-xs font-bold text-white truncate" title={inst.card_name}>
                          {inst.card_name}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* If proxy: Return to Proxy Box. If real: Return to Chaos Drawers */}
                          {inst.is_proxy ? (
                            <button
                              onClick={() => handleReturnProxyToBox(inst)}
                              className="flex-1 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer transition"
                              title="Return proxy card to Proxy Box"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>To Proxy Box</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenReturnModal(inst)}
                              className="flex-1 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer transition"
                              title="Return card to physical Chaos drawer"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Return</span>
                            </button>
                          )}

                          {/* Trade / Sell */}
                          <button
                            onClick={() => handleRemoveCard(inst)}
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

      {/* LEVEL 5: INSIDE OFFLINE PROXY BOX */}
      {isViewingProxyBox && selectedUnit === null && (
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
              <span className="text-xs font-mono uppercase text-purple-400 font-bold block flex items-center sm:justify-end gap-1.5">
                <Sparkles className="h-4 w-4" />
                <span>INSPECTING OFFLINE PROXY BOX</span>
              </span>
              <span className="text-lg font-black text-white font-mono">
                {proxyBoxCards.length} Proxies <span className="text-slate-400 font-normal text-sm sm:text-base">(£0.00 Fixed Valuation)</span>
              </span>
            </div>
          </div>

          {/* Search/filter within proxy cards */}
          {proxyBoxCards.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={proxySearchQuery}
                onChange={(e) => setProxySearchQuery(e.target.value)}
                placeholder="Filter proxies in Proxy Box..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          )}

          {/* Cards Gallery */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl">
            {filteredProxyBoxCards.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs italic">
                {proxyBoxCards.length === 0 
                  ? 'No cards currently in the Proxy Box. Ingest proxies via Batch Ingest or mark cards as proxies to store them here!' 
                  : `No cards matching "${proxySearchQuery}" in Proxy Box.`}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredProxyBoxCards.map((inst) => {
                  const meta = cardDictionary.get(inst.card_name.toLowerCase()) || cardDictionary.get(inst.oracle_id) || db.getCard(inst.card_name);

                  return (
                    <div
                      key={inst.instance_id}
                      className={`bg-slate-950 border rounded-2xl overflow-hidden shadow-lg transition flex flex-col justify-between ${
                        inst.is_for_sale ? 'border-for-sale' : 'border-slate-800 hover:border-purple-500/60'
                      }`}
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

                        {/* Top-Left `+` Menu Button */}
                        <div className="absolute top-1.5 left-1.5 z-20">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCardMenuOpenId(cardMenuOpenId === inst.instance_id ? null : inst.instance_id);
                            }}
                            className={`h-6 w-6 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${
                              cardMenuOpenId === inst.instance_id
                                ? 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-300'
                                : 'bg-slate-950/85 hover:bg-slate-900 text-white border border-slate-700/80 hover:border-amber-400'
                            }`}
                            title="Card options"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>

                          {cardMenuOpenId === inst.instance_id && (
                            <div 
                              onClick={(e) => e.stopPropagation()} 
                              className="absolute left-0 top-7 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 text-xs animate-in fade-in"
                            >
                              <button
                                type="button"
                                onClick={() => handleToggleProxy(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                  <span>Mark as Real Card</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleForSale(inst)}
                                className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                                  <span>{inst.is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                                </span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Status Badges */}
                        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 pointer-events-none">
                          {inst.is_for_sale && (
                            <span className="bg-rose-600/95 text-white font-mono font-black text-[9px] px-1.5 py-0.5 rounded shadow tracking-wider uppercase border border-rose-400/50">
                              FOR SALE
                            </span>
                          )}
                          <span className="bg-purple-900/90 text-purple-200 font-mono font-bold text-[9px] px-1.5 py-0.5 rounded shadow border border-purple-500/40">
                            PROXY
                          </span>
                        </div>

                        {/* Fixed £0 Valuation Badge */}
                        <div className="absolute bottom-1 right-1 bg-slate-950/90 text-purple-300 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border border-purple-900/50">
                          £0.00
                        </div>
                      </div>

                      {/* Card Info & Actions */}
                      <div className="p-2.5 space-y-2">
                        <div className="text-xs font-bold text-white truncate" title={inst.card_name}>
                          {inst.card_name}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {/* Checkout to Brewing */}
                          <button
                            onClick={() => handleCheckoutCard(inst)}
                            className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-[11px] flex items-center justify-center gap-1 shadow cursor-pointer transition"
                            title="Check out proxy to Decks / Brewing"
                          >
                            <Layers className="h-3 w-3" />
                            <span>To Brewing</span>
                          </button>

                          {/* Remove */}
                          <button
                            onClick={() => handleRemoveCard(inst)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                            title="Remove proxy from collection"
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
                  {unitsList.map((u) => <option key={u} value={u}>Unit {u}</option>)}
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

            <div className="flex justify-end gap-2 text-xs font-mono">
              <button
                onClick={() => setReturningInstance(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReturn}
                className="px-4 py-1.5 rounded-lg bg-theme-primary font-bold shadow cursor-pointer"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Relocate Card to another Drawer Batch */}
      {relocatingInstance && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-400" />
              <span>Relocate {relocatingInstance.card_name}</span>
            </h3>
            <p className="text-xs text-stone-400">
              Select a target physical batch to move this copy into:
            </p>

            <div className="grid grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">UNIT</label>
                <select
                  value={relocateUnit}
                  onChange={(e) => setRelocateUnit(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                >
                  {unitsList.map((u) => <option key={u} value={u}>Unit {u}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">DRAWER</label>
                <select
                  value={relocateDrawer}
                  onChange={(e) => setRelocateDrawer(e.target.value as any)}
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
                  value={relocateBatch}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setRelocateBatch('');
                    } else {
                      const p = parseInt(val, 10);
                      if (!isNaN(p)) setRelocateBatch(p);
                    }
                  }}
                  onBlur={() => {
                    if (relocateBatch === '' || relocateBatch < 1) {
                      setRelocateBatch(1);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 text-xs font-mono">
              <button
                onClick={() => setRelocatingInstance(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRelocate}
                className="px-4 py-1.5 rounded-lg bg-theme-primary font-bold shadow cursor-pointer"
              >
                Relocate Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FLOATING UNDO TOAST NOTIFICATION */}
      {activeUndo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 pointer-events-auto animate-in slide-in-from-bottom duration-200">
          <div className="bg-gradient-to-r from-stone-900 via-neutral-900 to-stone-900 border-2 border-amber-500/80 rounded-2xl shadow-2xl p-3.5 flex flex-col gap-2.5 text-xs text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0">
                  <RotateCcw className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-stone-200 truncate font-mono text-[11px]">
                    {activeUndo.message}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleUndo}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-stone-950 font-black font-mono text-xs flex items-center gap-1.5 shadow-lg cursor-pointer transition transform active:scale-95"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>UNDO ↺</span>
                </button>
                <button
                  onClick={() => setActiveUndo(null)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Countdown progress bar */}
            <div className="w-full bg-stone-800 rounded-full h-1 overflow-hidden">
              <div 
                className="bg-amber-400 h-full transition-all duration-100 ease-linear"
                style={{ width: `${undoProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

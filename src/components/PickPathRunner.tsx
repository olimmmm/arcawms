import React, { useState, useMemo, useEffect } from 'react';
import { 
  Compass, 
  MapPin, 
  CheckCircle2, 
  Play, 
  RotateCcw, 
  Trash2,
  Layers,
  ShoppingBag,
  Undo2,
  Copy,
  Sparkles,
  X
} from 'lucide-react';
import { CardInstance, PickItem, ScryfallCard } from '../types';
import { db } from '../services/db';
import { generatePickRoute, parseDecklistText, formatAsMtgText } from '../services/pickPath';
import { playSound, triggerHaptic } from '../services/audio';
import { getScryfallImageFallback } from '../services/scryfall';

const SAMPLE_WANTS = `1 Sol Ring
1 Rhystic Study
1 Cyclonic Rift
4 Lightning Bolt
2 Counterspell
1 Brainstorm
1 Force of Will
1 Steam Vents
1 Command Tower
1 Swords to Plowshares
1 The One Ring
1 Demonic Tutor`;

interface PickPathRunnerProps {
  pendingDecklist?: string;
  onClearPendingDecklist?: () => void;
}

export const PickPathRunner: React.FC<PickPathRunnerProps> = ({ pendingDecklist, onClearPendingDecklist }) => {
  const [phase, setPhase] = useState<'setup' | 'running'>('setup');
  const [decklistText, setDecklistText] = useState('');
  const [route, setRoute] = useState<PickItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (pendingDecklist) {
      setDecklistText(pendingDecklist);
      setPhase('setup');
      if (onClearPendingDecklist) onClearPendingDecklist();
    }
  }, [pendingDecklist, onClearPendingDecklist]);

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

  const handleStartRun = () => {
    playSound('click');
    const parsed = parseDecklistText(decklistText);
    if (parsed.length === 0) {
      alert('Please enter at least one card name.');
      return;
    }

    const generated = generatePickRoute(parsed, instances, cardDictionary);
    // Attach original instance snapshot for instant undo
    const withSnapshots = generated.map(item => {
      const original = item.instance_id ? db.getInstance(item.instance_id) : undefined;
      return {
        ...item,
        original_instance: original
      };
    });

    setRoute(withSnapshots);
    setPhase('running');
  };

  // 1. Pull to Brewing & Decks
  const handlePullToBrew = (item: PickItem) => {
    if (!item.instance_id) return;
    playSound('pull');
    triggerHaptic('medium');

    db.checkoutToDecks(item.instance_id);

    setRoute(prev => prev.map(r => r.id === item.id ? { ...r, status: 'pulled_brew' } : r));
  };

  // 2. Remove for Sales & Trades
  const handleRemoveForTrade = (item: PickItem) => {
    if (!item.instance_id) return;
    playSound('pull');
    triggerHaptic('heavy');

    const original = item.original_instance || db.getInstance(item.instance_id);
    const cloned = original ? { ...original } : undefined;
    db.deleteInstance(item.instance_id);

    setRoute(prev => prev.map(r => r.id === item.id ? { 
      ...r, 
      status: 'pulled_trade',
      original_instance: cloned
    } : r));
  };

  // Undo action while on this page
  const handleUndo = (item: PickItem) => {
    playSound('click');
    triggerHaptic('light');

    if (item.status === 'pulled_brew' && item.instance_id && item.location_id) {
      // Put back in drawer
      db.returnToChaos(item.instance_id, item.location_id);
    } else if (item.status === 'pulled_trade' && item.original_instance) {
      // Restore back into database
      db.restoreInstance(item.original_instance);
    }

    setRoute(prev => prev.map(r => r.id === item.id ? { ...r, status: 'pending' } : r));
  };

  const handleSkip = (item: PickItem) => {
    playSound('skip');
    triggerHaptic('light');
    setRoute(prev => prev.map(r => r.id === item.id ? { ...r, status: 'skipped' } : r));
  };

  // 4 Waterfall Category Splits
  const inChaosItems = useMemo(() => route.filter(i => i.category === 'units' || (i.inChaos && !i.category)), [route]);
  const alreadyInDecks = useMemo(() => route.filter(i => i.category === 'decks' || (!i.inChaos && !i.is_proxy && i.status !== 'missing' && !i.category)), [route]);
  const proxyItems = useMemo(() => route.filter(i => i.category === 'proxies' || (Boolean(i.is_proxy) && i.status !== 'missing')), [route]);
  const missingItems = useMemo(() => route.filter(i => i.category === 'missing' || i.status === 'missing'), [route]);

  const handleCopyCategory = (cat: 'units' | 'decks' | 'proxies' | 'missing', label: string) => {
    playSound('click');
    triggerHaptic('light');
    let itemsToCopy: PickItem[] = [];
    if (cat === 'units') itemsToCopy = inChaosItems;
    else if (cat === 'decks') itemsToCopy = alreadyInDecks;
    else if (cat === 'proxies') itemsToCopy = proxyItems;
    else if (cat === 'missing') itemsToCopy = missingItems;

    if (itemsToCopy.length === 0) {
      setToastMessage(`No cards in ${label} to copy.`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    const text = formatAsMtgText(itemsToCopy);
    navigator.clipboard.writeText(text);
    setToastMessage(`Copied ${itemsToCopy.length} cards in ${label} to clipboard!`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const processedCount = inChaosItems.filter(i => i.status === 'pulled_brew' || i.status === 'pulled_trade').length;
  const totalToPull = inChaosItems.length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/95 border border-slate-700 text-slate-100 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-mono backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <Sparkles className="h-4 w-4 text-theme-accent shrink-0" />
          <span>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-500 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* SETUP PHASE */}
      {phase === 'setup' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Compass className="h-5 w-5 text-theme-accent" />
              <span>Pick-Path Runner (Non-Backtracking Mass Pull)</span>
            </h1>
            <button
              onClick={() => { setDecklistText(SAMPLE_WANTS); playSound('click'); }}
              className="text-xs text-theme-accent hover:text-theme-accent-hover font-mono underline cursor-pointer"
            >
              Load Sample List
            </button>
          </div>

          <p className="text-xs text-slate-400">
            Paste a decklist. Generates a linear route across drawers (Unit 1→9 ➔ Drawer A→C ➔ Batch 1→12+).
          </p>

          <textarea
            value={decklistText}
            onChange={(e) => setDecklistText(e.target.value)}
            rows={10}
            placeholder="4 Lightning Bolt&#10;1 Sol Ring&#10;1 Brainstorm..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary font-sans"
          />

          <button
            onClick={handleStartRun}
            className="w-full py-3.5 rounded-xl bg-theme-primary hover:brightness-110 active:brightness-95 text-slate-950 font-black text-sm tracking-wide shadow-lg shadow-theme-primary/20 flex items-center justify-center gap-2 cursor-pointer transition"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>GENERATE OPTIMIZED PICK PATH</span>
          </button>
        </div>
      )}

      {/* RUNNING PHASE */}
      {phase === 'running' && (
        <div className="space-y-5">
          {/* Progress Header */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono uppercase font-bold text-theme-accent">
                PULLED {processedCount} OF {totalToPull} IN UNITS
              </span>
              <div className="w-32 sm:w-48 bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${totalToPull > 0 ? (processedCount / totalToPull) * 100 : 0}%` }}
                />
              </div>
            </div>

            <button
              onClick={() => { setPhase('setup'); playSound('click'); }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset List</span>
            </button>
          </div>

          {/* Clipboard Export Toolbar (4 Distinct MTG Text Exports) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Copy className="h-3.5 w-3.5 text-theme-accent" />
                <span>Copy to Clipboard (Standard MTG Text)</span>
              </span>
              <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">Single-click export</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* 1. Cards located in Units */}
              <button
                type="button"
                onClick={() => handleCopyCategory('units', 'Units (Drawers)')}
                disabled={inChaosItems.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-theme-accent-subtle hover:bg-theme-accent/25 text-theme-accent text-xs font-bold border border-theme-accent-subtle transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                title="Copy cards located in Units (Chaos Drawers)"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Units ({inChaosItems.length})</span>
              </button>

              {/* 2. Cards located in Decks/Brewing and NOT in Units */}
              <button
                type="button"
                onClick={() => handleCopyCategory('decks', 'Decks / Brewing')}
                disabled={alreadyInDecks.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs font-bold border border-blue-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                title="Copy cards located in Decks/Brewing and NOT in Units"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">In Decks ({alreadyInDecks.length})</span>
              </button>

              {/* 3. Cards located in Proxies and NOT in Units nor Decks/Brewing */}
              <button
                type="button"
                onClick={() => handleCopyCategory('proxies', 'Proxies')}
                disabled={proxyItems.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs font-bold border border-purple-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                title="Copy cards located in Proxies and NOT in Units nor Decks/Brewing"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Proxies ({proxyItems.length})</span>
              </button>

              {/* 4. Cards NOT in collection at all */}
              <button
                type="button"
                onClick={() => handleCopyCategory('missing', 'Unowned')}
                disabled={missingItems.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold border border-rose-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                title="Copy cards NOT in collection at all"
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Unowned ({missingItems.length})</span>
              </button>
            </div>
          </div>

          {/* Linear Route Checklist (Units) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl divide-y divide-slate-800">
            {inChaosItems.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                None of the requested cards are currently in your Chaos Drawers.
              </div>
            ) : (
              inChaosItems.map((item, idx) => {
                const isPulledBrew = item.status === 'pulled_brew';
                const isPulledTrade = item.status === 'pulled_trade';
                const isSkipped = item.status === 'skipped';

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                      isPulledBrew 
                        ? 'bg-blue-950/20 border-l-4 border-l-blue-500' 
                        : isPulledTrade
                        ? 'bg-rose-950/20 border-l-4 border-l-rose-500'
                        : isSkipped 
                        ? 'bg-slate-850/60' 
                        : 'hover:bg-slate-850'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-500 w-5">#{idx + 1}</span>

                      {/* Visual Coordinate Badge */}
                      <div className="px-3 py-1.5 rounded-lg bg-theme-accent-subtle text-theme-accent font-mono-coordinate font-black text-sm border border-theme-accent-subtle flex items-center gap-1 shrink-0">
                        <MapPin className="h-4 w-4" />
                        <span>{item.location_id}</span>
                      </div>

                      {/* Card Thumbnail */}
                      <div className={`w-10 h-14 rounded overflow-hidden shrink-0 transition ${
                        item.original_instance?.is_for_sale 
                          ? 'border-for-sale' 
                          : 'border border-slate-800 bg-slate-950'
                      }`}>
                        <img
                          src={item.card_metadata?.image_url_normal || getScryfallImageFallback(item.card_name)}
                          alt={item.card_name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = getScryfallImageFallback(item.card_name);
                          }}
                        />
                      </div>

                      <div>
                        <div className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{item.card_name}</span>
                          {item.original_instance?.is_for_sale && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-600/90 text-white font-bold tracking-wider">
                              FOR SALE
                            </span>
                          )}
                          {item.card_metadata?.price_eur ? (
                            <span className="text-[11px] font-mono text-emerald-400">€{item.card_metadata.price_eur.toFixed(2)}</span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Unit {item.unit} ➔ Drawer {item.drawer} ➔ Batch {item.batch_index}
                        </div>
                      </div>
                    </div>

                    {/* Dual Pull & Undo Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isPulledBrew ? (
                        /* Highlighted as pulled to brew -> click again to UNDO */
                        <button
                          onClick={() => handleUndo(item)}
                          className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer"
                          title="Click to undo and return to drawer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>IN BREW (UNDO ↺)</span>
                        </button>
                      ) : isPulledTrade ? (
                        /* Highlighted as removed for trade -> click again to UNDO */
                        <button
                          onClick={() => handleUndo(item)}
                          className="px-3.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-mono font-bold text-xs flex items-center gap-1.5 shadow cursor-pointer"
                          title="Click to undo and restore to collection"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span>REMOVED (UNDO ↺)</span>
                        </button>
                      ) : isSkipped ? (
                        <button
                          onClick={() => handleUndo(item)}
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <span>SKIPPED (UNDO ↺)</span>
                        </button>
                      ) : (
                        /* Pending: Option 1 (Brew) or Option 2 (Trade/Remove) */
                        <>
                          <button
                            onClick={() => handlePullToBrew(item)}
                            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold font-mono text-xs shadow flex items-center gap-1.5 cursor-pointer"
                            title="Pull to Brewing and Decks Pool"
                          >
                            <Layers className="h-3.5 w-3.5" />
                            <span>TO BREW</span>
                          </button>

                          <button
                            onClick={() => handleRemoveForTrade(item)}
                            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 font-mono text-xs flex items-center gap-1 cursor-pointer"
                            title="Remove from collection for sales/trades"
                          >
                            <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                            <span>TRADE / SELL</span>
                          </button>

                          <button
                            onClick={() => handleSkip(item)}
                            className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-mono cursor-pointer"
                            title="Skip (leave in drawer)"
                          >
                            <span>SKIP</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Cards Already in Decks */}
          {alreadyInDecks.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold text-blue-400 uppercase">
                  ALREADY IN DECKS / BREWING ({alreadyInDecks.length})
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopyCategory('decks', 'Decks / Brewing')}
                  className="px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs font-semibold border border-blue-500/30 flex items-center gap-1 cursor-pointer"
                  title="Copy cards in Decks to clipboard"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copy List</span>
                </button>
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {alreadyInDecks.map(item => (
                  <div key={item.id} className="py-2 flex items-center justify-between text-slate-400">
                    <span className="font-medium text-slate-200">{item.card_name}</span>
                    <span className="font-mono text-blue-300 text-[11px]">Out in Decks</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cards in Proxies */}
          {proxyItems.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold text-purple-400 uppercase flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>PROXIES FOUND ({proxyItems.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopyCategory('proxies', 'Proxies')}
                  className="px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs font-semibold border border-purple-500/30 flex items-center gap-1 cursor-pointer"
                  title="Copy proxies to clipboard"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copy List</span>
                </button>
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {proxyItems.map(item => (
                  <div key={item.id} className="py-2 flex items-center justify-between text-slate-400">
                    <span className="font-medium text-purple-200">{item.card_name}</span>
                    <span className="font-mono text-purple-400 text-[11px]">
                      {item.location_id || 'Proxy Box'} • £0.00
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing Cards */}
          {missingItems.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold text-rose-400 uppercase">
                  NOT IN COLLECTION ({missingItems.length})
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopyCategory('missing', 'Unowned')}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold border border-rose-500/30 flex items-center gap-1 cursor-pointer"
                  title="Copy unowned cards to clipboard"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copy List</span>
                </button>
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {missingItems.map(item => (
                  <div key={item.id} className="py-2 flex items-center justify-between text-slate-400">
                    <span className="font-medium text-slate-300">{item.card_name}</span>
                    <span className="font-mono text-rose-400 text-[11px]">Unowned</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

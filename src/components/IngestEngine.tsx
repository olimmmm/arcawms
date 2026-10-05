import React, { useState, useMemo, useEffect } from 'react';
import { 
  PlusCircle, 
  MapPin, 
  Check, 
  FileText, 
  History, 
  ArrowRight,
  ArrowLeftRight,
  Layers,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { ActivityLogItem, CardInstance, ScryfallCard } from '../types';
import { db, generateUUID } from '../services/db';
import { formatLocationId, parseDecklistText } from '../services/pickPath';
import { fetchScryfallCardByName, fetchScryfallCardsBatch, getScryfallImageFallback } from '../services/scryfall';
import { playSound, triggerHaptic } from '../services/audio';

const SAMPLE_SCAN = `4 Counterspell
2 Brainstorm
1 Force of Will
1 Cyclonic Rift
1 Sol Ring
3 Steam Vents`;

type IngestMode = 'new_to_chaos' | 'new_to_brewing' | 'brewing_to_chaos';

export const IngestEngine: React.FC = () => {
  // 3-way Ingest Mode
  const [mode, setMode] = useState<IngestMode>('new_to_chaos');

  const [unit, setUnit] = useState(4);
  const [drawer, setDrawer] = useState<'A' | 'B' | 'C'>('C');
  const [batchIndex, setBatchIndex] = useState(2); // e.g. 4.C.02

  const [rawText, setRawText] = useState(SAMPLE_SCAN);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // History filter: 'all' | 'added' | 'moved' | 'removed'
  const [historyFilter, setHistoryFilter] = useState<'all' | 'added' | 'moved' | 'removed'>('all');

  // Reactive DB subscriptions
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [history, setHistory] = useState<ActivityLogItem[]>(() => db.getHistory());

  useEffect(() => {
    return db.subscribe(() => {
      setInstances(db.getAllInstances());
      setHistory(db.getHistory());
    });
  }, []);

  const currentCoordinate = formatLocationId(unit, drawer, batchIndex);

  // Cards currently in target batch
  const existingInBatch = useMemo(() => {
    return instances.filter(i => i.location_id === currentCoordinate && i.state === 'A');
  }, [instances, currentCoordinate]);

  // Reverse list order
  const handleReverseList = () => {
    playSound('click');
    const lines = rawText.trim().split(/\r?\n/);
    if (lines.length > 0) {
      setRawText(lines.reverse().join('\n'));
    }
  };

  // Ingestion handler supporting all 3 modes
  const handleIngest = async () => {
    const parsed = parseDecklistText(rawText);
    if (parsed.length === 0) {
      alert('Please enter at least one card name.');
      return;
    }

    playSound('click');
    setIsProcessing(true);

    let totalProcessed = 0;
    let returnedFromBrewing = 0;
    let newlyCreated = 0;

    // Get current instances in brewing for 'brewing_to_chaos' matching
    const currentInstances = db.getAllInstances();
    const brewingPool = new Map<string, CardInstance[]>();
    for (const inst of currentInstances) {
      if (inst.state === 'B') {
        const key = inst.card_name.toLowerCase();
        if (!brewingPool.has(key)) brewingPool.set(key, []);
        brewingPool.get(key)!.push(inst);
      }
    }

    // Pre-fetch missing cards in fast, rate-limit-free batches (75 cards per API call)
    const cardNamesToFetch = parsed
      .map(p => p.name)
      .filter(name => {
        const c = db.getCard(name);
        return !c || !c.image_url_normal || !c.image_url_normal.startsWith('https://cards.scryfall.io') || !c.price_eur;
      });

    if (cardNamesToFetch.length > 0) {
      const fetchedBatch = await fetchScryfallCardsBatch(cardNamesToFetch);
      for (const card of fetchedBatch.values()) {
        db.upsertCard(card);
      }
    }

    for (const item of parsed) {
      let meta = db.getCard(item.name);
      if (!meta) {
        meta = (await fetchScryfallCardByName(item.name)) || {
          oracle_id: generateUUID(),
          name: item.name,
          cmc: 0,
          type_line: 'Magic Card',
          colors: [],
          color_identity: [],
          rarity: 'common',
          image_url_normal: getScryfallImageFallback(item.name),
          price_eur: 0
        };
        db.upsertCard(meta);
      }

      if (mode === 'new_to_chaos') {
        // Mode 1: New -> Chaos Drawers
        for (let i = 0; i < item.count; i++) {
          db.createInstance({
            oracle_id: meta.oracle_id,
            card_name: meta.name,
            state: 'A',
            location_id: currentCoordinate
          });
          newlyCreated++;
        }
      } else if (mode === 'new_to_brewing') {
        // Mode 2: New -> Active Brewing / Decks Pool
        for (let i = 0; i < item.count; i++) {
          db.createInstance({
            oracle_id: meta.oracle_id,
            card_name: meta.name,
            state: 'B',
            location_id: null
          });
          newlyCreated++;
        }
      } else if (mode === 'brewing_to_chaos') {
        // Mode 3: Brewing -> Chaos Drawers (Return desleeved cards back into physical batch)
        const key = item.name.toLowerCase();
        const availableInBrew = brewingPool.get(key) || [];

        let needed = item.count;
        while (needed > 0 && availableInBrew.length > 0) {
          const instToReturn = availableInBrew.shift()!;
          db.returnToChaos(instToReturn.instance_id, currentCoordinate);
          returnedFromBrewing++;
          needed--;
        }

        // If user imported more copies than were digitally in brewing, index remaining into batch
        while (needed > 0) {
          db.createInstance({
            oracle_id: meta.oracle_id,
            card_name: meta.name,
            state: 'A',
            location_id: currentCoordinate
          });
          newlyCreated++;
          needed--;
        }
      }

      totalProcessed += item.count;
    }

    db.healAndDeduplicateCards();
    setIsProcessing(false);
    playSound('success');
    triggerHaptic('heavy');

    if (mode === 'new_to_chaos') {
      setSuccessMessage(`Ingested ${newlyCreated} new cards into Batch ${currentCoordinate}!`);
      setBatchIndex(prev => prev + 1); // Advance batch coordinate
    } else if (mode === 'new_to_brewing') {
      setSuccessMessage(`Added ${newlyCreated} new cards directly to Brewing & Decks pool!`);
    } else {
      setSuccessMessage(
        `Returned ${returnedFromBrewing} cards from Brewing into Batch ${currentCoordinate}${
          newlyCreated > 0 ? ` (and indexed ${newlyCreated} additional copies)` : ''
        }!`
      );
      setBatchIndex(prev => prev + 1); // Advance batch coordinate
    }

    setTimeout(() => setSuccessMessage(null), 5000);
    setRawText('');
  };

  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return history;
    return history.filter(h => h.type === historyFilter);
  }, [history, historyFilter]);

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 3-Way Mode Switcher: New -> Chaos | New -> Brewing | Brewing -> Chaos */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-xl space-y-2">
        <label className="text-[11px] font-mono font-bold uppercase text-slate-400 block px-1">
          IMPORT DESTINATION & WORKFLOW:
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Option 1: New -> Chaos */}
          <button
            onClick={() => { setMode('new_to_chaos'); playSound('click'); }}
            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
              mode === 'new_to_chaos'
                ? 'bg-theme-subtle border-theme-primary text-white shadow'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase font-mono tracking-wider flex items-center gap-1.5">
                <PlusCircle className="h-4 w-4 text-theme-primary" />
                <span>New ➔ Chaos</span>
              </span>
              {mode === 'new_to_chaos' && <Check className="h-4 w-4 text-theme-primary" />}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Add new cards directly into physical chaos drawer batch.
            </p>
          </button>

          {/* Option 2: New -> Brewing */}
          <button
            onClick={() => { setMode('new_to_brewing'); playSound('click'); }}
            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
              mode === 'new_to_brewing'
                ? 'bg-blue-950/40 border-blue-500 text-white shadow'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase font-mono tracking-wider flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-blue-400" />
                <span>New ➔ Brewing</span>
              </span>
              {mode === 'new_to_brewing' && <Check className="h-4 w-4 text-blue-400" />}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Add new cards directly into active brewing trays & decks.
            </p>
          </button>

          {/* Option 3: Brewing -> Chaos */}
          <button
            onClick={() => { setMode('brewing_to_chaos'); playSound('click'); }}
            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
              mode === 'brewing_to_chaos'
                ? 'bg-emerald-950/40 border-emerald-500 text-white shadow'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs uppercase font-mono tracking-wider flex items-center gap-1.5">
                <RotateCcw className="h-4 w-4 text-emerald-400" />
                <span>Brewing ➔ Chaos</span>
              </span>
              {mode === 'brewing_to_chaos' && <Check className="h-4 w-4 text-emerald-400" />}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Return desleeved cards from decks back into drawer batches.
            </p>
          </button>
        </div>
      </div>

      {/* Target Drawer Coordinate Selector (Shown for New -> Chaos & Brewing -> Chaos) */}
      {mode !== 'new_to_brewing' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[11px] font-mono uppercase text-slate-400 font-bold">
                TARGET PHYSICAL BATCH COORDINATE:
              </span>
              <div className="text-3xl font-black text-theme-primary font-mono-coordinate flex items-center gap-2">
                <MapPin className="h-6 w-6 text-theme-primary" />
                <span>{currentCoordinate}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => { setBatchIndex(prev => Math.max(1, prev - 1)); playSound('click'); }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-mono text-slate-300 hover:bg-slate-700"
              >
                Batch -1
              </button>
              <button
                onClick={() => { setBatchIndex(prev => prev + 1); playSound('click'); }}
                className="px-3.5 py-1.5 rounded-lg bg-theme-primary hover-bg-theme-primary font-bold font-mono text-xs shadow"
              >
                Next Batch (+1) ➔
              </button>
            </div>
          </div>

          {/* 3-Tier Selectors with updated Left, Middle, Right orientation */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">UNIT (1-9)</label>
              <select
                value={unit}
                onChange={(e) => setUnit(parseInt(e.target.value, 10))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(u => <option key={u} value={u}>Unit {u}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">DRAWER (LEFT, MID, RIGHT)</label>
              <select
                value={drawer}
                onChange={(e) => setDrawer(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
              >
                <option value="A">Drawer A (Left)</option>
                <option value="B">Drawer B (Middle)</option>
                <option value="C">Drawer C (Right)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-mono text-slate-400 block mb-1">BATCH INDEX</label>
              <input
                type="number"
                min={1}
                value={batchIndex}
                onChange={(e) => setBatchIndex(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
              />
            </div>
          </div>

          <div className="text-xs text-slate-400 flex items-center justify-between font-mono pt-1">
            <span>Cards currently in this batch: <strong className="text-theme-primary">{existingInBatch.length}</strong></span>
            <span className="text-[11px] text-slate-500">Flexible sizing: Accepts any count (50, 80, 110+).</span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-blue-900/60 rounded-2xl p-5 shadow-xl flex items-center gap-3">
          <Layers className="h-6 w-6 text-blue-400 shrink-0" />
          <div>
            <div className="text-sm font-bold text-white">Target: Active Brewing & Decks Pool</div>
            <div className="text-xs text-slate-400">Cards in this mode are held diffused without physical drawer coordinates.</div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-600 text-emerald-300 font-bold text-xs flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* SCANNER IMPORT */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label className="text-xs font-mono font-bold text-slate-300 flex items-center gap-2">
            <FileText className="h-4 w-4 text-theme-primary" />
            <span>PASTE CARD LIST (Delver Lens, ManaBox, TCGplayer):</span>
          </label>
          <div className="flex items-center gap-3">
            {/* Reverse List Order Button */}
            <button
              onClick={handleReverseList}
              className="text-xs text-slate-300 hover:text-white font-mono flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition"
              title="Reverse the order of the pasted list (top-to-bottom)"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-theme-primary" />
              <span>Reverse List Order</span>
            </button>
            <button
              onClick={() => { setRawText(SAMPLE_SCAN); playSound('click'); }}
              className="text-xs text-theme-primary hover:underline font-mono"
            >
              Load Sample List
            </button>
          </div>
        </div>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={7}
          placeholder="4 Lightning Bolt&#10;3 Carrion Feeder (EMA) 84&#10;1 Sol Ring..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500 font-sans"
        />

        <button
          onClick={handleIngest}
          disabled={isProcessing}
          className="w-full py-3.5 rounded-xl bg-theme-primary hover-bg-theme-primary active:opacity-90 disabled:opacity-50 font-black text-sm tracking-wide shadow-lg shadow-theme-glow flex items-center justify-center gap-2 cursor-pointer transition"
        >
          {isProcessing ? (
            <>
              <div className="h-4 w-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              <span>Processing cards...</span>
            </>
          ) : mode === 'new_to_chaos' ? (
            <>
              <Check className="h-4 w-4 stroke-[3]" />
              <span>INGEST INTO BATCH {currentCoordinate}</span>
            </>
          ) : mode === 'new_to_brewing' ? (
            <>
              <Check className="h-4 w-4 stroke-[3]" />
              <span>ADD TO BREWING & DECKS POOL</span>
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 stroke-[3]" />
              <span>RETURN FROM BREWING ➔ BATCH {currentCoordinate}</span>
            </>
          )}
        </button>
      </div>

      {/* ACTIVITY & INVENTORY HISTORY LOG */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-theme-primary" />
            <h2 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
              Card History (Added, Moved, Removed)
            </h2>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <button
              onClick={() => setHistoryFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition ${
                historyFilter === 'all' ? 'bg-theme-primary font-bold' : 'text-slate-400 hover:text-white bg-slate-850'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setHistoryFilter('added')}
              className={`px-2.5 py-1 rounded-lg transition ${
                historyFilter === 'added' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-white bg-slate-850'
              }`}
            >
              Added
            </button>
            <button
              onClick={() => setHistoryFilter('moved')}
              className={`px-2.5 py-1 rounded-lg transition ${
                historyFilter === 'moved' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white bg-slate-850'
              }`}
            >
              Moved
            </button>
            <button
              onClick={() => setHistoryFilter('removed')}
              className={`px-2.5 py-1 rounded-lg transition ${
                historyFilter === 'removed' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-white bg-slate-850'
              }`}
            >
              Removed
            </button>
          </div>
        </div>

        {/* History Items List */}
        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs italic bg-slate-950 rounded-xl border border-slate-800">
            No history recorded yet for this filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-800 bg-slate-950 rounded-xl border border-slate-800 max-h-80 overflow-y-auto">
            {filteredHistory.map((item) => {
              const badgeBg = 
                item.type === 'added' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                item.type === 'moved' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' :
                'bg-rose-500/20 text-rose-400 border-rose-500/30';

              return (
                <div key={item.id} className="p-3 flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${badgeBg}`}>
                      {item.type}
                    </span>
                    <div className="truncate">
                      <span className="font-bold text-white mr-2">{item.card_name}</span>
                      <span className="text-slate-400 text-[11px] font-mono">
                        {item.details || (item.from_location ? `${item.from_location} ➔ ${item.to_location}` : item.to_location)}
                      </span>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-slate-500 shrink-0">
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

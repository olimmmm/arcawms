import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Bookmark, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Copy, 
  Compass, 
  Search, 
  Sparkles, 
  FileText, 
  LayoutGrid, 
  List, 
  ChevronRight, 
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  FolderPlus,
  ArrowUpDown
} from 'lucide-react';
import { db } from '../services/db';
import { CustomList, CustomListItem, CardInstance, ScryfallCard } from '../types';
import { playSound, triggerHaptic } from '../services/audio';
import { parseDecklistText } from '../services/pickPath';
import { 
  scryfallAutocomplete, 
  fetchScryfallCardByName, 
  fetchScryfallCardsBatch, 
  CARD_BACK_IMAGE 
} from '../services/scryfall';

interface CustomListViewProps {
  onNavigateToPickPath?: (decklistText: string) => void;
}

export const CustomListView: React.FC<CustomListViewProps> = ({ onNavigateToPickPath }) => {
  // DB subscriptions
  const [customLists, setCustomLists] = useState<CustomList[]>(() => db.getCustomLists());
  const [instances, setInstances] = useState<CardInstance[]>(() => db.getAllInstances());
  const [activeListId, setActiveListId] = useState<string>(() => {
    const lists = db.getCustomLists();
    return lists[0]?.id || '';
  });

  // UI state
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [addMode, setAddMode] = useState<'type' | 'paste'>('type');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortOption, setSortOption] = useState<'name' | 'price_desc' | 'count_desc' | 'added_desc'>('added_desc');
  
  // List Creation & Editing
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [isEditingList, setIsEditingList] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [listToDelete, setListToDelete] = useState<CustomList | null>(null);

  // Single Card Typing (with Scryfall autocomplete)
  const [typeInput, setTypeInput] = useState('');
  const [typeCount, setTypeCount] = useState<number>(1);
  const [typeNotes, setTypeNotes] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSearchingScryfall, setIsSearchingScryfall] = useState(false);
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(-1);
  const autocompleteDebounceRef = useRef<any>(null);

  // Bulk Paste
  const [pasteText, setPasteText] = useState('');
  const [isImportingBulk, setIsImportingBulk] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);

  // Card note editing
  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [itemNoteValue, setItemNoteValue] = useState('');

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Subscribe to DB updates
  useEffect(() => {
    return db.subscribe(() => {
      const updatedLists = db.getCustomLists();
      setCustomLists(updatedLists);
      setInstances(db.getAllInstances());
      // If active list no longer exists, reset to first list
      if (!updatedLists.some(l => l.id === activeListId) && updatedLists.length > 0) {
        setActiveListId(updatedLists[0].id);
      }
    });
  }, [activeListId]);

  // Ensure activeListId is valid
  useEffect(() => {
    if (!activeListId && customLists.length > 0) {
      setActiveListId(customLists[0].id);
    }
  }, [customLists, activeListId]);

  const activeList = useMemo(() => {
    return customLists.find(l => l.id === activeListId) || customLists[0] || null;
  }, [customLists, activeListId]);

  // Physical ownership calculation (strict read-only, 0 impact on cabinet counts)
  const getPhysicalOwnership = (cardName: string) => {
    const clean = cardName.trim().toLowerCase();
    let inDrawers = 0;
    let inDecks = 0;
    let inProxyBox = 0;
    for (const inst of instances) {
      if (inst.card_name.trim().toLowerCase() === clean) {
        if (inst.state === 'A') inDrawers++;
        else if (inst.state === 'B') inDecks++;
        else if (inst.state === 'P') inProxyBox++;
      }
    }
    const total = inDrawers + inDecks + inProxyBox;
    return { total, inDrawers, inDecks, inProxyBox };
  };

  // Handle Autocomplete
  useEffect(() => {
    if (autocompleteDebounceRef.current) clearTimeout(autocompleteDebounceRef.current);
    if (!typeInput || typeInput.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    autocompleteDebounceRef.current = setTimeout(async () => {
      setIsSearchingScryfall(true);
      try {
        const results = await scryfallAutocomplete(typeInput.trim());
        setSuggestions(results.slice(0, 7));
      } catch {
        setSuggestions([]);
      } finally {
        setIsSearchingScryfall(false);
      }
    }, 200);

    return () => {
      if (autocompleteDebounceRef.current) clearTimeout(autocompleteDebounceRef.current);
    };
  }, [typeInput]);

  // Handle Create List
  const handleCreateList = () => {
    if (!newListName.trim()) return;
    playSound('click');
    const created = db.createCustomList(newListName.trim(), newListDesc.trim());
    setActiveListId(created.id);
    setNewListName('');
    setNewListDesc('');
    setIsCreatingList(false);
    showToast(`Created list "${created.name}"`);
  };

  // Handle Start Edit List
  const handleStartEditList = () => {
    if (!activeList) return;
    playSound('click');
    setEditName(activeList.name);
    setEditDesc(activeList.description || '');
    setIsEditingList(true);
  };

  // Handle Save Edit List
  const handleSaveEditList = () => {
    if (!activeList || !editName.trim()) return;
    playSound('click');
    db.renameCustomList(activeList.id, editName.trim(), editDesc.trim());
    setIsEditingList(false);
    showToast(`Updated "${editName.trim()}"`);
  };

  // Handle Delete List
  const handleConfirmDeleteList = () => {
    if (!listToDelete) return;
    playSound('click');
    const name = listToDelete.name;
    db.deleteCustomList(listToDelete.id);
    setListToDelete(null);
    showToast(`Deleted list "${name}"`, 'info');
  };

  // Handle Add Single Card
  const handleAddSingleCard = async (targetName?: string) => {
    const cardNameToAdd = (targetName || typeInput).trim();
    if (!cardNameToAdd || !activeList) return;

    playSound('click');
    setIsAddingCard(true);
    setSuggestions([]);

    try {
      // Fetch high-speed Scryfall data to get real price and image
      const meta = await fetchScryfallCardByName(cardNameToAdd);
      db.addCardToCustomList(
        activeList.id,
        meta?.name || cardNameToAdd,
        typeCount > 0 ? typeCount : 1,
        meta || undefined,
        typeNotes.trim() || undefined
      );
      playSound('success');
      triggerHaptic('light');
      showToast(`Added ${typeCount}x "${meta?.name || cardNameToAdd}" to ${activeList.name}`);
      setTypeInput('');
      setTypeCount(1);
      setTypeNotes('');
    } catch {
      db.addCardToCustomList(
        activeList.id,
        cardNameToAdd,
        typeCount > 0 ? typeCount : 1,
        undefined,
        typeNotes.trim() || undefined
      );
      showToast(`Added ${typeCount}x "${cardNameToAdd}" to ${activeList.name}`);
      setTypeInput('');
      setTypeCount(1);
      setTypeNotes('');
    } finally {
      setIsAddingCard(false);
    }
  };

  // Handle Bulk Paste Import
  const handleImportBulk = async () => {
    if (!pasteText.trim() || !activeList) return;
    playSound('click');
    setIsImportingBulk(true);
    setBulkFeedback('Parsing decklist items...');

    try {
      const parsed = parseDecklistText(pasteText);
      if (parsed.length === 0) {
        showToast('No valid card names found in pasted text', 'error');
        setIsImportingBulk(false);
        return;
      }

      setBulkFeedback(`Resolving Scryfall images & prices for ${parsed.length} cards...`);
      // Batch fetch Scryfall data
      const names = parsed.map(p => p.name);
      const metaMap = await fetchScryfallCardsBatch(names);

      const itemsToAdd = parsed.map(p => {
        const meta = metaMap.get(p.name.toLowerCase());
        return {
          name: meta?.name || p.name,
          count: p.count,
          metadata: meta
        };
      });

      const totalCardsAdded = db.addCardsToCustomListBulk(activeList.id, itemsToAdd);
      playSound('success');
      triggerHaptic('medium');
      showToast(`Imported ${totalCardsAdded} cards into "${activeList.name}"!`);
      setPasteText('');
      setBulkFeedback(null);
    } catch (err: any) {
      playSound('error');
      showToast(`Failed to parse list: ${err.message || 'Unknown error'}`, 'error');
    } finally {
      setIsImportingBulk(false);
    }
  };

  // Handle Item Quantity Stepper
  const handleUpdateItemCount = (itemId: string, newCount: number) => {
    if (!activeList) return;
    playSound('click');
    triggerHaptic('light');
    if (newCount <= 0) {
      db.removeCardFromCustomList(activeList.id, itemId);
    } else {
      db.updateCustomListItemCount(activeList.id, itemId, newCount);
    }
  };

  // Handle Remove Card
  const handleRemoveItem = (item: CustomListItem) => {
    if (!activeList) return;
    playSound('skip');
    triggerHaptic('light');
    db.removeCardFromCustomList(activeList.id, item.id);
    showToast(`Removed "${item.card_name}" from ${activeList.name}`, 'info');
  };

  // Handle Save Note
  const handleSaveItemNote = (itemId: string) => {
    if (!activeList) return;
    playSound('click');
    db.updateCustomListItemNotes(activeList.id, itemId, itemNoteValue.trim());
    setEditingNoteItemId(null);
    setItemNoteValue('');
  };

  // Copy list formatted as decklist to clipboard
  const handleCopyDecklist = () => {
    if (!activeList || activeList.items.length === 0) return;
    playSound('click');
    const text = activeList.items.map(i => `${i.count} ${i.card_name}`).join('\n');
    navigator.clipboard.writeText(text);
    triggerHaptic('light');
    showToast(`Copied ${activeList.items.length} cards to clipboard!`);
  };

  // Send list directly to Pick-Path
  const handleSendToPickPath = () => {
    if (!activeList || activeList.items.length === 0) return;
    playSound('pull');
    const text = activeList.items.map(i => `${i.count} ${i.card_name}`).join('\n');
    if (onNavigateToPickPath) {
      onNavigateToPickPath(text);
    } else {
      navigator.clipboard.writeText(text);
      showToast(`Copied cards to clipboard! Navigate to Pick-Path to pull.`, 'info');
    }
  };

  // Filtered & Sorted items
  const processedItems = useMemo(() => {
    if (!activeList) return [];
    let items = [...activeList.items];

    // Filter
    if (filterQuery.trim()) {
      const q = filterQuery.trim().toLowerCase();
      items = items.filter(i => 
        i.card_name.toLowerCase().includes(q) ||
        (i.notes && i.notes.toLowerCase().includes(q)) ||
        (i.card_metadata?.type_line && i.card_metadata.type_line.toLowerCase().includes(q))
      );
    }

    // Sort
    items.sort((a, b) => {
      if (sortOption === 'name') {
        return a.card_name.localeCompare(b.card_name);
      }
      if (sortOption === 'price_desc') {
        const aPrice = a.card_metadata?.price_eur || 0;
        const bPrice = b.card_metadata?.price_eur || 0;
        return bPrice - aPrice;
      }
      if (sortOption === 'count_desc') {
        return b.count - a.count;
      }
      // added_desc (default)
      return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
    });

    return items;
  }, [activeList, filterQuery, sortOption]);

  // Aggregate stats for active list
  const activeListStats = useMemo(() => {
    if (!activeList) return { totalCount: 0, uniqueCount: 0, totalEur: 0, ownedCount: 0 };
    let totalCount = 0;
    let totalEur = 0;
    let ownedCount = 0;

    for (const item of activeList.items) {
      totalCount += item.count;
      const price = item.card_metadata?.price_eur || 0;
      totalEur += price * item.count;

      const physical = getPhysicalOwnership(item.card_name);
      if (physical.total > 0) {
        ownedCount++;
      }
    }

    return {
      totalCount,
      uniqueCount: activeList.items.length,
      totalEur: Math.round(totalEur * 100) / 100,
      ownedCount
    };
  }, [activeList, instances]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className={`px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border text-sm font-semibold backdrop-blur-md ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40 shadow-emerald-950/50'
              : toast.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-500/40 shadow-rose-950/50'
              : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-950/50'
          }`}>
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-theme-accent shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* Header & Abstract Lists Context Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-theme-subtle text-theme-primary border border-theme-subtle">
              <Bookmark className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                Custom Lists
                <span className="text-xs font-mono font-normal uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Wishlists & Binders
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Track abstract collections (Wants, Favourites, Digital Binders). Does not affect physical cabinet inventory.
              </p>
            </div>
          </div>
        </div>

        {/* New List Trigger */}
        <button
          type="button"
          onClick={() => { setIsCreatingList(true); playSound('click'); }}
          className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-theme-primary text-slate-950 font-bold text-xs sm:text-sm hover:brightness-110 shadow-sm cursor-pointer transition"
        >
          <FolderPlus className="h-4 w-4" />
          <span>New List</span>
        </button>
      </div>

      {/* List Tabs / Selector Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {customLists.map((list) => {
          const isActive = list.id === activeListId;
          const itemCount = list.items.reduce((acc, i) => acc + i.count, 0);
          return (
            <button
              key={list.id}
              onClick={() => { setActiveListId(list.id); playSound('click'); }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition cursor-pointer border ${
                isActive
                  ? 'bg-slate-800 text-white border-theme-accent/50 shadow-md ring-1 ring-theme-accent/30'
                  : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Bookmark className={`h-3.5 w-3.5 ${isActive ? 'text-theme-accent fill-theme-accent/20' : 'text-slate-500'}`} />
              <span>{list.name}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                isActive ? 'bg-theme-accent-subtle text-theme-accent' : 'bg-slate-800 text-slate-400'
              }`}>
                {itemCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active List Header Card */}
      {activeList && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-white">{activeList.name}</h2>
                <button
                  type="button"
                  onClick={handleStartEditList}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Rename list"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                {customLists.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setListToDelete(activeList)}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                    title="Delete list"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {activeList.description && (
                <p className="text-xs text-slate-400">{activeList.description}</p>
              )}
            </div>

            {/* List Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleCopyDecklist}
                disabled={activeList.items.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-accent-subtle hover:bg-theme-accent/20 text-theme-accent text-xs font-semibold border border-theme-accent-subtle transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                title="Copy cards as standard MTG text list"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy to Clipboard</span>
              </button>

              <button
                type="button"
                onClick={handleSendToPickPath}
                disabled={activeList.items.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-theme-subtle hover:bg-theme-subtle/80 text-theme-primary text-xs font-semibold border border-theme-subtle transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Pull items from drawers using Pick-Path"
              >
                <Compass className="h-3.5 w-3.5" />
                <span>Send to Pick-Path</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800/80">
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Total Quantity</div>
              <div className="text-base font-black text-white font-mono mt-0.5">{activeListStats.totalCount} cards</div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Unique Titles</div>
              <div className="text-base font-black text-theme-accent font-mono mt-0.5">{activeListStats.uniqueCount} titles</div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Est. Market Value</div>
              <div className="text-base font-black text-emerald-400 font-mono mt-0.5">€{activeListStats.totalEur.toFixed(2)}</div>
            </div>
            <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
              <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">In Storage Cabinets</div>
              <div className="text-base font-black text-blue-400 font-mono mt-0.5">
                {activeListStats.ownedCount} / {activeListStats.uniqueCount} owned
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Cards Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        {/* Toggle Mode: Type vs Paste */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-white uppercase tracking-wider">Add Cards to List</h3>
          </div>
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => { setAddMode('type'); playSound('click'); }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                addMode === 'type' ? 'bg-theme-primary text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Type Name</span>
            </button>
            <button
              type="button"
              onClick={() => { setAddMode('paste'); playSound('click'); }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                addMode === 'paste' ? 'bg-theme-primary text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Paste Text List</span>
            </button>
          </div>
        </div>

        {/* Mode 1: Type Single Card */}
        {addMode === 'type' && (
          <div className="space-y-3">
            <div className="relative">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={typeInput}
                    onChange={(e) => setTypeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (suggestions.length > 0 && autocompleteIndex >= 0) {
                          handleAddSingleCard(suggestions[autocompleteIndex]);
                        } else {
                          handleAddSingleCard();
                        }
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setAutocompleteIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setAutocompleteIndex(prev => Math.max(prev - 1, -1));
                      }
                    }}
                    placeholder="Search card name (e.g. Rhystic Study)..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-theme-primary focus:ring-1 focus:ring-theme-primary"
                  />
                  {isSearchingScryfall && (
                    <div className="absolute right-3 top-3 text-[10px] text-theme-accent animate-pulse font-mono">
                      Searching...
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-2 py-1.5 h-[42px]">
                    <span className="text-xs text-slate-500 font-mono mr-1.5">Qty:</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={typeCount}
                      onChange={(e) => setTypeCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 bg-transparent text-sm font-mono text-center text-white focus:outline-none"
                    />
                  </div>

                  <input
                    type="text"
                    value={typeNotes}
                    onChange={(e) => setTypeNotes(e.target.value)}
                    placeholder="Notes (optional)..."
                    className="hidden sm:block w-44 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-theme-primary"
                  />

                  <button
                    type="button"
                    onClick={() => handleAddSingleCard()}
                    disabled={!typeInput.trim() || isAddingCard}
                    className="px-4 py-2.5 rounded-xl bg-theme-primary text-slate-950 font-bold text-sm hover:brightness-110 transition shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Autocomplete Dropdown */}
              {suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-12 z-30 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden mt-1 max-h-56 overflow-y-auto">
                  {suggestions.map((name, idx) => {
                    const isSelected = idx === autocompleteIndex;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleAddSingleCard(name)}
                        className={`w-full px-3.5 py-2 text-left text-xs font-semibold flex items-center justify-between cursor-pointer transition ${
                          isSelected ? 'bg-theme-accent-subtle text-theme-accent' : 'text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <span>{name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">Scryfall match</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mode 2: Paste Bulk Decklist */}
        {addMode === 'paste' && (
          <div className="space-y-3">
            <textarea
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste list here (e.g.):&#10;4 Lightning Bolt&#10;1 Sol Ring&#10;2 Counterspell&#10;1 Esper Sentinel"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs sm:text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-theme-primary"
            />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="text-xs text-slate-400">
                {bulkFeedback ? (
                  <span className="text-theme-accent font-mono animate-pulse">{bulkFeedback}</span>
                ) : (
                  <span>Strips foil codes and set numbers automatically.</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleImportBulk}
                disabled={!pasteText.trim() || isImportingBulk}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-theme-primary text-slate-950 font-bold text-xs sm:text-sm hover:brightness-110 transition shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                <span>{isImportingBulk ? 'Importing...' : 'Add All to List'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List Content Controls (Search / Filter / View mode) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter active list..."
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-theme-primary"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Sort Selector */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1 text-xs text-slate-300">
            <ArrowUpDown className="h-3 w-3 mr-1.5 text-slate-500" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as any)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="added_desc" className="bg-slate-900">Recently Added</option>
              <option value="name" className="bg-slate-900">Alphabetical (A-Z)</option>
              <option value="price_desc" className="bg-slate-900">Price (High to Low)</option>
              <option value="count_desc" className="bg-slate-900">Quantity (Most First)</option>
            </select>
          </div>

          {/* Grid vs Table View Mode */}
          <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setViewMode('grid'); playSound('click'); }}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'grid' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('table'); playSound('click'); }}
              className={`p-1.5 rounded-lg transition cursor-pointer ${
                viewMode === 'table' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="Table View"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Cards View: Grid or Table */}
      {processedItems.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-10 text-center space-y-3">
          <div className="inline-flex p-3 rounded-full bg-slate-800 text-slate-500">
            <Bookmark className="h-6 w-6" />
          </div>
          <h4 className="text-base font-bold text-white">This list is empty</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Add cards using the search field above, paste a text decklist, or click the &quot;+&quot; menu on cards anywhere in the app to bookmark them here.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* Visual Card Grid View */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
          {processedItems.map((item) => {
            const meta = item.card_metadata;
            const physical = getPhysicalOwnership(item.card_name);
            const isEditingNote = editingNoteItemId === item.id;

            return (
              <div 
                key={item.id}
                className="group relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg hover:border-slate-700 transition flex flex-col justify-between"
              >
                {/* Card Artwork / Image */}
                <div className="relative aspect-[5/7] w-full bg-slate-950 overflow-hidden">
                  <img
                    src={meta?.image_url_normal || CARD_BACK_IMAGE}
                    alt={item.card_name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />

                  {/* Quantity Badge (Top-Right) */}
                  <div className="absolute top-2 right-2 bg-slate-950/90 border border-slate-700/80 rounded-lg px-2 py-0.5 shadow-lg">
                    <span className="text-xs font-black font-mono text-theme-accent">×{item.count}</span>
                  </div>

                  {/* Price Tag (Bottom-Right) */}
                  {meta && meta.price_eur > 0 && (
                    <div className="absolute bottom-2 right-2 bg-emerald-950/90 border border-emerald-500/40 rounded-lg px-2 py-0.5 shadow-lg">
                      <span className="text-[10px] font-black font-mono text-emerald-300">
                        €{(meta.price_eur * item.count).toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Physical Ownership Indicator (Bottom-Left) */}
                  <div className="absolute bottom-2 left-2 max-w-[80%]">
                    {physical.total > 0 ? (
                      <span className="inline-block bg-blue-950/90 border border-blue-500/40 text-blue-200 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow truncate">
                        Owned: {physical.total}
                      </span>
                    ) : (
                      <span className="inline-block bg-slate-950/90 border border-slate-700 text-slate-400 text-[9px] font-mono px-1.5 py-0.5 rounded shadow">
                        0 Owned
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Info & Stepper */}
                <div className="p-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-1">
                    <div className="font-bold text-xs text-white truncate" title={item.card_name}>
                      {item.card_name}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 rounded transition cursor-pointer"
                      title="Remove from list"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Notes snippet or edit button */}
                  {isEditingNote ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={itemNoteValue}
                        onChange={(e) => setItemNoteValue(e.target.value)}
                        placeholder="Add notes..."
                        className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-theme-primary"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveItemNote(item.id);
                          if (e.key === 'Escape') setEditingNoteItemId(null);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveItemNote(item.id)}
                        className="p-1 rounded bg-theme-primary text-slate-950 text-[10px] cursor-pointer"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div 
                      onClick={() => {
                        setEditingNoteItemId(item.id);
                        setItemNoteValue(item.notes || '');
                      }}
                      className="text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer truncate"
                      title={item.notes || 'Click to add notes'}
                    >
                      {item.notes ? (
                        <span className="italic text-theme-accent/80">“{item.notes}”</span>
                      ) : (
                        <span className="text-slate-600 hover:text-slate-400">+ Add note</span>
                      )}
                    </div>
                  )}

                  {/* Quantity Stepper */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                    <span className="text-[10px] font-mono text-slate-500">Quantity</span>
                    <div className="flex items-center gap-1.5 bg-slate-950 px-1.5 py-0.5 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleUpdateItemCount(item.id, item.count - 1)}
                        className="h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer font-bold text-xs"
                      >
                        -
                      </button>
                      <span className="text-xs font-mono font-bold text-white min-w-[16px] text-center">
                        {item.count}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateItemCount(item.id, item.count + 1)}
                        className="h-5 w-5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer font-bold text-xs"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Detailed Table View */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-200">
              <thead className="bg-slate-950 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3">Card</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Price</th>
                  <th className="py-3 px-3">Cabinet Stock</th>
                  <th className="py-3 px-3">Notes</th>
                  <th className="py-3 px-3 text-center">Qty</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {processedItems.map((item) => {
                  const meta = item.card_metadata;
                  const physical = getPhysicalOwnership(item.card_name);
                  const isEditingNote = editingNoteItemId === item.id;

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition">
                      {/* Card Thumbnail & Name */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={meta?.image_url_normal || CARD_BACK_IMAGE}
                            alt={item.card_name}
                            className="h-10 w-7 object-cover rounded shadow shrink-0 bg-slate-950"
                          />
                          <div>
                            <div className="font-bold text-white hover:text-theme-accent transition">{item.card_name}</div>
                            {meta?.mana_cost && (
                              <div className="text-[10px] text-slate-400 font-mono">{meta.mana_cost}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Type Line */}
                      <td className="py-2.5 px-3 text-slate-400 text-[11px] truncate max-w-[140px]">
                        {meta?.type_line || '—'}
                      </td>

                      {/* Scryfall Price */}
                      <td className="py-2.5 px-3 font-mono font-semibold text-emerald-400 whitespace-nowrap">
                        {meta && meta.price_eur > 0 ? `€${meta.price_eur.toFixed(2)}` : '—'}
                      </td>

                      {/* Physical Cabinet Stock Indicator */}
                      <td className="py-2.5 px-3">
                        {physical.total > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-950 text-blue-300 border border-blue-500/30">
                            <span>Owned: {physical.total}</span>
                            <span className="text-[9px] text-blue-400">({physical.inDrawers} draw)</span>
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-950 text-slate-500 border border-slate-800">
                            0 in Cabinet
                          </span>
                        )}
                      </td>

                      {/* Notes */}
                      <td className="py-2.5 px-3 max-w-[150px]">
                        {isEditingNote ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={itemNoteValue}
                              onChange={(e) => setItemNoteValue(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveItemNote(item.id);
                                if (e.key === 'Escape') setEditingNoteItemId(null);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveItemNote(item.id)}
                              className="p-1 rounded bg-theme-primary text-slate-950 text-xs cursor-pointer"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              setEditingNoteItemId(item.id);
                              setItemNoteValue(item.notes || '');
                            }}
                            className="text-xs text-slate-400 hover:text-white cursor-pointer truncate"
                            title={item.notes || 'Click to edit notes'}
                          >
                            {item.notes ? item.notes : <span className="text-slate-600 italic">+ note</span>}
                          </div>
                        )}
                      </td>

                      {/* Quantity Stepper */}
                      <td className="py-2.5 px-3 text-center">
                        <div className="inline-flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleUpdateItemCount(item.id, item.count - 1)}
                            className="text-slate-400 hover:text-white cursor-pointer px-1 text-xs font-bold"
                          >
                            -
                          </button>
                          <span className="font-mono font-bold text-white min-w-[14px]">
                            {item.count}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateItemCount(item.id, item.count + 1)}
                            className="text-slate-400 hover:text-white cursor-pointer px-1 text-xs font-bold"
                          >
                            +
                          </button>
                        </div>
                      </td>

                      {/* Remove */}
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item)}
                          className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create New List */}
      {isCreatingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-theme-primary" />
                <span>Create Custom List</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCreatingList(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">List Name</label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g. Commander Wishlist, Foil Binder..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-theme-primary"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  placeholder="e.g. Cards I want to trade for at FNM..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-theme-primary"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCreatingList(false)}
                className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateList}
                disabled={!newListName.trim()}
                className="px-4 py-2 rounded-xl bg-theme-primary text-slate-950 text-xs font-bold hover:brightness-110 transition shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Active List */}
      {isEditingList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-theme-accent" />
                <span>Edit List Details</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditingList(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">List Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-theme-primary"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Description</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-theme-primary"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditingList(false)}
                className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditList}
                disabled={!editName.trim()}
                className="px-4 py-2 rounded-xl bg-theme-primary text-slate-950 text-xs font-bold hover:brightness-110 transition shadow cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete List */}
      {listToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-400">
              <AlertCircle className="h-5 w-5" />
              <h3 className="text-base font-black text-white">Delete &quot;{listToDelete.name}&quot;?</h3>
            </div>
            <p className="text-xs text-slate-400">
              This will remove the list and its {listToDelete.items.length} bookmarked cards. Physical collection cards in your storage cabinet will NOT be affected.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setListToDelete(null)}
                className="px-3.5 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteList}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow cursor-pointer"
              >
                Delete List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

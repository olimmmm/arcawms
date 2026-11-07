import React from 'react';
import { 
  MapPin, 
  Edit3, 
  Trash2, 
  Plus, 
  Sparkles, 
  RotateCcw, 
  Layers, 
  ShoppingBag, 
  Undo2, 
  Bookmark, 
  ChevronRight 
} from 'lucide-react';
import { CardInstance, ScryfallCard, CustomList } from '../types';
import { getScryfallImageFallback, CARD_BACK_IMAGE } from '../services/scryfall';

interface SniperCardItemProps {
  card: ScryfallCard;
  cardInstances: CardInstance[];
  removedForCard: CardInstance[];
  isAnyCardMenuOpen: boolean;
  cardMenuOpenId: string | null;
  listSubmenuOpenId: string | null;
  customLists: CustomList[];
  mostRecentList?: CustomList | null;
  recentlyMoved: Map<string, { fromLoc: string }>;
  onToggleCardMenu: (id: string | null) => void;
  onToggleSubmenu: (id: string | null) => void;
  onOpenQuickAdd: (card: ScryfallCard, asProxy: boolean) => void;
  onToggleProxy: (inst: CardInstance) => void;
  onToggleForSale: (inst: CardInstance) => void;
  onAddCardToList: (name: string, listId: string, listName: string, card: ScryfallCard) => void;
  onQuickCreateListAndAdd: (name: string, card: ScryfallCard) => void;
  onUndoRemove: (instanceId: string) => void;
  onPullToBrew: (inst: CardInstance) => void;
  onRemoveForTrade: (inst: CardInstance) => void;
  onOpenEdit: (inst: CardInstance) => void;
  onUndoMoveToBrew: (instanceId: string) => void;
  onMoveToProxyBox: (inst: CardInstance) => void;
  onOpenReturn: (inst: CardInstance) => void;
}

export const SniperCardItem: React.FC<SniperCardItemProps> = React.memo(({
  card,
  cardInstances,
  removedForCard,
  isAnyCardMenuOpen,
  cardMenuOpenId,
  listSubmenuOpenId,
  customLists,
  mostRecentList,
  recentlyMoved,
  onToggleCardMenu,
  onToggleSubmenu,
  onOpenQuickAdd,
  onToggleProxy,
  onToggleForSale,
  onAddCardToList,
  onQuickCreateListAndAdd,
  onUndoRemove,
  onPullToBrew,
  onRemoveForTrade,
  onOpenEdit,
  onUndoMoveToBrew,
  onMoveToProxyBox,
  onOpenReturn,
}) => {
  const cardHasForSale = cardInstances.some(i => i.is_for_sale);
  const cardHasBrewProxy = cardInstances.some(i => i.is_proxy && i.state === 'B');

  return (
    <div
      className={`bg-slate-900 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row gap-4 sm:gap-5 transition-all relative ${
        isAnyCardMenuOpen ? 'z-30' : 'z-0'
      } ${
        cardHasForSale
          ? 'border-2 border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
          : 'border border-slate-800'
      }`}
    >
      {/* Card Image with Floating '+' Menu */}
      <div className={`relative w-24 sm:w-28 shrink-0 self-start ${cardMenuOpenId === card.oracle_id ? 'z-30' : 'z-10'}`}>
        <div className={`relative w-full rounded-xl overflow-hidden bg-slate-950 shadow transition-all ${
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
            className="w-full h-auto object-cover block"
            onError={(e) => {
              e.currentTarget.src = CARD_BACK_IMAGE;
            }}
          />

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

        {/* Top-Left `+` Menu Button & Unclipped Floating Dropdown Menu */}
        <div className={`absolute top-1.5 left-1.5 ${cardMenuOpenId === card.oracle_id ? 'z-30' : 'z-10'}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCardMenu(cardMenuOpenId === card.oracle_id ? null : card.oracle_id);
            }}
            className={`h-6 w-6 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer ${
              cardMenuOpenId === card.oracle_id
                ? 'bg-theme-accent text-slate-950 font-black ring-2 ring-theme-accent/60'
                : 'bg-slate-950/85 hover:bg-slate-900 text-white border border-slate-700/80 hover:border-theme-accent'
            }`}
            title="Card options menu"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {cardMenuOpenId === card.oracle_id && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-7 w-60 sm:w-64 bg-slate-900/98 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 space-y-1 text-xs backdrop-blur-md animate-in fade-in"
            >
              {cardInstances.length === 0 ? (
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-400 font-mono px-2 py-0.5 font-bold">ADD TO COLLECTION</div>
                  <button
                    type="button"
                    onClick={() => { onToggleCardMenu(null); onOpenQuickAdd(card, false); }}
                    className="w-full px-2 py-1.5 rounded-lg text-left flex items-center gap-1.5 hover:bg-slate-800 text-slate-200 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5 text-theme-accent" />
                    <span>+ Add Real Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { onToggleCardMenu(null); onOpenQuickAdd(card, true); }}
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
                    onClick={() => onToggleProxy(cardInstances[0])}
                    className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      <span>{cardInstances[0].is_proxy ? 'Mark as Real Card' : 'Mark as Proxy'}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleForSale(cardInstances[0])}
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
                      <div className="text-[10px] text-theme-accent font-mono font-bold flex justify-between">
                        <span>Copy #{cIdx + 1}</span>
                        <span className="text-slate-400 truncate max-w-[90px]">{inst.location_id || (inst.state === 'B' ? 'Brewing' : 'Proxy Box')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => onToggleProxy(inst)}
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
                          onClick={() => onToggleForSale(inst)}
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

              <div className="border-t border-slate-800 my-1" />
              {mostRecentList && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleCardMenu(null);
                    onAddCardToList(card.name, mostRecentList.id, mostRecentList.name, card);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between bg-theme-accent/10 hover:bg-theme-accent/20 text-theme-accent border border-theme-accent/30 transition cursor-pointer font-semibold group"
                  title={`Quick add "${card.name}" to ${mostRecentList.name}`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Bookmark className="h-3.5 w-3.5 text-theme-accent fill-theme-accent/30 shrink-0" />
                    <span className="truncate">Add to <strong className="font-bold underline decoration-theme-accent/50">{mostRecentList.name}</strong></span>
                  </span>
                  <span className="text-[9px] font-mono text-slate-400 shrink-0 ml-1 group-hover:text-white">
                    {mostRecentList.items.reduce((acc, i) => acc + i.count, 0)}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onToggleSubmenu(listSubmenuOpenId === card.oracle_id ? null : card.oracle_id)}
                className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Bookmark className="h-3.5 w-3.5 text-theme-accent" />
                  <span>Add to List...</span>
                </span>
                <ChevronRight className={`h-3 w-3 text-slate-400 transition-transform ${listSubmenuOpenId === card.oracle_id ? 'rotate-90' : ''}`} />
              </button>

              {listSubmenuOpenId === card.oracle_id && (
                <div className="p-1 space-y-1 bg-slate-950/70 rounded-lg border border-slate-800 max-h-48 overflow-y-auto">
                  {customLists.map(list => (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => onAddCardToList(card.name, list.id, list.name, card)}
                      className="w-full px-2 py-1 rounded text-left flex items-center justify-between hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer text-[11px]"
                    >
                      <span className="truncate max-w-[130px]">{list.name}</span>
                      <span className="text-[9px] font-mono text-slate-500">{list.items.reduce((acc, i) => acc + i.count, 0)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onQuickCreateListAndAdd(card.name, card)}
                    className="w-full px-2 py-1 rounded text-left flex items-center gap-1 text-theme-accent hover:brightness-110 hover:bg-slate-800 transition cursor-pointer text-[11px] font-semibold"
                  >
                    <Plus className="h-3 w-3" />
                    <span>+ New List</span>
                  </button>
                </div>
              )}
            </div>
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
                <span className="text-xs font-mono text-theme-accent bg-theme-accent-subtle px-2 py-0.5 rounded border border-theme-accent-subtle">
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
              onClick={() => onOpenQuickAdd(card, false)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-theme-accent" />
              <span>+ Add Copy</span>
            </button>
            <button
              onClick={() => onOpenQuickAdd(card, true)}
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
              {/* Recently removed copies */}
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
                    onClick={() => onUndoRemove(rem.instance_id)}
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
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-xl border gap-2 text-xs transition relative ${cardMenuOpenId === inst.instance_id ? 'z-30' : 'z-0'} ${borderClass}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {isInChaos ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg bg-theme-accent-subtle text-theme-accent font-mono-coordinate font-black text-sm border border-theme-accent-subtle flex items-center gap-1">
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
                          <button
                            onClick={() => onPullToBrew(inst)}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                            title="Add to brewing and decks pool"
                          >
                            <Layers className="h-3 w-3" />
                            <span>To Brew</span>
                          </button>

                          <button
                            onClick={() => onRemoveForTrade(inst)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 font-mono text-xs flex items-center gap-1 cursor-pointer"
                            title="Remove from collection for sales and trades"
                          >
                            <ShoppingBag className="h-3 w-3 text-rose-400" />
                            <span>Trade / Sell</span>
                          </button>

                          <button
                            onClick={() => onOpenEdit(inst)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 cursor-pointer"
                            title="Change coordinate"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : isInProxyBox ? (
                        <>
                          <button
                            onClick={() => onPullToBrew(inst)}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                            title="Move proxy into Active Decks / Brewing pool"
                          >
                            <Layers className="h-3 w-3" />
                            <span>To Brew</span>
                          </button>

                          <button
                            onClick={() => onRemoveForTrade(inst)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            title="Remove proxy from collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : recentlyMovedBrew ? (
                        <>
                          <button
                            onClick={() => onUndoMoveToBrew(inst.instance_id)}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-mono font-bold text-xs flex items-center gap-1 shadow cursor-pointer"
                            title="Undo pull and return to drawer coordinate"
                          >
                            <Undo2 className="h-3 w-3" />
                            <span>IN BREW (UNDO ↺)</span>
                          </button>

                          <button
                            onClick={() => onRemoveForTrade(inst)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            title="Remove from collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : isProxy ? (
                        <>
                          <button
                            onClick={() => onMoveToProxyBox(inst)}
                            className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                            title="Return proxy back to Proxy Box"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>To Proxy Box</span>
                          </button>

                          <button
                            onClick={() => onRemoveForTrade(inst)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            title="Remove proxy from collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onOpenReturn(inst)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono text-xs shadow flex items-center gap-1 cursor-pointer"
                            title="Return card from Brewing into a Chaos Drawer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Return to Drawer</span>
                          </button>

                          <button
                            onClick={() => onRemoveForTrade(inst)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            title="Remove from collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                      {/* Copy Individual Options Menu Toggle */}
                      <div className={`relative ${cardMenuOpenId === inst.instance_id ? 'z-40' : ''}`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCardMenu(cardMenuOpenId === inst.instance_id ? null : inst.instance_id);
                          }}
                          className={`p-1.5 rounded-lg transition border cursor-pointer ${
                            cardMenuOpenId === inst.instance_id
                              ? 'bg-theme-accent text-slate-950 border-theme-accent'
                              : 'text-slate-400 hover:text-white bg-slate-900 border-slate-700/80 hover:bg-slate-800'
                          }`}
                          title="Copy status settings"
                        >
                          <Plus className="h-3 w-3" />
                        </button>

                        {cardMenuOpenId === inst.instance_id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-8 w-52 sm:w-56 bg-slate-900/98 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 space-y-1 text-xs backdrop-blur-md animate-in fade-in"
                          >
                            <button
                              type="button"
                              onClick={() => onToggleProxy(inst)}
                              className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                                <span>{inst.is_proxy ? 'Mark as Real Card' : 'Mark as Proxy'}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleForSale(inst)}
                              className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <ShoppingBag className="h-3.5 w-3.5 text-rose-400" />
                                <span>{inst.is_for_sale ? 'Remove from Sale' : 'Mark For Sale (eBay)'}</span>
                              </span>
                            </button>

                            <div className="border-t border-slate-800 my-1" />
                            {mostRecentList && (
                              <button
                                type="button"
                                onClick={() => {
                                  onToggleCardMenu(null);
                                  onAddCardToList(inst.card_name, mostRecentList.id, mostRecentList.name, card);
                                }}
                                className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between bg-theme-accent/10 hover:bg-theme-accent/20 text-theme-accent border border-theme-accent/30 transition cursor-pointer font-semibold group"
                                title={`Quick add "${inst.card_name}" to ${mostRecentList.name}`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <Bookmark className="h-3.5 w-3.5 text-theme-accent fill-theme-accent/30 shrink-0" />
                                  <span className="truncate">Add to <strong className="font-bold underline decoration-theme-accent/50">{mostRecentList.name}</strong></span>
                                </span>
                                <span className="text-[9px] font-mono text-slate-400 shrink-0 ml-1 group-hover:text-white">
                                  {mostRecentList.items.reduce((acc, i) => acc + i.count, 0)}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onToggleSubmenu(listSubmenuOpenId === inst.instance_id ? null : inst.instance_id)}
                              className="w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-slate-800 text-slate-200 hover:text-white transition cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                <Bookmark className="h-3.5 w-3.5 text-theme-accent" />
                                <span>Add to List...</span>
                              </span>
                              <ChevronRight className={`h-3 w-3 text-slate-400 transition-transform ${listSubmenuOpenId === inst.instance_id ? 'rotate-90' : ''}`} />
                            </button>

                            {listSubmenuOpenId === inst.instance_id && (
                              <div className="p-1 space-y-1 bg-slate-950/70 rounded-lg border border-slate-800 max-h-48 overflow-y-auto">
                                {customLists.map(list => (
                                  <button
                                    key={list.id}
                                    type="button"
                                    onClick={() => onAddCardToList(inst.card_name, list.id, list.name, card)}
                                    className="w-full px-2 py-1 rounded text-left flex items-center justify-between hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer text-[11px]"
                                  >
                                    <span className="truncate max-w-[130px]">{list.name}</span>
                                    <span className="text-[9px] font-mono text-slate-500">{list.items.reduce((acc, i) => acc + i.count, 0)}</span>
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => onQuickCreateListAndAdd(inst.card_name, card)}
                                  className="w-full px-2 py-1 rounded text-left flex items-center gap-1 text-theme-accent hover:text-theme-accent-hover hover:bg-slate-800 transition cursor-pointer text-[11px] font-semibold"
                                >
                                  <Plus className="h-3 w-3" />
                                  <span>+ New List</span>
                                </button>
                              </div>
                            )}
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
});

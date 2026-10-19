import React from 'react';
import { Search, Compass, PlusCircle, Settings, Archive, Bookmark, Loader2, CheckCircle2, CloudOff } from 'lucide-react';
import { InventoryStats } from '../types';
import { CloudUploadState, syncClient } from '../services/sync';

interface NavbarProps {
  activeTab: 'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists';
  setActiveTab: (tab: 'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists') => void;
  stats: InventoryStats;
  syncStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  uploadState: CloudUploadState;
  onOpenSettings: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  stats,
  syncStatus,
  uploadState,
  onOpenSettings
}) => {
  const tabs = [
    { id: 'search', label: 'Search', icon: Search },
    { id: 'pickpath', label: 'Pick-Path', icon: Compass },
    { id: 'cabinet', label: 'Cabinet', icon: Archive },
    { id: 'lists', label: 'Lists', icon: Bookmark },
    { id: 'ingest', label: 'Batch Ingest', icon: PlusCircle }
  ] as const;

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800 text-slate-100 select-none shadow-md">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-theme-primary flex items-center justify-center font-black text-slate-950 text-sm shadow">
              AW
            </div>
            <div>
              <span className="font-extrabold tracking-tight text-white text-base">ArcaWMS</span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-theme-subtle text-theme-primary border border-theme-subtle ml-2 hidden sm:inline">
                Chaos Sorting
              </span>
            </div>
          </div>

          {/* Quick Count Pill */}
          <div className="flex items-center gap-2 font-mono text-xs bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-slate-400">
            <span><strong className="text-theme-primary">{stats.inChaosCount}</strong> in Drawers</span>
            <span className="text-slate-700">•</span>
            <span><strong className="text-blue-400">{stats.inDecksCount}</strong> in Decks</span>
            {typeof stats.proxyCount === 'number' && stats.proxyCount > 0 && (
              <>
                <span className="text-slate-700">•</span>
                <span><strong className="text-purple-400">{stats.proxyCount}</strong> Proxies</span>
              </>
            )}
            <span className="text-slate-700 hidden sm:inline">•</span>
            <span className="text-emerald-400 font-bold hidden sm:inline">€{stats.totalEurValue.toFixed(2)}</span>
          </div>

          {/* Top Right Actions: Upload/Sync Indicator + Settings Cog */}
          <div className="flex items-center gap-2">
            {uploadState === 'syncing' ? (
              <div 
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 font-mono text-xs shadow-sm shadow-amber-500/10 animate-pulse cursor-wait"
                title="Uploading changes to server... Please wait before closing or refreshing."
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                <span className="hidden sm:inline font-bold">Syncing...</span>
              </div>
            ) : uploadState === 'synced' ? (
              <div 
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-xs transition-all duration-300"
                title="All changes synced and saved to server."
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="hidden sm:inline font-bold">Synced</span>
              </div>
            ) : uploadState === 'error' ? (
              <div 
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs cursor-pointer"
                onClick={() => syncClient.forceReconnect()}
                title="Upload issue or offline. Click to reconnect."
              >
                <CloudOff className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span className="hidden sm:inline">Offline</span>
              </div>
            ) : null}

            <button
              onClick={onOpenSettings}
              className="group relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="Settings & Warehouse Preferences"
            >
              <Settings className="h-4 w-4 transition-transform group-hover:rotate-45" />
              {/* Subtle Sync Status Dot on the Cog */}
              <span className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${
                syncStatus === 'connected'
                  ? 'bg-emerald-400'
                  : syncStatus === 'connecting'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-slate-500'
              }`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-2 pb-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
                  isActive
                    ? 'bg-theme-primary font-black shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};

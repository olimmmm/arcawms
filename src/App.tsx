import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SniperSearch } from './components/SniperSearch';
import { PickPathRunner } from './components/PickPathRunner';
import { SkeuomorphicViewer } from './components/SkeuomorphicViewer';
import { IngestEngine } from './components/IngestEngine';
import { CustomListView } from './components/CustomListView';
import { SettingsSyncModal } from './components/SettingsSyncModal';
import { db } from './services/db';
import { syncClient } from './services/sync';
import { InventoryStats } from './types';
import { applyTheme, getActiveTheme } from './services/theme';
import { enrichMissingCards } from './services/scryfall';

export function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists'>('search');
  const [stats, setStats] = useState<InventoryStats>(() => db.getStats());
  const [syncStatus, setSyncStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>(
    () => syncClient.getStatus()
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingPickPathDecklist, setPendingPickPathDecklist] = useState<string | null>(null);

  // Cross-tab scroll position memory
  const scrollPositions = useRef<Record<string, number>>({});

  const handleTabChange = (nextTab: 'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists') => {
    if (nextTab === activeTab) return;
    scrollPositions.current[activeTab] = window.scrollY;
    setActiveTab(nextTab);
  };

  useLayoutEffect(() => {
    const targetY = scrollPositions.current[activeTab] || 0;
    window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
    const raf = requestAnimationFrame(() => {
      window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab]);

  useEffect(() => {
    applyTheme(getActiveTheme());
    enrichMissingCards();
  }, []);

  useEffect(() => {
    return db.subscribe(() => {
      setStats(db.getStats());
    });
  }, []);

  useEffect(() => {
    return syncClient.onStatusChange((status) => {
      setSyncStatus(status);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        stats={stats}
        syncStatus={syncStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 pb-16">
        <div style={{ display: activeTab === 'search' ? 'block' : 'none' }}>
          <SniperSearch />
        </div>
        <div style={{ display: activeTab === 'pickpath' ? 'block' : 'none' }}>
          <PickPathRunner 
            pendingDecklist={pendingPickPathDecklist || undefined}
            onClearPendingDecklist={() => setPendingPickPathDecklist(null)}
          />
        </div>
        <div style={{ display: activeTab === 'cabinet' ? 'block' : 'none' }}>
          <SkeuomorphicViewer />
        </div>
        <div style={{ display: activeTab === 'lists' ? 'block' : 'none' }}>
          <CustomListView
            onNavigateToPickPath={(text) => {
              setPendingPickPathDecklist(text);
              handleTabChange('pickpath');
            }}
          />
        </div>
        <div style={{ display: activeTab === 'ingest' ? 'block' : 'none' }}>
          <IngestEngine />
        </div>
      </main>

      <SettingsSyncModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        syncStatus={syncStatus}
      />
    </div>
  );
}
export default App;

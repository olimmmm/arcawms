import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { SniperSearch } from './components/SniperSearch';
import { PickPathRunner } from './components/PickPathRunner';
import { SkeuomorphicViewer } from './components/SkeuomorphicViewer';
import { IngestEngine } from './components/IngestEngine';
import { CustomListView } from './components/CustomListView';
import { SettingsSyncModal } from './components/SettingsSyncModal';
import { db } from './services/db';
import { syncClient, CloudUploadState } from './services/sync';
import { InventoryStats } from './types';
import { applyTheme, getActiveTheme } from './services/theme';

export function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists'>('search');
  const [stats, setStats] = useState<InventoryStats>(() => db.getStats());
  const [syncStatus, setSyncStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>(
    () => syncClient.getStatus()
  );
  const [uploadState, setUploadState] = useState<CloudUploadState>(() => syncClient.getUploadState());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingPickPathDecklist, setPendingPickPathDecklist] = useState<string | null>(null);

  // Cross-tab scroll position memory
  const scrollPositions = useRef<Record<string, number>>({});

  const handleTabChange = useCallback((nextTab: 'search' | 'pickpath' | 'cabinet' | 'ingest' | 'lists') => {
    setActiveTab(prev => {
      if (nextTab === prev) return prev;
      scrollPositions.current[prev] = window.scrollY;
      return nextTab;
    });
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleClearPendingDecklist = useCallback(() => {
    setPendingPickPathDecklist(null);
  }, []);

  const handleNavigateToPickPath = useCallback((text: string) => {
    setPendingPickPathDecklist(text);
    handleTabChange('pickpath');
  }, [handleTabChange]);

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

  useEffect(() => {
    return syncClient.onUploadStateChange((state) => {
      setUploadState(state);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        stats={stats}
        syncStatus={syncStatus}
        uploadState={uploadState}
        onOpenSettings={handleOpenSettings}
      />

      <main className="flex-1 pb-16">
        <div style={{ display: activeTab === 'search' ? 'block' : 'none' }}>
          <SniperSearch isActive={activeTab === 'search'} />
        </div>
        <div style={{ display: activeTab === 'pickpath' ? 'block' : 'none' }}>
          <PickPathRunner 
            isActive={activeTab === 'pickpath'}
            pendingDecklist={pendingPickPathDecklist || undefined}
            onClearPendingDecklist={handleClearPendingDecklist}
          />
        </div>
        <div style={{ display: activeTab === 'cabinet' ? 'block' : 'none' }}>
          <SkeuomorphicViewer isActive={activeTab === 'cabinet'} />
        </div>
        <div style={{ display: activeTab === 'lists' ? 'block' : 'none' }}>
          <CustomListView
            isActive={activeTab === 'lists'}
            onNavigateToPickPath={handleNavigateToPickPath}
          />
        </div>
        <div style={{ display: activeTab === 'ingest' ? 'block' : 'none' }}>
          <IngestEngine isActive={activeTab === 'ingest'} />
        </div>
      </main>

      <SettingsSyncModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        syncStatus={syncStatus}
      />
    </div>
  );
}
export default App;

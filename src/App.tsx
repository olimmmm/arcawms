import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { SniperSearch } from './components/SniperSearch';
import { PickPathRunner } from './components/PickPathRunner';
import { SkeuomorphicViewer } from './components/SkeuomorphicViewer';
import { IngestEngine } from './components/IngestEngine';
import { SettingsSyncModal } from './components/SettingsSyncModal';
import { db } from './services/db';
import { syncClient } from './services/sync';
import { InventoryStats } from './types';
import { applyTheme, getActiveTheme } from './services/theme';
import { enrichMissingCards } from './services/scryfall';

export function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'pickpath' | 'cabinet' | 'ingest'>('search');
  const [stats, setStats] = useState<InventoryStats>(() => db.getStats());
  const [syncStatus, setSyncStatus] = useState<'connected' | 'connecting' | 'disconnected' | 'error'>(
    () => syncClient.getStatus()
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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
        setActiveTab={setActiveTab}
        stats={stats}
        syncStatus={syncStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <main className="flex-1 pb-16">
        {activeTab === 'search' && <SniperSearch />}
        {activeTab === 'pickpath' && <PickPathRunner />}
        {activeTab === 'cabinet' && <SkeuomorphicViewer />}
        {activeTab === 'ingest' && <IngestEngine />}
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

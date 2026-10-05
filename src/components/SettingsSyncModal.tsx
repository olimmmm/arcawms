import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Wifi, 
  Download, 
  Upload, 
  RotateCcw, 
  Smartphone, 
  Check, 
  Volume2,
  Palette,
  FileSpreadsheet,
  ShieldCheck,
  Clock,
  ChevronRight
} from 'lucide-react';
import { db } from '../services/db';
import { syncClient } from '../services/sync';
import { playSound } from '../services/audio';
import { GUILD_THEMES, GuildThemeId, applyTheme, getActiveTheme } from '../services/theme';

interface SettingsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
}

export const SettingsSyncModal: React.FC<SettingsSyncModalProps> = ({
  isOpen,
  onClose,
  syncStatus
}) => {
  const [activeThemeId, setActiveThemeId] = useState<GuildThemeId>(() => getActiveTheme());
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; timestamp: string; label: string; cardCount: number }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveThemeId(getActiveTheme());
      setSnapshots(db.getSnapshots());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectTheme = (themeId: GuildThemeId) => {
    playSound('click');
    setActiveThemeId(themeId);
    applyTheme(themeId);
    db.updateSettings({ theme: themeId });
  };

  const handleExportJSON = () => {
    playSound('click');
    const jsonStr = db.exportJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arcawms-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    playSound('click');
    const csvStr = db.exportCSV();
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arcawms-collection-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = db.importJSON(content);
      if (res.success) {
        playSound('success');
        setImportStatus(`Successfully restored ${res.count} cards from backup!`);
        setSnapshots(db.getSnapshots());
        setActiveThemeId(getActiveTheme());
      } else {
        playSound('error');
        setImportStatus(`Import failed: ${res.error}`);
      }
    };
    reader.readAsText(file);
  };

  const handleRestoreSnapshot = (id: string, label: string) => {
    if (window.confirm(`Restore collection snapshot from "${label}"? Current unsaved changes will be replaced.`)) {
      playSound('success');
      const ok = db.restoreSnapshot(id);
      if (ok) {
        setImportStatus(`Restored snapshot: ${label}`);
        setSnapshots(db.getSnapshots());
      }
    }
  };

  const handleResetToSample = () => {
    if (window.confirm('Reset database to realistic MTG sample inventory? An auto-snapshot will be saved first.')) {
      playSound('success');
      db.resetToSample();
      setSnapshots(db.getSnapshots());
      setImportStatus('Database successfully reset to initial seed data.');
    }
  };

  const handleTestSound = () => {
    playSound('pull');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-theme-subtle border border-theme-subtle">
              <Palette className="h-5 w-5 text-theme-primary" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">ArcaWMS Settings & Preferences</h2>
              <p className="text-[11px] text-slate-400">Customization, automatic backups, and cross-device sync.</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* SECTION 1: 10 MTG GUILD COLOR PAIRS */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-theme-primary" />
              <span className="text-xs font-mono uppercase text-slate-300 font-bold">
                INTERFACE THEME (10 MTG GUILDS):
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Synced across devices</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {GUILD_THEMES.map((theme) => {
              const isSelected = activeThemeId === theme.id;

              return (
                <button
                  key={theme.id}
                  onClick={() => handleSelectTheme(theme.id)}
                  className={`p-2 rounded-xl border text-left transition flex flex-col justify-between gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800 border-theme-primary shadow-sm ring-1 ring-theme-primary'
                      : 'bg-slate-950/70 border-slate-800 hover:bg-slate-850 hover:border-slate-700'
                  }`}
                  title={`${theme.name} (${theme.colors}): ${theme.description}`}
                >
                  {/* Swatch color dots */}
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center -space-x-1">
                      <div
                        className="h-3.5 w-3.5 rounded-full border border-slate-900 shadow-sm"
                        style={{ backgroundColor: theme.primaryHex }}
                      />
                      <div
                        className="h-3.5 w-3.5 rounded-full border border-slate-900 shadow-sm"
                        style={{ backgroundColor: theme.accentHex }}
                      />
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-theme-primary" />}
                  </div>

                  <div>
                    <div className="text-xs font-bold text-white leading-tight">{theme.name}</div>
                    <div className="text-[10px] font-mono text-slate-400">{theme.guild}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* SECTION 2: BACKUPS & PROTECTION */}
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-mono uppercase text-slate-300 font-bold">
                DATA PROTECTION & ARCHIVE:
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Offline & Export</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* JSON Export */}
            <button
              onClick={handleExportJSON}
              className="p-3 rounded-xl bg-slate-950/90 hover:bg-slate-800 text-xs font-medium text-slate-200 flex flex-col items-center justify-center gap-1.5 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            >
              <Download className="h-4 w-4 text-theme-primary" />
              <span className="font-bold">Export JSON</span>
              <span className="text-[10px] text-slate-500">Full system backup</span>
            </button>

            {/* CSV Export */}
            <button
              onClick={handleExportCSV}
              className="p-3 rounded-xl bg-slate-950/90 hover:bg-slate-800 text-xs font-medium text-slate-200 flex flex-col items-center justify-center gap-1.5 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              <span className="font-bold">Export CSV</span>
              <span className="text-[10px] text-slate-500">Universal spreadsheet</span>
            </button>

            {/* JSON Import */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-3 rounded-xl bg-slate-950/90 hover:bg-slate-800 text-xs font-medium text-slate-200 flex flex-col items-center justify-center gap-1.5 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
            >
              <Upload className="h-4 w-4 text-sky-400" />
              <span className="font-bold">Import Backup</span>
              <span className="text-[10px] text-slate-500">Restore from JSON</span>
            </button>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".json"
            className="hidden"
          />

          {importStatus && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-theme-primary font-mono">
              {importStatus}
            </div>
          )}

          {/* Rolling Auto-Restore Snapshots */}
          {snapshots.length > 0 && (
            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 space-y-2">
              <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-500" />
                <span>Automatic Rolling Restore Points:</span>
              </span>
              <div className="space-y-1.5">
                {snapshots.slice(0, 3).map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900 border border-slate-850"
                  >
                    <div>
                      <span className="font-bold text-white mr-2">{snap.label}</span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        ({snap.cardCount} cards) • {new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRestoreSnapshot(snap.id, snap.label)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono text-theme-primary hover:underline cursor-pointer"
                    >
                      Restore ↺
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SECTION 3: REAL-TIME CROSS-DEVICE SYNC */}
        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-slate-400 font-bold flex items-center gap-1.5">
              <Wifi className="h-4 w-4 text-theme-primary" />
              <span>Real-Time Cloud / LAN Sync:</span>
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold flex items-center gap-1.5 ${
              syncStatus === 'connected'
                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                : syncStatus === 'connecting'
                ? 'bg-amber-950/80 text-amber-400 border border-amber-800'
                : 'bg-slate-800 text-slate-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                syncStatus === 'connected' ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'
              }`} />
              <span className="uppercase">{syncStatus}</span>
            </span>
          </div>

          <div className="text-xs text-slate-300 space-y-1">
            <p className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-theme-primary shrink-0" />
              <span>
                Simultaneous real-time sync across <strong>iPhone, iPad, and Desktop</strong>.
              </span>
            </p>
            <p className="text-[11px] text-slate-500">
              Pulls and pushes inventory instantly over WebSockets. If offline, changes queue and sync upon reconnecting.
            </p>
          </div>

          <button
            onClick={() => { syncClient.forceReconnect(); playSound('click'); }}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-xs font-mono text-slate-200 border border-slate-700 transition cursor-pointer"
          >
            Force Reconnect Sync
          </button>
        </div>

        {/* SECTION 4: TACTILE AUDIO & SEED RESET */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={handleTestSound}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <Volume2 className="h-4 w-4 text-theme-primary" />
            <span>Test Ergonomic Sound</span>
          </button>

          <button
            onClick={handleResetToSample}
            className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Sample Data</span>
          </button>
        </div>
      </div>
    </div>
  );
};

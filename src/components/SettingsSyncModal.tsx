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
  ChevronRight,
  Sparkles,
  Boxes,
  Plus,
  Minus,
  CheckCircle2
} from 'lucide-react';
import { db } from '../services/db';
import { syncClient } from '../services/sync';
import { playSound } from '../services/audio';
import { GUILD_THEMES, GuildThemeId, applyTheme, getActiveTheme } from '../services/theme';
import { enrichMissingCards } from '../services/scryfall';

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; timestamp: string; label: string; cardCount: number }>>([]);
  const [unitCount, setUnitCount] = useState<number>(() => db.getUnitCount());
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRefreshMetadata = async () => {
    playSound('click');
    setIsRefreshing(true);
    setImportStatus('Contacting Scryfall CDN to resolve images & prices...');
    try {
      const updated = await enrichMissingCards();
      playSound('success');
      setImportStatus(`Successfully updated images & prices for ${updated} cards!`);
    } catch {
      playSound('error');
      setImportStatus('Failed to refresh some card data. Check internet connection.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddUnit = () => {
    playSound('success');
    const newCount = db.addUnit();
    setUnitCount(newCount);
    setImportStatus(`Added Unit ${newCount} to the Chaos Cabinet!`);
  };

  const handleRemoveLastUnit = () => {
    if (db.canRemoveUnit(unitCount)) {
      if (window.confirm(`Remove empty Unit ${unitCount}?`)) {
        playSound('click');
        db.removeLastUnit();
        setUnitCount(db.getUnitCount());
        setImportStatus(`Removed Unit ${unitCount}.`);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActiveThemeId(getActiveTheme());
      setSnapshots(db.getSnapshots());
      setUnitCount(db.getUnitCount());
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
    try {
      playSound('click');
      const jsonStr = db.exportJSON();
      const fileName = `arcawms-backup-${new Date().toISOString().split('T')[0]}.json`;
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      playSound('success');
      setExportFeedback({
        type: 'success',
        message: `Successfully generated and downloaded ${fileName}`
      });
      setTimeout(() => setExportFeedback(null), 6000);
    } catch (err: any) {
      playSound('error');
      setExportFeedback({
        type: 'error',
        message: `Failed to export JSON: ${err.message}`
      });
    }
  };

  const handleExportCSV = () => {
    try {
      playSound('click');
      const csvStr = db.exportCSV();
      const fileName = `arcawms-collection-${new Date().toISOString().split('T')[0]}.csv`;
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      playSound('success');
      setExportFeedback({
        type: 'success',
        message: `Successfully generated and downloaded ${fileName}`
      });
      setTimeout(() => setExportFeedback(null), 6000);
    } catch (err: any) {
      playSound('error');
      setExportFeedback({
        type: 'error',
        message: `Failed to export CSV: ${err.message}`
      });
    }
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

        {/* SECTION 2: PHYSICAL STORAGE CONFIGURATION */}
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-mono uppercase text-slate-300 font-bold">
                CHAOS CABINET CONFIGURATION:
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Dynamic storage</span>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>Active Storage Units:</span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-black text-xs border border-amber-500/40">
                  {unitCount} Units ({unitCount * 3} Drawers)
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Each unit has 3 drawers (A = Left, B = Middle, C = Right) with unlimited batch dividers.
              </p>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                onClick={handleAddUnit}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs flex items-center gap-1.5 shadow transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Add Unit {unitCount + 1}</span>
              </button>

              {unitCount > 1 && db.canRemoveUnit(unitCount) && (
                <button
                  onClick={handleRemoveLastUnit}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800 font-mono text-xs flex items-center gap-1 transition cursor-pointer"
                  title={`Remove empty Unit ${unitCount}`}
                >
                  <Minus className="h-3 w-3" />
                  <span>Remove Unit</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 3: BACKUPS & PROTECTION */}
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

          {/* Export / Download Feedback Confirmation Banner */}
          {exportFeedback && (
            <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-2 shadow-lg transition-all animate-in fade-in slide-in-from-top-1 ${
              exportFeedback.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300'
                : 'bg-rose-950/80 border-rose-500/80 text-rose-300'
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="font-bold truncate">{exportFeedback.message}</span>
              </div>
              <button
                onClick={() => setExportFeedback(null)}
                className="p-1 text-slate-400 hover:text-white rounded cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Refresh Images & Prices on Demand */}
          <button
            onClick={handleRefreshMetadata}
            disabled={isRefreshing}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-950 hover:bg-slate-850 text-xs font-mono text-slate-300 hover:text-white border border-slate-800 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`h-3.5 w-3.5 text-theme-primary ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Resolving Scryfall CDN images & prices...' : 'Refresh Missing Card Images & Market Prices'}</span>
          </button>

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

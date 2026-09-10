import React from 'react';
import { PlusCircle, RotateCcw, Eye, LayoutGrid } from 'lucide-react';
import { WindowConfig } from '../types';

interface HiddenWindowsDockProps {
  hiddenWindows: WindowConfig[];
  onRestore: (id: number) => void;
  onRestoreAll: () => void;
}

export const HiddenWindowsDock: React.FC<HiddenWindowsDockProps> = ({
  hiddenWindows,
  onRestore,
  onRestoreAll,
}) => {
  if (hiddenWindows.length === 0) return null;

  return (
    <div
      id="hidden-windows-dock"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 bg-[#172134]/95 backdrop-blur-md border border-slate-700/80 rounded-full shadow-2xl animate-fade-in text-slate-200"
    >
      <div className="flex items-center gap-1.5 text-xs text-slate-400 pl-1 font-mono">
        <Eye className="w-3.5 h-3.5 text-amber-400" />
        <span>已隐藏视窗:</span>
      </div>

      <div className="flex items-center gap-1.5">
        {hiddenWindows.map((win) => (
          <button
            key={win.id}
            onClick={() => onRestore(win.id)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-900/90 border border-sky-500/40 text-sky-400 hover:bg-sky-950/60 hover:border-sky-400 text-xs font-mono transition-all"
            title={`恢复视窗 ${win.id} (${win.title})`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>恢复 {win.title}</span>
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-slate-700/60 mx-0.5" />

      <button
        onClick={onRestoreAll}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-900/80 text-xs font-mono font-medium transition-all"
        title="全部恢复并均分 1:1:1"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span>恢复 1:1:1 均分</span>
      </button>
    </div>
  );
};

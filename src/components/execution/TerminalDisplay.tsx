import React from 'react';
import { LogMessage } from '../../types';
import { Terminal, Minimize2, Maximize2, Cpu, Activity, Play, CheckCircle2, AlertTriangle, ShieldAlert, ArrowRight } from 'lucide-react';

interface TerminalDisplayProps {
  logs: LogMessage[];
  isFullscreen: boolean;
  setIsFullscreen: (val: boolean) => void;
  isActive: boolean;
  onSelectTicker?: (ticker: string) => void;
  terminalContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function TerminalDisplay({
  logs,
  isFullscreen,
  setIsFullscreen,
  isActive,
  onSelectTicker,
  terminalContainerRef
}: TerminalDisplayProps) {
  return (
    <div className={isFullscreen 
      ? "fixed inset-0 z-50 bg-black p-6 md:p-8 font-mono text-xs flex flex-col justify-between" 
      : "rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs shadow-inner"
    }>
      <div className="flex items-center justify-between mb-2 text-zinc-500 border-b border-zinc-900 pb-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-500" />
          <span className="font-bold text-zinc-200 text-sm md:text-base">
            Tape-Reading Terminal {isFullscreen && <span className="text-zinc-500 font-normal"> (Fullscreen)</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
            isActive 
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 animate-pulse' 
              : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
          }`}>
            {isActive ? 'Live Feed' : 'Offline'}
          </span>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flex items-center gap-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-1 text-xs font-bold text-zinc-300 hover:text-white transition-all shadow-sm focus:outline-none"
            title={isFullscreen ? "Exit Fullscreen (Esc)" : "Maximize Terminal"}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Exit <span className="hidden sm:inline text-[10px] text-zinc-500 font-normal ml-0.5">[Esc]</span></span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Full Screen</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div 
        ref={terminalContainerRef} 
        className={isFullscreen 
          ? "flex-1 overflow-y-auto space-y-3 my-4 pr-2 custom-scrollbar" 
          : "h-96 min-h-[16rem] max-h-[1200px] resize-y overflow-y-auto space-y-2 pr-1 custom-scrollbar"
        }
      >
        {logs.length === 0 ? (
          <div className="text-zinc-600 italic h-full flex items-center justify-center text-center px-4">
            Click "Start Engine" above to run the live execution algorithm. Click any logged trade row to view stock quote and news!
          </div>
        ) : (
          logs.map((log) => {
            let icon = <Cpu className="h-3 w-3 text-zinc-500" />;
            let textColor = 'text-zinc-400';

            if (log.type === 'scan') {
              icon = <Activity className="h-3 w-3 text-cyan-400 animate-pulse" />;
              textColor = 'text-cyan-400';
            } else if (log.type === 'found') {
              icon = <Cpu className="h-3 w-3 text-yellow-400" />;
              textColor = 'text-yellow-300 font-bold';
            } else if (log.type === 'exec') {
              icon = <Play className="h-3 w-3 text-emerald-400" />;
              textColor = 'text-emerald-400 font-bold';
            } else if (log.type === 'success') {
              icon = <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
              textColor = 'text-emerald-500 font-extrabold';
            } else if (log.type === 'fail') {
              icon = <AlertTriangle className="h-3 w-3 text-rose-500" />;
              textColor = 'text-rose-400 font-bold';
            } else if (log.type === 'warn') {
              icon = <ShieldAlert className="h-3 w-3 text-orange-400" />;
              textColor = 'text-orange-300';
            } else if (log.type === 'error') {
              icon = <AlertTriangle className="h-3 w-3 text-red-600" />;
              textColor = 'text-red-500 font-bold bg-red-500/10 px-1 rounded';
            }

            return (
              <div
                key={log.id}
                onClick={() => log.ticker && onSelectTicker?.(log.ticker)}
                className={`flex gap-2 items-start leading-relaxed border-b border-zinc-950 pb-1.5 pt-0.5 group transition-colors ${
                  log.ticker 
                    ? 'cursor-pointer hover:bg-zinc-950/80 px-1 rounded' 
                    : ''
                }`}
                title={log.ticker ? `Click to inspect $${log.ticker} details` : undefined}
              >
                <span className="text-zinc-600 flex-shrink-0 select-none font-mono text-xs md:text-sm">[{log.time}]</span>
                <span className="flex-shrink-0 mt-1">{icon}</span>
                <span className={`${textColor} flex-1 ${isFullscreen ? 'whitespace-normal break-words text-sm md:text-base font-medium' : 'truncate'}`}>
                  {log.text}
                </span>
                
                {log.ticker && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/25 font-sans select-none flex items-center gap-1 font-semibold flex-shrink-0">
                    Research {log.ticker}
                    <ArrowRight className="h-2.5 w-2.5" />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {isFullscreen && (
        <div className="flex items-center justify-between text-[10px] text-zinc-500 border-t border-zinc-900 pt-2 font-mono">
          <span>Click any log row with a stock ticker to automatically view real-time charts and cataloged news.</span>
          <span className="hidden md:inline">Press <kbd className="bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-800">Esc</kbd> key to exit</span>
        </div>
      )}
    </div>
  );
}

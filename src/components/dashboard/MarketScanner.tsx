import React from 'react';
import { MarketGainer } from '../../types';
import { Activity, ArrowRight } from 'lucide-react';

interface MarketScannerProps {
  gainers: MarketGainer[];
  loadingGainers: boolean;
  isScannerHours: boolean;
  onSelectGainer: (symbol: string) => void;
}

export function MarketScanner({
  gainers,
  loadingGainers,
  isScannerHours,
  onSelectGainer
}: MarketScannerProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Activity className={`h-5 w-5 ${isScannerHours ? 'text-emerald-500' : 'text-zinc-500'}`} />
            Live Top Gainers
          </h2>
          <p className="text-xs text-zinc-500">9:30 AM - 4:00 PM EST (Mon-Fri)</p>
        </div>
        {loadingGainers && (
          <div className="text-xs text-emerald-400 flex items-center gap-2 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20 animate-pulse">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Scanning Market...
          </div>
        )}
        {!isScannerHours && (
          <div className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded font-medium border border-zinc-700">
            Scanner Off-hours
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {!isScannerHours ? (
          <div className="text-center text-zinc-400 py-8 px-4 text-sm border border-dashed border-zinc-800 rounded-lg bg-zinc-950/20 leading-relaxed">
            The automated live gainer scanner operates during regular market hours:<br />
            <strong className="text-emerald-400">9:30 AM - 4:00 PM EST, Monday through Friday</strong>.<br />
            <span className="text-xs text-zinc-500 mt-2 block">
              Outside of these hours, use the Live Execution Engine above to simulate continuous active trading.
            </span>
          </div>
        ) : gainers.length === 0 && !loadingGainers ? (
          <div className="text-center text-zinc-500 py-6 text-sm bg-zinc-950/25 rounded-lg border border-zinc-800">
            No major market gainers tracked in this slot.
          </div>
        ) : (
          <div className="flex gap-4 pb-2 overflow-x-auto custom-scrollbar">
            {gainers.map((gainer) => (
              <button
                key={gainer.symbol}
                onClick={() => onSelectGainer(gainer.symbol)}
                className="flex-shrink-0 w-44 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-left transition-all hover:border-emerald-500 hover:bg-zinc-900 cursor-pointer focus:outline-none"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-white text-base">{gainer.symbol}</span>
                  <span className="text-xs font-bold text-emerald-400">
                    +{gainer.changesPercentage.toFixed(1)}%
                  </span>
                </div>
                <div className="text-base font-bold text-zinc-100 mb-1">
                  ${gainer.price.toFixed(2)}
                </div>
                <div className="text-[10px] text-zinc-500 truncate" title={gainer.name}>
                  {gainer.name}
                </div>
                <div className="mt-2 text-[9px] text-zinc-400 bg-zinc-900/80 px-1.5 py-0.5 rounded flex items-center justify-between">
                  <span>Scan Detail</span>
                  <ArrowRight className="h-2.5 w-2.5 text-zinc-600" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

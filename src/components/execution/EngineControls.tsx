import React from 'react';
import { UserPreferences } from '../../types';
import { Activity, Play, Square } from 'lucide-react';

interface EngineControlsProps {
  isActive: boolean;
  onToggleActive: () => void;
  positionSize: string;
  onChangePositionSize: (val: string) => void;
  onSavePreferences: () => void;
  speed: number;
  onChangeSpeed: (val: number) => void;
  preferences: UserPreferences;
  connectionStatus: 'success' | 'failed' | 'none';
  balance: number;
}

export function EngineControls({
  isActive,
  onToggleActive,
  positionSize,
  onChangePositionSize,
  onSavePreferences,
  speed,
  onChangeSpeed,
  preferences,
  connectionStatus,
  balance
}: EngineControlsProps) {
  const getBrokerageLabel = (brokerage?: string) => {
    if (brokerage === 'robinhood') return 'Robinhood';
    if (brokerage === 'interactivebrokers') return 'IBKR';
    if (brokerage === 'lightspeed') return 'Lightspeed';
    return 'Simulation';
  };

  return (
    <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-4">
      <div className="flex items-center gap-2">
        <Activity className={`h-5 w-5 ${isActive ? 'text-emerald-500 animate-pulse' : 'text-zinc-500'}`} />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold tracking-tight text-white">Live Execution Engine</h2>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
              connectionStatus === 'success'
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : connectionStatus === 'failed'
                ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                : 'text-zinc-400 bg-zinc-900 border-zinc-800'
            }`}>
              {connectionStatus === 'success'
                ? `${getBrokerageLabel(preferences.brokerage)} Connected`
                : connectionStatus === 'failed'
                ? `${getBrokerageLabel(preferences.brokerage)} Offline`
                : 'Simulated Mode'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 flex items-center gap-1.5 flex-wrap">
            <span>Automated real-time scanner & executor.</span>
            <span className="text-zinc-600">&bull;</span>
            {connectionStatus === 'success' ? (
              <span>Real Balance: ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            ) : connectionStatus === 'failed' ? (
              <span className="text-rose-400 font-semibold">Offline / Connection Failed</span>
            ) : (
              <span>
                Simulated Balance: ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className={`font-semibold ${balance >= 10000 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ({balance >= 10000 ? '+' : ''}{(((balance - 10000) / 10000) * 100).toFixed(2)}% P/L)
                </span>
              </span>
            )}
          </p>
        </div>
      </div>
      
      <button
        onClick={onToggleActive}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all shadow-md focus:outline-none ${
          isActive 
            ? 'bg-rose-600 hover:bg-rose-500 text-white' 
            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
        }`}
      >
        {isActive ? (
          <>
            <Square className="h-4 w-4 fill-current" />
            Stop Engine
          </>
        ) : (
          <>
            <Play className="h-4 w-4 fill-current" />
            Start Engine
          </>
        )}
      </button>
    </div>
  );
}

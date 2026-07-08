import React from 'react';
import { UserPreferences, LowFloatTicker } from '../../types';
import { Filter } from 'lucide-react';

interface FilterSettingsProps {
  showPreferences: boolean;
  setShowPreferences: (val: boolean) => void;
  preferences: UserPreferences;
  onSavePreferences: (newPrefs: UserPreferences) => void;
  connectionStatus: 'success' | 'failed' | 'none';
  blacklistedInput: string;
  setBlacklistedInput: (val: string) => void;
  isActive: boolean;
  lowFloatTickers: LowFloatTicker[];
}

export function FilterSettings({
  showPreferences,
  setShowPreferences,
  preferences,
  onSavePreferences,
  connectionStatus,
  blacklistedInput,
  setBlacklistedInput,
  isActive,
  lowFloatTickers
}: FilterSettingsProps) {
  const getBrokerageLabel = (brokerage?: string) => {
    if (brokerage === 'robinhood') return 'Robinhood';
    if (brokerage === 'interactivebrokers') return 'IBKR';
    if (brokerage === 'lightspeed') return 'Lightspeed';
    return 'Simulation';
  };

  const handleMarketChange = (market: string, isChecked: boolean) => {
    let updatedMarkets;
    if (isChecked) {
      updatedMarkets = preferences.markets.filter((m) => m !== market);
    } else {
      updatedMarkets = [...preferences.markets, market];
    }
    onSavePreferences({
      ...preferences,
      markets: updatedMarkets
    });
  };

  const handleBlacklistBlur = () => {
    const tickers = blacklistedInput
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s);
    onSavePreferences({
      ...preferences,
      blacklistedTickers: tickers
    });
  };

  const handleRobinhoodOnlyChange = (checked: boolean) => {
    onSavePreferences({
      ...preferences,
      robinhoodOnly: checked
    });
  };

  const filteredCount = lowFloatTickers.filter((item) => {
    const marketMatch = preferences.markets.includes(item.market);
    const rhMatch = !preferences.robinhoodOnly || item.onRobinhood;
    return marketMatch && rhMatch;
  }).length;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setShowPreferences(!showPreferences)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors focus:outline-none"
      >
        <span className="flex items-center gap-1.5 font-sans">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          Stock Markets & Platform Restrictions
        </span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
          connectionStatus === 'success'
            ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
            : connectionStatus === 'failed'
            ? 'text-rose-500 bg-rose-500/10 border-rose-500/20'
            : 'text-zinc-400 bg-zinc-900 border-zinc-800'
        }`}>
          {connectionStatus === 'success'
            ? `${getBrokerageLabel(preferences.brokerage)} Connected`
            : connectionStatus === 'failed'
            ? `${getBrokerageLabel(preferences.brokerage)} Connection Failed`
            : 'Simulation Mode'}
        </span>
      </button>

      {showPreferences && (
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 space-y-4 animate-fadeIn">
          {/* Markets Checklist */}
          <div>
            <span className="block text-xs font-bold text-zinc-300 mb-2">Enable / Disable Stock Markets:</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {['NASDAQ', 'NYSE', 'OTC', 'Foreign', 'Warrants'].map((market) => {
                const isChecked = preferences.markets.includes(market);
                return (
                  <label key={market} className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleMarketChange(market, isChecked)}
                      className="rounded border-zinc-800 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>{market}</span>
                    {market === 'NASDAQ' || market === 'NYSE' ? (
                      <span className="text-[9px] text-zinc-600 bg-zinc-900 px-1 rounded">Listed</span>
                    ) : (
                      <span className="text-[9px] text-amber-500/80 bg-amber-500/10 px-1 rounded border border-amber-500/10">Special</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Blacklisted Tickers */}
          <div className="border-t border-zinc-800 pt-3 mb-3">
            <span className="block text-xs font-bold text-zinc-300 mb-2">Blacklisted Tickers (Do Not Trade):</span>
            <input
              type="text"
              value={blacklistedInput}
              onChange={(e) => setBlacklistedInput(e.target.value)}
              onBlur={handleBlacklistBlur}
              placeholder="AAPL, TSLA, NVDA"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
            <p className="text-[10px] text-zinc-500 mt-1">If provided, the engine will NEVER trade these stocks to protect your existing positions.</p>
          </div>

          {/* Platform restrictions */}
          <div className="border-t border-zinc-800 pt-3">
            <span className="block text-xs font-bold text-zinc-300 mb-2">Platform Compatibility Filter:</span>
            <label className="flex items-start gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={preferences.robinhoodOnly}
                onChange={(e) => handleRobinhoodOnlyChange(e.target.checked)}
                className="mt-0.5 rounded border-zinc-800 bg-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0"
              />
              <div>
                <span className="font-semibold text-zinc-300">Robinhood Platform Compatible Only</span>
                <p className="text-[10px] text-zinc-500 leading-normal mt-0.5">
                  Filter out OTC markets, warrants, and foreign dual-listed tickers that are not tradable on Robinhood. Disable this to simulate the entire small-cap universe.
                </p>
              </div>
            </label>
          </div>
          
          {/* Filtered Count Info */}
          <div className="text-[10px] text-zinc-500 bg-zinc-900/40 p-2 rounded border border-zinc-900 flex justify-between items-center">
            <span>Matching stocks: <strong className="text-zinc-300">{filteredCount} / {lowFloatTickers.length}</strong></span>
            <span>Cloud Saved Settings</span>
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { UserPreferences } from '../../types';
import { X, Check, RefreshCw } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  setPreferences: React.Dispatch<React.SetStateAction<UserPreferences>>;
  onSave: (newPrefs: UserPreferences) => Promise<void>;
  savingPrefs: boolean;
  rhUsername: string;
  setRhUsername: (val: string) => void;
  rhPassword: string;
  setRhPassword: (val: string) => void;
  rhValidating: boolean;
  rhMessage: { type: 'error' | 'success'; text: string } | null;
  onValidateRobinhood: () => Promise<void>;
}

export function SettingsModal({
  isOpen,
  onClose,
  preferences,
  setPreferences,
  onSave,
  savingPrefs,
  rhUsername,
  setRhUsername,
  rhPassword,
  setRhPassword,
  rhValidating,
  rhMessage,
  onValidateRobinhood
}: SettingsModalProps) {
  if (!isOpen) return null;

  const handleResetStrategy = () => {
    setPreferences({
      ...preferences,
      minPrice: 2.0,
      maxPrice: 20.0,
      minGainPercent: 10,
      minRvol: 5.0,
      maxFloatMillions: 20,
      maxStopDistance: 0.20,
      minStopDistance: 0.05,
      minRewardRiskRatio: 2.0,
      maxProximityPercent: 2.0,
      simulationSpeed: 6000,
      catalystValidation: 'gemini',
      checkPriceRange: true,
      checkDailyGain: true,
      checkRelativeVol: true,
      checkSharesFloat: true,
      checkTradingWindow: true,
      checkBullFlagPattern: true,
      checkStopDistance: true,
      checkRiskReward: true,
      maxFlagpoleRedCandles: 1,
      maxPullbackGreenCandles: 1
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl relative animate-fadeIn">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-100 focus:outline-none"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="mb-6 text-xl font-bold text-zinc-100">Settings</h2>
        
        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">
              Strategy & Engine Tweaks
            </label>
            <div className="space-y-4 mb-6 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-zinc-400">Configure core momentum filters and risk</span>
                <button
                  onClick={handleResetStrategy}
                  className="flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-400"
                  type="button"
                >
                  <RefreshCw className="h-3 w-3" /> Reset Defaults
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Min Price ($)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={preferences.minPrice ?? 2.0}
                    onChange={(e) => setPreferences({ ...preferences, minPrice: parseFloat(e.target.value) || 2.0 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Price ($)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={preferences.maxPrice ?? 20.0}
                    onChange={(e) => setPreferences({ ...preferences, maxPrice: parseFloat(e.target.value) || 20.0 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Min Daily Gain (%)</label>
                  <input
                    type="number"
                    value={preferences.minGainPercent ?? 10}
                    onChange={(e) => setPreferences({ ...preferences, minGainPercent: parseFloat(e.target.value) || 10 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Min RVOL (x)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={preferences.minRvol ?? 5.0}
                    onChange={(e) => setPreferences({ ...preferences, minRvol: parseFloat(e.target.value) || 5.0 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Float (M)</label>
                  <input
                    type="number"
                    value={preferences.maxFloatMillions ?? 20}
                    onChange={(e) => setPreferences({ ...preferences, maxFloatMillions: parseFloat(e.target.value) || 20 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Stop Dist ($)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={preferences.maxStopDistance ?? 0.20}
                    onChange={(e) => setPreferences({ ...preferences, maxStopDistance: parseFloat(e.target.value) || 0.20 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Min R:R Ratio</label>
                  <input
                    type="number"
                    step="0.5"
                    value={preferences.minRewardRiskRatio ?? 2.0}
                    onChange={(e) => setPreferences({ ...preferences, minRewardRiskRatio: parseFloat(e.target.value) || 2.0 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Engine Speed (ms)</label>
                  <input
                    type="number"
                    step="1000"
                    value={preferences.simulationSpeed ?? 6000}
                    onChange={(e) => setPreferences({ ...preferences, simulationSpeed: parseInt(e.target.value) || 6000 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Min Stop Dist ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={preferences.minStopDistance ?? 0.05}
                    onChange={(e) => setPreferences({ ...preferences, minStopDistance: parseFloat(e.target.value) || 0.05 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Proximity (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={preferences.maxProximityPercent ?? 2.0}
                    onChange={(e) => setPreferences({ ...preferences, maxProximityPercent: parseFloat(e.target.value) || 2.0 })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Flagpole Red Candles</label>
                  <input
                    type="number"
                    min="0"
                    max="3"
                    value={preferences.maxFlagpoleRedCandles ?? 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setPreferences({ ...preferences, maxFlagpoleRedCandles: isNaN(val) ? 0 : val });
                    }}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Max Pullback Green Candles</label>
                  <input
                    type="number"
                    min="0"
                    max="4"
                    value={preferences.maxPullbackGreenCandles ?? 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setPreferences({ ...preferences, maxPullbackGreenCandles: isNaN(val) ? 0 : val });
                    }}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <label className="block text-sm font-medium text-zinc-300 mb-3 mt-4">
              Entrance Checklist Filters
            </label>
            <div className="space-y-4 mb-6 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
              <span className="text-[10px] text-zinc-400 block mb-1">Enable or disable checks in the buy entrance evaluation:</span>
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-zinc-800/40">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkPriceRange ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkPriceRange: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>1. Price Range</span>
                </label>
                
                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkDailyGain ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkDailyGain: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>2. Daily Gain</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkRelativeVol ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkRelativeVol: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>3. Relative Vol</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkSharesFloat ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkSharesFloat: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>4. Shares Float</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkTradingWindow ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkTradingWindow: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>5. Trading Window</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkBullFlagPattern ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkBullFlagPattern: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>6. Bull Flag Pattern</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkStopDistance ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkStopDistance: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>7. Stop Distance</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={preferences.checkRiskReward ?? true}
                    onChange={(e) => setPreferences({ ...preferences, checkRiskReward: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-900"
                  />
                  <span>8. Risk/Reward</span>
                </label>
              </div>

              <div className="space-y-2 pt-1">
                <label className="block text-xs font-semibold text-zinc-400">9. Catalyst &amp; News Validation</label>
                <div className="flex flex-col gap-2 bg-zinc-950/40 p-2.5 rounded border border-zinc-800/40" onClick={(e) => e.stopPropagation()}>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                    <input
                      type="radio"
                      name="catalystValidation"
                      value="gemini"
                      checked={(preferences.catalystValidation ?? 'gemini') === 'gemini'}
                      onChange={() => setPreferences({ ...preferences, catalystValidation: 'gemini' })}
                      className="h-4 w-4 border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                    />
                    <span>Gemini Sentiment</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                    <input
                      type="radio"
                      name="catalystValidation"
                      value="keywords"
                      checked={preferences.catalystValidation === 'keywords'}
                      onChange={() => setPreferences({ ...preferences, catalystValidation: 'keywords' })}
                      className="h-4 w-4 border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                    />
                    <span>Keywords Only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
                    <input
                      type="radio"
                      name="catalystValidation"
                      value="bypassed"
                      checked={preferences.catalystValidation === 'bypassed'}
                      onChange={() => setPreferences({ ...preferences, catalystValidation: 'bypassed' })}
                      className="h-4 w-4 border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                    />
                    <span>Bypassed (Technical Breakout Only)</span>
                  </label>
                </div>
              </div>
            </div>

            <label className="block text-sm font-medium text-zinc-300 mb-3 mt-4">
              Brokerage Connection
            </label>
            <div className="space-y-3">
              <label className="flex items-center gap-3 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-900 cursor-pointer select-none">
                <input
                  type="radio"
                  name="brokerage"
                  value="none"
                  checked={preferences.brokerage === 'none'}
                  onChange={() => setPreferences({ ...preferences, brokerage: 'none' })}
                  className="h-4 w-4 rounded-full border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                />
                <span className="text-sm text-zinc-200">No Connection (Simulated Mode)</span>
              </label>
              <label className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-900 cursor-pointer select-none">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="brokerage"
                    value="lightspeed"
                    checked={preferences.brokerage === 'lightspeed'}
                    onChange={() => setPreferences({ ...preferences, brokerage: 'lightspeed' })}
                    className="h-4 w-4 rounded-full border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                  />
                  <span className="text-sm text-zinc-200">Lightspeed</span>
                </div>
                {preferences.brokerage === 'lightspeed' && (
                  <div className="pl-7 pt-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="password"
                      placeholder="Lightspeed API Key"
                      value={preferences.lightspeedKey || ''}
                      onChange={(e) => setPreferences({ ...preferences, lightspeedKey: e.target.value })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </label>
              <label className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-900 cursor-pointer select-none">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="brokerage"
                    value="robinhood"
                    checked={preferences.brokerage === 'robinhood'}
                    onChange={() => setPreferences({ ...preferences, brokerage: 'robinhood' })}
                    className="h-4 w-4 rounded-full border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                  />
                  <span className="text-sm text-zinc-200">Robinhood</span>
                </div>
                {preferences.brokerage === 'robinhood' && (
                  <div className="pl-7 pt-2 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-col gap-2 p-3 bg-zinc-950/50 rounded border border-zinc-800">
                      <span className="text-xs font-medium text-zinc-300">Login to Robinhood</span>
                      <input
                        type="text"
                        placeholder="Username / Email"
                        value={rhUsername}
                        onChange={(e) => setRhUsername(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={rhPassword}
                        onChange={(e) => setRhPassword(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={onValidateRobinhood}
                        disabled={rhValidating || !rhUsername || !rhPassword}
                        className="mt-1 w-full rounded bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/20 transition-colors focus:outline-none"
                      >
                        {rhValidating ? 'Validating...' : 'Validate Credentials'}
                      </button>
                      {rhMessage && (
                        <div className={`text-xs p-2 rounded ${rhMessage.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                          {rhMessage.text}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-zinc-500">Or manually enter Bearer Token:</span>
                      <input
                        type="password"
                        placeholder="Robinhood Bearer Token"
                        value={preferences.robinhoodToken || ''}
                        onChange={(e) => setPreferences({ ...preferences, robinhoodToken: e.target.value })}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      {preferences.robinhoodToken && (
                        <span className="text-xs text-emerald-500 flex items-center gap-1 mt-1 font-semibold">
                          <Check className="w-3 h-3 text-emerald-500" /> Token configured
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </label>
              <label className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-900 cursor-pointer select-none">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="brokerage"
                    value="interactivebrokers"
                    checked={preferences.brokerage === 'interactivebrokers'}
                    onChange={() => setPreferences({ ...preferences, brokerage: 'interactivebrokers' })}
                    className="h-4 w-4 rounded-full border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-zinc-950"
                  />
                  <span className="text-sm text-zinc-200">Interactive Brokers</span>
                </div>
                {preferences.brokerage === 'interactivebrokers' && (
                  <div className="pl-7 pt-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="url"
                      placeholder="Client Portal Gateway URL (e.g. https://your-ngrok-url.app)"
                      value={preferences.ibkrUrl || ''}
                      onChange={(e) => setPreferences({ ...preferences, ibkrUrl: e.target.value })}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </label>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors focus:outline-none"
            disabled={savingPrefs}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(preferences)}
            disabled={savingPrefs}
            className="flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 focus:outline-none"
          >
            {savingPrefs ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

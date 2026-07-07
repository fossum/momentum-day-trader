import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { Play, Square, Activity, Terminal, ShieldAlert, Cpu, CheckCircle2, AlertTriangle, ArrowRight, Settings, Info, Filter, Check } from 'lucide-react';
import { UserPreferences, LowFloatTicker } from '../types';

interface LogMessage {
  id: string;
  text: string;
  type: 'info' | 'scan' | 'found' | 'exec' | 'success' | 'fail' | 'warn';
  time: string;
  ticker?: string;
}

interface SimulatedTrade {
  ticker: string;
  float: string;
  catalyst: string;
  setup: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  target: number;
  stop: number;
}

const CATALYSTS = [
  'FDA Phase II Approval',
  'Record Earnings Surprise',
  'Strategic Partnership with Tech Giant',
  'Short Squeeze Momentum (RVOL > 5x)',
  'Patent Granted for Next-Gen Tech',
  'Sector Squeeze - Small-cap Solar energy',
  'CEO Insider Buying Confirmed'
];

const LOW_FLOAT_TICKERS: LowFloatTicker[] = [
  // NASDAQ/NYSE (Standard listed - On Robinhood)
  { ticker: 'SMMT', float: '4.2M', market: 'NASDAQ', onRobinhood: true, companyName: 'Summit Therapeutics' },
  { ticker: 'VERB', float: '8.1M', market: 'NASDAQ', onRobinhood: true, companyName: 'Verb Technology' },
  { ticker: 'KOSS', float: '2.5M', market: 'NASDAQ', onRobinhood: true, companyName: 'Koss Corporation' },
  { ticker: 'IMPP', float: '12.4M', market: 'NASDAQ', onRobinhood: true, companyName: 'Imperial Petroleum' },
  { ticker: 'VHAI', float: '15.6M', market: 'NASDAQ', onRobinhood: true, companyName: 'Vocodia Health Group' },
  { ticker: 'PXS', float: '3.1M', market: 'NASDAQ', onRobinhood: true, companyName: 'Pyxis Tankers' },
  { ticker: 'SPCB', float: '5.4M', market: 'NASDAQ', onRobinhood: true, companyName: 'SuperCom Ltd.' },
  { ticker: 'PALT', float: '6.7M', market: 'NASDAQ', onRobinhood: true, companyName: 'Paltalk, Inc.' },
  { ticker: 'HLCO', float: '1.8M', market: 'NASDAQ', onRobinhood: true, companyName: 'Helport Digital' },

  // OTC Markets (Not on Robinhood)
  { ticker: 'CYDY', float: '22.1M', market: 'OTC', onRobinhood: false, companyName: 'CytoDyn Inc.' },
  { ticker: 'HCMC', float: '45.0M', market: 'OTC', onRobinhood: false, companyName: 'Healthier Choices Management' },
  { ticker: 'GTBIF', float: '18.4M', market: 'OTC', onRobinhood: false, companyName: 'Green Thumb Industries' },
  { ticker: 'FNMA', float: '25.0M', market: 'OTC', onRobinhood: false, companyName: 'Fannie Mae' },

  // Foreign ADRs / TSX-listed etc. (May not be on Robinhood, or require OTC/special accounts)
  { ticker: 'TCNNF', float: '14.2M', market: 'Foreign', onRobinhood: false, companyName: 'Trulieve Cannabis' },
  { ticker: 'CURLF', float: '19.1M', market: 'Foreign', onRobinhood: false, companyName: 'Curaleaf Holdings' },
  { ticker: 'ASMLF', float: '3.2M', market: 'Foreign', onRobinhood: false, companyName: 'ASML Ordinary' },

  // Warrants (Not on Robinhood)
  { ticker: 'SMMTW', float: '1.2M', market: 'Warrants', onRobinhood: false, companyName: 'Summit Therapeutics Warrants' },
  { ticker: 'KOSSW', float: '0.8M', market: 'Warrants', onRobinhood: false, companyName: 'Koss Corp Warrants' },
  { ticker: 'SPCBW', float: '1.5M', market: 'Warrants', onRobinhood: false, companyName: 'SuperCom Warrants' }
];

interface DryModeSimulatorProps {
  onSelectTicker?: (ticker: string) => void;
}

export function DryModeSimulator({ onSelectTicker }: DryModeSimulatorProps) {
  const [isActive, setIsActive] = useState(false);
  const [shareSize, setShareSize] = useState<number>(1000);
  const [speed, setSpeed] = useState<number>(6000); // ms per state transition
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [currentTrade, setCurrentTrade] = useState<SimulatedTrade | null>(null);
  const [step, setStep] = useState<number>(0);
  
  const DEFAULT_PREFERENCES: UserPreferences = {
    markets: ['NASDAQ', 'NYSE', 'OTC', 'Warrants', 'Foreign'],
    robinhoodOnly: true
  };

  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [showPreferences, setShowPreferences] = useState(false);
  const preferencesRef = useRef<UserPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const loadPrefs = async () => {
      try {
        const docRef = doc(db, `users/${auth.currentUser?.uid}/preferences`, 'settings');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPreferences(docSnap.data() as UserPreferences);
        } else {
          await setDoc(docRef, DEFAULT_PREFERENCES);
        }
      } catch (err) {
        console.error('Error loading preferences:', err);
      }
    };

    loadPrefs();
  }, []);

  const savePreferences = async (newPrefs: UserPreferences) => {
    if (!auth.currentUser) return;
    try {
      const docRef = doc(db, `users/${auth.currentUser?.uid}/preferences`, 'settings');
      await setDoc(docRef, newPrefs);
      setPreferences(newPrefs);
      addLog('[SYSTEM] Trading preferences updated and saved to cloud.', 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser?.uid}/preferences/settings`);
    }
  };

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const currentTradeRef = useRef<SimulatedTrade | null>(null);

  // Helper to sync ref and state
  const updateCurrentTrade = (trade: SimulatedTrade | null) => {
    currentTradeRef.current = trade;
    setCurrentTrade(trade);
  };

  // Add terminal log helper
  const addLog = (text: string, type: LogMessage['type'] = 'info', ticker?: string) => {
    const newLog: LogMessage = {
      id: Math.random().toString(36).substring(2, 9),
      text,
      type,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ticker
    };
    setLogs((prev) => [...prev.slice(-49), newLog]); // Keep last 50 logs
  };

  // Scroll to bottom of terminal
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Main simulation state machine interval
  useEffect(() => {
    if (!isActive) {
      updateCurrentTrade(null);
      setStep(0);
      return;
    }

    // Initial scan log
    addLog('Ross Cameron momentum engine started.', 'info');
    addLog('Scanning market for low-float gappers priced $2 - $20...', 'scan');

    const runSimulationStep = async () => {
      if (!auth.currentUser) return;

      setStep((prevStep) => {
        let nextStep = (prevStep + 1) % 6;
        const activeTrade = currentTradeRef.current;

        if (prevStep === 3) {
          // 80% chance to hold position and track tape to simulate waiting for a trend
          if (Math.random() < 0.80) {
            nextStep = 3;
          }
        }

        switch (nextStep) {
          case 0: // Scan & find setup
            {
              const currentPrefs = preferencesRef.current;
              const filteredTickers = LOW_FLOAT_TICKERS.filter(item => {
                const marketMatch = currentPrefs.markets.includes(item.market);
                const rhMatch = !currentPrefs.robinhoodOnly || item.onRobinhood;
                return marketMatch && rhMatch;
              });

              let selectedItem;
              if (filteredTickers.length > 0) {
                selectedItem = filteredTickers[Math.floor(Math.random() * filteredTickers.length)];
              } else {
                addLog('[SYSTEM WARNING] No stocks match filter settings! Using NASDAQ defaults.', 'warn');
                const standardTickers = LOW_FLOAT_TICKERS.filter(t => t.market === 'NASDAQ');
                selectedItem = standardTickers[Math.floor(Math.random() * standardTickers.length)];
              }

              const catalyst = CATALYSTS[Math.floor(Math.random() * CATALYSTS.length)];
              const setupType = Math.random() > 0.5 ? 'Bull Flag' : 'Flat Top Breakout';
              const initialPrice = parseFloat((Math.random() * 15 + 2).toFixed(2)); // Midpoint $2 to $17
              
              // Define 0.8% typical spread for high-volatility small cap momentum stocks
              const spreadPercent = 0.008;
              const buyPrice = parseFloat((initialPrice * (1 + spreadPercent / 2)).toFixed(2));
              const sellPriceBase = parseFloat((initialPrice * (1 - spreadPercent / 2)).toFixed(2));

              const tempTrade: SimulatedTrade = {
                ticker: selectedItem.ticker,
                float: selectedItem.float,
                catalyst,
                setup: setupType,
                // Buy at the current high price in the range (Ask)
                entryPrice: buyPrice,
                exitPrice: 0,
                shares: shareSize,
                pnl: 0,
                // Sell at the current low price in the target range (Bid)
                target: parseFloat((initialPrice * 1.08 * (1 - spreadPercent / 2)).toFixed(2)),
                // Trigger stop loss, filled at the low end of the stop range (Bid)
                stop: parseFloat((initialPrice * 0.96 * (1 - spreadPercent / 2)).toFixed(2))
              };

              updateCurrentTrade(tempTrade);
              addLog(`[SCANNER] Hot ticker found: $${tempTrade.ticker} | Float: ${tempTrade.float}`, 'found', tempTrade.ticker);
              addLog(`[CATALYST] Catalyst: ${tempTrade.catalyst} (RVOL > 4.5x)`, 'found', tempTrade.ticker);
              addLog(`[SETUP] Forming high-velocity 1-minute ${tempTrade.setup}. Range: $${sellPriceBase} (Bid) - $${buyPrice} (Ask)`, 'info', tempTrade.ticker);
            }
            break;

          case 1: // Level 2 analysis
            if (activeTrade) {
              addLog(`[LEVEL 2] Volume surging. Analyzing tape velocity... Bid support holding strong.`, 'info', activeTrade.ticker);
              addLog(`[TAPE] Heavy ask blocks at $${(activeTrade.entryPrice * 1.005).toFixed(2)} are being consumed rapidly.`, 'info', activeTrade.ticker);
            }
            break;

          case 2: // Buy Execution
            if (activeTrade) {
              addLog(`[EXEC] BUY ORDER FILLED: ${activeTrade.shares} shares of $${activeTrade.ticker} at $${activeTrade.entryPrice} (Top of Spread / Ask).`, 'exec', activeTrade.ticker);
              addLog(`[RISK] Stop loss: $${activeTrade.stop} | Profit Target: $${activeTrade.target} (2:1 Ratio).`, 'warn', activeTrade.ticker);
            }
            break;

          case 3: // Position tracking
            if (activeTrade) {
              const rand = Math.random();
              if (rand < 0.4) {
                addLog(`[POSITION] $${activeTrade.ticker} pushing higher. Current mid: $${(activeTrade.entryPrice * 1.04).toFixed(2)}. Front-side holding 9 EMA.`, 'info', activeTrade.ticker);
              } else if (rand < 0.7) {
                addLog(`[POSITION] Consolidating sideways. Volume fading slightly, preparing for breakout attempt.`, 'info', activeTrade.ticker);
              } else {
                addLog(`[POSITION] Warning: Breakout stalled at resistance. Level 2 asks increasing.`, 'warn', activeTrade.ticker);
              }
            }
            break;

          case 4: // Position Resolution
            if (activeTrade) {
              const outcomeRoll = Math.random();
              let finalExit = activeTrade.entryPrice;
              let finalPnl = 0;
              let description = '';
              let logType: LogMessage['type'] = 'info';

              if (outcomeRoll < 0.45) {
                // Success - hit target!
                finalExit = activeTrade.target;
                finalPnl = (finalExit - activeTrade.entryPrice) * activeTrade.shares;
                const finalPnlPercent = ((finalExit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[PROFIT] Target Hit! $${activeTrade.ticker} erupted on high volume. Sold at low of range: $${finalExit} (Bid). P&L: +${finalPnlPercent.toFixed(2)}%`;
                logType = 'success';
              } else if (outcomeRoll < 0.75) {
                // Bail-out/Scratch trade (very common in Ross Cameron's breakout or bail-out methodology)
                const scratchSpread = (Math.random() * 0.04 - 0.02); // -$0.02 to +$0.02
                // Sell at the lower end of the scratch range (Bid)
                finalExit = parseFloat(((activeTrade.entryPrice + scratchSpread) * 0.992).toFixed(2));
                finalPnl = (finalExit - activeTrade.entryPrice) * activeTrade.shares;
                const finalPnlPercent = ((finalExit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[SCRATCH] Breakout or Bail-out! Momentum stalled. Fast scratch sold at low of range: $${finalExit} (Bid). P&L: ${finalPnl >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%`;
                logType = 'warn';
              } else {
                // Stop Loss Hit
                finalExit = activeTrade.stop;
                finalPnl = (finalExit - activeTrade.entryPrice) * activeTrade.shares;
                const finalPnlPercent = ((finalExit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[STOP LOSS] Back-side broke 9 EMA. Stop loss sold at low of range: $${finalExit} (Bid). P&L: ${finalPnlPercent.toFixed(2)}%`;
                logType = 'fail';
              }

              const resolvedTrade = {
                ...activeTrade,
                exitPrice: finalExit,
                pnl: parseFloat(finalPnl.toFixed(2))
              };

              updateCurrentTrade(resolvedTrade);
              addLog(description, logType, resolvedTrade.ticker);

              // Auto-log the trade to firestore
              const logToDb = async () => {
                try {
                  await addDoc(collection(db, `users/${auth.currentUser?.uid}/trades`), {
                    userId: auth.currentUser?.uid,
                    ticker: resolvedTrade.ticker.toUpperCase(),
                    entryPrice: resolvedTrade.entryPrice,
                    exitPrice: resolvedTrade.exitPrice,
                    shares: resolvedTrade.shares,
                    strategy: `${resolvedTrade.setup} (Dry-Mode)`,
                    notes: `[Simulated Dry-Mode] Setup: ${resolvedTrade.setup}. Float: ${resolvedTrade.float}. Catalyst: ${resolvedTrade.catalyst}. Target: $${resolvedTrade.target}, Stop: $${resolvedTrade.stop}.`,
                    pnl: resolvedTrade.pnl,
                    timestamp: serverTimestamp()
                  });
                  addLog(`[SYSTEM] Trade auto-logged to database history.`, 'success', resolvedTrade.ticker);
                } catch (err) {
                  handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser?.uid}/trades`);
                }
              };

              logToDb();
            }
            break;

          case 5: // Post-trade wait
            addLog(`Scanning market for next setup...`, 'scan');
            updateCurrentTrade(null);
            break;
        }

        return nextStep;
      });
    };

    // First step immediate after starting
    runSimulationStep();

    const timer = setInterval(runSimulationStep, speed);
    return () => clearInterval(timer);
  }, [isActive, speed, shareSize]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2">
          <Activity className={`h-5 w-5 ${isActive ? 'text-emerald-500 animate-pulse' : 'text-zinc-500'}`} />
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white">Ross Cameron Simulator</h2>
            <p className="text-xs text-zinc-400">Dry-mode real-time practice engine</p>
          </div>
        </div>
        
        <button
          onClick={() => setIsActive(!isActive)}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all shadow-md ${
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
              Start Simulator
            </>
          )}
        </button>
      </div>

      {/* Simulator Settings */}
      <div className="grid grid-cols-2 gap-4 mb-4 bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs">
        <div>
          <label className="block text-zinc-400 mb-1">Simulated Size</label>
          <select
            value={shareSize}
            onChange={(e) => setShareSize(Number(e.target.value))}
            disabled={isActive}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          >
            <option value={500}>500 shares</option>
            <option value={1000}>1,000 shares</option>
            <option value={2000}>2,000 shares</option>
            <option value={5000}>5,000 shares</option>
          </select>
        </div>
        <div>
          <label className="block text-zinc-400 mb-1">Simulation Speed</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isActive}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          >
            <option value={4000}>Aggressive (4s / state)</option>
            <option value={6000}>Standard (6s / state)</option>
            <option value={10000}>Realistic (10s / state)</option>
          </select>
        </div>
      </div>

      {/* Filters & Platform Settings */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowPreferences(!showPreferences)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-zinc-500" />
            Stock Markets & Platform Restrictions
          </span>
          <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono">
            {preferences.robinhoodOnly ? 'Robinhood Ready' : 'All Markets'}
          </span>
        </button>

        {showPreferences && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 space-y-4">
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
                        onChange={() => {
                          let updatedMarkets;
                          if (isChecked) {
                            updatedMarkets = preferences.markets.filter((m) => m !== market);
                          } else {
                            updatedMarkets = [...preferences.markets, market];
                          }
                          savePreferences({
                            ...preferences,
                            markets: updatedMarkets
                          });
                        }}
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

            {/* Platform restrictions */}
            <div className="border-t border-zinc-800 pt-3">
              <span className="block text-xs font-bold text-zinc-300 mb-2">Platform Compatibility Filter:</span>
              <label className="flex items-start gap-2.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={preferences.robinhoodOnly}
                  onChange={(e) => {
                    savePreferences({
                      ...preferences,
                      robinhoodOnly: e.target.checked
                    });
                  }}
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
              <span>Matching stocks: <strong className="text-zinc-300">{
                LOW_FLOAT_TICKERS.filter(item => {
                  const marketMatch = preferences.markets.includes(item.market);
                  const rhMatch = !preferences.robinhoodOnly || item.onRobinhood;
                  return marketMatch && rhMatch;
                }).length
              } / {LOW_FLOAT_TICKERS.length}</strong></span>
              <span>Cloud Saved Settings</span>
            </div>
          </div>
        )}
      </div>

      {/* Terminal View */}
      <div className="rounded-lg border border-zinc-800 bg-black p-4 font-mono text-xs shadow-inner">
        <div className="flex items-center justify-between mb-2 text-zinc-500 border-b border-zinc-900 pb-2">
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-zinc-400" />
            <span>Tape-Reading Terminal</span>
          </div>
          <span className="text-[10px] uppercase bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-400 font-bold tracking-wider">
            {isActive ? 'Live Feed' : 'Offline'}
          </span>
        </div>

        <div ref={terminalContainerRef} className="h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {logs.length === 0 ? (
            <div className="text-zinc-600 italic h-full flex items-center justify-center text-center px-4">
              Click "Start Simulator" above to run Ross Cameron dry-mode algorithm. Click any logged trade row to view stock quote and news!
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
              }

              return (
                <div
                  key={log.id}
                  onClick={() => log.ticker && onSelectTicker?.(log.ticker)}
                  className={`flex gap-2 items-center leading-relaxed border-b border-zinc-950 pb-1.5 pt-0.5 group transition-colors ${
                    log.ticker 
                      ? 'cursor-pointer hover:bg-zinc-950/80 px-1 rounded' 
                      : ''
                  }`}
                  title={log.ticker ? `Click to inspect $${log.ticker} details` : undefined}
                >
                  <span className="text-zinc-600 flex-shrink-0 select-none">[{log.time}]</span>
                  <span className="flex-shrink-0">{icon}</span>
                  <span className={`${textColor} flex-1 truncate`}>{log.text}</span>
                  
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
      </div>
    </div>
  );
}

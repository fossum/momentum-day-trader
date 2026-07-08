import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { UserPreferences, LowFloatTicker, LogMessage, SimulatedTrade } from '../types';
import { useBrokerage } from '../hooks/useBrokerage';
import { EngineControls } from './execution/EngineControls';
import { FilterSettings } from './execution/FilterSettings';
import { TerminalDisplay } from './execution/TerminalDisplay';
import { Info } from 'lucide-react';

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
  { ticker: 'SMMT', float: '4.2M', market: 'NASDAQ', onRobinhood: true, companyName: 'Summit Therapeutics' },
  { ticker: 'VERB', float: '8.1M', market: 'NASDAQ', onRobinhood: true, companyName: 'Verb Technology' },
  { ticker: 'KOSS', float: '2.5M', market: 'NASDAQ', onRobinhood: true, companyName: 'Koss Corporation' },
  { ticker: 'IMPP', float: '12.4M', market: 'NASDAQ', onRobinhood: true, companyName: 'Imperial Petroleum' },
  { ticker: 'VHAI', float: '15.6M', market: 'NASDAQ', onRobinhood: true, companyName: 'Vocodia Health Group' },
  { ticker: 'PXS', float: '3.1M', market: 'NASDAQ', onRobinhood: true, companyName: 'Pyxis Tankers' },
  { ticker: 'SPCB', float: '5.4M', market: 'NASDAQ', onRobinhood: true, companyName: 'SuperCom Ltd.' },
  { ticker: 'PALT', float: '6.7M', market: 'NASDAQ', onRobinhood: true, companyName: 'Paltalk, Inc.' },
  { ticker: 'HLCO', float: '1.8M', market: 'NASDAQ', onRobinhood: true, companyName: 'Helport Digital' },
  { ticker: 'CYDY', float: '22.1M', market: 'OTC', onRobinhood: false, companyName: 'CytoDyn Inc.' },
  { ticker: 'HCMC', float: '45.0M', market: 'OTC', onRobinhood: false, companyName: 'Healthier Choices Management' },
  { ticker: 'GTBIF', float: '18.4M', market: 'OTC', onRobinhood: false, companyName: 'Green Thumb Industries' },
  { ticker: 'FNMA', float: '25.0M', market: 'OTC', onRobinhood: false, companyName: 'Fannie Mae' },
  { ticker: 'TCNNF', float: '14.2M', market: 'Foreign', onRobinhood: false, companyName: 'Trulieve Cannabis' },
  { ticker: 'CURLF', float: '19.1M', market: 'Foreign', onRobinhood: false, companyName: 'Curaleaf Holdings' },
  { ticker: 'ASMLF', float: '3.2M', market: 'Foreign', onRobinhood: false, companyName: 'ASML Ordinary' },
  { ticker: 'SMMTW', float: '1.2M', market: 'Warrants', onRobinhood: false, companyName: 'Summit Therapeutics Warrants' },
  { ticker: 'KOSSW', float: '0.8M', market: 'Warrants', onRobinhood: false, companyName: 'Koss Corp Warrants' },
  { ticker: 'SPCBW', float: '1.5M', market: 'Warrants', onRobinhood: false, companyName: 'SuperCom Warrants' }
];

interface ExecutionEngineProps {
  onSelectTicker?: (ticker: string) => void;
  topGainersSection?: React.ReactNode;
  helperTextSection?: React.ReactNode;
  preferences: UserPreferences;
  onSavePreferences: (newPrefs: UserPreferences) => Promise<void>;
  retryTrigger?: number;
}

export function ExecutionEngine({
  onSelectTicker,
  topGainersSection,
  helperTextSection,
  preferences,
  onSavePreferences,
  retryTrigger = 0
}: ExecutionEngineProps) {
  const [isActive, setIsActive] = useState(false);
  const [positionSize, setPositionSize] = useState<string>('1');
  const [speed, setSpeed] = useState<number>(6000); // ms per state transition
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [currentTrade, setCurrentTrade] = useState<SimulatedTrade | null>(null);
  const [step, setStep] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [blacklistedInput, setBlacklistedInput] = useState<string>('');

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const currentTradeRef = useRef<SimulatedTrade | null>(null);
  const preferencesRef = useRef<UserPreferences>(preferences);
  const positionSizeRef = useRef<string>(positionSize);
  const hasLoggedStartRef = useRef<boolean>(false);

  // Add terminal log helper
  const addLog = useCallback((text: string, type: LogMessage['type'] = 'info', ticker?: string) => {
    const newLog: LogMessage = {
      id: Math.random().toString(36).substring(2, 9),
      text,
      type,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ticker
    };
    setLogs((prev) => [...prev.slice(-49), newLog]); // Keep last 50 logs
  }, []);

  const { balance, setBalance, connectionStatus, executeTrade } = useBrokerage(
    preferences,
    retryTrigger,
    addLog
  );

  const balanceRef = useRef<number>(balance);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    positionSizeRef.current = positionSize;
  }, [positionSize]);

  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    if (preferences.positionSize) {
      setPositionSize(preferences.positionSize);
    }
  }, [preferences.positionSize]);

  useEffect(() => {
    setBlacklistedInput((preferences.blacklistedTickers || []).join(', '));
  }, [preferences.blacklistedTickers]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const loadState = async () => {
      try {
        const docRef = doc(db, `users/${auth.currentUser?.uid}/executionState`, 'currentTrade');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && !docSnap.data().empty) {
          const trade = docSnap.data() as SimulatedTrade;
          currentTradeRef.current = trade;
          setCurrentTrade(trade);
          setStep(3); // Resume at position tracking
        }
      } catch (e) {
        console.warn('Failed to load active trade', e);
      }
    };
    loadState();
  }, []);

  const updateCurrentTrade = async (trade: SimulatedTrade | null) => {
    currentTradeRef.current = trade;
    setCurrentTrade(trade);
    if (auth.currentUser) {
      try {
        const docRef = doc(db, `users/${auth.currentUser.uid}/executionState`, 'currentTrade');
        if (trade) {
          await setDoc(docRef, trade);
        } else {
          await setDoc(docRef, { empty: true });
        }
      } catch (e) {
        console.warn('Failed to save active trade to DB', e);
      }
    }
  };

  // Scroll to bottom of terminal
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs, isFullscreen]);

  // Listen for Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Toggle body scroll lock when fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Main simulation state machine interval
  useEffect(() => {
    if (!isActive) {
      updateCurrentTrade(null);
      setStep(0);
      hasLoggedStartRef.current = false;
      return;
    }

    if (!hasLoggedStartRef.current) {
      addLog('Ross Cameron momentum engine started.', 'info');
      addLog('Scanning market for low-float gappers priced $2 - $20...', 'scan');
      hasLoggedStartRef.current = true;
    }

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
              let selectedItem;

              const filteredTickers = LOW_FLOAT_TICKERS.filter(item => {
                const marketMatch = currentPrefs.markets.includes(item.market);
                const rhMatch = !currentPrefs.robinhoodOnly || item.onRobinhood;
                const isBlacklisted = currentPrefs.blacklistedTickers?.includes(item.ticker);
                return marketMatch && rhMatch && !isBlacklisted;
              });

              if (filteredTickers.length > 0) {
                selectedItem = filteredTickers[Math.floor(Math.random() * filteredTickers.length)];
              } else {
                addLog('[SYSTEM WARNING] No stocks match filter settings! Using NASDAQ defaults.', 'warn');
                const standardTickers = LOW_FLOAT_TICKERS.filter(t => t.market === 'NASDAQ' && !currentPrefs.blacklistedTickers?.includes(t.ticker));
                if (standardTickers.length > 0) {
                  selectedItem = standardTickers[Math.floor(Math.random() * standardTickers.length)];
                } else {
                  selectedItem = LOW_FLOAT_TICKERS[0];
                }
              }

              const catalyst = CATALYSTS[Math.floor(Math.random() * CATALYSTS.length)];
              const setupType = Math.random() > 0.5 ? 'Bull Flag' : 'Flat Top Breakout';
              const initialPrice = parseFloat((Math.random() * 15 + 2).toFixed(2));
              
              const spreadPercent = 0.008;
              const buyPrice = parseFloat((initialPrice * (1 + spreadPercent / 2)).toFixed(2));
              const sellPriceBase = parseFloat((initialPrice * (1 - spreadPercent / 2)).toFixed(2));

              let computedShares = 1;
              const psStr = (positionSizeRef.current || "1").toString().trim();
              if (psStr.endsWith("%")) {
                const pct = parseFloat(psStr.replace("%", ""));
                const maxCashForTrade = balanceRef.current * (pct / 100);
                computedShares = Math.max(1, Math.floor(maxCashForTrade / buyPrice));
              } else {
                computedShares = parseInt(psStr) || 1;
              }

              const tempTrade: SimulatedTrade = {
                ticker: selectedItem.ticker,
                float: selectedItem.float,
                catalyst,
                setup: setupType,
                entryPrice: buyPrice,
                exitPrice: 0,
                shares: computedShares,
                pnl: 0,
                target: parseFloat((initialPrice * 1.08 * (1 - spreadPercent / 2)).toFixed(2)),
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

              if (preferencesRef.current.brokerage && preferencesRef.current.brokerage !== 'none') {
                if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", activeTrade.ticker);
                } else {
                  executeTrade(activeTrade.ticker, activeTrade.shares, activeTrade.entryPrice, 'buy')
                    .then(() => {
                      addLog(`[BROKER] LIVE BUY ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', activeTrade.ticker);
                    })
                    .catch((err) => {
                      const isSymbolNotFound = err.message && (
                        err.message.includes("Could not resolve Contract ID") ||
                        err.message.includes("No symbol found") ||
                        err.message.includes("symbol is valid") ||
                        err.message.includes("Instrument not found")
                      );
                      
                      if (isSymbolNotFound) {
                        addLog(`[BROKER WARNING] Skipping symbol $${activeTrade.ticker} (not in broker / conid not found). Scanning for next setup...`, 'warn', activeTrade.ticker);
                        updateCurrentTrade(null);
                        setStep(5);
                      } else {
                        addLog(`[BROKER ERROR] BUY FAILED: ${err.message}`, 'error', activeTrade.ticker);
                        setIsActive(false);
                        updateCurrentTrade(null);
                        setStep(0);
                      }
                    });
                }
              }
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
                finalExit = activeTrade.target;
                finalPnl = (finalExit - activeTrade.entryPrice) * activeTrade.shares;
                const finalPnlPercent = ((finalExit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[PROFIT] Target Hit! $${activeTrade.ticker} erupted on high volume. Sold at low of range: $${finalExit} (Bid). P&L: +${finalPnlPercent.toFixed(2)}%`;
                logType = 'success';
              } else if (outcomeRoll < 0.75) {
                const scratchSpread = (Math.random() * 0.04 - 0.02);
                finalExit = parseFloat(((activeTrade.entryPrice + scratchSpread) * 0.992).toFixed(2));
                finalPnl = (finalExit - activeTrade.entryPrice) * activeTrade.shares;
                const finalPnlPercent = ((finalExit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[SCRATCH] Breakout or Bail-out! Momentum stalled. Fast scratch sold at low of range: $${finalExit} (Bid). P&L: ${finalPnl >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%`;
                logType = 'warn';
              } else {
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

              if (!preferencesRef.current.brokerage || preferencesRef.current.brokerage === 'none') {
                setBalance(prev => parseFloat((prev + finalPnl).toFixed(2)));
              }

              if (preferencesRef.current.brokerage && preferencesRef.current.brokerage !== 'none') {
                if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", resolvedTrade.ticker);
                } else {
                  executeTrade(resolvedTrade.ticker, resolvedTrade.shares, resolvedTrade.exitPrice, 'sell')
                    .then(() => {
                      addLog(`[BROKER] LIVE SELL ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', resolvedTrade.ticker);
                    })
                    .catch((err) => {
                      addLog(`[BROKER ERROR] SELL FAILED: ${err.message}`, 'error', resolvedTrade.ticker);
                      setIsActive(false);
                    });
                }
              }

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
                } catch (err: any) {
                  try {
                    handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser?.uid}/trades`);
                  } catch (handledErr: any) {
                    let msg = "Database connection error.";
                    try {
                      const parsed = JSON.parse(handledErr.message);
                      msg = parsed.error || msg;
                    } catch {
                      msg = handledErr.message;
                    }
                    addLog(`[SYSTEM ERROR] Failed to log trade: ${msg}`, 'error', resolvedTrade.ticker);
                  }
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

    runSimulationStep();

    const timer = setInterval(runSimulationStep, speed);
    return () => clearInterval(timer);
  }, [isActive, speed, addLog, executeTrade, setBalance]);

  const handleToggleActive = () => {
    if (!isActive) {
      if (preferences.brokerage && preferences.brokerage !== 'none' && connectionStatus === 'failed') {
        addLog('[SYSTEM ERROR] Cannot start engine: Broker connection is offline. Please check your settings.', 'error');
        return;
      }
    }
    setIsActive(!isActive);
  };

  return (
    <div className="space-y-6">
      {topGainersSection}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <EngineControls
          isActive={isActive}
          onToggleActive={handleToggleActive}
          positionSize={positionSize}
          onChangePositionSize={setPositionSize}
          onSavePreferences={() => onSavePreferences({ ...preferences, positionSize })}
          speed={speed}
          onChangeSpeed={setSpeed}
          preferences={preferences}
          connectionStatus={connectionStatus}
          balance={balance}
        />

        <FilterSettings
          showPreferences={showPreferences}
          setShowPreferences={setShowPreferences}
          preferences={preferences}
          onSavePreferences={onSavePreferences}
          connectionStatus={connectionStatus}
          blacklistedInput={blacklistedInput}
          setBlacklistedInput={setBlacklistedInput}
          isActive={isActive}
          lowFloatTickers={LOW_FLOAT_TICKERS}
        />
      </div>

      <TerminalDisplay
        logs={logs}
        isFullscreen={isFullscreen}
        setIsFullscreen={setIsFullscreen}
        isActive={isActive}
        onSelectTicker={onSelectTicker}
        terminalContainerRef={terminalContainerRef}
      />

      {helperTextSection}
    </div>
  );
}

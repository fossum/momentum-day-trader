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
  onRetryConnection?: () => void;
}

export function ExecutionEngine({
  onSelectTicker,
  topGainersSection,
  helperTextSection,
  preferences,
  onSavePreferences,
  retryTrigger = 0,
  onRetryConnection
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
  const [isConnecting, setIsConnecting] = useState(false);
  const [activePrompt, setActivePrompt] = useState<any | null>(null);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const currentTradeRef = useRef<SimulatedTrade | null>(null);
  const preferencesRef = useRef<UserPreferences>(preferences);
  const positionSizeRef = useRef<string>(positionSize);
  const hasLoggedStartRef = useRef<boolean>(false);
  const stepRef = useRef<number>(step);
  const isProcessingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const positionStepRef = useRef<number>(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const changeStep = (newStep: number) => {
    stepRef.current = newStep;
    setStep(newStep);
  };

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

  const { balance, setBalance, connectionStatus, executeTrade, replyToIbkrPrompt } = useBrokerage(
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
          changeStep(3); // Resume at position tracking
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

  const logTradeToDb = async (resolvedTrade: SimulatedTrade) => {
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

  const handleResolvePrompt = async (confirmed: boolean) => {
    if (!activePrompt) return;
    
    const promptId = activePrompt.id;
    const currentStep = stepRef.current;
    const trade = currentTradeRef.current;
    
    if (!confirmed) {
      addLog(`[SYSTEM] User declined broker warning. Cancelling order.`, 'warn', trade?.ticker);
      try {
        await replyToIbkrPrompt(promptId, false);
      } catch (e) {
        console.warn("Failed to send decline reply to IBKR:", e);
      }
      setActivePrompt(null);
      setIsActive(false);
      isPausedRef.current = false;
      await updateCurrentTrade(null);
      changeStep(0);
      isProcessingRef.current = false;
      return;
    }

    addLog(`[SYSTEM] Warning approved. Submitting reply...`, 'info', trade?.ticker);
    try {
      const res = await replyToIbkrPrompt(promptId, true);
      
      // Save messageIds to preferences
      const currentApproved = preferencesRef.current.approvedIbkrWarnings || [];
      const newIds = activePrompt.messageIds || [];
      const updatedApproved = Array.from(new Set([...currentApproved, ...newIds]));
      
      await onSavePreferences({
        ...preferencesRef.current,
        approvedIbkrWarnings: updatedApproved
      });
      addLog(`[SYSTEM] Approved warnings whitelisted: ${JSON.stringify(newIds)}`, 'success', trade?.ticker);

      if (res && res.requiresConfirmation) {
        // Show the next prompt
        setActivePrompt(res.prompts[0]);
      } else {
        // Successfully placed order!
        setActivePrompt(null);
        isPausedRef.current = false;
        isProcessingRef.current = false;
        
        if (currentStep === 2) {
          addLog(`[BROKER] LIVE BUY ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', trade?.ticker);
          changeStep(3);
        } else if (currentStep === 4) {
          addLog(`[BROKER] LIVE SELL ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', trade?.ticker);
          if (trade) {
            await logTradeToDb(trade);
          }
          changeStep(5);
        }
      }
    } catch (err: any) {
      addLog(`[BROKER ERROR] Order reply failed: ${err.message}`, 'error', trade?.ticker);
      setActivePrompt(null);
      isPausedRef.current = false;
      setIsActive(false);
      await updateCurrentTrade(null);
      changeStep(0);
      isProcessingRef.current = false;
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
      if (!auth.currentUser || isProcessingRef.current || isPausedRef.current) return;
      isProcessingRef.current = true;

      try {
        const currentStep = stepRef.current;
        const activeTrade = currentTradeRef.current;

        switch (currentStep) {
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

              addLog(`[SCANNER] Selected ticker: $${selectedItem.ticker}. Fetching live FMP quote & news...`, 'scan', selectedItem.ticker);

              let liveData;
              try {
                const res = await fetch(`/api/stock/${selectedItem.ticker}/live-data`);
                if (!res.ok) {
                  const errData = await res.json();
                  throw new Error(errData.error || res.statusText);
                }
                liveData = await res.json();
              } catch (err: any) {
                addLog(`[SYSTEM ERROR] Failed to fetch live data for $${selectedItem.ticker}: ${err.message}. Aborting trade scan.`, 'error', selectedItem.ticker);
                setIsActive(false);
                await updateCurrentTrade(null);
                changeStep(0);
                return;
              }

              const initialPrice = liveData.price;
              const catalyst = liveData.catalyst;
              const rvol = liveData.rvol;
              const volume = liveData.volume;
              const setupType = Math.random() > 0.5 ? 'Bull Flag' : 'Flat Top Breakout';
              
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

              await updateCurrentTrade(tempTrade);
              addLog(`[SCANNER] Hot ticker found: $${tempTrade.ticker} | Float: ${tempTrade.float}`, 'found', tempTrade.ticker);
              addLog(`[CATALYST] News: "${tempTrade.catalyst}" (RVOL: ${rvol}x | Vol: ${volume.toLocaleString()})`, 'found', tempTrade.ticker);
              addLog(`[SETUP] Forming high-velocity 1-minute ${tempTrade.setup}. Range: $${sellPriceBase} (Bid) - $${buyPrice} (Ask)`, 'info', tempTrade.ticker);
              
              changeStep(1);
            }
            break;

          case 1: // Level 2 analysis
            if (activeTrade) {
              addLog(`[LEVEL 2] Volume surging. Analyzing tape velocity... Bid support holding strong.`, 'info', activeTrade.ticker);
              addLog(`[TAPE] Heavy ask blocks at $${(activeTrade.entryPrice * 1.005).toFixed(2)} are being consumed rapidly.`, 'info', activeTrade.ticker);
              changeStep(2);
            } else {
              changeStep(0);
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
                  positionStepRef.current = 0;
                  changeStep(3);
                } else {
                  try {
                    const res = await executeTrade(
                      activeTrade.ticker, 
                      activeTrade.shares, 
                      activeTrade.entryPrice, 
                      'buy',
                      activeTrade.target,
                      activeTrade.stop
                    );
                    if (res && res.requiresConfirmation) {
                      addLog(`[BROKER WARNING] Order requires confirmation: ${JSON.stringify(res.prompts[0].message)}`, 'warn', activeTrade.ticker);
                      isPausedRef.current = true;
                      setActivePrompt(res.prompts[0]);
                    } else {
                      addLog(`[BROKER] LIVE BUY ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', activeTrade.ticker);
                      positionStepRef.current = 0;
                      changeStep(3);
                    }
                  } catch (err: any) {
                    const isSymbolNotFound = err.message && (
                      err.message.includes("Could not resolve Contract ID") ||
                      err.message.includes("No symbol found") ||
                      err.message.includes("symbol is valid") ||
                      err.message.includes("Instrument not found")
                    );
                    
                    if (isSymbolNotFound) {
                      addLog(`[BROKER WARNING] Skipping symbol $${activeTrade.ticker} (not in broker / conid not found). Scanning for next setup...`, 'warn', activeTrade.ticker);
                      
                      // Add symbol to blacklist
                      const currentBlacklist = preferencesRef.current.blacklistedTickers || [];
                      if (!currentBlacklist.includes(activeTrade.ticker)) {
                        const updatedBlacklist = [...currentBlacklist, activeTrade.ticker];
                        try {
                          await onSavePreferences({
                            ...preferencesRef.current,
                            blacklistedTickers: updatedBlacklist
                          });
                          addLog(`[SYSTEM] Added $${activeTrade.ticker} to blacklist.`, 'info', activeTrade.ticker);
                        } catch (e) {
                          console.error("Failed to update blacklist:", e);
                        }
                      }

                      await updateCurrentTrade(null);
                      changeStep(5);
                    } else {
                      addLog(`[BROKER ERROR] BUY FAILED: ${err.message}`, 'error', activeTrade.ticker);
                      setIsActive(false);
                      await updateCurrentTrade(null);
                      changeStep(0);
                    }
                  }
                }
              } else {
                positionStepRef.current = 0;
                changeStep(3);
              }
            } else {
              changeStep(0);
            }
            break;

          case 3: // Position tracking
            if (activeTrade) {
              positionStepRef.current += 1;
              
              let liveData;
              try {
                const res = await fetch(`/api/stock/${activeTrade.ticker}/live-data`);
                if (!res.ok) {
                  const errData = await res.json();
                  throw new Error(errData.error || res.statusText);
                }
                liveData = await res.json();
              } catch (err: any) {
                addLog(`[SYSTEM WARNING] Failed to fetch live tracking quote for $${activeTrade.ticker}: ${err.message}. Retrying on next tick...`, 'warn', activeTrade.ticker);
                return;
              }

              const currentPrice = liveData.price;
              const pnl = (currentPrice - activeTrade.entryPrice) * activeTrade.shares;
              const pnlPercent = ((currentPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
              
              addLog(`[POSITION] $${activeTrade.ticker} live price: $${currentPrice.toFixed(2)} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`, 'info', activeTrade.ticker);

              let exitPrice = currentPrice;
              let description = '';
              let logType: LogMessage['type'] = 'info';
              let shouldResolve = false;

              if (currentPrice >= activeTrade.target) {
                exitPrice = activeTrade.target;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[PROFIT] Target Hit! $${activeTrade.ticker} reached profit limit. Sold at: $${exitPrice} (Bid). P&L: +${finalPnlPercent.toFixed(2)}%`;
                logType = 'success';
                shouldResolve = true;
              } else if (currentPrice <= activeTrade.stop) {
                exitPrice = activeTrade.stop;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[STOP LOSS] Stop loss hit! $${activeTrade.ticker} dropped below risk limit. Sold at: $${exitPrice} (Bid). P&L: ${finalPnlPercent.toFixed(2)}%`;
                logType = 'fail';
                shouldResolve = true;
              } else if (positionStepRef.current >= 5) {
                exitPrice = currentPrice;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[SCRATCH] Setup stalled (holding time limit reached). Sold at market price: $${exitPrice}. P&L: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%`;
                logType = 'warn';
                shouldResolve = true;
              }

              if (shouldResolve) {
                const finalPnl = (exitPrice - activeTrade.entryPrice) * activeTrade.shares;
                const resolvedTrade = {
                  ...activeTrade,
                  exitPrice: exitPrice,
                  pnl: parseFloat(finalPnl.toFixed(2))
                };
                
                addLog(description, logType, resolvedTrade.ticker);
                await updateCurrentTrade(resolvedTrade);
                changeStep(4);
              }
            } else {
              changeStep(0);
            }
            break;

          case 4: // Position Resolution
            if (activeTrade) {
              const resolvedTrade = activeTrade;

              if (!preferencesRef.current.brokerage || preferencesRef.current.brokerage === 'none') {
                setBalance(prev => parseFloat((prev + resolvedTrade.pnl).toFixed(2)));
                await logTradeToDb(resolvedTrade);
                changeStep(5);
              } else {
                if (preferencesRef.current.brokerage === 'interactivebrokers') {
                  addLog(`[BROKER] Bracket order is active. Exit is managed on broker: Target $${resolvedTrade.target} / Stop $${resolvedTrade.stop}.`, 'info', resolvedTrade.ticker);
                  await logTradeToDb(resolvedTrade);
                  changeStep(5);
                } else if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", resolvedTrade.ticker);
                  await logTradeToDb(resolvedTrade);
                  changeStep(5);
                } else {
                  try {
                    const res = await executeTrade(resolvedTrade.ticker, resolvedTrade.shares, resolvedTrade.exitPrice, 'sell');
                    if (res && res.requiresConfirmation) {
                      addLog(`[BROKER WARNING] Order requires confirmation: ${JSON.stringify(res.prompts[0].message)}`, 'warn', resolvedTrade.ticker);
                      isPausedRef.current = true;
                      setActivePrompt(res.prompts[0]);
                    } else {
                      addLog(`[BROKER] LIVE SELL ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', resolvedTrade.ticker);
                      await logTradeToDb(resolvedTrade);
                      changeStep(5);
                    }
                  } catch (err: any) {
                    addLog(`[BROKER ERROR] SELL FAILED: ${err.message}`, 'error', resolvedTrade.ticker);
                    setIsActive(false);
                    await updateCurrentTrade(null);
                    changeStep(0);
                  }
                }
              }
            } else {
              changeStep(0);
            }
            break;

          case 5: // Post-trade wait
            addLog(`Scanning market for next setup...`, 'scan');
            await updateCurrentTrade(null);
            changeStep(0);
            break;
        }
      } finally {
        isProcessingRef.current = false;
      }
    };

    const timer = setInterval(runSimulationStep, speed);
    return () => clearInterval(timer);
  }, [isActive, speed, addLog, executeTrade, setBalance, onSavePreferences]);

  useEffect(() => {
    if (isConnecting) {
      if (connectionStatus === 'success') {
        setIsConnecting(false);
        setIsActive(true);
        addLog('[SYSTEM] Broker reconnection successful. Ross Cameron momentum engine starting...', 'success');
      } else if (connectionStatus === 'failed') {
        setIsConnecting(false);
        addLog('[SYSTEM ERROR] Broker reconnection failed. Please check your Gateway or settings and try again.', 'error');
      }
    }
  }, [connectionStatus, isConnecting, addLog]);

  const handleToggleActive = () => {
    if (!isActive) {
      if (preferences.brokerage && preferences.brokerage !== 'none' && connectionStatus === 'failed') {
        addLog('[SYSTEM] Attempting to reconnect to broker...', 'info');
        setIsConnecting(true);
        if (onRetryConnection) {
          onRetryConnection();
        }
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
          isConnecting={isConnecting}
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

      {activePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 border-b border-zinc-900 pb-4 mb-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 animate-pulse">
                <Info className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-zinc-100 font-sans">IBKR Order Confirmation Required</h3>
                <p className="text-xs text-zinc-500 font-mono">ID: {activePrompt.id}</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              {activePrompt.message?.map((msg: string, idx: number) => {
                const cleanMsg = msg.replace(/<\/?[^>]+(>|$)/g, "");
                return (
                  <p key={idx} className="text-sm leading-relaxed text-zinc-300 font-mono whitespace-pre-line bg-zinc-900/40 p-3 rounded-lg border border-zinc-900/80">
                    {cleanMsg}
                  </p>
                );
              })}
              <p className="text-[10px] text-zinc-500 italic font-sans leading-normal">
                Selecting "Yes, Approve & Submit" will whitelist this prompt's warning identifier ("{activePrompt.messageIds?.join(', ')}") and automatically bypass it in future trades.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-900 pt-4 font-sans">
              <button
                onClick={() => handleResolvePrompt(false)}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors"
              >
                No, Cancel Order
              </button>
              <button
                onClick={() => handleResolvePrompt(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 active:bg-amber-700 rounded-lg shadow-lg hover:shadow-amber-600/10 transition-all"
              >
                Yes, Approve & Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

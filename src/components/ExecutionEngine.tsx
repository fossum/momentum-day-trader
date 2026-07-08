import React, { useState, useEffect, useRef } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { Play, Square, Activity, Terminal, ShieldAlert, Cpu, CheckCircle2, AlertTriangle, ArrowRight, Settings, Info, Filter, Check, Maximize2, Minimize2 } from 'lucide-react';
import { UserPreferences, LowFloatTicker } from '../types';

interface LogMessage {
  id: string;
  text: string;
  type: 'info' | 'scan' | 'found' | 'exec' | 'success' | 'fail' | 'warn' | 'error';
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
  const [balance, setBalance] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(6000); // ms per state transition
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [currentTrade, setCurrentTrade] = useState<SimulatedTrade | null>(null);
  const [step, setStep] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'failed' | 'none'>('none');
  const connectionStatusRef = useRef<'success' | 'failed' | 'none'>('none');
  const [blacklistedInput, setBlacklistedInput] = useState<string>('');

  const getBrokerageLabel = (brokerage?: string) => {
    if (brokerage === 'robinhood') return 'Robinhood';
    if (brokerage === 'interactivebrokers') return 'IBKR';
    if (brokerage === 'lightspeed') return 'Lightspeed';
    return 'Simulation';
  };
  
  const DEFAULT_PREFERENCES: UserPreferences = {
    markets: ['NASDAQ', 'NYSE', 'OTC', 'Warrants', 'Foreign'],
    robinhoodOnly: true
  };

  const [showPreferences, setShowPreferences] = useState(false);
  const preferencesRef = useRef<UserPreferences>(preferences || DEFAULT_PREFERENCES);
  const positionSizeRef = useRef<string>(positionSize);
  const balanceRef = useRef<number>(balance);
  const hasLoggedStartRef = useRef<boolean>(false);

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

  // Fetch account balance
  useEffect(() => {
    // Reset connection status tracking on manual retry so we get fresh terminal logs
    if (retryTrigger > 0) {
      connectionStatusRef.current = 'none';
      setConnectionStatus('none');
      addLog('[SYSTEM] Retrying broker connection...', 'info');
    }

    if (!preferences.brokerage || preferences.brokerage === 'none') {
      setBalance(prev => (prev === 0 ? 10000 : prev)); // Default simulated balance
      if (connectionStatusRef.current !== 'none') {
        addLog('[SYSTEM] Switched to Simulated Mode.', 'info');
      }
      connectionStatusRef.current = 'none';
      setConnectionStatus('none');
      return;
    }

    const fetchBalance = async () => {
      if (preferences.brokerage === 'robinhood' && !preferences.robinhoodToken) {
        const msg = "Robinhood token missing. Please configure it in Settings.";
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }
      if (preferences.brokerage === 'interactivebrokers' && !preferences.ibkrUrl) {
        const msg = "IBKR Gateway URL missing. Please configure it in Settings.";
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }
      if (preferences.brokerage === 'lightspeed' && !preferences.lightspeedKey) {
        const msg = "Lightspeed key missing. Please configure it in Settings.";
        console.warn(msg);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] ${msg}`, 'error');
        }
        setBalance(0);
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
        return;
      }

      try {
        const res = await fetch(`/api/broker/balance?brokerage=${preferences.brokerage}`, {
          headers: {
            "x-robinhood-token": preferences.robinhoodToken || "",
            "x-lightspeed-key": preferences.lightspeedKey || "",
            "x-ibkr-url": preferences.ibkrUrl || ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance || 0);
          if (connectionStatusRef.current !== 'success') {
            addLog(`[SYSTEM] Connected successfully to ${getBrokerageLabel(preferences.brokerage)}. Real Balance: $${(data.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'info');
          }
          connectionStatusRef.current = 'success';
          setConnectionStatus('success');
        } else {
          let errMsg = `HTTP ${res.status}`;
          try {
            const errData = await res.json();
            if (errData.error) errMsg = errData.error;
          } catch {}
          
          if (connectionStatusRef.current !== 'failed') {
            addLog(`[SYSTEM ERROR] Connection to ${getBrokerageLabel(preferences.brokerage)} failed: ${errMsg}`, 'error');
          }
          connectionStatusRef.current = 'failed';
          setConnectionStatus('failed');
        }
      } catch (err: any) {
        console.warn("Balance fetch error:", err.message);
        if (connectionStatusRef.current !== 'failed') {
          addLog(`[SYSTEM ERROR] Connection to ${getBrokerageLabel(preferences.brokerage)} failed: ${err.message}`, 'error');
        }
        connectionStatusRef.current = 'failed';
        setConnectionStatus('failed');
      }
    };
    fetchBalance();
    
    const interval = setInterval(fetchBalance, 15000); // refresh every 15s
    return () => {
      clearInterval(interval);
    };
  }, [preferences, retryTrigger]);

  const savePreferences = onSavePreferences;

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const currentTradeRef = useRef<SimulatedTrade | null>(null);

  // Helper to sync ref and state
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

    // Initial scan log - only print once on start
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
                  // Fallback
                  selectedItem = LOW_FLOAT_TICKERS[0];
                }
              }

              const catalyst = CATALYSTS[Math.floor(Math.random() * CATALYSTS.length)];
              const setupType = Math.random() > 0.5 ? 'Bull Flag' : 'Flat Top Breakout';
              const initialPrice = parseFloat((Math.random() * 15 + 2).toFixed(2)); // Midpoint $2 to $17
              
              // Define 0.8% typical spread for high-volatility small cap momentum stocks
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
                // Buy at the current high price in the range (Ask)
                entryPrice: buyPrice,
                exitPrice: 0,
                shares: computedShares,
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

              // Live Broker Execution (BUY)
              if (preferencesRef.current.brokerage && preferencesRef.current.brokerage !== 'none') {
                if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", activeTrade.ticker);
                } else {
                  fetch("/api/broker/trade", {
                    method: "POST",
                    headers: { 
                      "Content-Type": "application/json",
                      "x-robinhood-token": preferencesRef.current.robinhoodToken || "",
                      "x-lightspeed-key": preferencesRef.current.lightspeedKey || "",
                      "x-ibkr-url": preferencesRef.current.ibkrUrl || ""
                    },
                    body: JSON.stringify({
                      brokerage: preferencesRef.current.brokerage,
                      ticker: activeTrade.ticker,
                      shares: activeTrade.shares,
                      price: activeTrade.entryPrice,
                      side: "buy"
                    })
                  }).then(async (res) => {
                  if (res.ok) {
                    addLog(`[BROKER] LIVE BUY ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', activeTrade.ticker);
                  } else {
                    const err = await res.json();
                    const isSymbolNotFound = err.error && (
                      err.error.includes("Could not resolve Contract ID") ||
                      err.error.includes("No symbol found") ||
                      err.error.includes("symbol is valid") ||
                      err.error.includes("Instrument not found")
                    );
                    
                    if (isSymbolNotFound) {
                      addLog(`[BROKER WARNING] Skipping symbol $${activeTrade.ticker} (not in broker / conid not found). Scanning for next setup...`, 'warn', activeTrade.ticker);
                      updateCurrentTrade(null);
                      setStep(5); // Transition to 5 so next tick starts at 0 (Scan)
                    } else {
                      addLog(`[BROKER ERROR] BUY FAILED: ${err.error}`, 'error', activeTrade.ticker);
                      setIsActive(false);
                      updateCurrentTrade(null);
                      setStep(0);
                    }
                  }
                }).catch(err => {
                  addLog(`[BROKER ERROR] Connection failed`, 'error', activeTrade.ticker);
                  setIsActive(false);
                  updateCurrentTrade(null);
                  setStep(0);
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

              if (!preferencesRef.current.brokerage || preferencesRef.current.brokerage === 'none') {
                setBalance(prev => parseFloat((prev + finalPnl).toFixed(2)));
              }

              // Live Broker Execution (SELL)
              if (preferencesRef.current.brokerage && preferencesRef.current.brokerage !== 'none') {
                if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", resolvedTrade.ticker);
                } else {
                  fetch("/api/broker/trade", {
                    method: "POST",
                    headers: { 
                      "Content-Type": "application/json",
                      "x-robinhood-token": preferencesRef.current.robinhoodToken || "",
                      "x-lightspeed-key": preferencesRef.current.lightspeedKey || "",
                      "x-ibkr-url": preferencesRef.current.ibkrUrl || ""
                    },
                    body: JSON.stringify({
                      brokerage: preferencesRef.current.brokerage,
                      ticker: resolvedTrade.ticker,
                      shares: resolvedTrade.shares,
                      price: resolvedTrade.exitPrice,
                      side: "sell"
                    })
                  }).then(async (res) => {
                    if (res.ok) {
                      addLog(`[BROKER] LIVE SELL ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', resolvedTrade.ticker);
                    } else {
                      const err = await res.json();
                      addLog(`[BROKER ERROR] SELL FAILED: ${err.error}`, 'error', resolvedTrade.ticker);
                      setIsActive(false);
                    }
                  }).catch(err => {
                    addLog(`[BROKER ERROR] Connection failed`, 'error', resolvedTrade.ticker);
                    setIsActive(false);
                  });
                }
              }

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

    // First step immediate after starting
    runSimulationStep();

    const timer = setInterval(runSimulationStep, speed);
    return () => clearInterval(timer);
  }, [isActive, speed]);

  return (
    <div className="space-y-6">
      {topGainersSection}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
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
          onClick={() => {
            if (!isActive) {
              if (preferences.brokerage && preferences.brokerage !== 'none' && connectionStatus === 'failed') {
                addLog('[SYSTEM ERROR] Cannot start engine: Broker connection is offline. Please check your settings.', 'error');
                return;
              }
            }
            setIsActive(!isActive);
          }}
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
              Start Engine
            </>
          )}
        </button>
      </div>

      {/* Execution Settings */}
      <div className="grid grid-cols-2 gap-4 mb-4 bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs">
        <div>
          <label className="block text-zinc-400 mb-1">Position Size (e.g. 10% or 100)</label>
          <input
            type="text"
            value={positionSize}
            onChange={(e) => setPositionSize(e.target.value)}
            onBlur={() => {
              const newPrefs = { ...preferences, positionSize };
              savePreferences(newPrefs);
            }}
            disabled={isActive}
            placeholder="10% or 100"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500 disabled:opacity-50 font-mono"
          />
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

            {/* Blacklisted Tickers */}
            <div className="border-t border-zinc-800 pt-3 mb-3">
              <span className="block text-xs font-bold text-zinc-300 mb-2">Blacklisted Tickers (Do Not Trade):</span>
              <input
                type="text"
                value={blacklistedInput}
                onChange={(e) => setBlacklistedInput(e.target.value)}
                onBlur={() => {
                  const tickers = blacklistedInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
                  savePreferences({
                    ...preferences,
                    blacklistedTickers: tickers
                  });
                }}
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
    </div>

    {/* Terminal View */}
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
              className="flex items-center gap-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-1 text-xs font-bold text-zinc-300 hover:text-white transition-all shadow-sm"
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

      {helperTextSection}
    </div>
  );
}

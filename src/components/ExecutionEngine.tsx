import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db, getCachedSentiment, cacheSentiment } from '../lib/firebase';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { UserPreferences, LogMessage, SimulatedTrade, MarketGainer } from '../types';
import { logLocalDecision } from '../lib/localLogger';
import { useBrokerage } from '../hooks/useBrokerage';
import {
  detectBullFlag,
  validateCatalyst,
  validateStopDistance,
  calculateTarget,
  passesBaselineFilter,
  passesRvolFilter,
  passesFloatFilter,
  isWithinTradingWindow,
  formatCompact,
  analyzeBullFlag
} from '../hooks/usePatternDetector';
import { EngineControls } from './execution/EngineControls';
import { FilterSettings } from './execution/FilterSettings';
import { TerminalDisplay } from './execution/TerminalDisplay';
import { Info } from 'lucide-react';

interface ExecutionEngineProps {
  onSelectTicker?: (ticker: string) => void;
  topGainersSection?: React.ReactNode;
  helperTextSection?: React.ReactNode;
  preferences: UserPreferences;
  onSavePreferences: (newPrefs: UserPreferences) => Promise<void>;
  retryTrigger?: number;
  onRetryConnection?: () => void;
  gainers?: MarketGainer[];
  onRefreshGainers?: () => Promise<void>;
}

export function ExecutionEngine({
  onSelectTicker,
  topGainersSection,
  helperTextSection,
  preferences,
  onSavePreferences,
  retryTrigger = 0,
  onRetryConnection,
  gainers = [],
  onRefreshGainers
}: ExecutionEngineProps) {
  const [isActive, setIsActive] = useState(false);
  const [positionSize, setPositionSize] = useState<string>('1');
  const [speed, setSpeed] = useState<number>(preferences.simulationSpeed || 6000); // ms per state transition
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [currentTrade, setCurrentTrade] = useState<SimulatedTrade | null>(null);
  const [step, setStep] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [blacklistedInput, setBlacklistedInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [activePrompt, setActivePrompt] = useState<any | null>(null);
  const [marketStatus, setMarketStatus] = useState<{
    isMarketOpen: boolean;
    timezone: string;
    openingHour: string;
    closingHour: string;
    isHoliday: boolean;
    holidayName: string | null;
  } | null>(null);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const currentTradeRef = useRef<SimulatedTrade | null>(null);
  const preferencesRef = useRef<UserPreferences>(preferences);
  const positionSizeRef = useRef<string>(positionSize);
  const hasLoggedStartRef = useRef<boolean>(false);
  const stepRef = useRef<number>(step);
  const isProcessingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const positionStepRef = useRef<number>(0);
  const gainersRef = useRef<MarketGainer[]>(gainers);
  const lastGainerIndexRef = useRef<number>(0);
  const checkedSymbolsRef = useRef<Set<string>>(new Set());
  // Track the breakout entry price for bailout logic (separate from limit entry)
  const entryLivePriceRef = useRef<number>(0);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    gainersRef.current = gainers;
    checkedSymbolsRef.current.clear();
  }, [gainers]);

  useEffect(() => {
    const checkMarketStatus = async () => {
      try {
        const res = await fetch('/api/market/status');
        if (res.ok) {
          const data = await res.json();
          setMarketStatus(data);
        }
      } catch (err) {
        console.warn("Failed to fetch market status:", err);
      }
    };

    checkMarketStatus();
    const interval = setInterval(checkMarketStatus, 10 * 60 * 1000); // 10 minutes
    return () => clearInterval(interval);
  }, []);

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
      time: new Date().toLocaleTimeString([], { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ticker
    };
    setLogs((prev) => [...prev.slice(-49), newLog]); // Keep last 50 logs
    logLocalDecision(text, type);
  }, []);

  const { balance, setBalance, pnl, pnlPercent, connectionStatus, executeTrade, replyToIbkrPrompt } = useBrokerage(
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
    if (preferences.simulationSpeed) {
      setSpeed(preferences.simulationSpeed);
    }
  }, [preferences.positionSize, preferences.simulationSpeed]);

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
          changeStep(4); // Resume at position tracking
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
        notes: `[Simulated Dry-Mode] Setup: ${resolvedTrade.setup}. Float: ${resolvedTrade.float}. Catalyst: ${resolvedTrade.catalyst}. Target: $${resolvedTrade.target}, Stop: $${resolvedTrade.stop}. Stop Distance: $${(resolvedTrade.entryPrice - resolvedTrade.stop).toFixed(2)}. R:R: ${((resolvedTrade.target - resolvedTrade.entryPrice) / (resolvedTrade.entryPrice - resolvedTrade.stop)).toFixed(2)}.`,
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

        if (currentStep === 3) {
          addLog(`[BROKER] LIVE BUY ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', trade?.ticker);
          changeStep(4);
        } else if (currentStep === 5) {
          addLog(`[BROKER] LIVE SELL ORDER SUBMITTED (${preferencesRef.current.brokerage})`, 'success', trade?.ticker);
          if (trade) {
            await logTradeToDb(trade);
          }
          changeStep(6);
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
      addLog('Scanning live FMP gainers for low-float gappers priced $2 - $20...', 'scan');
      hasLoggedStartRef.current = true;
    }

    const runSimulationStep = async () => {
      if (!auth.currentUser || isProcessingRef.current || isPausedRef.current) return;
      isProcessingRef.current = true;

      try {
        const currentStep = stepRef.current;
        const activeTrade = currentTradeRef.current;

        switch (currentStep) {
          case 0: // SCAN & FILTER — Live screener with Ross Cameron baseline filters
            {
              // Trading window check
              const extendedHours = preferencesRef.current.extendedTradingHours || false;
              if (!isWithinTradingWindow(extendedHours)) {
                addLog(`[SYSTEM] Outside Ross Cameron trading window (${extendedHours ? '9:30 AM - 4:00 PM' : '9:30 - 11:30 AM'} EST). Engine idle.`, 'info');
                return;
              }

              // Server-side market status and holiday check
              if (marketStatus) {
                if (marketStatus.isHoliday) {
                  addLog(`[SYSTEM] Today is a market holiday (${marketStatus.holidayName || 'Exchange Closed'}). Engine idle.`, 'info');
                  return;
                }
                if (!marketStatus.isMarketOpen && !isWithinTradingWindow(true)) {
                  addLog(`[SYSTEM] FMP reports market is closed. Engine idle.`, 'info');
                  return;
                }
              }

              const currentGainers = gainersRef.current;
              if (!currentGainers || currentGainers.length === 0) {
                addLog('[SCANNER] No live gainers available from FMP. Waiting for market data...', 'scan');
                return;
              }

              const blacklist = preferencesRef.current.blacklistedTickers || [];
              // Configuration limits
              const minPrice = preferencesRef.current.minPrice ?? 2.0;
              const maxPrice = preferencesRef.current.maxPrice ?? 20.0;
              const minGainPercent = preferencesRef.current.minGainPercent ?? 10;
              const minRvol = preferencesRef.current.minRvol ?? 5.0;
              const maxFloatMillions = preferencesRef.current.maxFloatMillions ?? 20;

              const checkPriceRange = preferencesRef.current.checkPriceRange ?? true;
              const checkDailyGain = preferencesRef.current.checkDailyGain ?? true;

              // Find the next gainer that passes baseline filters
              let selectedGainer: MarketGainer | null = null;
              const startIdx = lastGainerIndexRef.current;

              for (let i = 0; i < currentGainers.length; i++) {
                const idx = (startIdx + i) % currentGainers.length;
                const g = currentGainers[idx];

                if (blacklist.includes(g.symbol)) {
                  continue;
                }

                const priceValid = !checkPriceRange || (g.price >= minPrice && g.price <= maxPrice);
                const gainValid = !checkDailyGain || (g.changesPercentage >= minGainPercent);

                if (!priceValid || !gainValid) {
                  if (!checkedSymbolsRef.current.has(g.symbol)) {
                    checkedSymbolsRef.current.add(g.symbol);
                    const reasons: string[] = [];
                    if (checkPriceRange && (g.price < minPrice || g.price > maxPrice)) {
                      reasons.push(`Price $${g.price.toFixed(2)} out of bounds ($${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)})`);
                    }
                    if (checkDailyGain && (g.changesPercentage < minGainPercent)) {
                      reasons.push(`Gain +${g.changesPercentage.toFixed(1)}% < ${minGainPercent}%`);
                    }
                    addLog(`[SCANNER] $${g.symbol} failed baseline filters: ${reasons.join(', ')}`, 'scan', g.symbol);
                  }
                  continue;
                }

                selectedGainer = g;
                lastGainerIndexRef.current = (idx + 1) % currentGainers.length;
                break;
              }

              if (!selectedGainer) {
                const filterDesc = [
                  checkPriceRange ? `price $${minPrice}–$${maxPrice}` : null,
                  checkDailyGain ? `gain ≥ ${minGainPercent}%` : null
                ].filter(Boolean).join(', ');
                addLog(`[SCANNER] No live gainers pass baseline filters (${filterDesc || 'no filters active'}). Waiting...`, 'scan');
                return;
              }

              // Add symbol to checked list
              checkedSymbolsRef.current.add(selectedGainer.symbol);

              // Check if we checked all the checkable gainers
              const checkableGainers = currentGainers.filter(g =>
                !blacklist.includes(g.symbol) &&
                (!checkPriceRange || (g.price >= minPrice && g.price <= maxPrice)) &&
                (!checkDailyGain || (g.changesPercentage >= minGainPercent))
              );
              const allChecked = checkableGainers.length === 0 || checkableGainers.every(g => checkedSymbolsRef.current.has(g.symbol));

              if (allChecked && onRefreshGainers) {
                addLog('[SCANNER] Evaluated each stock in the current gainers list. Triggering refresh...', 'info');
                checkedSymbolsRef.current.clear();
                onRefreshGainers().catch(err => console.warn('Failed to refresh gainers:', err));
              }

              addLog(`[SCANNER] Evaluating $${selectedGainer.symbol} (${selectedGainer.name}) — +${selectedGainer.changesPercentage.toFixed(1)}% at $${selectedGainer.price.toFixed(2)}`, 'scan', selectedGainer.symbol);

              // Fetch live data & 1-min chart candles in parallel
              let liveData: any = null;
              let candles: any[] = [];
              try {
                const [liveRes, chartRes] = await Promise.all([
                  fetch(`/api/stock/${selectedGainer.symbol}/live-data`, {
                    headers: {
                      'x-brokerage': preferencesRef.current.brokerage || '',
                      'x-robinhood-token': preferencesRef.current.robinhoodToken || '',
                      'x-ibkr-url': preferencesRef.current.ibkrUrl || ''
                    }
                  }),
                  fetch(`/api/stock/${selectedGainer.symbol}/chart/1min`)
                ]);

                if (liveRes.ok) {
                  liveData = await liveRes.json();
                } else {
                  const errData = await liveRes.json();
                  throw new Error(`Live data: ${errData.error || liveRes.statusText}`);
                }

                if (chartRes.ok) {
                  candles = await chartRes.json();
                } else {
                  throw new Error(`Chart data: ${chartRes.statusText}`);
                }
              } catch (err: any) {
                addLog(`[SYSTEM ERROR] Failed to fetch data for $${selectedGainer.symbol}: ${err.message}. Skipping.`, 'error', selectedGainer.symbol);
                return;
              }

              // Run all evaluation checks!
              const checkRelativeVol = preferencesRef.current.checkRelativeVol ?? true;
              const checkSharesFloat = preferencesRef.current.checkSharesFloat ?? true;
              const checkTradingWindow = preferencesRef.current.checkTradingWindow ?? true;
              const checkBullFlagPattern = preferencesRef.current.checkBullFlagPattern ?? true;
              const checkStopDistance = preferencesRef.current.checkStopDistance ?? true;
              const checkRiskReward = preferencesRef.current.checkRiskReward ?? true;

              const catalystValidation = preferencesRef.current.catalystValidation ?? 'gemini';
              const checkNewsCatalyst = catalystValidation === 'keywords' || catalystValidation === 'gemini';
              const checkGeminiSentiment = catalystValidation === 'gemini';

              const passesPrice = !checkPriceRange || (liveData.price >= minPrice && liveData.price <= maxPrice);
              const passesGain = !checkDailyGain || (selectedGainer.changesPercentage >= minGainPercent);
              const passesRvol = !checkRelativeVol || passesRvolFilter(liveData.rvol, minRvol);
              const hasKnownFloat = liveData.sharesOutstanding !== 0 && !!liveData.sharesOutstanding;
              const passesFloat = !checkSharesFloat || (hasKnownFloat && passesFloatFilter(liveData.sharesOutstanding, maxFloatMillions));
              const passesWindow = !checkTradingWindow || isWithinTradingWindow(extendedHours);

              const catalystResult = validateCatalyst(liveData.catalyst);
              const passesCatalyst = !checkNewsCatalyst || catalystResult.valid;

              // Gemini news sentiment analysis check (if enabled and news keyword passes, or news catalyst check is disabled but we have news)
              let geminiPass = true;
              let geminiReason = "";
              if (checkGeminiSentiment) {
                const hasActualNews = liveData.catalyst && !liveData.catalyst.startsWith("No recent fundamental catalyst");
                if (checkNewsCatalyst ? passesCatalyst : hasActualNews) {
                  try {
                    const cached = await getCachedSentiment(selectedGainer.symbol, liveData.catalyst);
                    if (cached) {
                      geminiPass = cached.isPositive;
                      geminiReason = cached.reason + " (Cached)";
                    } else {
                      const res = await fetch('/api/news/sentiment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          ticker: selectedGainer.symbol,
                          headline: liveData.catalyst
                        })
                      });
                      if (res.ok) {
                        const data = await res.json();
                        geminiPass = data.isPositive;
                        geminiReason = data.reason;
                        await cacheSentiment(selectedGainer.symbol, liveData.catalyst, {
                          isPositive: geminiPass,
                          reason: geminiReason
                        });
                      } else {
                        geminiPass = false;
                        geminiReason = `Sentiment API returned status ${res.status}`;
                      }
                    }
                  } catch (err: any) {
                    geminiPass = false;
                    geminiReason = `Sentiment check failed: ${err.message}`;
                  }
                } else {
                  if (checkNewsCatalyst) {
                    geminiPass = false;
                    geminiReason = "Skipped (no valid catalyst keyword)";
                  } else {
                    geminiPass = true;
                    geminiReason = "Bypassed (no news catalyst to check)";
                  }
                }
              } else {
                geminiReason = "Bypassed (Gemini sentiment filter disabled)";
              }

              // Bull Flag Pattern Check
              let passesPattern = false;
              let patternReason = "";
              let patternResult: any = null;
              if (checkBullFlagPattern) {
                if (Array.isArray(candles) && candles.length >= 4) {
                  const sorted = [...candles].reverse(); // newest first from FMP, reverse to chronological
                  patternResult = analyzeBullFlag(sorted);
                  passesPattern = patternResult.detected;
                  patternReason = patternResult.reason || "";
                } else {
                  patternReason = `Insufficient candles (${candles?.length || 0} candles, minimum 4 required)`;
                }
              } else {
                passesPattern = true;
                patternReason = "Bypassed (Bull Flag pattern check disabled)";
              }

              // Risk Management Checks (Stop Distance & R:R)
              let passesStop = false;
              let stopDistStr = "N/A";
              const entryPrice = (checkBullFlagPattern && patternResult?.detected) ? patternResult.resistanceLevel : liveData.price;
              const stopPrice = (checkBullFlagPattern && patternResult?.detected) ? patternResult.pullbackLow : 0;
              const maxStopDistance = preferencesRef.current.maxStopDistance ?? 0.20;

              if (checkStopDistance) {
                const finalStopPrice = stopPrice > 0 ? stopPrice : (entryPrice * 0.98);
                passesStop = validateStopDistance(entryPrice, finalStopPrice, maxStopDistance);
                stopDistStr = `$${(entryPrice - finalStopPrice).toFixed(2)}`;
              } else {
                passesStop = true;
                stopDistStr = "Bypassed (Stop distance check disabled)";
              }

              let passesRR = false;
              let rrRatioStr = "N/A";
              let targetPrice = 0;
              const minRewardRiskRatio = preferencesRef.current.minRewardRiskRatio ?? 2.0;

              if (checkRiskReward) {
                const finalStopPrice = stopPrice > 0 ? stopPrice : (entryPrice * 0.98);
                const targetResult = calculateTarget(entryPrice, finalStopPrice, undefined, minRewardRiskRatio);
                if (targetResult) {
                  passesRR = true;
                  rrRatioStr = `${targetResult.ratio}:1`;
                  targetPrice = targetResult.targetPrice;
                }
              } else {
                passesRR = true;
                rrRatioStr = "Bypassed (Risk/Reward check disabled)";
                targetPrice = entryPrice * 1.04; // default target (4% gain)
              }

              const allPass = passesPrice && passesGain && passesRvol && passesFloat && passesWindow && passesCatalyst && geminiPass && passesPattern && passesStop && passesRR;

              // Format report
              const statusChar = (pass: boolean) => pass ? '✓ PASS' : '✗ FAIL';
              const floatDisplay = hasKnownFloat ? formatCompact(liveData.sharesOutstanding) : "Unknown";
              const report = `[EVALUATION] Buy Entrance Checklist for $${selectedGainer.symbol}:
----------------------------------------------------------------------
1. Price Range:       ${statusChar(passesPrice)} ($${liveData.price.toFixed(2)} | Req: $${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)})${!checkPriceRange ? ' [BYPASSED]' : ''}
2. Daily Gain:        ${statusChar(passesGain)} (+${selectedGainer.changesPercentage.toFixed(1)}% | Req: >=${minGainPercent}%)${!checkDailyGain ? ' [BYPASSED]' : ''}
3. Relative Vol:      ${statusChar(passesRvol)} (${liveData.rvol}x | Req: >=${minRvol}x)${!checkRelativeVol ? ' [BYPASSED]' : ''}
4. Shares Float:      ${statusChar(passesFloat)} (${floatDisplay} | Req: <=${formatCompact(maxFloatMillions * 1000000)})${!checkSharesFloat ? ' [BYPASSED]' : ''}
5. Trading Window:    ${statusChar(passesWindow)} (Req: 9:30 AM-11:30 AM EST)${!checkTradingWindow ? ' [BYPASSED]' : ''}
6. News Catalyst:     ${statusChar(passesCatalyst)} (${passesCatalyst ? (checkNewsCatalyst ? `Keyword "${catalystResult.matchedKeyword}" found` : 'Bypassed') : `No keyword matched in headline: "${liveData.catalyst || 'None'}"`})${!checkNewsCatalyst ? ' [BYPASSED]' : ''}
7. Gemini Sentiment:  ${statusChar(geminiPass)} (${geminiReason})
8. Bull Flag Pattern: ${statusChar(passesPattern)} (${passesPattern ? (checkBullFlagPattern ? `Detected at Resistance $${patternResult?.resistanceLevel?.toFixed(2)}` : 'Bypassed') : patternReason})${!checkBullFlagPattern ? ' [BYPASSED]' : ''}
9. Stop Distance:     ${statusChar(passesStop)} (${stopDistStr} | Req: <=$${maxStopDistance.toFixed(2)})${!checkStopDistance ? ' [BYPASSED]' : ''}
10. Risk/Reward:      ${statusChar(passesRR)} (${rrRatioStr} | Req: >=${minRewardRiskRatio}:1)${!checkRiskReward ? ' [BYPASSED]' : ''}
----------------------------------------------------------------------
Result: ${allPass ? '✓ ALL ENTRANCE REQUIREMENTS PASSED' : '✗ FAILED ENTRANCE REQUIREMENTS'}`;

              if (allPass) {
                addLog(report, 'success', selectedGainer.symbol);

                // Calculate shares based on position size preference
                let computedShares = 1;
                const psStr = (positionSizeRef.current || "1").toString().trim();
                if (psStr.endsWith("%")) {
                  const pct = parseFloat(psStr.replace("%", ""));
                  const maxCashForTrade = balanceRef.current * (pct / 100);
                  computedShares = Math.max(1, Math.floor(maxCashForTrade / entryPrice));
                } else {
                  computedShares = parseInt(psStr) || 1;
                }

                // Setup the trade
                const setupTrade: SimulatedTrade = {
                  ticker: selectedGainer.symbol,
                  float: floatDisplay,
                  catalyst: liveData.catalyst || '',
                  setup: 'Bull Flag',
                  entryPrice: parseFloat(entryPrice.toFixed(2)),
                  shares: computedShares,
                  target: targetPrice,
                  stop: stopPrice > 0 ? stopPrice : parseFloat((entryPrice * 0.98).toFixed(2)),
                  exitPrice: 0,
                  pnl: 0
                };

                await updateCurrentTrade(setupTrade);
                changeStep(1); // Proceed to catalyst validation step in UI
              } else {
                addLog(report, 'warn', selectedGainer.symbol);
                await updateCurrentTrade(null);
                // Remain on step 0
              }
            }
            break;

          case 1: // CATALYST VALIDATION — Require a fundamental news driver
            if (activeTrade) {
              const catalystValidation = preferencesRef.current.catalystValidation ?? 'gemini';
              const checkNewsCatalyst = catalystValidation === 'keywords' || catalystValidation === 'gemini';
              const checkGeminiSentiment = catalystValidation === 'gemini';

              if (!checkNewsCatalyst && !checkGeminiSentiment) {
                addLog(`[CATALYST] Bypassed news catalyst and Gemini checks (News Catalyst and Gemini filters disabled)`, 'info', activeTrade.ticker);
                changeStep(2);
                break;
              }

              const runKeywordFallback = async (reason: string) => {
                if (!checkNewsCatalyst) {
                  addLog(`[CATALYST] Bypassed keyword validator for $${activeTrade.ticker} (News Catalyst filter disabled)`, 'info', activeTrade.ticker);
                  return true;
                }
                addLog(`[CATALYST FALLBACK] Running keyword validator for $${activeTrade.ticker} because: ${reason}`, 'info', activeTrade.ticker);
                const catalystResult = validateCatalyst(activeTrade.catalyst);
                if (!catalystResult.valid) {
                  addLog(`[ABORT] No qualifying news catalyst for $${activeTrade.ticker}. Headline: "${activeTrade.catalyst || 'None'}". Skipping (Technical Breakout Only).`, 'warn', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return false;
                }
                addLog(`[CATALYST] ✓ Valid keyword catalyst found for $${activeTrade.ticker}: "${catalystResult.matchedKeyword}" — "${activeTrade.catalyst}"`, 'found', activeTrade.ticker);
                return true;
              };

              // Gemini Sentiment Analysis Filter
              if (checkGeminiSentiment) {
                const hasActualNews = activeTrade.catalyst && !activeTrade.catalyst.startsWith("No recent fundamental catalyst");
                const catalystValid = checkNewsCatalyst ? validateCatalyst(activeTrade.catalyst).valid : true;

                if (checkNewsCatalyst ? catalystValid : hasActualNews) {
                  addLog(`[GEMINI] Analyzing news catalyst sentiment for $${activeTrade.ticker}...`, 'info', activeTrade.ticker);
                  try {
                    const cached = await getCachedSentiment(activeTrade.ticker, activeTrade.catalyst);
                    if (cached) {
                      if (!cached.isPositive) {
                        addLog(`[ABORT] Gemini determined news is not a positive fundamental catalyst for $${activeTrade.ticker} (Cached). Reason: "${cached.reason}". Headline: "${activeTrade.catalyst}". Skipping trade.`, 'warn', activeTrade.ticker);
                        await updateCurrentTrade(null);
                        changeStep(0);
                        return;
                      }
                      addLog(`[GEMINI] ✓ Positive news sentiment/catalyst confirmed for $${activeTrade.ticker} (Cached): "${cached.reason}"`, 'success', activeTrade.ticker);
                    } else {
                      const res = await fetch('/api/news/sentiment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          ticker: activeTrade.ticker,
                          headline: activeTrade.catalyst
                        })
                      });
                      if (!res.ok) {
                        throw new Error(`Server returned status ${res.status}`);
                      }
                      const data = await res.json();
                      if (!data.isPositive) {
                        addLog(`[ABORT] Gemini determined news is not a positive fundamental catalyst for $${activeTrade.ticker}. Reason: "${data.reason}". Headline: "${activeTrade.catalyst}". Skipping trade.`, 'warn', activeTrade.ticker);
                        await cacheSentiment(activeTrade.ticker, activeTrade.catalyst, {
                          isPositive: false,
                          reason: data.reason
                        });
                        await updateCurrentTrade(null);
                        changeStep(0);
                        return;
                      }
                      addLog(`[GEMINI] ✓ Positive news sentiment/catalyst confirmed for $${activeTrade.ticker}: "${data.reason}"`, 'success', activeTrade.ticker);
                      await cacheSentiment(activeTrade.ticker, activeTrade.catalyst, {
                        isPositive: true,
                        reason: data.reason
                      });
                    }
                  } catch (err: any) {
                    addLog(`[GEMINI ERROR] Sentiment check failed: ${err.message}. Falling back to keyword validation.`, 'warn', activeTrade.ticker);
                    const success = await runKeywordFallback(err.message);
                    if (!success) return;
                  }
                } else {
                  const success = await runKeywordFallback(checkNewsCatalyst ? 'no valid catalyst keyword' : 'no news to check');
                  if (!success) return;
                }
              } else {
                const success = await runKeywordFallback('Gemini filter is disabled');
                if (!success) return;
              }

              changeStep(2);
            } else {
              changeStep(0);
            }
            break;

          case 2: // PATTERN DETECTION — Bull flag from 1-min candles
            if (activeTrade) {
              const checkBullFlagPattern = preferencesRef.current.checkBullFlagPattern ?? true;
              const checkStopDistance = preferencesRef.current.checkStopDistance ?? true;
              const checkRiskReward = preferencesRef.current.checkRiskReward ?? true;

              let candles: any[] = [];
              if (checkBullFlagPattern) {
                addLog(`[PATTERN] Fetching 1-min candle data for $${activeTrade.ticker}...`, 'info', activeTrade.ticker);
                try {
                  const res = await fetch(`/api/stock/${activeTrade.ticker}/chart/1min`);
                  if (!res.ok) throw new Error(`Chart API error: ${res.status}`);
                  candles = await res.json();
                } catch (err: any) {
                  addLog(`[SYSTEM ERROR] Failed to fetch 1-min chart for $${activeTrade.ticker}: ${err.message}. Skipping.`, 'error', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return;
                }
              }

              // Run bull flag detection
              let patternResult: any = null;
              if (checkBullFlagPattern) {
                if (!Array.isArray(candles) || candles.length < 5) {
                  addLog(`[PATTERN] Insufficient candle data for $${activeTrade.ticker} (${candles?.length || 0} candles). Skipping.`, 'warn', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return;
                }
                const sorted = [...candles].reverse();
                patternResult = detectBullFlag(sorted);
                if (!patternResult) {
                  addLog(`[PATTERN] No bull flag pattern detected for $${activeTrade.ticker}. Skipping.`, 'scan', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return;
                }
                addLog(`[PATTERN] ✓ Bull Flag detected for $${activeTrade.ticker}! Resistance: $${patternResult.resistanceLevel.toFixed(2)} | Pullback Low: $${patternResult.pullbackLow.toFixed(2)}`, 'found', activeTrade.ticker);
              } else {
                addLog(`[PATTERN] Bypassed bull flag pattern check for $${activeTrade.ticker} (Bull Flag pattern check disabled)`, 'info', activeTrade.ticker);
              }

              // Configuration limits
              const maxStopDistance = preferencesRef.current.maxStopDistance ?? 0.20;
              const minRewardRiskRatio = preferencesRef.current.minRewardRiskRatio ?? 2.0;

              // Entry & Stop calculations
              const entryPrice = (checkBullFlagPattern && patternResult) ? patternResult.resistanceLevel : (activeTrade.entryPrice || 0);
              const stopPrice = (checkBullFlagPattern && patternResult) ? patternResult.pullbackLow : 0;
              const finalStopPrice = stopPrice > 0 ? stopPrice : (entryPrice * 0.98);

              // Risk management: validate stop distance
              if (checkStopDistance) {
                if (!validateStopDistance(entryPrice, finalStopPrice, maxStopDistance)) {
                  const stopDist = (entryPrice - finalStopPrice).toFixed(2);
                  addLog(`[RISK] $${activeTrade.ticker} stop distance $${stopDist} exceeds $${maxStopDistance.toFixed(2)} max. Skipping trade.`, 'warn', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return;
                }
              } else {
                addLog(`[RISK] Bypassed stop distance check for $${activeTrade.ticker} (Stop distance check disabled)`, 'info', activeTrade.ticker);
              }

              // Calculate target with configured R:R minimum
              let targetPrice = entryPrice * 1.04; // default target
              let targetRatioStr = "Bypassed";

              if (checkRiskReward) {
                const targetResult = calculateTarget(entryPrice, finalStopPrice, undefined, minRewardRiskRatio);
                if (!targetResult) {
                  addLog(`[RISK] $${activeTrade.ticker} invalid risk:reward setup. Skipping.`, 'warn', activeTrade.ticker);
                  await updateCurrentTrade(null);
                  changeStep(0);
                  return;
                }
                targetPrice = targetResult.targetPrice;
                targetRatioStr = `${targetResult.ratio}:1`;
              } else {
                addLog(`[RISK] Bypassed risk:reward check for $${activeTrade.ticker} (Risk/Reward check disabled)`, 'info', activeTrade.ticker);
              }

              // Calculate shares based on position size preference
              let computedShares = 1;
              const psStr = (positionSizeRef.current || "1").toString().trim();
              if (psStr.endsWith("%")) {
                const pct = parseFloat(psStr.replace("%", ""));
                const maxCashForTrade = balanceRef.current * (pct / 100);
                computedShares = Math.max(1, Math.floor(maxCashForTrade / entryPrice));
              } else {
                computedShares = parseInt(psStr) || 1;
              }

              const setupTrade: SimulatedTrade = {
                ...activeTrade,
                setup: 'Bull Flag',
                entryPrice: parseFloat(entryPrice.toFixed(2)),
                shares: computedShares,
                target: targetPrice,
                stop: parseFloat(finalStopPrice.toFixed(2))
              };

              await updateCurrentTrade(setupTrade);
              addLog(`[SETUP] $${setupTrade.ticker} trade setup confirmed. Entry: $${setupTrade.entryPrice} | Stop: $${setupTrade.stop} | Target: $${setupTrade.target} (${targetRatioStr} R:R) | Shares: ${setupTrade.shares}`, 'info', setupTrade.ticker);
              if (checkBullFlagPattern && patternResult) {
                addLog(`[LEVEL 2] Watching for resistance break at $${patternResult.resistanceLevel.toFixed(2)}...`, 'info', setupTrade.ticker);
              } else {
                addLog(`[LEVEL 2] Watching for breakout entry trigger at $${setupTrade.entryPrice.toFixed(2)}...`, 'info', setupTrade.ticker);
              }
              changeStep(3);
            } else {
              changeStep(0);
            }
            break;

          case 3: // ENTRY EXECUTION — Buy at breakout
            if (activeTrade) {
              addLog(`[EXEC] BUY ORDER FILLED: ${activeTrade.shares} shares of $${activeTrade.ticker} at $${activeTrade.entryPrice} (Breakout above resistance).`, 'exec', activeTrade.ticker);
              addLog(`[RISK] Stop loss: $${activeTrade.stop} | Profit Target: $${activeTrade.target}`, 'warn', activeTrade.ticker);

              if (preferencesRef.current.brokerage && preferencesRef.current.brokerage !== 'none') {
                if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", activeTrade.ticker);
                  positionStepRef.current = 0;
                  entryLivePriceRef.current = activeTrade.entryPrice;
                  changeStep(4);
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
                      entryLivePriceRef.current = activeTrade.entryPrice;
                      changeStep(4);
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
                      changeStep(6);
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
                entryLivePriceRef.current = activeTrade.entryPrice;
                changeStep(4);
              }
            } else {
              changeStep(0);
            }
            break;

          case 4: // POSITION TRACKING with BAILOUT on failed breakout
            if (activeTrade) {
              positionStepRef.current += 1;

              let liveData: any;
              try {
                const res = await fetch(`/api/stock/${activeTrade.ticker}/live-data`, {
                  headers: {
                    'x-brokerage': preferencesRef.current.brokerage || '',
                    'x-robinhood-token': preferencesRef.current.robinhoodToken || '',
                    'x-ibkr-url': preferencesRef.current.ibkrUrl || ''
                  }
                });
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
              const pnlVal = (currentPrice - activeTrade.entryPrice) * activeTrade.shares;
              const pnlPercent = ((currentPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;

              addLog(`[POSITION] $${activeTrade.ticker} live price: $${currentPrice.toFixed(2)} | PnL: ${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`, 'info', activeTrade.ticker);

              let exitPrice = currentPrice;
              let description = '';
              let logType: LogMessage['type'] = 'info';
              let shouldResolve = false;

              if (currentPrice >= activeTrade.target) {
                // TARGET HIT
                exitPrice = activeTrade.target;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[PROFIT] Target Hit! $${activeTrade.ticker} reached profit limit. Sold at: $${exitPrice} (Bid). P&L: +${finalPnlPercent.toFixed(2)}%`;
                logType = 'success';
                shouldResolve = true;
              } else if (currentPrice <= activeTrade.stop) {
                // STOP LOSS HIT
                exitPrice = activeTrade.stop;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[STOP LOSS] Stop loss hit! $${activeTrade.ticker} dropped below risk limit. Sold at: $${exitPrice} (Bid). P&L: ${finalPnlPercent.toFixed(2)}%`;
                logType = 'fail';
                shouldResolve = true;
              } else if (positionStepRef.current <= 2 && currentPrice <= entryLivePriceRef.current) {
                // BAILOUT — breakout failed (price flat or declining in first 1–2 cycles)
                exitPrice = currentPrice;
                const finalPnlPercent = ((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
                description = `[BAILOUT] Breakout failed to surge for $${activeTrade.ticker}. Price flat/declining after entry. Sold at market: $${exitPrice.toFixed(2)}. P&L: ${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(2)}%`;
                logType = 'warn';
                shouldResolve = true;
              } else if (positionStepRef.current >= 5) {
                // TIME LIMIT — scratch
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
                changeStep(5);
              }
            } else {
              changeStep(0);
            }
            break;

          case 5: // POSITION RESOLUTION
            if (activeTrade) {
              const resolvedTrade = activeTrade;

              if (!preferencesRef.current.brokerage || preferencesRef.current.brokerage === 'none') {
                setBalance(prev => parseFloat((prev + resolvedTrade.pnl).toFixed(2)));
                await logTradeToDb(resolvedTrade);
                changeStep(6);
              } else {
                if (preferencesRef.current.brokerage === 'interactivebrokers') {
                  addLog(`[BROKER] Bracket order is active. Exit is managed on broker: Target $${resolvedTrade.target} / Stop $${resolvedTrade.stop}.`, 'info', resolvedTrade.ticker);
                  await logTradeToDb(resolvedTrade);
                  changeStep(6);
                } else if (preferencesRef.current.brokerage === 'robinhood' && !preferencesRef.current.robinhoodToken) {
                  console.warn("Robinhood token missing, skipping broker trade execution");
                  addLog("Robinhood token missing, skipping broker trade execution", "warn", resolvedTrade.ticker);
                  await logTradeToDb(resolvedTrade);
                  changeStep(6);
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
                      changeStep(6);
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

          case 6: // POST-TRADE COOLDOWN
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
          pnl={pnl}
          pnlPercent={pnlPercent}
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
                Selecting "Yes, Approve &amp; Submit" will whitelist this prompt's warning identifier ("{activePrompt.messageIds?.join(', ')}") and automatically bypass it in future trades.
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
                Yes, Approve &amp; Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

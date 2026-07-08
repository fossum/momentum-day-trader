import React, { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { UserPreferences } from '../types';
import { 
  TrendingUp, 
  LogOut, 
  Settings, 
  BookOpen, 
  Activity, 
  BarChart3, 
  Calendar,
  AlertCircle,
  Info,
  ArrowRight
} from 'lucide-react';

// Hooks
import { useBrokerage } from '../hooks/useBrokerage';
import { useMarketScanner } from '../hooks/useMarketScanner';
import { useStockSearch } from '../hooks/useStockSearch';
import { useTradeLogging } from '../hooks/useTradeLogging';

// Components
import { StatsOverview } from './dashboard/StatsOverview';
import { MarketScanner } from './dashboard/MarketScanner';
import { StockResearch } from './dashboard/StockResearch';
import { TradeLogForm } from './dashboard/TradeLogForm';
import { TradeHistoryTable } from './dashboard/TradeHistoryTable';
import { SettingsModal } from './dashboard/SettingsModal';
import { ExecutionEngine } from './ExecutionEngine';
import { calculateTradePnlPercent } from '../lib/utils';

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<'manual' | 'live' | 'performance' | 'historical'>('live');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>({ 
    markets: ['NASDAQ', 'NYSE', 'OTC', 'Warrants', 'Foreign'], 
    robinhoodOnly: true, 
    brokerage: 'none' 
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  
  // Settings Form Credentials state
  const [rhUsername, setRhUsername] = useState('');
  const [rhPassword, setRhPassword] = useState('');

  // Manual Log Trade Form state
  const [ticker, setTicker] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [shares, setShares] = useState('');
  const [strategy, setStrategy] = useState('Gap and Go');
  const [notes, setNotes] = useState('');

  const strategies = [
    'Gap and Go',
    'Bull Flag',
    'Flat Top Breakout',
    'Reversal',
    'VWAP Bounce',
    'Momentum Breakout'
  ];

  // Load user settings preferences on mount
  useEffect(() => {
    if (!auth.currentUser) return;
    const fetchPrefs = async () => {
      try {
        const docRef = doc(db, `users/${auth.currentUser?.uid}/preferences`, 'settings');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPreferences(docSnap.data() as UserPreferences);
        }
      } catch (err) {
        console.warn('Error fetching preferences:', err);
      }
    };
    fetchPrefs();
  }, []);

  // Initialize Hooks
  const { 
    isRhValidating, 
    rhMessage, 
    setRhMessage, 
    validateRobinhood 
  } = useBrokerage(preferences, retryTrigger);

  const {
    gainers,
    loadingGainers,
    isScannerHours
  } = useMarketScanner();

  const {
    quote,
    news,
    loadingSearch,
    searchTicker,
    setSearchTicker,
    performSearch
  } = useStockSearch();

  const {
    trades,
    dbError,
    setDbError,
    isSubmitting,
    confirmClear,
    logTrade,
    clearHistory
  } = useTradeLogging(preferences);

  // Settings save handler
  const savePreferences = async (newPrefs: UserPreferences, shouldCloseSettings = true) => {
    if (!auth.currentUser) return;
    setSavingPrefs(true);
    try {
      const docRef = doc(db, `users/${auth.currentUser.uid}/preferences`, 'settings');
      await setDoc(docRef, newPrefs);
      setPreferences(newPrefs);
      setRetryTrigger(prev => prev + 1); // Trigger broker connection retry
      if (shouldCloseSettings) {
        setIsSettingsOpen(false);
      }
    } catch (err: any) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser?.uid}/preferences/settings`);
      } catch (handledErr: any) {
        let msg = 'Database connection error.';
        try {
          const parsed = JSON.parse(handledErr.message);
          msg = parsed.error || msg;
        } catch {
          msg = handledErr.message;
        }
        setDbError(msg);
      }
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleValidateRobinhood = async () => {
    const token = await validateRobinhood(rhUsername, rhPassword);
    if (token) {
      const updatedPrefs = { ...preferences, robinhoodToken: token };
      setPreferences(updatedPrefs);
      setRhUsername('');
      setRhPassword('');
    }
  };

  const handleLogTradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !entryPrice || !exitPrice || !shares) return;
    try {
      await logTrade(
        ticker.toUpperCase(),
        parseFloat(entryPrice),
        parseFloat(exitPrice),
        parseFloat(shares),
        strategy,
        notes
      );
      // Reset form
      setTicker('');
      setEntryPrice('');
      setExitPrice('');
      setShares('');
      setNotes('');
    } catch (err) {
      console.warn('Manual log trade failed:', err);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSearch(searchTicker);
  };

  const handleSelectTicker = (symbol: string) => {
    setActiveTab('manual');
    performSearch(symbol);
    setTicker(symbol); // Prepopulate manual log form ticker
  };

  // Filters for historical trade logs tab
  const [historySearch, setHistorySearch] = useState('');
  const [historyStrategyFilter, setHistoryStrategyFilter] = useState('All');
  const [historyOutcomeFilter, setHistoryOutcomeFilter] = useState('All');

  const filteredTrades = trades.filter((trade) => {
    const searchString = historySearch.toLowerCase();
    const strat = trade.strategy || '';
    const note = trade.notes || '';
    
    const matchesSearch = !historySearch || 
                          (trade.ticker && trade.ticker.toLowerCase().includes(searchString)) || 
                          strat.toLowerCase().includes(searchString) ||
                          note.toLowerCase().includes(searchString);
    
    const matchesStrategy = historyStrategyFilter === 'All' || 
                            strat === historyStrategyFilter || 
                            strat.includes(historyStrategyFilter);
    
    let matchesOutcome = true;
    const diff = trade.exitPrice - trade.entryPrice;
    if (historyOutcomeFilter === 'Wins') {
      matchesOutcome = diff > 0;
    } else if (historyOutcomeFilter === 'Losses') {
      matchesOutcome = diff < 0;
    } else if (historyOutcomeFilter === 'Scratches') {
      matchesOutcome = diff === 0;
    }

    return matchesSearch && matchesStrategy && matchesOutcome;
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Momentum Log</h1>
              <p className="text-[10px] text-zinc-500 font-mono hidden sm:block">ACTIVE SIMULATION SUITE</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-2 rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus:outline-none"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              onClick={() => auth.signOut()}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100 focus:outline-none"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
        {dbError && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 animate-fadeIn">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <h3 className="text-sm font-medium text-red-500">Database Connection Error</h3>
              <p className="mt-1 text-sm text-red-400/80">{dbError}</p>
            </div>
          </div>
        )}

        {/* Navigation Tabs Bar */}
        <div className="mb-8 border-b border-zinc-800">
          <div className="flex flex-wrap gap-1 sm:gap-2 -mb-px" aria-label="Tabs">
            {[
              { id: 'manual', name: 'Manual Work', icon: BookOpen, count: null },
              { id: 'live', name: 'Live Data', icon: Activity, count: isScannerHours ? 'LIVE' : null },
              { id: 'performance', name: 'Performance Analysis', icon: BarChart3, count: null },
              { id: 'historical', name: 'Historical Data', icon: Calendar, count: trades.length },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-all duration-200 focus:outline-none ${
                    isActive
                      ? 'border-emerald-500 text-emerald-400 font-semibold'
                      : 'border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-500 animate-pulse' : 'text-zinc-500'}`} />
                  <span>{tab.name}</span>
                  {tab.count !== null && (
                    <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                      tab.id === 'live' 
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* TAB 1: MANUAL WORK */}
        {activeTab === 'manual' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 animate-fadeIn">
            {/* Left side: Log Trade Form */}
            <div className="lg:col-span-1 space-y-6">
              <TradeLogForm
                ticker={ticker}
                setTicker={setTicker}
                shares={shares}
                setShares={setShares}
                entryPrice={entryPrice}
                setEntryPrice={setEntryPrice}
                exitPrice={exitPrice}
                setExitPrice={setExitPrice}
                strategy={strategy}
                setStrategy={setStrategy}
                notes={notes}
                setNotes={setNotes}
                isSubmitting={isSubmitting}
                onSubmit={handleLogTradeSubmit}
                strategies={strategies}
              />

              {/* Quick tip */}
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 text-xs text-zinc-400 flex items-start gap-2">
                <Info className="h-4 w-4 text-zinc-500 flex-shrink-0 mt-0.5" />
                <p>
                  You can use the <strong>Momentum Scanner</strong> on the right to research stocks. Clicking on search results or live gainers will automatically populate this manual log form.
                </p>
              </div>
            </div>

            {/* Right side: Momentum Scanner / Stock Research */}
            <div className="lg:col-span-2 space-y-6">
              <StockResearch
                quote={quote}
                news={news}
                loadingSearch={loadingSearch}
                searchTicker={searchTicker}
                onSearchChange={setSearchTicker}
                onSearchSubmit={handleSearchSubmit}
              />
            </div>
          </div>
        )}

        {/* TAB 2: LIVE DATA & AUTOMATED SIMULATION */}
        <div className={activeTab === 'live' ? 'block animate-fadeIn' : 'hidden'}>
          <div className="space-y-6 max-w-full">
            <ExecutionEngine
              onSelectTicker={handleSelectTicker}
              preferences={preferences}
              onSavePreferences={(newPrefs) => savePreferences(newPrefs, false)}
              retryTrigger={retryTrigger}
              topGainersSection={
                <MarketScanner
                  gainers={gainers}
                  loadingGainers={loadingGainers}
                  isScannerHours={isScannerHours}
                  onSelectGainer={handleSelectTicker}
                />
              }
              helperTextSection={
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
                  <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wide flex items-center gap-1.5 font-sans">
                    <Info className="h-4 w-4 text-emerald-500" />
                    Simulation & Live Data Suite Instructions
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400 leading-relaxed">
                    <div className="bg-zinc-950/40 p-3 rounded-lg border border-zinc-950">
                      <span className="font-semibold text-zinc-300 block mb-1">How it works:</span>
                      The <strong>Live Execution Engine</strong> simulates live active scanners catching setups, formulating entry bids, choosing tight stops (based on Ross Cameron breakout guidelines), trailing, and executing exits.
                    </div>
                    <div className="bg-zinc-950/40 p-3 rounded-lg border border-zinc-950">
                      <span className="font-semibold text-zinc-300 block mb-1">History Synchronization:</span>
                      When an execution engine trade concludes with profit/scratch/loss outcomes, the result is automatically added to your cloud Firestore logs and visible in the <strong>Historical Data</strong> tab.
                    </div>
                  </div>
                </div>
              }
            />
          </div>
        </div>

        {/* TAB 3: PERFORMANCE ANALYSIS */}
        {activeTab === 'performance' && (
          <StatsOverview trades={trades} />
        )}

        {/* TAB 4: HISTORICAL DATA & EXPORT */}
        {activeTab === 'historical' && (
          <TradeHistoryTable
            trades={trades}
            filteredTrades={filteredTrades}
            historySearch={historySearch}
            setHistorySearch={setHistorySearch}
            historyStrategyFilter={historyStrategyFilter}
            setHistoryStrategyFilter={setHistoryStrategyFilter}
            historyOutcomeFilter={historyOutcomeFilter}
            setHistoryOutcomeFilter={setHistoryOutcomeFilter}
            confirmClear={confirmClear}
            onClearHistory={clearHistory}
            strategies={strategies}
          />
        )}

      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        preferences={preferences}
        setPreferences={setPreferences}
        onSave={savePreferences}
        savingPrefs={savingPrefs}
        rhUsername={rhUsername}
        setRhUsername={setRhUsername}
        rhPassword={rhPassword}
        setRhPassword={setRhPassword}
        rhValidating={isRhValidating}
        rhMessage={rhMessage}
        onValidateRobinhood={handleValidateRobinhood}
      />
    </div>
  );
}

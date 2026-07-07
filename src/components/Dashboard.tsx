import React, { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { Trade, FmpQuote, FmpNews, MarketGainer } from '../types';
import { 
  LineChart, 
  Search, 
  LogOut, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  Trash2, 
  BookOpen, 
  Calendar, 
  Clock, 
  BarChart3, 
  Sparkles, 
  PlusCircle, 
  Info,
  Layers,
  ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { DryModeSimulator } from './DryModeSimulator';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Cell 
} from 'recharts';

function isMarketScannerActive(): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const formatted = formatter.format(new Date());
    
    const weekdayMatch = formatted.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
    const timeMatch = formatted.match(/(\d{1,2}):(\d{2})/);
    
    if (!weekdayMatch || !timeMatch) return true;
    
    const weekday = weekdayMatch[1];
    if (weekday === 'Sat' || weekday === 'Sun') {
      return false;
    }
    
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    
    const isPM = /PM/i.test(formatted);
    const isAM = /AM/i.test(formatted);
    let hour24 = hour;
    if (isPM && hour < 12) hour24 += 12;
    if (isAM && hour === 12) hour24 = 0;
    
    const totalMinutes = hour24 * 60 + minute;
    const startMinutes = 6 * 60; // 6:00 AM
    const endMinutes = 10 * 60; // 10:00 AM
    
    return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
  } catch (error) {
    console.error('Timezone formatter error:', error);
    return true; // fail-safe
  }
}

export function Dashboard() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [searchTicker, setSearchTicker] = useState('');
  const [quote, setQuote] = useState<FmpQuote | null>(null);
  const [news, setNews] = useState<FmpNews[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [gainers, setGainers] = useState<MarketGainer[]>([]);
  const [loadingGainers, setLoadingGainers] = useState(false);
  const [isScannerHours, setIsScannerHours] = useState(isMarketScannerActive());

  // Form state
  const [ticker, setTicker] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [shares, setShares] = useState('');
  const [strategy, setStrategy] = useState('Gap and Go');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strategies = [
    'Gap and Go',
    'Bull Flag',
    'Flat Top Breakout',
    'Reversal',
    'VWAP Bounce',
    'Momentum Breakout'
  ];

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const q = query(
      collection(db, `users/${auth.currentUser.uid}/trades`),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tradesData: Trade[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        tradesData.push({
          id: doc.id,
          ...data,
          // Handle Firestore timestamp
          timestamp: data.timestamp?.toMillis() || Date.now()
        } as Trade);
      });
      setTrades(tradesData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${auth.currentUser?.uid}/trades`);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchGainers = async () => {
      const active = isMarketScannerActive();
      setIsScannerHours(active);
      
      if (!active) {
        setLoadingGainers(false);
        return;
      }

      setLoadingGainers(true);
      try {
        const res = await fetch('/api/market/gainers');
        if (res.ok) {
          const data = await res.json();
          // The API returns a large array, we just want the top 15
          setGainers(Array.isArray(data) ? data.slice(0, 15) : []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingGainers(false);
      }
    };

    fetchGainers();
    // Poll every 30 seconds for new top gainers
    const interval = setInterval(fetchGainers, 30000);
    return () => clearInterval(interval);
  }, []);

  const performSearch = async (symbol: string) => {
    if (!symbol) return;
    const cleanSymbol = symbol.toUpperCase();
    setSearchTicker(cleanSymbol);
    setTicker(cleanSymbol); // prefill the log form ticker
    setLoadingSearch(true);
    try {
      const [quoteRes, newsRes] = await Promise.all([
        fetch(`/api/stock/${cleanSymbol}/quote`),
        fetch(`/api/stock/${cleanSymbol}/news`)
      ]);
      
      const quoteData = await quoteRes.json();
      const newsData = await newsRes.json();
      
      if (quoteData && quoteData.length > 0) {
        setQuote(quoteData[0]);
      } else {
        setQuote(null);
      }
      
      setNews(newsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSearch(false);
    }
  };

  const searchFmp = async (e: React.FormEvent) => {
    e.preventDefault();
    await performSearch(searchTicker);
  };

  const handleLogTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !ticker || !entryPrice || !exitPrice || !shares) return;
    
    setIsSubmitting(true);
    const entry = parseFloat(entryPrice);
    const exit = parseFloat(exitPrice);
    const numShares = parseFloat(shares);
    const pnl = (exit - entry) * numShares;

    try {
      await addDoc(collection(db, `users/${auth.currentUser.uid}/trades`), {
        userId: auth.currentUser.uid,
        ticker: ticker.toUpperCase(),
        entryPrice: entry,
        exitPrice: exit,
        shares: numShares,
        strategy,
        notes,
        pnl,
        timestamp: serverTimestamp()
      });
      
      setTicker('');
      setEntryPrice('');
      setExitPrice('');
      setShares('');
      setNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${auth.currentUser.uid}/trades`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearHistory = async () => {
    if (!auth.currentUser || trades.length === 0) return;
    
    if (!confirmClear) {
      setConfirmClear(true);
      // Auto-reset confirmation after 3 seconds
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }

    try {
      const batch = writeBatch(db);
      trades.forEach((trade) => {
        const tradeRef = doc(db, `users/${auth.currentUser!.uid}/trades`, trade.id);
        batch.delete(tradeRef);
      });
      await batch.commit();
      setConfirmClear(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${auth.currentUser.uid}/trades`);
    }
  };

  const calculateTradePnlPercent = (trade: Trade) => {
    return ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  };

  const totalPnlPercent = trades.reduce((sum, trade) => sum + calculateTradePnlPercent(trade), 0);

  // Active Tab State
  const [activeTab, setActiveTab] = useState<'manual' | 'live' | 'performance' | 'historical'>('manual');

  // Historical Filters State
  const [historySearch, setHistorySearch] = useState('');
  const [historyStrategyFilter, setHistoryStrategyFilter] = useState('All');
  const [historyOutcomeFilter, setHistoryOutcomeFilter] = useState('All');

  // Performance Calculations
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => (t.exitPrice - t.entryPrice) > 0);
  const losingTrades = trades.filter(t => (t.exitPrice - t.entryPrice) < 0);
  const scratchTrades = trades.filter(t => (t.exitPrice - t.entryPrice) === 0);
  
  const winRate = totalTrades > 0 ? Math.round((winningTrades.length / totalTrades) * 100) : 0;

  const tradePercentages = trades.map(t => calculateTradePnlPercent(t));
  const avgGain = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + calculateTradePnlPercent(t), 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? losingTrades.reduce((sum, t) => sum + calculateTradePnlPercent(t), 0) / losingTrades.length 
    : 0;
  
  const bestTrade = tradePercentages.length > 0 ? Math.max(...tradePercentages) : 0;
  const worstTrade = tradePercentages.length > 0 ? Math.min(...tradePercentages) : 0;

  const totalGainsValue = winningTrades.reduce((sum, t) => sum + (t.exitPrice - t.entryPrice) * t.shares, 0);
  const totalLossesValue = Math.abs(losingTrades.reduce((sum, t) => sum + (t.exitPrice - t.entryPrice) * t.shares, 0));
  const profitFactor = totalLossesValue > 0 ? (totalGainsValue / totalLossesValue).toFixed(2) : totalGainsValue > 0 ? 'Infinite' : '0.00';

  // Chart 1: Equity Curve (Cumulative P&L over time)
  // Reversing array to show from oldest to newest chronological trade
  const equityData = [...trades]
    .reverse()
    .reduce((acc: { name: string; return: number; cumulative: number }[], trade, index) => {
      const pnlPct = calculateTradePnlPercent(trade);
      const prevCumulative = index > 0 ? acc[index - 1].cumulative : 0;
      acc.push({
        name: `${index + 1}. ${trade.ticker}`,
        return: parseFloat(pnlPct.toFixed(2)),
        cumulative: parseFloat((prevCumulative + pnlPct).toFixed(2)),
      });
      return acc;
    }, []);

  // Chart 2: Strategy returns breakdown
  const strategyDataMap = trades.reduce((acc: Record<string, { count: number; totalPnl: number }>, trade) => {
    const pnlPct = calculateTradePnlPercent(trade);
    if (!acc[trade.strategy]) {
      acc[trade.strategy] = { count: 0, totalPnl: 0 };
    }
    acc[trade.strategy].count += 1;
    acc[trade.strategy].totalPnl += pnlPct;
    return acc;
  }, {});

  const strategyChartData = Object.keys(strategyDataMap).map(strat => ({
    name: strat,
    count: strategyDataMap[strat].count,
    pnl: parseFloat(strategyDataMap[strat].totalPnl.toFixed(2)),
  }));

  // Filtering for historical tab
  const filteredTrades = trades.filter(trade => {
    const matchesSearch = trade.ticker.toLowerCase().includes(historySearch.toLowerCase()) || 
                          trade.strategy.toLowerCase().includes(historySearch.toLowerCase()) ||
                          (trade.notes && trade.notes.toLowerCase().includes(historySearch.toLowerCase()));
    
    const matchesStrategy = historyStrategyFilter === 'All' || 
                            trade.strategy === historyStrategyFilter || 
                            trade.strategy.includes(historyStrategyFilter);
    
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
          <button
            onClick={() => auth.signOut()}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
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
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold">
                  <PlusCircle className="h-5 w-5 text-emerald-500" />
                  Log Manual Trade
                </h2>
                
                <form onSubmit={handleLogTrade} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Ticker</label>
                      <input
                        type="text"
                        required
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm uppercase placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                        placeholder="AAPL"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Shares</label>
                      <input
                        type="number"
                        required
                        min="1"
                        value={shares}
                        onChange={(e) => setShares(e.target.value)}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                        placeholder="100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Entry ($)</label>
                      <input
                        type="number"
                        required
                        step="0.01"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-400">Exit ($)</label>
                      <input
                        type="number"
                        required
                        step="0.01"
                        value={exitPrice}
                        onChange={(e) => setExitPrice(e.target.value)}
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">Strategy</label>
                    <select
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-zinc-200"
                    >
                      {strategies.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">Notes (Optional)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                      placeholder="Context on this setup..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-md bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting ? 'Saving...' : 'Log Trade'}
                  </button>
                </form>
              </div>

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
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Search className="h-5 w-5 text-blue-500" />
                  Momentum Scanner & Quote Research
                </h2>
                
                <form onSubmit={searchFmp} className="mb-6 flex gap-2">
                  <input
                    type="text"
                    value={searchTicker}
                    onChange={(e) => setSearchTicker(e.target.value.toUpperCase())}
                    className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm uppercase placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                    placeholder="Enter ticker symbol (e.g. SMMT, VERB)"
                  />
                  <button
                    type="submit"
                    disabled={loadingSearch}
                    className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 cursor-pointer"
                  >
                    {loadingSearch ? 'Scanning...' : 'Search'}
                  </button>
                </form>

                {quote && (
                  <div className="mb-6 space-y-4 rounded-xl bg-zinc-950 p-5 border border-zinc-800 animate-fadeIn">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-2xl text-white">{quote.symbol}</span>
                          <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-mono">STOCK DETAILS</span>
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5">{quote.name}</div>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="font-bold text-2xl text-white">${quote.price.toFixed(2)}</div>
                        <div className={`text-xs font-semibold ${quote.changesPercentage >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {quote.changesPercentage >= 0 ? '+' : ''}{quote.changesPercentage.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-zinc-900">
                      <div className="rounded bg-zinc-900/60 p-3">
                        <div className="text-zinc-500">Volume</div>
                        <div className="font-semibold text-zinc-200 text-sm mt-0.5">{(quote.volume / 1000000).toFixed(2)}M</div>
                      </div>
                      <div className="rounded bg-zinc-900/60 p-3">
                        <div className="text-zinc-500">Relative Vol</div>
                        <div className="font-semibold text-zinc-200 text-sm mt-0.5">{quote.avgVolume > 0 ? (quote.volume / quote.avgVolume).toFixed(2) : '-'}x</div>
                      </div>
                      <div className="rounded bg-zinc-900/60 p-3">
                        <div className="text-zinc-500">Day Range</div>
                        <div className="font-semibold text-zinc-200 text-xs mt-1 truncate">${quote.dayLow.toFixed(2)} - ${quote.dayHigh.toFixed(2)}</div>
                      </div>
                      <div className="rounded bg-zinc-900/60 p-3">
                        <div className="text-zinc-500">Float (O/S)</div>
                        <div className="font-semibold text-zinc-200 text-sm mt-0.5">{(quote.sharesOutstanding / 1000000).toFixed(2)}M</div>
                      </div>
                    </div>
                  </div>
                )}

                {news.length > 0 ? (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-2">
                      <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                      Latest Financial News & Market Catalyst
                    </h3>
                    <div className="max-h-[350px] overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                      {news.slice(0, 5).map((n, i) => (
                        <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block p-3 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 hover:border-zinc-700 transition-all group">
                          <div className="text-[10px] text-zinc-500 mb-1 flex items-center justify-between">
                            <span>{n.site}</span>
                            <span>{format(new Date(n.publishedDate), 'MMM d, h:mm a')}</span>
                          </div>
                          <div className="text-sm font-medium text-zinc-200 group-hover:text-blue-400 transition-colors line-clamp-2 leading-relaxed">{n.title}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  quote && (
                    <div className="text-center py-8 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-lg">
                      No recent news cataloged for {quote.symbol}.
                    </div>
                  )
                )}

                {!quote && !loadingSearch && (
                  <div className="text-center py-12 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl bg-zinc-950/20">
                    <Search className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                    Enter a ticker in the search bar above to fetch live metrics and catalogs.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE DATA & AUTOMATED SIMULATION */}
        <div className={activeTab === 'live' ? 'block animate-fadeIn' : 'hidden'}>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* Column 1: Dry-Mode Simulator Controls */}
            <div className="lg:col-span-1 space-y-6">
              <DryModeSimulator onSelectTicker={performSearch} />
            </div>

            {/* Column 2: Live Gainers & Feed */}
            <div className="lg:col-span-2 space-y-6">
              {/* Top Gainers Card */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                      <Activity className={`h-5 w-5 ${isScannerHours ? 'text-emerald-500' : 'text-zinc-500'}`} />
                      Live Top Gainers
                    </h2>
                    <p className="text-xs text-zinc-500">6:00 AM - 10:00 AM EST (Mon-Fri)</p>
                  </div>
                  {loadingGainers && (
                    <div className="text-xs text-emerald-400 flex items-center gap-2 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20">
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
                      The automated live gainer scanner operates during pre-market and early market hours:<br />
                      <strong className="text-emerald-400">6:00 AM - 10:00 AM EST, Monday through Friday</strong>.<br />
                      <span className="text-xs text-zinc-500 mt-2 block">Outside of these hours, use the Dry-Mode Simulator on the left to simulate continuous active trading.</span>
                    </div>
                  ) : gainers.length === 0 && !loadingGainers ? (
                    <div className="text-center text-zinc-500 py-6 text-sm bg-zinc-950/25 rounded-lg border border-zinc-800">No major market gainers tracked in this slot.</div>
                  ) : (
                    <div className="flex gap-4 pb-2 overflow-x-auto custom-scrollbar">
                      {gainers.map((gainer) => (
                        <button
                          key={gainer.symbol}
                          onClick={() => {
                            setActiveTab('manual');
                            performSearch(gainer.symbol);
                          }}
                          className="flex-shrink-0 w-44 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-left transition-all hover:border-emerald-500 hover:bg-zinc-900 cursor-pointer"
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

              {/* Informative Help Guide */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
                <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wide flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-emerald-500" />
                  Simulation & Live Data Suite Instructions
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400 leading-relaxed">
                  <div className="bg-zinc-950/40 p-3 rounded-lg border border-zinc-950">
                    <span className="font-semibold text-zinc-300 block mb-1">How it works:</span>
                    The <strong>Dry-Mode Simulator</strong> simulates live active scanners catching setups, formulating entry bids, choosing tight stops (based on Ross Cameron breakout guidelines), trailing, and executing exits.
                  </div>
                  <div className="bg-zinc-950/40 p-3 rounded-lg border border-zinc-950">
                    <span className="font-semibold text-zinc-300 block mb-1">History Synchronization:</span>
                    When a simulator trade concludes with profit/scratch/loss outcomes, the result is automatically added to your cloud Firestore logs and visible in the <strong>Historical Data</strong> tab.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TAB 3: PERFORMANCE ANALYSIS */}
        {activeTab === 'performance' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Cumulative Return</span>
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                </div>
                <div className={`mt-2 text-3xl font-bold ${totalPnlPercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
                </div>
                <span className="text-[10px] text-zinc-500 block mt-1">Sum of trade return percentages</span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Win Rate</span>
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                </div>
                <div className="mt-2 text-3xl font-bold text-white">{winRate}%</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span className="text-emerald-500 font-medium">{winningTrades.length} Wins</span>
                  <span>/</span>
                  <span className="text-red-400 font-medium">{losingTrades.length} Losses</span>
                  {scratchTrades.length > 0 && (
                    <>
                      <span>/</span>
                      <span className="text-zinc-400 font-medium">{scratchTrades.length} Scratches</span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Profit Factor</span>
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="mt-2 text-3xl font-bold text-white">{profitFactor}</div>
                <span className="text-[10px] text-zinc-500 block mt-1">Ratio of total gross gains to losses</span>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-400">Total Volume</span>
                  <Layers className="h-4 w-4 text-zinc-500" />
                </div>
                <div className="mt-2 text-3xl font-bold text-white">{totalTrades}</div>
                <span className="text-[10px] text-zinc-500 block mt-1">Total recorded simulation logs</span>
              </div>
            </div>

            {/* Performance Ratios Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-zinc-900 p-6 rounded-xl border border-zinc-800">
              <div className="p-3 bg-zinc-950/40 rounded border border-zinc-950">
                <div className="text-xs text-zinc-500">Avg Gain (Winners)</div>
                <div className="text-sm font-semibold text-emerald-500 mt-0.5">+{avgGain.toFixed(2)}%</div>
              </div>
              <div className="p-3 bg-zinc-950/40 rounded border border-zinc-950">
                <div className="text-xs text-zinc-500">Avg Loss (Losers)</div>
                <div className="text-sm font-semibold text-red-500 mt-0.5">{avgLoss.toFixed(2)}%</div>
              </div>
              <div className="p-3 bg-zinc-950/40 rounded border border-zinc-950">
                <div className="text-xs text-zinc-500">Best Trade</div>
                <div className="text-sm font-semibold text-emerald-400 mt-0.5">+{bestTrade.toFixed(2)}%</div>
              </div>
              <div className="p-3 bg-zinc-950/40 rounded border border-zinc-950">
                <div className="text-xs text-zinc-500">Worst Trade</div>
                <div className="text-sm font-semibold text-red-400 mt-0.5">{worstTrade.toFixed(2)}%</div>
              </div>
            </div>

            {/* Visual Charts */}
            {totalTrades > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Equity Curve Area Chart */}
                <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Equity Curve (% Cumulative Return)</h3>
                    <p className="text-xs text-zinc-500">Chronological growth of returns sequential by trade</p>
                  </div>
                  <div className="h-72 w-full text-xs font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={equityData}
                        margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={totalPnlPercent >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0.2}/>
                            <stop offset="95%" stopColor={totalPnlPercent >= 0 ? '#10b981' : '#f43f5e'} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis dataKey="name" stroke="#71717a" />
                        <YAxis stroke="#71717a" unit="%" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                          labelClassName="text-zinc-400 font-semibold"
                          formatter={(value: any) => [`${value}%`, 'Cumulative Return']}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="cumulative" 
                          stroke={totalPnlPercent >= 0 ? '#10b981' : '#f43f5e'} 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorCumulative)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Strategy Performance Bar Chart */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                  <div className="mb-4">
                    <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Returns by Strategy</h3>
                    <p className="text-xs text-zinc-500">Aggregate returns percentage grouped by strategy</p>
                  </div>
                  <div className="h-72 w-full text-xs font-mono">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={strategyChartData}
                        margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis dataKey="name" stroke="#71717a" tickFormatter={(t) => t.slice(0, 10) + '...'} />
                        <YAxis stroke="#71717a" unit="%" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a' }}
                          labelClassName="text-zinc-400 font-semibold"
                          formatter={(value: any) => [`${value}%`, 'Total Return']}
                        />
                        <Bar dataKey="pnl" name="Total Return">
                          {strategyChartData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-20 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/50">
                <BarChart3 className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
                <h3 className="font-semibold text-zinc-300 text-base">No Analytical Data</h3>
                <p className="text-sm text-zinc-500 mt-1">Please log manual trades or launch the simulator in the Live Data tab to compile charts.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: HISTORICAL DATA & EXPORT */}
        {activeTab === 'historical' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Advanced Filters Bar */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4 sm:space-y-0 sm:flex sm:items-center sm:gap-4 sm:justify-between">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-white"
                    placeholder="Search ticker, details..."
                  />
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                </div>

                {/* Strategy Filter */}
                <div>
                  <select
                    value={historyStrategyFilter}
                    onChange={(e) => setHistoryStrategyFilter(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-zinc-300"
                  >
                    <option value="All">All Strategies</option>
                    {strategies.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Outcome Filter */}
                <div>
                  <select
                    value={historyOutcomeFilter}
                    onChange={(e) => setHistoryOutcomeFilter(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-zinc-300"
                  >
                    <option value="All">All Outcomes</option>
                    <option value="Wins">Wins Only</option>
                    <option value="Losses">Losses Only</option>
                    <option value="Scratches">Scratches Only</option>
                  </select>
                </div>
              </div>

              {/* Clear History Trigger */}
              <div className="flex items-center justify-end">
                {trades.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                      confirmClear 
                        ? 'border-red-500 bg-red-500 text-white hover:bg-red-600 animate-pulse'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400'
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {confirmClear ? 'Click Again to Clear ALL' : 'Reset History'}
                  </button>
                )}
              </div>
            </div>

            {/* List Table */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col min-h-[500px]">
              <div className="border-b border-zinc-800 p-5 flex items-center justify-between bg-zinc-900">
                <div className="flex items-center gap-4">
                  <h2 className="text-md font-bold text-white flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-500" />
                    Trade Logs Database
                  </h2>
                  <div className="text-xs text-zinc-500 font-mono">Showing {filteredTrades.length} of {trades.length} records</div>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-0">
                {filteredTrades.length === 0 ? (
                  <div className="flex h-96 flex-col items-center justify-center text-zinc-500 gap-2">
                    <Calendar className="h-10 w-10 text-zinc-700" />
                    <span>No trades match your search filter constraints.</span>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-950/90 text-zinc-400 backdrop-blur-sm border-b border-zinc-800">
                      <tr>
                        <th className="px-6 py-3.5 font-bold uppercase tracking-wider">Date/Time</th>
                        <th className="px-6 py-3.5 font-bold uppercase tracking-wider">Ticker</th>
                        <th className="px-6 py-3.5 font-bold uppercase tracking-wider">Strategy & Log Info</th>
                        <th className="px-6 py-3.5 font-bold uppercase tracking-wider text-right">Size & Price Details</th>
                        <th className="px-6 py-3.5 font-bold uppercase tracking-wider text-right">Return %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40">
                      {filteredTrades.map((trade) => {
                        const tradePnlPct = calculateTradePnlPercent(trade);
                        const isWin = tradePnlPct > 0;
                        const isLoss = tradePnlPct < 0;
                        return (
                          <tr key={trade.id} className="transition-colors hover:bg-zinc-800/20">
                            <td className="px-6 py-4 whitespace-nowrap text-zinc-500 font-mono">
                              {format(new Date(trade.timestamp), 'yyyy-MM-dd HH:mm')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="font-bold text-white text-sm">{trade.ticker}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center rounded-full bg-zinc-800 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                                {trade.strategy}
                              </span>
                              {trade.notes && (
                                <p className="mt-1 text-[11px] text-zinc-400 max-w-[320px] line-clamp-1 italic">{trade.notes}</p>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right font-mono">
                              <div className="text-zinc-200">{trade.shares.toLocaleString()} sh</div>
                              <div className="text-[10px] text-zinc-500">${trade.entryPrice.toFixed(2)} &rarr; ${trade.exitPrice.toFixed(2)}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right font-bold font-mono">
                              <span className={isWin ? 'text-emerald-500' : isLoss ? 'text-red-500' : 'text-zinc-400'}>
                                {isWin ? '+' : ''}{tradePnlPct.toFixed(2)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}


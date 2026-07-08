import React, { useMemo } from 'react';
import { Trade } from '../../types';
import { calculateTradePnlPercent } from '../../lib/utils';
import { 
  TrendingUp, 
  DollarSign, 
  Layers, 
  BarChart3 
} from 'lucide-react';
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

interface StatsOverviewProps {
  trades: Trade[];
}

export function StatsOverview({ trades }: StatsOverviewProps) {
  const stats = useMemo(() => {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => (t.exitPrice - t.entryPrice) > 0);
    const losingTrades = trades.filter(t => (t.exitPrice - t.entryPrice) < 0);
    const scratchTrades = trades.filter(t => (t.exitPrice - t.entryPrice) === 0);
    
    const winRate = totalTrades > 0 ? Math.round((winningTrades.length / totalTrades) * 100) : 0;
    const totalPnlPercent = trades.reduce((sum, trade) => sum + calculateTradePnlPercent(trade), 0);

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
    const profitFactor = totalLossesValue > 0 
      ? (totalGainsValue / totalLossesValue).toFixed(2) 
      : totalGainsValue > 0 ? 'Infinite' : '0.00';

    // Chart 1: Equity Curve
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

    // Chart 2: Strategy performance
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

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      scratchTrades,
      winRate,
      totalPnlPercent,
      avgGain,
      avgLoss,
      bestTrade,
      worstTrade,
      profitFactor,
      equityData,
      strategyChartData
    };
  }, [trades]);

  const {
    totalTrades,
    winningTrades,
    losingTrades,
    scratchTrades,
    winRate,
    totalPnlPercent,
    avgGain,
    avgLoss,
    bestTrade,
    worstTrade,
    profitFactor,
    equityData,
    strategyChartData
  } = stats;

  return (
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
          <p className="text-sm text-zinc-500 mt-1">Please log manual trades or launch the execution engine in the Live Data tab to compile charts.</p>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { Trade } from '../../types';
import { Search, Trash2, Clock, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { calculateTradePnlPercent } from '../../lib/utils';

interface TradeHistoryTableProps {
  trades: Trade[];
  filteredTrades: Trade[];
  historySearch: string;
  setHistorySearch: (val: string) => void;
  historyStrategyFilter: string;
  setHistoryStrategyFilter: (val: string) => void;
  historyOutcomeFilter: string;
  setHistoryOutcomeFilter: (val: string) => void;
  confirmClear: boolean;
  onClearHistory: () => Promise<void>;
  strategies: string[];
}

export function TradeHistoryTable({
  trades,
  filteredTrades,
  historySearch,
  setHistorySearch,
  historyStrategyFilter,
  setHistoryStrategyFilter,
  historyOutcomeFilter,
  setHistoryOutcomeFilter,
  confirmClear,
  onClearHistory,
  strategies
}: TradeHistoryTableProps) {
  return (
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

        {/* Actions Trigger */}
        <div className="flex items-center justify-end gap-2">
          {trades.length > 0 && (
            <>
              <button
                onClick={() => {
                  const csvRows = [];
                  const headers = ['Date', 'Ticker', 'Strategy', 'Notes', 'Shares', 'Entry Price', 'Exit Price', 'Return %'];
                  csvRows.push(headers.join(','));

                  for (const trade of filteredTrades) {
                    const row = [
                      format(new Date(trade.timestamp), 'yyyy-MM-dd HH:mm:ss'),
                      trade.ticker,
                      `"${trade.strategy || ''}"`,
                      `"${trade.notes ? trade.notes.replace(/"/g, '""') : ''}"`,
                      trade.shares,
                      trade.entryPrice,
                      trade.exitPrice,
                      calculateTradePnlPercent(trade).toFixed(2)
                    ];
                    csvRows.push(row.join(','));
                  }

                  const csvString = csvRows.join('\n');
                  const blob = new Blob([csvString], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.setAttribute('hidden', '');
                  a.setAttribute('href', url);
                  a.setAttribute('download', `trade_history_${format(new Date(), 'yyyy-MM-dd')}.csv`);
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-700 hover:text-white cursor-pointer focus:outline-none"
              >
                Export CSV
              </button>
              <button
                onClick={onClearHistory}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer focus:outline-none ${
                  confirmClear
                    ? 'border-red-500 bg-red-500 text-white hover:bg-red-600 animate-pulse'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirmClear ? 'Click Again to Clear ALL' : 'Reset History'}
              </button>
            </>
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
  );
}

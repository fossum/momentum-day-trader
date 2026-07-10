import React from 'react';
import { FmpQuote, FmpNews } from '../../types';
import { Search, Sparkles, Info } from 'lucide-react';
import { format } from 'date-fns';
import { formatCompact } from '../../hooks/usePatternDetector';

interface StockResearchProps {
  quote: FmpQuote | null;
  news: FmpNews[];
  loadingSearch: boolean;
  searchTicker: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
}

export function StockResearch({
  quote,
  news,
  loadingSearch,
  searchTicker,
  onSearchChange,
  onSearchSubmit
}: StockResearchProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Search className="h-5 w-5 text-blue-500" />
        Momentum Scanner & Quote Research
      </h2>
      
      <form onSubmit={onSearchSubmit} className="mb-6 flex gap-2">
        <input
          type="text"
          value={searchTicker}
          onChange={(e) => onSearchChange(e.target.value.toUpperCase())}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm uppercase placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
          placeholder="Enter ticker symbol (e.g. SMMT, VERB)"
        />
        <button
          type="submit"
          disabled={loadingSearch}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 cursor-pointer focus:outline-none"
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
              <div className="font-semibold text-zinc-200 text-sm mt-0.5">
                {quote.sharesOutstanding && quote.sharesOutstanding > 0 
                  ? formatCompact(quote.sharesOutstanding) 
                  : 'Unknown'}
              </div>
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
  );
}

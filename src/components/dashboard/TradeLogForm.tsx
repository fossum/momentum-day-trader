import React from 'react';
import { PlusCircle } from 'lucide-react';

interface TradeLogFormProps {
  ticker: string;
  setTicker: (val: string) => void;
  shares: string;
  setShares: (val: string) => void;
  entryPrice: string;
  setEntryPrice: (val: string) => void;
  exitPrice: string;
  setExitPrice: (val: string) => void;
  strategy: string;
  setStrategy: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  strategies: string[];
}

export function TradeLogForm({
  ticker,
  setTicker,
  shares,
  setShares,
  entryPrice,
  setEntryPrice,
  exitPrice,
  setExitPrice,
  strategy,
  setStrategy,
  notes,
  setNotes,
  isSubmitting,
  onSubmit,
  strategies
}: TradeLogFormProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <PlusCircle className="h-5 w-5 text-emerald-500" />
        Log Manual Trade
      </h2>
      
      <form onSubmit={onSubmit} className="space-y-4">
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
          className="w-full rounded-md bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer focus:outline-none"
        >
          {isSubmitting ? 'Saving...' : 'Log Trade'}
        </button>
      </form>
    </div>
  );
}

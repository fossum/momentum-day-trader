export interface Trade {
  id: string;
  userId: string;
  ticker: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  strategy: string;
  notes: string;
  timestamp: number;
  pnl: number;
}

export interface FmpQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  volume: number;
  avgVolume: number;
  exchange: string;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  earningsAnnouncement: string;
  sharesOutstanding: number;
  timestamp: number;
}

export interface FmpNews {
  symbol: string;
  publishedDate: string;
  title: string;
  image: string;
  site: string;
  text: string;
  url: string;
}

export interface MarketGainer {
  symbol: string;
  name: string;
  change: number;
  price: number;
  changesPercentage: number;
}

export interface UserPreferences {
  markets: string[];
  robinhoodOnly: boolean;
  brokerage?: 'none' | 'robinhood' | 'lightspeed' | 'interactivebrokers';
  robinhoodToken?: string;
  lightspeedKey?: string;
  ibkrUrl?: string;
  trackedTickers?: string[];
  blacklistedTickers?: string[];
  positionSize?: string;
}

export interface LowFloatTicker {
  ticker: string;
  float: string;
  market: 'NASDAQ' | 'NYSE' | 'OTC' | 'Warrants' | 'Foreign';
  onRobinhood: boolean;
  companyName: string;
}

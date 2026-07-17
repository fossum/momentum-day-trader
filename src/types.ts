/**
 * @file types.ts
 * @description Type definitions for the AI Studio Trader application,
 * representing trades, market indicators, preferences, and simulation states.
 */

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
  approvedIbkrWarnings?: string[];
  extendedTradingHours?: boolean;
  catalystValidation?: 'gemini' | 'keywords' | 'bypassed';
  checkPriceRange?: boolean;
  checkDailyGain?: boolean;
  checkRelativeVol?: boolean;
  checkSharesFloat?: boolean;
  checkTradingWindow?: boolean;
  checkBullFlagPattern?: boolean;
  checkStopDistance?: boolean;
  checkRiskReward?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minGainPercent?: number;
  minRvol?: number;
  maxFloatMillions?: number;
  maxStopDistance?: number;
  minStopDistance?: number;
  minRewardRiskRatio?: number;
  maxProximityPercent?: number;
  simulationSpeed?: number;
  maxFlagpoleRedCandles?: number;
  maxPullbackGreenCandles?: number;
  /**
   * The current active simulated trade state, saved to the database.
   */
  currentTrade?: SimulatedTrade | null;
}

export interface LowFloatTicker {
  ticker: string;
  float: string;
  market: 'NASDAQ' | 'NYSE' | 'OTC' | 'Warrants' | 'Foreign';
  onRobinhood: boolean;
  companyName: string;
}

export interface LogMessage {
  id: string;
  text: string;
  type: 'info' | 'scan' | 'found' | 'exec' | 'success' | 'fail' | 'warn' | 'error';
  time: string;
  ticker?: string;
}

export interface SimulatedTrade {
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


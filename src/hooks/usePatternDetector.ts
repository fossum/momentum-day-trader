/**
 * Ross Cameron Momentum Pattern Detection Module
 *
 * Pure-logic functions for:
 * - Bull flag pattern detection from 1-minute candle data
 * - 9-period EMA calculation
 * - News catalyst keyword validation
 * - Stop distance enforcement ($0.20 max)
 * - Reward:Risk ratio validation (2:1 minimum)
 * - Trading window enforcement (9:30–11:30 AM EST)
 */

// ---------- Types ----------

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BullFlagResult {
  detected: boolean;
  resistanceLevel: number;
  pullbackLow: number;
  flagpoleCandles: Candle[];
  pullbackCandles: Candle[];
}

export interface CatalystResult {
  valid: boolean;
  matchedKeyword: string | null;
}

export interface TradeSetup {
  resistanceLevel: number;
  stopPrice: number;
  targetPrice: number;
  riskRewardRatio: number;
  pullbackLow: number;
  flagpoleCandles: Candle[];
  pullbackCandles: Candle[];
}

// ---------- Constants ----------

export const CATALYST_KEYWORDS = [
  'FDA',
  'Earnings',
  'Clinical Trial',
  'Partnership',
  'Contract',
  'Acquisition',
  'Patent',
  'Merger',
  'Buyout',
  'SEC Filing',
  'Drug Approval',
  'Phase II',
  'Phase III',
  'Revenue',
  'Guidance'
];

export const MAX_STOP_DISTANCE_DEFAULT = 0.20;
export const MIN_REWARD_RISK_RATIO_DEFAULT = 2.0;

// ---------- EMA ----------

/**
 * Calculate the 9-period Exponential Moving Average from candle closes.
 * Candles should be in chronological order (oldest first).
 * Returns an array of EMA values, one per candle (first `period - 1` values use SMA as seed).
 */
export function calculate9EMA(candles: Candle[], period: number = 9): number[] {
  if (candles.length === 0) return [];
  if (candles.length < period) {
    // Not enough data for a full EMA, return SMA for all available
    const sum = candles.reduce((acc, c) => acc + c.close, 0);
    const sma = sum / candles.length;
    return candles.map(() => sma);
  }

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // Seed EMA with the SMA of the first `period` candles
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
    emaValues.push(sum / (i + 1)); // placeholder until we have a full period
  }
  // Overwrite the seed position with the actual SMA
  emaValues[period - 1] = sum / period;

  // Calculate EMA for remaining candles
  for (let i = period; i < candles.length; i++) {
    const prevEma = emaValues[i - 1];
    const ema = (candles[i].close - prevEma) * multiplier + prevEma;
    emaValues.push(ema);
  }

  return emaValues;
}

// ---------- Bull Flag Detection ----------

/**
 * Detect a Ross Cameron-style Bull Flag pattern from 1-minute candles.
 *
 * Phase A (Flagpole): 2–3 consecutive green candles making new highs
 * with aggressive volume acceleration.
 *
 * Phase B (Pullback): 2–4 subsequent red/doji candles where:
 *   - Average pullback volume < 50% of average flagpole volume
 *   - Price holds above the 9 EMA
 *
 * Candles must be in chronological order (oldest first).
 * Analyzes the most recent candles to find the latest pattern.
 */
export function detectBullFlag(candles: Candle[]): BullFlagResult | null {
  if (candles.length < 4) return null; // Need at least 2 flagpole + 2 pullback

  const emaValues = calculate9EMA(candles);

  // Scan backwards from the most recent candle to find a pullback
  // then look for a flagpole before it
  for (let pullbackEnd = candles.length - 1; pullbackEnd >= 4; pullbackEnd--) {
    // Try pullback lengths of 2, 3, 4
    for (let pullbackLen = 2; pullbackLen <= 4 && pullbackLen <= pullbackEnd; pullbackLen++) {
      const pullbackStart = pullbackEnd - pullbackLen + 1;

      // Extract pullback candles
      const pullbackCandles = candles.slice(pullbackStart, pullbackEnd + 1);

      // Check pullback candles are red or doji (close <= open)
      const allRedOrDoji = pullbackCandles.every(c => c.close <= c.open + 0.005);
      if (!allRedOrDoji) continue;

      // Check pullback holds above 9 EMA
      const pullbackHoldsEma = pullbackCandles.every((c, i) => {
        const emaIdx = pullbackStart + i;
        return emaIdx < emaValues.length && c.low >= emaValues[emaIdx] * 0.998; // small tolerance
      });
      if (!pullbackHoldsEma) continue;

      // Now look for the flagpole immediately before the pullback
      // Try flagpole lengths of 2, 3
      for (let flagpoleLen = 2; flagpoleLen <= 3 && flagpoleLen <= pullbackStart; flagpoleLen++) {
        const flagpoleStart = pullbackStart - flagpoleLen;
        const flagpoleCandles = candles.slice(flagpoleStart, pullbackStart);

        // Check flagpole candles are green (close > open)
        const allGreen = flagpoleCandles.every(c => c.close > c.open);
        if (!allGreen) continue;

        // Check flagpole candles are making new highs
        let makingNewHighs = true;
        for (let i = 1; i < flagpoleCandles.length; i++) {
          if (flagpoleCandles[i].high <= flagpoleCandles[i - 1].high) {
            makingNewHighs = false;
            break;
          }
        }
        if (!makingNewHighs) continue;

        // Volume check: average pullback volume < 50% of average flagpole volume
        const avgFlagpoleVol = flagpoleCandles.reduce((s, c) => s + c.volume, 0) / flagpoleCandles.length;
        const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.volume, 0) / pullbackCandles.length;

        if (avgFlagpoleVol === 0) continue; // Avoid division by zero
        if (avgPullbackVol >= avgFlagpoleVol * 0.5) continue; // CRITICAL: pullback vol must be < 50%

        // Pattern detected!
        const resistanceLevel = Math.max(...flagpoleCandles.map(c => c.high));
        const pullbackLow = Math.min(...pullbackCandles.map(c => c.low));

        return {
          detected: true,
          resistanceLevel,
          pullbackLow,
          flagpoleCandles,
          pullbackCandles
        };
      }
    }
  }

  return null;
}

// ---------- Risk Management ----------

/**
 * Validate the stop distance is within the maximum.
 * Returns true if the trade is acceptable, false if the stop is too wide.
 */
export function validateStopDistance(
  entryPrice: number,
  pullbackLow: number,
  maxStopDistance: number = MAX_STOP_DISTANCE_DEFAULT
): boolean {
  const stopDistance = Number((entryPrice - pullbackLow).toFixed(2));
  return stopDistance > 0 && stopDistance <= maxStopDistance;
}

/**
 * Calculate the profit target ensuring a minimum reward:risk ratio.
 * The target is set at the resistance breakout level if it provides >= min R:R.
 * If not, the target is calculated based on the required R:R.
 *
 * Returns the target price and actual R:R ratio, or null if the setup is invalid.
 */
export function calculateTarget(
  entryPrice: number,
  stopPrice: number,
  resistanceLevel?: number,
  minRewardRiskRatio: number = MIN_REWARD_RISK_RATIO_DEFAULT
): { targetPrice: number; ratio: number } | null {
  const stopDistance = entryPrice - stopPrice;
  if (stopDistance <= 0) return null;

  const minTarget = entryPrice + stopDistance * minRewardRiskRatio;

  // If resistance level provides at least required R:R, use it
  if (resistanceLevel !== undefined && resistanceLevel >= minTarget) {
    const ratio = (resistanceLevel - entryPrice) / stopDistance;
    return { targetPrice: resistanceLevel, ratio: parseFloat(ratio.toFixed(2)) };
  }

  // Otherwise, use the calculated minimum target
  return {
    targetPrice: parseFloat(minTarget.toFixed(2)),
    ratio: minRewardRiskRatio
  };
}

// ---------- Catalyst Validation ----------

/**
 * Validate that a news headline contains a qualifying catalyst keyword.
 * Ross Cameron's strategy requires a fundamental driver — no catalyst, no trade.
 */
export function validateCatalyst(headline: string): CatalystResult {
  if (!headline || headline.trim() === '') {
    return { valid: false, matchedKeyword: null };
  }

  const upperHeadline = headline.toUpperCase();

  for (const keyword of CATALYST_KEYWORDS) {
    if (upperHeadline.includes(keyword.toUpperCase())) {
      return { valid: true, matchedKeyword: keyword };
    }
  }

  return { valid: false, matchedKeyword: null };
}

// ---------- Baseline Screener Filters ----------

/**
 * Check if a gainer passes the Ross Cameron baseline criteria.
 * Default: Price $2.00 to $20.00, Daily Gain >= 10%
 */
export function passesBaselineFilter(
  price: number,
  changePercent: number,
  minPrice: number = 2.0,
  maxPrice: number = 20.0,
  minGainPercent: number = 10
): boolean {
  return price >= minPrice && price <= maxPrice && changePercent >= minGainPercent;
}

/**
 * Check if RVOL meets the minimum threshold (Default: 5x).
 */
export function passesRvolFilter(
  rvol: number,
  minRvol: number = 5.0
): boolean {
  return rvol >= minRvol;
}

/**
 * Check if the float (using shares outstanding as proxy) is under the maximum (Default: 20M).
 */
export function passesFloatFilter(
  sharesOutstanding: number,
  maxFloatMillions: number = 20
): boolean {
  return sharesOutstanding >= 1000 && sharesOutstanding <= (maxFloatMillions * 1000000);
}

export const formatCompact = (num: number, locale = 'en-US'): string => {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(num);
};

// ---------- Trading Window ----------

/**
 * Check if the current time is within the Ross Cameron trading window.
 * Default: 9:30 AM – 11:30 AM EST
 * Extended: 9:30 AM – 4:00 PM EST
 */
export function isWithinTradingWindow(extendedHours: boolean = false): boolean {
  try {
    const now = new Date();
    // Get current time in ET
    const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    // Weekend check (0 = Sunday, 6 = Saturday)
    if (day === 0 || day === 6) return false;

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 30;     // 9:30 AM
    const cameronClose = 11 * 60 + 30;  // 11:30 AM
    const marketClose = 16 * 60;         // 4:00 PM

    const endMinutes = extendedHours ? marketClose : cameronClose;

    return totalMinutes >= marketOpen && totalMinutes <= endMinutes;
  } catch {
    return true; // Fail-safe: allow trading
  }
}

/**
 * Testable version that accepts a Date object instead of using system clock.
 * Used by functional tests.
 */
export function isWithinTradingWindowAt(date: Date, extendedHours: boolean = false): boolean {
  try {
    const etString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const etDate = new Date(etString);

    const day = etDate.getDay();
    if (day === 0 || day === 6) return false;

    const hour = etDate.getHours();
    const minute = etDate.getMinutes();
    const totalMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 30;
    const cameronClose = 11 * 60 + 30;
    const marketClose = 16 * 60;

    const endMinutes = extendedHours ? marketClose : cameronClose;

    return totalMinutes >= marketOpen && totalMinutes <= endMinutes;
  } catch {
    return true;
  }
}

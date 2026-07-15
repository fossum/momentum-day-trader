import { Candle } from './types';

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

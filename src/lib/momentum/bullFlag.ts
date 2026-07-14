import { Candle, BullFlagResult, BullFlagDiagnostic } from './types';
import { calculate9EMA } from './ema';

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
function getDatePart(dateStr?: string): string {
  if (!dateStr) return '';
  if (!dateStr.includes('-') && !dateStr.includes('/')) {
    // If it doesn't look like a date (e.g., in time-only tests), treat them all as the same date
    return 'same-date';
  }
  if (dateStr.includes(' ')) {
    return dateStr.split(' ')[0];
  }
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  return dateStr;
}

export function detectBullFlag(
  candles: Candle[],
  currentPrice?: number,
  maxProximityPercent: number = 2.0
): BullFlagResult | null {
  if (candles.length === 0) return null;
  const lastDate = getDatePart(candles[candles.length - 1].date);
  const filtered = candles.filter(c => getDatePart(c.date) === lastDate);
  if (filtered.length < 4) return null;

  candles = filtered;
  const emaValues = calculate9EMA(candles);

  // Scan backwards from the most recent candle to find a pullback
  // then look for a flagpole before it. Limit search to the last 10 candles
  // to ensure the pattern is recent and active.
  const maxScanDepth = Math.max(4, candles.length - 10);
  for (let pullbackEnd = candles.length - 1; pullbackEnd >= maxScanDepth; pullbackEnd--) {
    // Try pullback lengths of 2, 3, 4
    for (let pullbackLen = 2; pullbackLen <= 4 && pullbackLen <= pullbackEnd; pullbackLen++) {
      const pullbackStart = pullbackEnd - pullbackLen + 1;

      // Extract pullback candles
      const pullbackCandles = candles.slice(pullbackStart, pullbackEnd + 1);

      // Check pullback candles are red or doji (close <= open + 0.005)
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

        // Proximity Check
        const priceToCheck = currentPrice !== undefined ? currentPrice : candles[candles.length - 1].close;
        const pctDiff = Math.abs(priceToCheck - resistanceLevel) / resistanceLevel;
        if (pctDiff > (maxProximityPercent / 100)) {
          continue;
        }

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

/**
 * Detailed diagnostic check for a bull flag pattern.
 * If detected, returns the pattern setup details.
 * If not detected, evaluates the most recent candidate setups to explain why it failed.
 */
export function analyzeBullFlag(
  candles: Candle[],
  currentPrice?: number,
  maxProximityPercent: number = 2.0
): BullFlagDiagnostic {
  if (candles.length === 0) return { detected: false, reason: "No candle data" };
  const lastDate = getDatePart(candles[candles.length - 1].date);
  const filtered = candles.filter(c => getDatePart(c.date) === lastDate);
  if (filtered.length < 4) {
    return { detected: false, reason: `Insufficient candle data for today (${filtered.length} candles, minimum 4 required)` };
  }

  candles = filtered;
  const emaValues = calculate9EMA(candles);

  // First, try standard detection
  const standardResult = detectBullFlag(candles, currentPrice, maxProximityPercent);
  if (standardResult) {
    return {
      detected: true,
      resistanceLevel: standardResult.resistanceLevel,
      pullbackLow: standardResult.pullbackLow,
      flagpoleCandles: standardResult.flagpoleCandles,
      pullbackCandles: standardResult.pullbackCandles
    };
  }

  // If not detected, analyze candidate setups near the end of the data to find the closest match or report failure
  const pullbackEnd = candles.length - 1;
  let bestFailureReason = "No candidate flagpole or pullback setup found";
  let bestScore = -1;

  // Look for any flagpole-pullback combinations near the end
  // (matches the scan logic of detectBullFlag)
  for (let pullbackLen = 2; pullbackLen <= 4; pullbackLen++) {
    const pullbackStart = pullbackEnd - pullbackLen + 1;
    if (pullbackStart < 2) continue;

    const pullbackCandles = candles.slice(pullbackStart, pullbackEnd + 1);

    // Check if pullback holds 9 EMA
    const pullbackHoldsEma = pullbackCandles.every((c, i) => {
      const emaIdx = pullbackStart + i;
      return emaIdx < emaValues.length && c.low >= emaValues[emaIdx] * 0.998;
    });

    // Check if pullback candles are red/doji
    const allRedOrDoji = pullbackCandles.every(c => c.close <= c.open + 0.005);

    for (let flagpoleLen = 2; flagpoleLen <= 3; flagpoleLen++) {
      const flagpoleStart = pullbackStart - flagpoleLen;
      if (flagpoleStart < 0) continue;

      const flagpoleCandles = candles.slice(flagpoleStart, pullbackStart);

      const allGreen = flagpoleCandles.every(c => c.close > c.open);

      let makingNewHighs = true;
      for (let i = 1; i < flagpoleCandles.length; i++) {
        if (flagpoleCandles[i].high <= flagpoleCandles[i - 1].high) {
          makingNewHighs = false;
          break;
        }
      }

      const avgFlagpoleVol = flagpoleCandles.reduce((s, c) => s + c.volume, 0) / flagpoleCandles.length;
      const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.volume, 0) / pullbackCandles.length;
      const volRatio = avgFlagpoleVol > 0 ? (avgPullbackVol / avgFlagpoleVol) : 0;

      // Identify the specific failure reason for this candidate using a scoring system
      let score = 0;
      let failureReason = "";

      if (allGreen) {
        score += 1;
        if (makingNewHighs) {
          score += 1;
          if (allRedOrDoji) {
            score += 1;
            if (pullbackHoldsEma) {
              score += 1;
              if (volRatio >= 0.5) {
                failureReason = `Pullback average volume is too high (${(volRatio * 100).toFixed(0)}% of flagpole vol, required < 50%)`;
              } else {
                const resistanceLevel = Math.max(...flagpoleCandles.map(c => c.high));
                const priceToCheck = currentPrice !== undefined ? currentPrice : candles[candles.length - 1].close;
                const pctDiff = Math.abs(priceToCheck - resistanceLevel) / resistanceLevel;
                if (pctDiff > (maxProximityPercent / 100)) {
                  failureReason = `Proximity check failed: price $${priceToCheck.toFixed(2)} is ${(pctDiff * 100).toFixed(2)}% away from resistance $${resistanceLevel.toFixed(2)} (max ${maxProximityPercent.toFixed(1)}%)`;
                }
              }
            } else {
              failureReason = `Pullback candle low broke below the 9 EMA`;
            }
          } else {
            failureReason = `Pullback candles are not all red/doji (close <= open)`;
          }
        } else {
          failureReason = `Flagpole candles are not making higher highs`;
        }
      } else {
        failureReason = `Flagpole candles are not all green (close > open)`;
      }

      if (score > bestScore) {
        bestScore = score;
        bestFailureReason = failureReason;
      }
    }
  }

  return { detected: false, reason: bestFailureReason };
}

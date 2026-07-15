import { Candle, BullFlagResult, BullFlagDiagnostic } from './types';
import { calculate9EMA } from './ema';

/**
 * Detect a Ross Cameron-style Bull Flag pattern from 1-minute candles.
 *
 * Phase A (Flagpole): 2–3 consecutive green candles making new highs
 * with aggressive volume acceleration. Allows up to maxFlagpoleRedCandles micro-red candles.
 *
 * Phase B (Pullback): 2–4 subsequent red/doji candles where:
 *   - Average pullback volume < 50% of average flagpole volume
 *   - Price holds above the 9 EMA
 *   - Allows up to maxPullbackGreenCandles micro-green candles.
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

function isMicroRedOrDoji(c: Candle): boolean {
  if (c.close > c.open) return false;
  const body = c.open - c.close;
  const relativeBody = body / c.open;
  // Body <= $0.02 OR relative change <= 0.2% of open price
  return body <= 0.02 || relativeBody <= 0.002;
}

function isMicroGreenOrDoji(c: Candle): boolean {
  if (c.close <= c.open + 0.005) return true; // Standard red/doji is already conforming
  const body = c.close - c.open;
  const relativeBody = body / c.open;
  // Green body <= $0.02 OR relative change <= 0.2% of open price
  return body <= 0.02 || relativeBody <= 0.002;
}

/**
 * Find the next resistance level from the candles list before the flagpole start.
 * Scans for local peaks above the entry price.
 */
export function findNextResistance(
  candles: Candle[],
  flagpoleStartIdx: number,
  entryPrice: number
): number | undefined {
  const priorCandles = candles.slice(0, flagpoleStartIdx);
  if (priorCandles.length === 0) return undefined;

  const peaks: number[] = [];
  
  // Find local peaks in prior candles (maximum of 3-candle window)
  for (let i = 1; i < priorCandles.length - 1; i++) {
    const cur = priorCandles[i].high;
    const prev = priorCandles[i - 1].high;
    const next = priorCandles[i + 1].high;
    if (cur > prev && cur >= next) {
      peaks.push(cur);
    }
  }

  // Also include the absolute daily high of the prior candles
  const absoluteHigh = Math.max(...priorCandles.map(c => c.high));
  if (absoluteHigh > entryPrice && !peaks.includes(absoluteHigh)) {
    peaks.push(absoluteHigh);
  }

  // Filter peaks that are strictly above the entry price
  const validTargets = peaks.filter(p => p > entryPrice);
  if (validTargets.length === 0) return undefined;

  // Find the closest peak above the entry price
  return Math.min(...validTargets);
}

export function detectBullFlag(
  candles: Candle[],
  currentPrice?: number,
  maxProximityPercent: number = 2.0,
  maxFlagpoleRedCandles: number = 1,
  maxPullbackGreenCandles: number = 1,
  minStopDistance: number = 0.01
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

      // Check pullback candles color validation
      let pullbackColorPass = false;
      const greenCandles = pullbackCandles.filter(c => c.close > c.open + 0.005);
      if (greenCandles.length <= maxPullbackGreenCandles) {
        pullbackColorPass = greenCandles.every(isMicroGreenOrDoji);
      }
      if (!pullbackColorPass) continue;

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

        // Check flagpole candles color validation
        let flagpoleColorPass = false;
        const nonGreenCandles = flagpoleCandles.filter(c => c.close <= c.open);
        if (nonGreenCandles.length <= maxFlagpoleRedCandles) {
          flagpoleColorPass = nonGreenCandles.every(isMicroRedOrDoji);
        }
        // Ensure overall flagpole is net green (last close > first open)
        if (flagpoleColorPass && flagpoleCandles.length > 1) {
          if (flagpoleCandles[flagpoleCandles.length - 1].close <= flagpoleCandles[0].open) {
            flagpoleColorPass = false;
          }
        }
        if (!flagpoleColorPass) continue;

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

        // Reject negative, zero, or too small stops
        if (resistanceLevel - pullbackLow < minStopDistance) {
          continue;
        }

        // Proximity Check
        const priceToCheck = currentPrice !== undefined ? currentPrice : candles[candles.length - 1].close;
        const pctDiff = Math.abs(priceToCheck - resistanceLevel) / resistanceLevel;
        if (pctDiff > (maxProximityPercent / 100)) {
          continue;
        }

        const nextResistance = findNextResistance(candles, flagpoleStart, resistanceLevel);

        return {
          detected: true,
          resistanceLevel,
          pullbackLow,
          flagpoleCandles,
          pullbackCandles,
          nextResistance
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
  maxProximityPercent: number = 2.0,
  maxFlagpoleRedCandles: number = 1,
  maxPullbackGreenCandles: number = 1,
  minStopDistance: number = 0.01
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
  const standardResult = detectBullFlag(candles, currentPrice, maxProximityPercent, maxFlagpoleRedCandles, maxPullbackGreenCandles, minStopDistance);
  if (standardResult) {
    return {
      detected: true,
      resistanceLevel: standardResult.resistanceLevel,
      pullbackLow: standardResult.pullbackLow,
      flagpoleCandles: standardResult.flagpoleCandles,
      pullbackCandles: standardResult.pullbackCandles,
      nextResistance: standardResult.nextResistance
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

    // Check pullback candles color validation
    let pullbackColorPass = false;
    const greenCandles = pullbackCandles.filter(c => c.close > c.open + 0.005);
    if (greenCandles.length <= maxPullbackGreenCandles) {
      pullbackColorPass = greenCandles.every(isMicroGreenOrDoji);
    }

    for (let flagpoleLen = 2; flagpoleLen <= 3; flagpoleLen++) {
      const flagpoleStart = pullbackStart - flagpoleLen;
      if (flagpoleStart < 0) continue;

      const flagpoleCandles = candles.slice(flagpoleStart, pullbackStart);

      // Check flagpole candles color validation
      let flagpoleColorPass = false;
      const nonGreenCandles = flagpoleCandles.filter(c => c.close <= c.open);
      if (nonGreenCandles.length <= maxFlagpoleRedCandles) {
        flagpoleColorPass = nonGreenCandles.every(isMicroRedOrDoji);
      }
      // Ensure overall flagpole is net green (last close > first open)
      if (flagpoleColorPass && flagpoleCandles.length > 1) {
        if (flagpoleCandles[flagpoleCandles.length - 1].close <= flagpoleCandles[0].open) {
          flagpoleColorPass = false;
        }
      }

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

      if (flagpoleColorPass) {
        score += 1;
        if (makingNewHighs) {
          score += 1;
          if (pullbackColorPass) {
            score += 1;
            if (pullbackHoldsEma) {
              score += 1;
              if (volRatio >= 0.5) {
                failureReason = `Pullback average volume is too high (${(volRatio * 100).toFixed(0)}% of flagpole vol, required < 50%)`;
              } else {
                const resistanceLevel = Math.max(...flagpoleCandles.map(c => c.high));
                const pullbackLow = Math.min(...pullbackCandles.map(c => c.low));
                const stopDist = resistanceLevel - pullbackLow;
                if (stopDist < minStopDistance) {
                  failureReason = `Stop distance ($${stopDist.toFixed(2)}) is less than minimum stop-loss guardrail ($${minStopDistance.toFixed(2)})`;
                } else {
                  const priceToCheck = currentPrice !== undefined ? currentPrice : candles[candles.length - 1].close;
                  const pctDiff = Math.abs(priceToCheck - resistanceLevel) / resistanceLevel;
                  if (pctDiff > (maxProximityPercent / 100)) {
                    failureReason = `Proximity check failed: price $${priceToCheck.toFixed(2)} is ${(pctDiff * 100).toFixed(2)}% away from resistance $${resistanceLevel.toFixed(2)} (max ${maxProximityPercent.toFixed(1)}%)`;
                  }
                }
              }
            } else {
              failureReason = `Pullback candle low broke below the 9 EMA`;
            }
          } else {
            if (maxPullbackGreenCandles > 0) {
              failureReason = `Pullback candles are not all red/doji (allowing up to ${maxPullbackGreenCandles} micro-green)`;
            } else {
              failureReason = `Pullback candles are not all red/doji (close <= open)`;
            }
          }
        } else {
          failureReason = `Flagpole candles are not making higher highs`;
        }
      } else {
        if (maxFlagpoleRedCandles > 0) {
          failureReason = `Flagpole candles are not all green (allowing up to ${maxFlagpoleRedCandles} micro-red/doji)`;
        } else {
          failureReason = `Flagpole candles are not all green (close > open)`;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestFailureReason = failureReason;
      }
    }
  }

  return { detected: false, reason: bestFailureReason };
}

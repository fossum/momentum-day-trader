/**
 * @fileoverview Unifies trade evaluation checks for both live trading and backtesting.
 * Runs the full Ross Cameron morning breakout buy setup checklist: Price, Daily Gain,
 * RVOL (with lunchtime scaling), Float, Trading Window, Catalyst Keywords, Gemini news sentiment,
 * Bull Flag Pattern, Stop Loss Distance, and Risk/Reward parameters.
 */

import { Candle, SetupEvaluationResult } from './types';
import { passesFloatFilter, passesRvolFilter } from './filters';
import { validateStopDistance, calculateTarget } from './risk';
import { isWithinTradingWindowAt, isAfterLunchtimeLullAt, getElapsedMarketMinutes } from './tradingWindow';
import { analyzeBullFlag } from './bullFlag';
import { validateCatalyst } from './catalysts';
import { UserPreferences } from '../../types';

/**
 * Evaluates a potential stock trade setup against the unified momentum strategy criteria.
 * This function is used by both the live execution engine and the backtester.
 *
 * @param params - The input parameters for trade setup evaluation.
 * @param params.ticker - The stock ticker symbol.
 * @param params.price - The current price of the stock.
 * @param params.changePercent - The daily gain percentage of the stock.
 * @param params.volume - The cumulative volume of the stock today so far (includes pre-market).
 * @param params.avgVolume - The average daily volume of the stock.
 * @param params.sharesOutstanding - The outstanding/float shares of the stock.
 * @param params.candles - The chronological array of 1-minute candles for today (includes pre-market).
 * @param params.catalyst - The news headline or catalyst description.
 * @param params.time - The current mock or live timestamp.
 * @param params.preferences - The user's strategy preferences.
 * @param params.checkSentiment - Optional async callback to perform Gemini news sentiment analysis.
 * @returns A promise resolving to the detailed checklist and final decision result.
 */
export async function evaluateSetup(params: {
  ticker: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  sharesOutstanding: number;
  candles: Candle[];
  catalyst: string;
  time: Date;
  preferences: UserPreferences;
  checkSentiment?: (ticker: string, catalystText: string) => Promise<{ isPositive: boolean; reason: string }>;
}): Promise<SetupEvaluationResult> {
  const {
    ticker,
    price,
    changePercent,
    volume,
    avgVolume,
    sharesOutstanding,
    candles,
    catalyst,
    time,
    preferences,
    checkSentiment
  } = params;

  // Extract checks and limits from preferences (using default values if undefined)
  const minPrice = preferences.minPrice ?? 2.0;
  const maxPrice = preferences.maxPrice ?? 20.0;
  const minGainPercent = preferences.minGainPercent ?? 10.0;
  const maxFloatMillions = preferences.maxFloatMillions ?? 20.0;
  const extendedHours = preferences.extendedTradingHours ?? false;
  const catalystValidation = preferences.catalystValidation ?? 'gemini';

  const checkPriceRange = preferences.checkPriceRange !== false;
  const checkDailyGain = preferences.checkDailyGain !== false;
  const checkRelativeVol = preferences.checkRelativeVol !== false;
  const checkSharesFloat = preferences.checkSharesFloat !== false;
  const checkTradingWindow = preferences.checkTradingWindow !== false;
  const checkNewsCatalyst = catalystValidation === 'keywords';
  const checkGeminiSentiment = catalystValidation === 'gemini';
  const checkBullFlagPattern = preferences.checkBullFlagPattern !== false;
  const checkStopDistance = preferences.checkStopDistance !== false;
  const checkRiskReward = preferences.checkRiskReward !== false;

  // 1. Price Range Check
  const passesPrice = !checkPriceRange || (price >= minPrice && price <= maxPrice);

  // 2. Daily Gain Check
  const passesGain = !checkDailyGain || (changePercent >= minGainPercent);

  // 3. Relative Volume Check (enforcing 20x during lunchtime lull)
  let minRvol = preferences.minRvol ?? 5.0;
  if (isAfterLunchtimeLullAt(time)) {
    minRvol = Math.max(minRvol, 20.0);
  }
  // Time-scaled relative volume calculation (volume / (avgVolume / 390 * elapsedMarketMinutes))
  const elapsedMinutes = getElapsedMarketMinutes(time);
  const scaledAvgVolume = (avgVolume / 390) * elapsedMinutes;
  const calculatedRvol = scaledAvgVolume > 0 ? parseFloat((volume / scaledAvgVolume).toFixed(2)) : 0.0;
  const passesRvol = !checkRelativeVol || passesRvolFilter(calculatedRvol, minRvol);

  // 4. Shares Float Check
  const hasKnownFloat = sharesOutstanding !== 0 && !isNaN(sharesOutstanding);
  const passesFloat = !checkSharesFloat || (hasKnownFloat && passesFloatFilter(sharesOutstanding, maxFloatMillions));

  // 5. Trading Window Check
  const passesWindow = !checkTradingWindow || isWithinTradingWindowAt(time, extendedHours);

  // 6. Keywords News Catalyst Check
  const catalystResult = validateCatalyst(catalyst);
  const passesCatalyst = !checkNewsCatalyst || catalystResult.valid;

  // 7. Bull Flag Pattern Check
  let passesPattern = false;
  let patternReason = "";
  let patternResult: any = null;
  const minStopDistance = preferences.minStopDistance ?? 0.01;

  if (checkBullFlagPattern) {
    if (Array.isArray(candles) && candles.length >= 4) {
      patternResult = analyzeBullFlag(
        candles,
        price,
        preferences.maxProximityPercent ?? 2.0,
        preferences.maxFlagpoleRedCandles ?? 1,
        preferences.maxPullbackGreenCandles ?? 1,
        minStopDistance
      );
      passesPattern = patternResult.detected;
      patternReason = patternResult.reason || "";
    } else {
      patternReason = `Insufficient candles (${candles?.length || 0} candles, minimum 4 required)`;
    }
  } else {
    passesPattern = true;
    patternReason = "Bypassed (Bull Flag pattern check disabled)";
  }

  // 8. Gemini News Sentiment Check (only run if all baseline filters pass to save API quota)
  let geminiPass = true;
  let geminiReason = "";
  if (checkGeminiSentiment && passesPrice && passesGain && passesRvol && passesFloat && passesWindow && passesCatalyst && passesPattern) {
    const hasActualNews = catalyst && !catalyst.startsWith("No recent fundamental catalyst");
    if (hasActualNews) {
      if (checkSentiment) {
        try {
          const res = await checkSentiment(ticker, catalyst);
          geminiPass = res.isPositive;
          geminiReason = res.reason;
        } catch (err: any) {
          // If the sentiment check throws, fail the check
          geminiPass = false;
          geminiReason = `Sentiment check failed: ${err.message}`;
        }
      } else {
        geminiPass = false;
        geminiReason = "Sentiment check callback not provided";
      }
    } else {
      geminiPass = false;
      geminiReason = "Skipped (no news catalyst found)";
    }
  } else if (checkGeminiSentiment) {
    geminiReason = "Bypassed (Bull Flag pattern not detected)";
  } else {
    geminiReason = "Bypassed (Gemini sentiment filter disabled)";
  }

  // 9. Risk Management Checks (Stop Distance & R:R)
  let passesStop = false;
  let calculatedStopDistance = 0;
  const entryPrice = (checkBullFlagPattern && patternResult?.detected) ? patternResult.resistanceLevel : price;
  const stopPrice = (checkBullFlagPattern && patternResult?.detected) ? patternResult.pullbackLow : 0;
  const maxStopDistance = preferences.maxStopDistance ?? 0.20;

  if (checkStopDistance) {
    const finalStopPrice = (stopPrice > 0 && stopPrice < entryPrice) ? stopPrice : (entryPrice * 0.98);
    passesStop = validateStopDistance(entryPrice, finalStopPrice, maxStopDistance, minStopDistance);
    calculatedStopDistance = Number((entryPrice - finalStopPrice).toFixed(2));
  } else {
    passesStop = true;
    calculatedStopDistance = 0;
  }

  let passesRR = false;
  let calculatedRatio = 0;
  let targetPrice = 0;
  const minRewardRiskRatio = preferences.minRewardRiskRatio ?? 2.0;

  if (checkRiskReward) {
    const finalStopPrice = (stopPrice > 0 && stopPrice < entryPrice) ? stopPrice : (entryPrice * 0.98);
    const targetResult = calculateTarget(
      entryPrice,
      finalStopPrice,
      patternResult?.nextResistance,
      minRewardRiskRatio,
      minStopDistance
    );
    if (targetResult) {
      passesRR = true;
      targetPrice = targetResult.targetPrice;
      calculatedRatio = targetResult.ratio;
    } else {
      passesRR = false;
      calculatedRatio = 0;
      targetPrice = entryPrice * 1.04;
    }
  } else {
    passesRR = true;
    calculatedRatio = minRewardRiskRatio;
    targetPrice = entryPrice * 1.04;
  }

  const allPass =
    passesPrice &&
    passesGain &&
    passesRvol &&
    passesFloat &&
    passesWindow &&
    passesCatalyst &&
    geminiPass &&
    passesPattern &&
    passesStop &&
    passesRR;

  return {
    passesPrice,
    passesGain,
    passesRvol,
    passesFloat,
    passesWindow,
    passesCatalyst,
    geminiPass,
    passesPattern,
    passesStop,
    passesRR,
    allPass,
    patternResult,
    requiredMinRvol: minRvol,
    calculatedRvol,
    calculatedStopDistance,
    calculatedRatio,
    targetPrice,
    stopPrice: stopPrice > 0 ? stopPrice : parseFloat((entryPrice * 0.98).toFixed(2)),
    entryPrice,
    geminiReason,
    patternReason
  };
}

/**
 * Formats a structured morning breakout buy setup checklist evaluation report.
 * Respects toggle settings inside the UserPreferences object and filters out
 * any disabled checks from the final printed output, maintaining parity
 * between client-side and backtesting logs.
 *
 * @param symbol - The stock ticker symbol.
 * @param timeStr - The formatted timestamp of the evaluation.
 * @param price - The current price of the stock.
 * @param changePercent - The daily gain percentage of the stock.
 * @param floatShares - The outstanding/float shares of the stock.
 * @param preferences - The user's strategy preferences.
 * @param evalResult - The result of the unified setup evaluation.
 * @returns The formatted multi-line checklist report string.
 */
export function formatChecklistReport(
  symbol: string,
  timeStr: string,
  price: number,
  changePercent: number,
  floatShares: number,
  preferences: UserPreferences,
  evalResult: SetupEvaluationResult
): string {
  const statusChar = (pass: boolean) => pass ? '✓ PASS' : '✗ FAIL';
  
  const catalystValidation = preferences.catalystValidation ?? 'gemini';
  const checkPriceRange = preferences.checkPriceRange !== false;
  const checkDailyGain = preferences.checkDailyGain !== false;
  const checkRelativeVol = preferences.checkRelativeVol !== false;
  const checkSharesFloat = preferences.checkSharesFloat !== false;
  const checkTradingWindow = preferences.checkTradingWindow !== false;
  const checkNewsCatalyst = catalystValidation === 'keywords';
  const checkGeminiSentiment = catalystValidation === 'gemini';
  const checkBullFlagPattern = preferences.checkBullFlagPattern !== false;
  const checkStopDistance = preferences.checkStopDistance !== false;
  const checkRiskReward = preferences.checkRiskReward !== false;

  const minPrice = preferences.minPrice ?? 2.0;
  const maxPrice = preferences.maxPrice ?? 20.0;
  const minGainPercent = preferences.minGainPercent ?? 10.0;
  const maxFloatMillions = preferences.maxFloatMillions ?? 20.0;

  const checklistItems: { label: string; details: string }[] = [];

  if (checkPriceRange) {
    checklistItems.push({
      label: "Price Range",
      details: `${statusChar(evalResult.passesPrice)} ($${price.toFixed(2)} | Req: $${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)})`
    });
  }
  if (checkDailyGain) {
    checklistItems.push({
      label: "Daily Gain",
      details: `${statusChar(evalResult.passesGain)} (+${changePercent.toFixed(1)}% | Req: >=${minGainPercent}%)`
    });
  }
  if (checkRelativeVol) {
    checklistItems.push({
      label: "Relative Vol",
      details: `${statusChar(evalResult.passesRvol)} (${evalResult.calculatedRvol}x | Req: >=${evalResult.requiredMinRvol}x)`
    });
  }
  if (checkSharesFloat) {
    const floatDisplay = floatShares !== 0 ? `${(floatShares / 1000000).toFixed(2)}M` : "Unknown";
    checklistItems.push({
      label: "Shares Float",
      details: `${statusChar(evalResult.passesFloat)} (${floatDisplay} | Req: <=${maxFloatMillions}M)`
    });
  }
  if (checkTradingWindow) {
    checklistItems.push({
      label: "Trading Window",
      details: `${statusChar(evalResult.passesWindow)} (Req: 9:30 AM-11:30 AM EST)`
    });
  }
  if (checkNewsCatalyst) {
    checklistItems.push({
      label: "News Catalyst",
      details: `${statusChar(evalResult.passesCatalyst)} (${evalResult.passesCatalyst ? "Catalyst found/Bypassed" : "No keyword matched"})`
    });
  }
  if (checkGeminiSentiment) {
    checklistItems.push({
      label: "Gemini Sentiment",
      details: `${statusChar(evalResult.geminiPass)} (${evalResult.geminiReason || "Bypassed"})`
    });
  }
  if (checkBullFlagPattern) {
    checklistItems.push({
      label: "Bull Flag Pattern",
      details: `${statusChar(evalResult.passesPattern)} (${evalResult.passesPattern ? `Detected at Resistance $${evalResult.patternResult?.resistanceLevel?.toFixed(2)}` : evalResult.patternReason})`
    });
  }
  if (checkStopDistance) {
    checklistItems.push({
      label: "Stop Distance",
      details: `${statusChar(evalResult.passesStop)} ($${evalResult.calculatedStopDistance.toFixed(2)} | Req: $${(preferences.minStopDistance ?? 0.01).toFixed(2)}-$${(preferences.maxStopDistance ?? 0.20).toFixed(2)})`
    });
  }
  if (checkRiskReward) {
    checklistItems.push({
      label: "Risk/Reward",
      details: `${statusChar(evalResult.passesRR)} (${evalResult.calculatedRatio.toFixed(1)}:1 | Req: >=${preferences.minRewardRiskRatio ?? 2.0}:1)`
    });
  }

  const formattedLines = checklistItems.map((item, index) => {
    const prefix = `${index + 1}. ${item.label}:`;
    const paddedPrefix = prefix.padEnd(22, ' ');
    return `${paddedPrefix}${item.details}`;
  });

  return `[EVALUATION] Buy Entrance Checklist for $${symbol} at ${timeStr}:
----------------------------------------------------------------------
${formattedLines.join('\n')}
----------------------------------------------------------------------
Result: ${evalResult.allPass ? '✓ ALL ENTRANCE REQUIREMENTS PASSED' : '✗ FAILED ENTRANCE REQUIREMENTS'}`;
}

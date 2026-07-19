/**
 * @fileoverview Momentum trading strategy backtest runner.
 * Simulates chronological market candle data, evaluates gapper setups,
 * tracks simulated positions, and logs strategy metrics with Gemini news sentiment analysis caching.
 *
 * Usage:
 *   npx tsx scripts/backtest.ts [options] [userId]
 *   npm run backtest -- [options] [userId]
 *
 * Options:
 *   --date=YYYY-MM-DD   Specify a custom past date to run the backtest for (defaults to the latest trading day in the candle chart).
 *   --verbose           Print verbose checklist evaluations for candidate setups.
 *
 * Arguments:
 *   userId              The user ID to load preferences for (defaults to 'testuser').
 *
 * Example:
 *   npm run backtest -- --date=2026-07-16 --verbose ericfoss
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { adminDb } from '../src/lib/firebaseAdmin';
import { FmpApiClient } from '../fmp_client';
import { analyzeNewsSentiment } from '../src/lib/gemini';
import {
  evaluateSetup,
  passesTickerFilter,
  isWithinTradingWindowAt,
  formatChecklistReport
} from '../src/lib/momentum';
import { UserPreferences, MarketGainer, SimulatedTrade } from '../src/types';
import { computeHash, computeFnv1aHash } from '../src/lib/firebase';

/**
 * Helper to parse FMP date strings in Eastern Time.
 * Determines the EDT (-04:00) or EST (-05:00) offset dynamically.
 * 
 * @param dateStr - Date string in format "YYYY-MM-DD HH:MM:SS"
 * @returns Parsed Date object
 */
function parseFmpDate(dateStr: string): Date {
  const datePart = dateStr.split(' ')[0];
  const month = parseInt(datePart.split('-')[1]);
  const offset = (month >= 4 && month <= 10) ? '-04:00' : '-05:00';
  return new Date(dateStr.replace(' ', 'T') + offset);
}

dotenv.config();

/**
 * Formats a Date object to an Eastern Time ISO-like string.
 *
 * @param date - The Date object to format. Defaults to current date.
 * @returns The formatted date string in Eastern Time.
 */
const getEasternISOString = (date: Date = new Date()): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
  let hour = partMap.hour;
  if (hour === '24') hour = '00';

  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${partMap.year}-${partMap.month}-${partMap.day}T${hour}:${partMap.minute}:${partMap.second}.${ms}`;
};



/**
 * Main execution function for the backtester. Loads user preferences,
 * fetches biggest market gainers, simulates chronological candle data progression,
 * runs the execution strategy, and logs backtest performance metrics.
 * 
 * @returns A promise that resolves when the backtester execution completes.
 */
async function main() {
  const args = process.argv.slice(2);
  const isVerbose = args.includes('--verbose');

  // Parse target date if specified via --date=YYYY-MM-DD or --date YYYY-MM-DD
  let targetDate: string | null = null;
  const dateEqIdx = args.findIndex(a => a.startsWith('--date='));
  if (dateEqIdx !== -1) {
    targetDate = args[dateEqIdx].split('=')[1];
  } else {
    const dateIdx = args.indexOf('--date');
    if (dateIdx !== -1 && dateIdx + 1 < args.length) {
      targetDate = args[dateIdx + 1];
    }
  }

  if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error("Error: --date parameter must be in YYYY-MM-DD format.");
    process.exit(1);
  }

  // Find the userId argument (the first non-flag argument that is not the targetDate value)
  const userIdArg = args.find(a => !a.startsWith('--') && a !== targetDate);
  const userId = userIdArg || 'testuser';
  let currentSimulatedTime: Date | null = null;

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const dateStrForLog = targetDate ? targetDate.replace(/-/g, '') : getEasternISOString().split('T')[0].replace(/-/g, '');
  const logFilePath = path.join(logsDir, `backtest_${userId}_${dateStrForLog}.log`);
  fs.writeFileSync(logFilePath, ''); // Overwrite log file on startup

  /**
   * Helper function to log messages to both the console and the user-specific 
   * backtest log file, utilizing the simulated stock market time as the timestamp 
   * prefix when processing candles.
   * 
   * @param message - The message string to log.
   * @returns void
   */
  const log = (message: string) => {
    const timestamp = currentSimulatedTime ? getEasternISOString(currentSimulatedTime) : getEasternISOString();
    const formatted = `[${timestamp}] ${message}`;
    console.log(formatted);
    fs.appendFileSync(logFilePath, formatted + '\n');
  };

  log(`Starting backtest script for user: ${userId}`);

  // Fetch settings
  log(`Fetching preferences from Firebase for ${userId}...`);
  let preferences: UserPreferences;
  try {
    const prefsSnap = await adminDb.collection('users').doc(userId).collection('preferences').doc('settings').get();
    if (prefsSnap.exists) {
      preferences = prefsSnap.data() as UserPreferences;
      log(`Successfully loaded preferences from Firebase.`);
    } else {
      log(`No preferences found for ${userId}, using defaults.`);
      preferences = {
        markets: ['NASDAQ', 'NYSE'],
        robinhoodOnly: false,
        minPrice: 2.0,
        maxPrice: 20.0,
        minGainPercent: 10,
        minRvol: 5.0,
        maxFloatMillions: 20,
        maxStopDistance: 0.20,
        minStopDistance: 0.01,
        minRewardRiskRatio: 2.0,
        maxProximityPercent: 2.0,
        maxFlagpoleRedCandles: 1,
        maxPullbackGreenCandles: 1,
        checkPriceRange: true,
        checkDailyGain: true,
        checkRelativeVol: true,
        checkSharesFloat: true,
        checkBullFlagPattern: true,
        checkStopDistance: true,
        checkRiskReward: true,
        catalystValidation: 'gemini'
      };
    }
  } catch (error: any) {
    log(`Error fetching preferences (${error.message}). Using defaults.`);
    preferences = {
      markets: ['NASDAQ', 'NYSE'],
      robinhoodOnly: false,
      minPrice: 2.0,
      maxPrice: 20.0,
      minGainPercent: 10,
      minRvol: 5.0,
      maxFloatMillions: 20,
      maxStopDistance: 0.20,
      minStopDistance: 0.01,
      minRewardRiskRatio: 2.0,
      maxProximityPercent: 2.0,
      maxFlagpoleRedCandles: 1,
      maxPullbackGreenCandles: 1,
      checkPriceRange: true,
      checkDailyGain: true,
      checkRelativeVol: true,
      checkSharesFloat: true,
      checkBullFlagPattern: true,
      checkStopDistance: true,
      checkRiskReward: true,
      catalystValidation: 'gemini'
    };
  }

  const allCompletedTrades: SimulatedTrade[] = [];
  const startingBalance = 100;
  let balance = startingBalance;

  // Local in-memory cache to prevent redundant Firestore queries or Gemini API calls within the same run.
  const sentimentCache = new Map<string, { isPositive: boolean; reason: string }>();

  const fmpApiKey = process.env.FMP_API_KEY;
  if (!fmpApiKey) {
    log(`ERROR: FMP_API_KEY environment variable is not set.`);
    process.exit(1);
  }

  const fmpClient = new FmpApiClient(fmpApiKey);

  // Fetch gainers
  log(`Fetching today's top gainers from FMP...`);
  let gainers: MarketGainer[] = [];
  try {
    const data = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${fmpApiKey}`, 0);
    gainers = data.map((item: any) => ({
      ...item,
      changesPercentage: item.changesPercentage !== undefined ? item.changesPercentage : item.changePercentage
    }));
    log(`Found ${gainers.length} gainers.`);
  } catch (err: any) {
    log(`Failed to fetch gainers: ${err.message}`);
    process.exit(1);
  }

  // Configuration limits
  const minPrice = preferences.minPrice ?? 2.0;
  const maxPrice = preferences.maxPrice ?? 20.0;
  const minGainPercent = preferences.minGainPercent ?? 10;

  const blacklist = preferences.blacklistedTickers || [];

  for (const gainer of gainers) {
    if (blacklist.includes(gainer.symbol)) {
      log(`[SCANNER] Excluding $${gainer.symbol} (blacklisted)`);
      continue;
    }
    if (!passesTickerFilter(gainer.symbol, gainer.name)) {
      log(`[SCANNER] Excluding $${gainer.symbol}: contains ETF, Leverage, or Target keyword.`);
      continue;
    }

    if (preferences.checkPriceRange && (gainer.price < minPrice || gainer.price > maxPrice)) {
      log(`[SCANNER] $${gainer.symbol} failed price filter ($${gainer.price})`);
      continue;
    }

    if (preferences.checkDailyGain && (gainer.changesPercentage < minGainPercent)) {
      log(`[SCANNER] $${gainer.symbol} failed daily gain filter (+${gainer.changesPercentage}%)`);
      continue;
    }

    log(`[TESTING] $${gainer.symbol} (+${gainer.changesPercentage.toFixed(1)}%) - Fetching 1min chart...`);
    let chart: any[] = [];

    if (fmpClient.is1MinUnsupported) {
      log(`[ERROR] FMP Subscription does not support 1-minute historical charts for ${gainer.symbol}. Skipping.`);
      continue;
    }

    try {
      chart = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 0, { is1Min: true });
    } catch (err: any) {
      log(`[ERROR] Failed to fetch 1min chart for ${gainer.symbol}: ${err.message}. Check FMP permissions.`);
      continue;
    }

    if (!Array.isArray(chart) || chart.length === 0) {
      log(`[ERROR] No 1min chart data for ${gainer.symbol}`);
      continue;
    }

    // FMP returns newest to oldest. Reverse to oldest to newest.
    const sortedChart = [...chart].reverse();

    // Resolve the trading day: use the custom targetDate if provided, or default to the latest candle in the chart
    const lastChartCandle = sortedChart[sortedChart.length - 1];
    const todayPrefix = targetDate || (lastChartCandle ? lastChartCandle.date.split(' ')[0] : '');

    const todayCandles = sortedChart.filter((c: any) => {
      return c.date && c.date.startsWith(todayPrefix);
    });

    if (todayCandles.length === 0) {
      log(`[INFO] No candles found for today prefix ${todayPrefix} for ${gainer.symbol}`);
      continue;
    }

    log(`[INFO] Found ${todayCandles.length} candles today for ${gainer.symbol}. Processing...`);

    // Fetch quote, profile, float and news data to check float, avgVolume and pre-market offset
    let floatShares = 0;
    let avgVolume = 1;
    let dailyVolume = 0;
    let catalystText = "No recent fundamental catalyst found on FMP.";
    const [floatRes, profileRes, newsRes, quoteRes] = await Promise.allSettled([
      fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/shares-float?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 3600000),
      fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/profile?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 3600000),
      fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/news/stock?symbols=${gainer.symbol}&limit=5&apikey=${fmpApiKey}`, 300000),
      fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/quote?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 3600000)
    ]);

    if (floatRes.status === 'fulfilled' && Array.isArray(floatRes.value) && floatRes.value.length > 0) {
      floatShares = floatRes.value[0].floatShares || floatRes.value[0].outstandingShares || 0;
    } else if (floatRes.status === 'rejected') {
      log(`[WARN] FMP Float fetch failed for ${gainer.symbol}: ${floatRes.reason}`);
    }

    if (profileRes.status === 'fulfilled' && Array.isArray(profileRes.value) && profileRes.value.length > 0) {
      avgVolume = profileRes.value[0].averageVolume || 1;
    } else if (profileRes.status === 'rejected') {
      log(`[WARN] FMP Profile fetch failed for ${gainer.symbol}: ${profileRes.reason}`);
    }

    if (newsRes.status === 'fulfilled' && Array.isArray(newsRes.value) && newsRes.value.length > 0 && newsRes.value[0].title) {
      catalystText = `News: ${newsRes.value[0].title}`;
    } else if (newsRes.status === 'rejected') {
      log(`[WARN] FMP News fetch failed for ${gainer.symbol}: ${newsRes.reason}`);
    }

    if (quoteRes.status === 'fulfilled' && Array.isArray(quoteRes.value) && quoteRes.value.length > 0) {
      dailyVolume = quoteRes.value[0].volume || 0;
    } else if (quoteRes.status === 'rejected') {
      log(`[WARN] FMP Quote fetch failed for ${gainer.symbol}: ${quoteRes.reason}`);
    }

    const totalRegularVol = todayCandles.reduce((sum, c) => sum + (c.volume || 0), 0);
    const preMarketVol = Math.max(0, dailyVolume - totalRegularVol);

    let activeTrade: {
      entry: number;
      stop: number;
      target: number;
      shares: number;
      entryTime: string;
      floatDisplay: string;
      catalyst: string;
    } | null = null;

    // Simulate chronological progression
    for (let i = 0; i < todayCandles.length; i++) {
      const currentCandle = todayCandles[i];
      const candleTime = parseFmpDate(currentCandle.date);
      currentSimulatedTime = candleTime;
      const timeStr = currentCandle.date.split(' ')[1];
      const livePrice = currentCandle.close;

      if (activeTrade) {
        // Trade management
        const low = currentCandle.low;
        const high = currentCandle.high;

        if (low <= activeTrade.stop) {
          const exitPrice = activeTrade.stop;
          const pnl = (exitPrice - activeTrade.entry) * activeTrade.shares;
          balance += pnl;
          log(`[TRADE] ${timeStr} $${gainer.symbol} Stop loss hit at $${exitPrice.toFixed(2)}. Exit triggered. P&L: $${pnl.toFixed(2)}`);

          allCompletedTrades.push({
            ticker: gainer.symbol,
            float: activeTrade.floatDisplay,
            catalyst: activeTrade.catalyst,
            setup: "Bull Flag",
            entryPrice: activeTrade.entry,
            exitPrice: exitPrice,
            shares: activeTrade.shares,
            pnl: pnl,
            target: activeTrade.target,
            stop: activeTrade.stop
          });
          activeTrade = null;
        } else if (high >= activeTrade.target) {
          const exitPrice = activeTrade.target;
          const pnl = (exitPrice - activeTrade.entry) * activeTrade.shares;
          balance += pnl;
          log(`[TRADE] ${timeStr} $${gainer.symbol} Target reached at $${exitPrice.toFixed(2)}. Exit triggered. P&L: $${pnl.toFixed(2)}`);

          allCompletedTrades.push({
            ticker: gainer.symbol,
            float: activeTrade.floatDisplay,
            catalyst: activeTrade.catalyst,
            setup: "Bull Flag",
            entryPrice: activeTrade.entry,
            exitPrice: exitPrice,
            shares: activeTrade.shares,
            pnl: pnl,
            target: activeTrade.target,
            stop: activeTrade.stop
          });
          activeTrade = null;
        }
        continue; // Continue to next candle after managing trade
      }

      // Check if we are inside the trading window (constants 9:30 AM - 11:30 AM EST)
      const isWithinWindow = isWithinTradingWindowAt(candleTime, preferences.extendedTradingHours ?? false);
      if (!isWithinWindow) {
        continue;
      }

      // Compute rolling volume (including pre-market volume offset)
      const chartUpToNow = todayCandles.slice(0, i + 1);
      const regularVolSoFar = chartUpToNow.reduce((sum, c) => sum + (c.volume || 0), 0);
      const totalVolSoFar = preMarketVol + regularVolSoFar;

      /**
       * Sentiment check callback that validates a fundamental catalyst news story
       * using a dual-layer cache (local in-memory + global Firestore newsSentiment cache)
       * before executing a live Gemini API request.
       * 
       * @param ticker - The stock ticker symbol.
       * @param catalystText - The headline or news text to analyze.
       * @returns A promise resolving to the news sentiment result.
       */
      const checkSentimentCallback = async (ticker: string, catalystText: string) => {
        const hasActualNews = catalystText && !catalystText.startsWith("No recent");
        if (!hasActualNews) {
          return { isPositive: false, reason: "No actual news" };
        }

        // 1. Check local in-memory cache first
        const cacheKey = `${ticker}:${catalystText}`;
        if (sentimentCache.has(cacheKey)) {
          return sentimentCache.get(cacheKey)!;
        }

        // 2. Compute hashes and check persistent Firestore cache
        const shaHash = await computeHash(catalystText);
        const fnvHash = computeFnv1aHash(catalystText);

        try {
          // Attempt SHA-256 lookup first
          let cachedDoc = await adminDb.collection('newsSentiment').doc(shaHash).get();
          if (!cachedDoc.exists) {
            // Fall back to FNV-1a lookup
            cachedDoc = await adminDb.collection('newsSentiment').doc(fnvHash).get();
          }

          if (cachedDoc.exists) {
            const data = cachedDoc.data();
            if (data && typeof data.isPositive === 'boolean') {
              const res = { isPositive: data.isPositive, reason: data.reason || 'Cached.' };
              sentimentCache.set(cacheKey, res);
              return res;
            }
          }
        } catch (err: any) {
          log(`[WARNING] Failed to query Firestore sentiment cache: ${err.message}`);
        }

        // 3. Cache miss: perform live Gemini API call
        const sentimentRes = await analyzeNewsSentiment(ticker, catalystText);
        const result = { isPositive: sentimentRes.isPositive, reason: sentimentRes.reason };

        // Save to local in-memory cache
        sentimentCache.set(cacheKey, result);

        // Save to persistent Firestore cache under SHA-256 hash (the preferred format)
        try {
          await adminDb.collection('newsSentiment').doc(shaHash).set({
            ticker,
            headline: catalystText,
            isPositive: result.isPositive,
            reason: result.reason,
            timestamp: new Date()
          });
        } catch (err: any) {
          log(`[WARNING] Failed to write to Firestore sentiment cache: ${err.message}`);
        }

        return result;
      };


      const evalResult = await evaluateSetup({
        ticker: gainer.symbol,
        price: livePrice,
        changePercent: gainer.changesPercentage,
        volume: totalVolSoFar,
        avgVolume,
        sharesOutstanding: floatShares,
        candles: chartUpToNow,
        catalyst: catalystText,
        time: candleTime,
        preferences,
        checkSentiment: checkSentimentCallback
      });

      const shouldLogReport = evalResult.allPass || evalResult.passesPattern || (isVerbose && evalResult.passesPrice && evalResult.passesGain);

      if (shouldLogReport) {
        const report = formatChecklistReport(
          gainer.symbol,
          timeStr,
          livePrice,
          gainer.changesPercentage,
          floatShares,
          preferences,
          evalResult
        );
        log(report);
      }

      if (evalResult.allPass) {
        const positionSizeSetting = (preferences.positionSize || "2000").toString().trim();
        let computedShares = 1;
        if (positionSizeSetting.endsWith("%")) {
          const pct = parseFloat(positionSizeSetting.replace("%", ""));
          const maxCashForTrade = balance * (pct / 100);
          computedShares = Math.max(1, Math.floor(maxCashForTrade / evalResult.entryPrice));
        } else {
          computedShares = parseInt(positionSizeSetting) || 1;
        }

        activeTrade = {
          entry: evalResult.entryPrice,
          stop: evalResult.stopPrice,
          target: evalResult.targetPrice,
          shares: computedShares,
          entryTime: timeStr,
          floatDisplay: floatShares !== 0 ? `${(floatShares / 1000000).toFixed(2)}M` : "Unknown",
          catalyst: catalystText
        };
      }
    }

    if (activeTrade) {
      const lastCandle = todayCandles[todayCandles.length - 1];
      if (lastCandle) {
        currentSimulatedTime = parseFmpDate(lastCandle.date);
      }
      const endTimeStr = lastCandle ? lastCandle.date.split(' ')[1] : '11:30:00';
      const exitPrice = lastCandle ? lastCandle.close : activeTrade.entry;
      const pnl = (exitPrice - activeTrade.entry) * activeTrade.shares;
      balance += pnl;
      log(`[TRADE] ${endTimeStr} $${gainer.symbol} Trade still open at end of window. Closing at last price $${exitPrice.toFixed(2)}. P&L: $${pnl.toFixed(2)}`);

      allCompletedTrades.push({
        ticker: gainer.symbol,
        float: activeTrade.floatDisplay,
        catalyst: activeTrade.catalyst,
        setup: "Bull Flag",
        entryPrice: activeTrade.entry,
        exitPrice: exitPrice,
        shares: activeTrade.shares,
        pnl: pnl,
        target: activeTrade.target,
        stop: activeTrade.stop
      });
      activeTrade = null;
    }
    currentSimulatedTime = null;
  }

  log("\n======================================================================");
  log("                      BACKTEST PERFORMANCE SUMMARY                    ");
  log("======================================================================");
  log(`Starting Balance:  $${(startingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  log(`Ending Balance:    $${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  const totalTrades = allCompletedTrades.length;
  const winningTrades = allCompletedTrades.filter(t => t.pnl > 0);
  const losingTrades = allCompletedTrades.filter(t => t.pnl <= 0);
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 1.0;

  log(`Total Trades:      ${totalTrades}`);
  log(`Winning Trades:    ${winningTrades.length}`);
  log(`Losing Trades:     ${losingTrades.length}`);
  log(`Win Rate:          ${winRate.toFixed(1)}%`);
  log(`Gain Percentage:   ${(netPnl / startingBalance * 100).toFixed(2)}%`);
  log(`Gross Profit:      $${grossProfit.toFixed(2)}`);
  log(`Gross Loss:        $${grossLoss.toFixed(2)}`);
  log(`Net P&L:           $${(netPnl >= 0 ? '+' : '')}${netPnl.toFixed(2)}`);
  log(`Profit Factor:     ${profitFactor === Infinity ? 'Infinity' : profitFactor.toFixed(2)}`);
  log("======================================================================\n");

  log(`Backtest complete!`);
  process.exit(0);
}

main().catch(console.error);

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { db } from '../src/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  FmpApiClient,
  decompose5MinTo1Min
} from '../fmp_client';
import { analyzeNewsSentiment } from '../src/lib/gemini';
import {
  analyzeBullFlag,
  passesRvolFilter,
  passesFloatFilter,
  passesTickerFilter,
  validateStopDistance,
  calculateTarget
} from '../src/lib/momentum';
import { UserPreferences, MarketGainer } from '../src/types';

dotenv.config();

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



async function main() {
  const args = process.argv.slice(2);
  const userId = args[0] || 'testuser';

  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const todayStr = getEasternISOString().split('T')[0].replace(/-/g, '');
  const logFilePath = path.join(logsDir, `backtest_${userId}_${todayStr}.log`);

  const log = (message: string) => {
    const timestamp = getEasternISOString();
    const formatted = `[${timestamp}] ${message}`;
    console.log(formatted);
    fs.appendFileSync(logFilePath, formatted + '\n');
  };

  log(`Starting backtest script for user: ${userId}`);

  // Fetch settings
  log(`Fetching preferences from Firebase for ${userId}...`);
  let preferences: UserPreferences;
  try {
    const prefsSnap = await getDoc(doc(db, 'users', userId, 'preferences', 'settings'));
    if (prefsSnap.exists()) {
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
  const minRvol = preferences.minRvol ?? 5.0;
  const maxFloatMillions = preferences.maxFloatMillions ?? 20;

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
    let isFallback = false;

    if (fmpClient.is1MinUnsupported) {
      isFallback = true;
    } else {
      try {
        chart = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 0, { is1Min: true });
      } catch (err: any) {
        log(`Failed to fetch 1min chart for ${gainer.symbol}: ${err.message}. Attempting 5-min fallback...`);
        isFallback = true;
      }
    }

    if (isFallback || !Array.isArray(chart) || chart.length === 0) {
      try {
        const fiveMinData = await fmpClient.fetchWithCache<any[]>(
          `https://financialmodelingprep.com/stable/historical-chart/5min?symbol=${gainer.symbol}&apikey=${fmpApiKey}`,
          0
        );
        if (Array.isArray(fiveMinData) && fiveMinData.length > 0) {
          chart = decompose5MinTo1Min(fiveMinData);
          log(`[FMP 1MIN FALLBACK] Successfully decomposed 5-min chart into 1-min candles for ${gainer.symbol}`);
        }
      } catch (fallbackErr: any) {
        log(`[FMP 5MIN CHART ERROR] Fallback failed for ${gainer.symbol}: ${fallbackErr.message}. Skipping.`);
        continue;
      }
    }

    if (!Array.isArray(chart) || chart.length === 0) {
      log(`[ERROR] No 1min chart data for ${gainer.symbol}`);
      continue;
    }

    // FMP returns newest to oldest. Reverse to oldest to newest.
    const sortedChart = [...chart].reverse();

    // Filter to today 9:30 AM to 11:00 AM EST
    const today = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
    const todayParts = today.split('/');
    const currentYearStr = todayParts[2];
    const currentMonthStr = todayParts[0].padStart(2, '0');
    const currentDayStr = todayParts[1].padStart(2, '0');
    const todayPrefix = `${currentYearStr}-${currentMonthStr}-${currentDayStr}`;

    const windowCandles = sortedChart.filter((c: any) => {
      if (!c.date) return false;
      if (!c.date.startsWith(todayPrefix)) return false;
      const timePart = c.date.split(' ')[1];
      if (!timePart) return false;
      const [hour, minute] = timePart.split(':').map(Number);
      const isAfterOpen = hour > 9 || (hour === 9 && minute >= 30);
      const isBeforeClose = hour < 11 || (hour === 11 && minute === 0);
      return isAfterOpen && isBeforeClose;
    });

    if (windowCandles.length === 0) {
      log(`[INFO] No candles found in the 9:30-11:00 window for ${gainer.symbol}`);
      continue;
    }

    log(`[INFO] Found ${windowCandles.length} candles in the 9:30-11:00 window for ${gainer.symbol}. Processing...`);

    // Fetch quote and profile data to check float and rvol
    let floatShares = 0;
    let avgVolume = 1;
    let catalystText = "No recent fundamental catalyst found on FMP.";
    try {
      const [floatRes, profileRes, newsRes] = await Promise.allSettled([
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/shares-float?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 3600000),
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/profile?symbol=${gainer.symbol}&apikey=${fmpApiKey}`, 3600000),
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/news/stock?symbols=${gainer.symbol}&limit=5&apikey=${fmpApiKey}`, 300000)
      ]);

      if (floatRes.status === 'fulfilled' && Array.isArray(floatRes.value) && floatRes.value.length > 0) {
        floatShares = floatRes.value[0].floatShares || floatRes.value[0].outstandingShares || 0;
      }
      if (profileRes.status === 'fulfilled' && Array.isArray(profileRes.value) && profileRes.value.length > 0) {
        avgVolume = profileRes.value[0].averageVolume || 1;
      }
      if (newsRes.status === 'fulfilled' && Array.isArray(newsRes.value) && newsRes.value.length > 0 && newsRes.value[0].title) {
        catalystText = `News: ${newsRes.value[0].title}`;
      }
    } catch (e: any) {
      log(`[WARN] FMP Profile fetch failed for ${gainer.symbol}: ${e.message}`);
    }

    let activeTrade: { entry: number, stop: number, target: number } | null = null;

    // Simulate chronological progression
    for (let i = 0; i < windowCandles.length; i++) {
      const currentCandle = windowCandles[i];
      const timeStr = currentCandle.date.split(' ')[1];
      const livePrice = currentCandle.close;

      if (activeTrade) {
        // Trade management
        const low = currentCandle.low;
        const high = currentCandle.high;

        if (low <= activeTrade.stop) {
          log(`[TRADE] ${timeStr} $${gainer.symbol} Stop loss hit at $${activeTrade.stop}. Exit triggered.`);
          activeTrade = null;
        } else if (high >= activeTrade.target) {
          log(`[TRADE] ${timeStr} $${gainer.symbol} Target reached at $${activeTrade.target}. Exit triggered.`);
          activeTrade = null;
        }
        continue; // Continue to next candle after managing trade
      }

      // Compute rolling volume
      const chartUpToNow = windowCandles.slice(0, i + 1);
      const totalVolSoFar = chartUpToNow.reduce((sum, c) => sum + (c.volume || 0), 0);
      const currentRvol = parseFloat((totalVolSoFar / (avgVolume / 390 * chartUpToNow.length)).toFixed(2)); // approximate intraday rvol

      if (preferences.checkRelativeVol && !passesRvolFilter(currentRvol, minRvol)) {
        continue;
      }

      const hasKnownFloat = floatShares !== 0;
      if (preferences.checkSharesFloat && (!hasKnownFloat || !passesFloatFilter(floatShares, maxFloatMillions))) {
        continue;
      }

      if (preferences.checkBullFlagPattern) {
        const patternResult = analyzeBullFlag(
          chartUpToNow,
          livePrice,
          preferences.maxProximityPercent ?? 2.0,
          preferences.maxFlagpoleRedCandles ?? 1,
          preferences.maxPullbackGreenCandles ?? 1
        );

        if (patternResult.detected) {
          // Sentiment Check
          let sentimentPass = true;
          if (preferences.catalystValidation === 'gemini') {
            const hasActualNews = catalystText && !catalystText.startsWith("No recent");
            if (hasActualNews) {
              try {
                const sentimentRes = await analyzeNewsSentiment(gainer.symbol, catalystText);
                sentimentPass = sentimentRes.isPositive;
              } catch (e: any) {
                sentimentPass = false;
              }
            } else {
              sentimentPass = false;
            }
          }

          if (!sentimentPass) {
            continue; // Skip if sentiment is negative
          }

          const entryPrice = patternResult.resistanceLevel || livePrice;
          const pullbackLow = patternResult.pullbackLow || 0;
          const minStopDistance = preferences.minStopDistance ?? 0.01;
          const maxStopDistance = preferences.maxStopDistance ?? 0.20;
          const finalStopPrice = (pullbackLow > 0 && pullbackLow < entryPrice) ? pullbackLow : (entryPrice * 0.98);

          if (preferences.checkStopDistance && !validateStopDistance(entryPrice, finalStopPrice, maxStopDistance, minStopDistance)) {
            continue; // Stop distance filter
          }

          let targetPrice = entryPrice * 1.04;
          if (preferences.checkRiskReward) {
            const minRR = preferences.minRewardRiskRatio ?? 2.0;
            const targetResult = calculateTarget(entryPrice, finalStopPrice, patternResult.nextResistance, minRR, minStopDistance);
            if (!targetResult) {
              continue; // Risk reward filter
            }
            targetPrice = targetResult.targetPrice;
          }

          // Found a valid setup
          log(`[SETUP] ${timeStr} $${gainer.symbol} Bull Flag Detected! Entry: $${entryPrice.toFixed(2)}, Stop: $${finalStopPrice.toFixed(2)}, Target: $${targetPrice.toFixed(2)}`);

          activeTrade = {
            entry: entryPrice,
            stop: finalStopPrice,
            target: targetPrice
          };
        }
      }
    }

    if (activeTrade) {
      log(`[TRADE] 11:00:00 $${gainer.symbol} Trade still open at end of window. Closing at last price.`);
    }
  }

  log(`Backtest complete!`);
  process.exit(0);
}

main().catch(console.error);

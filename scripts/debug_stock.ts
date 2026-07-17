import dotenv from 'dotenv';
import path from 'path';
import { FmpApiClient } from '../fmp_client';
import { analyzeBullFlag, passesFloatFilter, passesRvolFilter } from '../src/lib/momentum';

dotenv.config();

const fmpApiKey = process.env.FMP_API_KEY;
if (!fmpApiKey) {
  console.error("Missing FMP_API_KEY in .env");
  process.exit(1);
}

const fmpClient = new FmpApiClient(fmpApiKey);

// Exact defaults from backtest.ts
const minPrice = 2.0;
const maxPrice = 20.0;
const minGainPercent = 10;
const minRvol = 5.0;
const maxFloatMillions = 20;
const maxStopDistance = 0.20;
const minStopDistance = 0.01;
const minRewardRiskRatio = 2.0;
const maxProximityPercent = 2.0;
const maxFlagpoleRedCandles = 1;
const maxPullbackGreenCandles = 1;

async function main() {
  const symbol = process.argv[2]?.toUpperCase();
  if (!symbol) {
    console.error("Usage: npx tsx scripts/debug_stock.ts <TICKER>");
    process.exit(1);
  }
  
  console.log(`Fetching 1min chart for ${symbol}...`);
  let chart = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${symbol}&apikey=${fmpApiKey}`, 0, { is1Min: true });

  const sortedChart = [...chart].reverse();
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

  console.log(`Found ${windowCandles.length} candles in the 9:30-11:00 window.`);

  let floatShares = 0;
  let avgVolume = 1;
  try {
    const floatRes = await fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/shares-float?symbol=${symbol}&apikey=${fmpApiKey}`, 3600000);
    const profileRes = await fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${fmpApiKey}`, 3600000);
    if (Array.isArray(floatRes) && floatRes.length > 0) floatShares = floatRes[0].floatShares || floatRes[0].outstandingShares || 0;
    if (Array.isArray(profileRes) && profileRes.length > 0) avgVolume = profileRes[0].averageVolume || 1;
  } catch(e) {}

  console.log(`Float Shares: ${(floatShares/1000000).toFixed(2)}M, Avg Vol: ${avgVolume}`);

  for (let i = 0; i < windowCandles.length; i++) {
    const currentCandle = windowCandles[i];
    const timeStr = currentCandle.date.split(' ')[1];
    const livePrice = currentCandle.close;

    const chartUpToNow = windowCandles.slice(0, i + 1);
    const totalVolSoFar = chartUpToNow.reduce((sum, c) => sum + (c.volume || 0), 0);
    const currentRvol = parseFloat((totalVolSoFar / (avgVolume / 390 * chartUpToNow.length)).toFixed(2));

    if (!passesRvolFilter(currentRvol, minRvol)) {
      if (i < 15) console.log(`[${timeStr}] Failed RVol filter. Current RVol: ${currentRvol}, min: ${minRvol}`);
      continue;
    }

    const hasKnownFloat = floatShares !== 0;
    if (!hasKnownFloat || !passesFloatFilter(floatShares, maxFloatMillions)) {
      if (i === 0) console.log(`[${timeStr}] Failed Float filter. Float: ${(floatShares/1000000).toFixed(2)}M, max: ${maxFloatMillions}M`);
      continue;
    }

    const patternResult = analyzeBullFlag(
      chartUpToNow,
      livePrice,
      maxProximityPercent,
      maxFlagpoleRedCandles,
      maxPullbackGreenCandles
    );

    if (patternResult.detected) {
      console.log(`[${timeStr}] BULL FLAG DETECTED! Price: ${livePrice}`);
    } else {
      console.log(`[${timeStr}] Bull Flag Analysis: ${JSON.stringify(patternResult)}`);
    }
  }
}

main().catch(console.error);

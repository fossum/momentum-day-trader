/**
 * @file generate-chart.ts
 * @description Batch decision chart overlay script. Scans momentum trading bot log files for Buy Entrance Checklist
 * occurrences, fetches historical 1-minute intraday candles from Financial Modeling Prep (FMP) API,
 * overlays technical analysis markers (EMA-9, Resistance levels, Stop Losses, Trade Entry/Abort decision markers),
 * and generates interactive HTML chart files in the `public/` directory.
 * 
 * @usage
 * npx tsx scripts/generate-chart.ts [ticker] [filterDate] [options]
 * 
 * @arguments
 *   ticker       (Optional) The stock ticker symbol to look up in the logs (default: JZXN).
 *   filterDate   (Optional) Filter evaluations to a specific date in YYYY-MM-DD format.
 * 
 * @options
 *   --log <path>       Specify the path to the log file.
 *   --user <userId>    Specify a user ID to read logs from `logs/<userId>.log`.
 * 
 * @environment-variables
 *   FMP_API_KEY        (Required) Your Financial Modeling Prep API Key.
 *   LOG_FILE_PATH      (Optional) Path to log file.
 *   USER_ID            (Optional) Firebase user ID.
 * 
 * @behavior
 * If neither command-line options nor environment variables are supplied to specify a log file,
 * the script dynamically scans the `logs/` directory. It looks for files named with a 28-character
 * Firebase UID pattern, picking the most recently modified one. If no such file matches, it falls back
 * to the most recently modified `.log` file in the directory.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { calculate9EMA } from '../src/lib/momentum/ema';
import { detectBullFlag } from '../src/lib/momentum/bullFlag';


// Load environment variables
dotenv.config();

const FMP_API_KEY = process.env.FMP_API_KEY;
if (!FMP_API_KEY) {
  console.error("Error: FMP_API_KEY environment variable is required in .env");
  process.exit(1);
}

// Parse arguments
let ticker = '';
let filterDate = '';
let logPathInput = '';
let userIdInput = '';

const args = process.argv.slice(2);
let positionalCount = 0;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--log=')) {
    logPathInput = arg.split('=')[1];
  } else if (arg === '--log') {
    logPathInput = args[++i];
  } else if (arg.startsWith('--user=')) {
    userIdInput = arg.split('=')[1];
  } else if (arg === '--user') {
    userIdInput = args[++i];
  } else if (arg.startsWith('-')) {
    // ignore unknown flags
  } else {
    if (positionalCount === 0) {
      ticker = arg.toUpperCase();
      positionalCount++;
    } else if (positionalCount === 1) {
      filterDate = arg;
      positionalCount++;
    }
  }
}

if (!ticker) {
  ticker = 'JZXN';
}

console.log(`Running batch decision chart overlay script for $${ticker}...`);

// Ensure public folder exists
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Fetch candles cache to avoid duplicate network requests for the same date
const candlesCache = new Map<string, { candles: any[]; resolvedDate: string }>();

/**
 * Fetches 1-minute historical candles from the Financial Modeling Prep (FMP) API,
 * caching the results by date to prevent duplicate network requests.
 * 
 * @param symbol - The stock ticker symbol.
 * @param date - The date to fetch historical data for (in YYYY-MM-DD format).
 * @returns A promise that resolves to an array of candle objects.
 * @throws An error if the FMP API returns a non-OK status or invalid format.
 */
async function getCachedCandles(symbol: string, date: string): Promise<{ candles: any[]; resolvedDate: string }> {
  const cacheKey = `${symbol}_${date}`;
  if (candlesCache.has(cacheKey)) {
    return candlesCache.get(cacheKey)!;
  }
  
  const url = `https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${symbol}&from=${date}&to=${date}&apikey=${FMP_API_KEY}`;
  console.log(`Fetching FMP intraday 1min candles for ${date}: ${url.replace(FMP_API_KEY!, 'SECRET')}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FMP API returned status ${response.status}`);
  }
  let data = await response.json();
  let resolvedDate = date;

  if (!Array.isArray(data) || data.length === 0) {
    console.log(`No candles found for ${date}. Fetching latest available candles to auto-resolve correct trading date...`);
    const fallbackUrl = `https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${symbol}&apikey=${FMP_API_KEY}`;
    const fbResponse = await fetch(fallbackUrl);
    if (fbResponse.ok) {
      const fbData = await fbResponse.json();
      if (Array.isArray(fbData) && fbData.length > 0) {
        const uniqueDates = Array.from(new Set(fbData.map((c: any) => c.date.split(' ')[0]))).sort();
        const targetTime = new Date(date).getTime();
        let bestDate = '';
        for (const d of uniqueDates) {
          if (new Date(d).getTime() <= targetTime) {
            bestDate = d;
          }
        }
        if (!bestDate && uniqueDates.length > 0) {
          bestDate = uniqueDates[uniqueDates.length - 1];
        }
        if (bestDate && bestDate !== date) {
          console.log(`Auto-resolved trading date for ${date} to: ${bestDate}`);
          resolvedDate = bestDate;
          const filteredData = fbData.filter((c: any) => c.date.startsWith(bestDate));
          const result = { candles: filteredData, resolvedDate };
          candlesCache.set(cacheKey, result);
          candlesCache.set(`${symbol}_${resolvedDate}`, result);
          return result;
        }
      }
    }
  }

  if (!Array.isArray(data)) {
    throw new Error(`Invalid FMP response: ${JSON.stringify(data)}`);
  }
  
  const result = { candles: data, resolvedDate };
  candlesCache.set(cacheKey, result);
  return result;
}

/**
 * Converts an FMP date string (assumed to be in EST/EDT) to a Unix timestamp.
 * 
 * @param fmpDate - The date string from the FMP API (e.g., "YYYY-MM-DD HH:MM:SS").
 * @returns The corresponding Unix timestamp (seconds since epoch).
 */
function fmpDateToUnix(fmpDate: string): number {
  const dateStr = fmpDate.replace(' ', 'T');
  const temp = new Date(dateStr + '-04:00'); // Assume EDT
  if (temp.getMonth() < 2 || temp.getMonth() > 10) {
    return Math.floor(new Date(dateStr + '-05:00').getTime() / 1000);
  }
  return Math.floor(temp.getTime() / 1000);
}

/**
 * Parses a date-time string (either Eastern Time format "YYYY-MM-DD HH:MM:SS" 
 * or an ISO timestamp string) into a Unix timestamp in seconds.
 * 
 * @param timeStr - The date-time string to parse.
 * @returns The corresponding Unix timestamp (seconds since epoch).
 */
function parseTimeToUnix(timeStr: string): number {
  if (timeStr.includes('T')) {
    // If it's a standard ISO string with timezone or without, parse it.
    // If it's the execution timestamp from getEasternISOString, it has format YYYY-MM-DDTHH:MM:SS.ms (no timezone suffix)
    // and is in Eastern Time.
    if (!timeStr.endsWith('Z') && !timeStr.includes('+') && !timeStr.includes('-')) {
      return fmpDateToUnix(timeStr.replace('T', ' '));
    }
    return Math.floor(new Date(timeStr).getTime() / 1000);
  }
  // Otherwise, assume it's in Eastern Time "YYYY-MM-DD HH:MM:SS"
  return fmpDateToUnix(timeStr);
}

/**
 * Formats a Unix timestamp (seconds) to Eastern Time format "YYYY-MM-DD HH:MM:SS".
 * 
 * @param unix - The Unix timestamp in seconds.
 * @returns Eastern Time formatted string.
 */
function formatUnixToEastern(unix: number): string {
  const date = new Date(unix * 1000);
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
  return `${partMap.year}-${partMap.month}-${partMap.day} ${hour}:${partMap.minute}:${partMap.second}`;
}

// Load and parse log file
const envLogPath = process.env.LOG_FILE_PATH;
const envUserId = process.env.USER_ID;

let logPath = '';

if (logPathInput) {
  logPath = path.isAbsolute(logPathInput) ? logPathInput : path.join(process.cwd(), logPathInput);
} else if (userIdInput) {
  logPath = path.join(process.cwd(), 'logs', `${userIdInput}.log`);
} else if (envLogPath) {
  logPath = path.isAbsolute(envLogPath) ? envLogPath : path.join(process.cwd(), envLogPath);
} else if (envUserId) {
  logPath = path.join(process.cwd(), 'logs', `${envUserId}.log`);
} else {
  // Dynamically scan logs directory
  const logsDir = path.join(process.cwd(), 'logs');
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir);
    const logFiles = files.filter(f => f.endsWith('.log'));

    if (logFiles.length > 0) {
      // Find the best log file
      // Prefer ones that match a standard 28-character Firebase UID (like abc123xyz456mock789user00000.log)
      const firebaseUidPattern = /^[a-zA-Z0-9]{28}\.log$/;
      const matchingFiles = logFiles.filter(f => firebaseUidPattern.test(f));

      let selectedFile = '';
      if (matchingFiles.length > 0) {
        // If there are multiple, get the most recently modified one
        const sorted = matchingFiles.map(f => {
          const filePath = path.join(logsDir, f);
          const stat = fs.statSync(filePath);
          return { name: f, mtime: stat.mtimeMs };
        }).sort((a, b) => b.mtime - a.mtime);
        selectedFile = sorted[0].name;
      } else {
        // Exclude files containing 'copy' or 'backup' if possible, otherwise take the first
        const nonCopyFiles = logFiles.filter(f => !f.toLowerCase().includes('copy') && !f.toLowerCase().includes('backup'));
        const filesToChooseFrom = nonCopyFiles.length > 0 ? nonCopyFiles : logFiles;

        const sorted = filesToChooseFrom.map(f => {
          const filePath = path.join(logsDir, f);
          const stat = fs.statSync(filePath);
          return { name: f, mtime: stat.mtimeMs };
        }).sort((a, b) => b.mtime - a.mtime);
        selectedFile = sorted[0].name;
      }

      if (selectedFile) {
        logPath = path.join(logsDir, selectedFile);
        console.log(`Auto-detected log file: ${selectedFile}`);
      }
    }
  }
}

if (!logPath) {
  console.error("Error: No log file specified or auto-detected. Provide one via --log <path>, --user <id>, or the LOG_FILE_PATH / USER_ID environment variables.");
  process.exit(1);
}

if (!fs.existsSync(logPath)) {
  console.error(`Error: Log file not found at ${logPath}`);
  process.exit(1);
}

console.log(`Reading log file at ${logPath}...`);
const logContent = fs.readFileSync(logPath, 'utf8');
const lines = logContent.split('\n');

// Find all checklist blocks for the ticker
const occurrences: {
  timestamp: string;
  checklistLines: string[];
  endIndex: number;
}[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes(`Buy Entrance Checklist for $${ticker} `) || line.includes(`Buy Entrance Checklist for $${ticker}:`)) {
    const checklistLines: string[] = [];
    let endIndex = -1;
    let timestamp = '';

    const tMatch = line.match(/^\[([^\]]+)\]/);
    if (tMatch) {
      timestamp = tMatch[1];
    }

    // Capture the checklist block
    for (let j = i; j < lines.length; j++) {
      checklistLines.push(lines[j]);
      if (lines[j].includes('----------------------------------------------------------------------') && j > i + 2) {
        endIndex = j + 1;
        if (j + 1 < lines.length) {
          checklistLines.push(lines[j + 1]);
        }
        break;
      }
    }

    if (endIndex !== -1) {
      occurrences.push({
        timestamp,
        checklistLines,
        endIndex
      });
    }
  }
}

console.log(`Found ${occurrences.length} evaluation checklist occurrences for $${ticker} in log.`);

// Filter occurrences if filterDate is provided
const filteredOccurrences = filterDate
  ? occurrences.filter(occ => occ.timestamp.startsWith(filterDate))
  : occurrences;

if (filteredOccurrences.length === 0) {
  console.log(`No occurrences found matching date filter: ${filterDate}`);
  process.exit(0);
}

console.log(`Processing ${filteredOccurrences.length} matching occurrences...`);

/**
 * Processes a single checklist occurrence, fetching necessary candle data,
 * calculating indicators like EMA-9 and bull flag breakouts, and writing
 * the resulting interactive HTML chart file to the public directory.
 * 
 * @param occ - The log occurrence data including checklist lines and end index.
 * @param index - The index of the occurrence in the list.
 * @returns A promise that resolves when processing is complete.
 */
async function processOccurrence(occ: typeof occurrences[0], index: number) {
  const { timestamp, checklistLines, endIndex } = occ;
  
  // Parse exact evaluation time if present in the checklist header (e.g. "at 09:56:00:")
  const firstLine = checklistLines[0];
  const timeMatch = firstLine.match(/at (\d{2}:\d{2}:\d{2}):/);
  const evalTime = timeMatch ? timeMatch[1] : '';

  let dateStr = timestamp.substring(0, 10); // YYYY-MM-DD
  let timeFormatted = evalTime ? evalTime.replace(/:/g, '-') : timestamp.substring(11, 19).replace(/:/g, '-'); // HH-MM-SS

  console.log(`\n[${index + 1}/${filteredOccurrences.length}] Processing ${ticker} evaluation at ${timestamp}...`);

  // Parse check-post decision (abort / fill / trade results)
  let checklistFailed = false;
  checklistLines.forEach(line => {
    if (line.includes('Result: ✗') || line.includes('FAILED ENTRANCE REQUIREMENTS')) {
      checklistFailed = true;
    }
  });

  let isAborted = checklistFailed;
  let decisionReason = checklistFailed ? 'Failed checklist requirements.' : '';
  let decisionSimTime = evalTime;
  let finalDecisionTime = timestamp;

  for (let idx = endIndex; idx < Math.min(endIndex + 15, lines.length); idx++) {
    const line = lines[idx];
    const msgPart = line.substring(line.indexOf(']') + 1);
    const simTimeMatch = msgPart.match(/(\d{2}:\d{2}:\d{2})/);

    if (line.includes(`[ABORT]`) && line.includes(`$${ticker}`)) {
      isAborted = true;
      decisionReason = line.substring(line.indexOf('[ABORT]'));
      if (simTimeMatch) {
        decisionSimTime = simTimeMatch[1];
      } else {
        const tMatch = line.match(/^\[([^\]]+)\]/);
        if (tMatch) finalDecisionTime = tMatch[1];
      }
      break;
    }
    if (line.includes(`BUY ORDER FILLED`) && line.includes(`$${ticker}`)) {
      isAborted = false;
      decisionReason = line.substring(line.indexOf('BUY ORDER FILLED'));
      if (simTimeMatch) {
        decisionSimTime = simTimeMatch[1];
      } else {
        const tMatch = line.match(/^\[([^\]]+)\]/);
        if (tMatch) finalDecisionTime = tMatch[1];
      }
      break;
    }
    if (line.includes(`[TRADE]`) && line.includes(`$${ticker}`)) {
      isAborted = false;
      decisionReason = line.substring(line.indexOf('[TRADE]'));
      if (simTimeMatch) {
        decisionSimTime = simTimeMatch[1];
      } else {
        const tMatch = line.match(/^\[([^\]]+)\]/);
        if (tMatch) finalDecisionTime = tMatch[1];
      }
      break;
    }
  }

  // Parse checklists specs
  let parsedPrice = 0;
  let parsedFloat = '';
  let parsedCatalyst = '';

  checklistLines.forEach(line => {
    if (line.includes('1. Price Range:')) {
      const pMatch = line.match(/\$(\d+\.\d+)/);
      if (pMatch) parsedPrice = parseFloat(pMatch[1]);
    }
    if (line.includes('4. Shares Float:')) {
      const fMatch = line.match(/\(([^|]+)/);
      if (fMatch) parsedFloat = fMatch[1].trim();
    }
  });

  // Extract catalyst from checklist or trailing logs
  for (let idx = endIndex; idx < Math.min(endIndex + 15, lines.length); idx++) {
    const line = lines[idx];
    if (line.includes('Headline:') || line.includes('No qualifying news catalyst')) {
      const headMatch = line.match(/Headline: "([^"]+)"/);
      if (headMatch) parsedCatalyst = headMatch[1];
    }
  }
  if (!parsedCatalyst) {
    checklistLines.forEach(line => {
      if (line.includes('6. News Catalyst:')) {
        const cMatch = line.match(/"([^"]+)"/);
        if (cMatch) parsedCatalyst = cMatch[1];
      }
    });
  }

  // Get raw candles (from FMP) and resolved date
  const { candles: rawCandles, resolvedDate } = await getCachedCandles(ticker, dateStr);
  if (rawCandles.length === 0) {
    console.error(`  Warning: No candles found for ${resolvedDate}, skipping.`);
    return;
  }
  dateStr = resolvedDate;

  // Align decision time with resolved date
  if (decisionSimTime) {
    finalDecisionTime = `${dateStr} ${decisionSimTime}`;
  } else if (finalDecisionTime === timestamp) {
    const dateObj = new Date(timestamp.includes('Z') || timestamp.includes('+') ? timestamp : timestamp + 'Z');
    const estDateStr = dateObj.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    const [month, day, year] = estDateStr.split('/');
    const timeFormattedEst = timestamp.substring(11, 19);
    finalDecisionTime = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeFormattedEst}`;
  }

  // Sort candles chronologically
  const chronologicalCandles = [...rawCandles].reverse().map(c => ({
    date: c.date,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseInt(c.volume)
  }));

  const emaValues = calculate9EMA(chronologicalCandles);
  const chartCandleData = chronologicalCandles.map((c) => ({
    time: fmpDateToUnix(c.date),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume
  }));

  const chartEmaData = chronologicalCandles.map((c, idx) => ({
    time: fmpDateToUnix(c.date),
    value: parseFloat(emaValues[idx].toFixed(4))
  }));

  // Detect pattern at the moment of checklist
  let checklistUnix: number;
  if (evalTime && dateStr) {
    checklistUnix = parseTimeToUnix(`${dateStr} ${evalTime}`);
  } else {
    checklistUnix = parseTimeToUnix(timestamp);
  }
  const candlesUpToDecision = chronologicalCandles.filter(c => fmpDateToUnix(c.date) <= checklistUnix);
  const patternResult = detectBullFlag(candlesUpToDecision.length > 0 ? candlesUpToDecision : chronologicalCandles);

  let resistanceLevel = patternResult?.resistanceLevel || 0;
  let pullbackLow = patternResult?.pullbackLow || 0;

  // Fallback pattern values from checklist text
  if (!resistanceLevel || !pullbackLow) {
    checklistLines.forEach(line => {
      if (line.includes('8. Bull Flag Pattern:')) {
        const resMatch = line.match(/Resistance \$(\d+\.\d+)/);
        if (resMatch) resistanceLevel = parseFloat(resMatch[1]);
      }
      if (line.includes('Pullback Low:') || line.includes('Stop:')) {
        const stopMatch = line.match(/(?:Low|Stop): \$(\d+\.\d+)/);
        if (stopMatch) pullbackLow = parseFloat(stopMatch[1]);
      }
    });
  }

  // Align decisionUnix with nearest candle
  let markerTime = 0;
  let closestDiff = Infinity;
  const finalDecisionUnix = parseTimeToUnix(finalDecisionTime);

  chartCandleData.forEach(c => {
    const candleMin = Math.floor(c.time / 60);
    const decisionMin = Math.floor(finalDecisionUnix / 60);
    if (candleMin === decisionMin) {
      markerTime = c.time;
    }
  });
  if (!markerTime) {
    chartCandleData.forEach(c => {
      const diff = finalDecisionUnix - c.time;
      if (diff >= 0 && diff < closestDiff) {
        closestDiff = diff;
        markerTime = c.time;
      }
    });
  }

  const decisionInfo = {
    ticker,
    targetDate: dateStr,
    decisionTime: finalDecisionTime,
    decisionUnix: markerTime || finalDecisionUnix,
    isAborted,
    decisionReason: decisionReason || (isAborted ? "Aborted trade (No valid news catalyst/pattern error)" : "Entered position"),
    resistanceLevel,
    pullbackLow,
    parsedPrice: parsedPrice || (chartCandleData.find(c => c.time === markerTime)?.close || 0),
    parsedFloat,
    parsedCatalyst: parsedCatalyst || "No fundamental catalyst parsed from log file.",
    checklist: checklistLines
  };

  const formattedChecklistTime = formatUnixToEastern(checklistUnix);

  // Compile HTML output
  const htmlContent = `<!DOCTYPE html>
<html lang="en" class="h-screen">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Momentum Algo Decision Chart - $${ticker} (${formattedChecklistTime})</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/lightweight-charts@4/dist/lightweight-charts.standalone.production.js" onerror="console.warn('unpkg failed, trying jsdelivr'); this.onerror=null; this.src='https://cdn.jsdelivr.net/npm/lightweight-charts@4/dist/lightweight-charts.standalone.production.js';"></script>
  <!-- Error Console Logger -->
  <script>
    window.addEventListener('error', function(e) {
      console.error("Caught error:", e);
      var errDiv = document.getElementById('error-display');
      if (errDiv) {
        errDiv.classList.remove('hidden');
        errDiv.innerText += '\\n[' + new Date().toLocaleTimeString() + '] ' + e.message + ' (at ' + e.filename + ':' + e.lineno + ')';
      }
    });
  </script>
  <style>
    body {
      background-color: #0b0e11;
      color: #d1d4dc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: #131722;
    }
    ::-webkit-scrollbar-thumb {
      background: #2a2e39;
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #363c4e;
    }
  </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">
  <!-- Inline UI Error Console -->
  <div id="error-display" class="hidden bg-rose-950/95 border-b border-rose-500 text-rose-200 p-4 font-mono text-xs whitespace-pre-wrap z-50 relative shrink-0 max-h-32 overflow-y-auto">
    <div class="font-bold border-b border-rose-500/30 pb-1 mb-1 text-[10px] uppercase tracking-wider">Browser Diagnostics Console</div>
  </div>
  <header class="bg-[#131722] border-b border-[#2a2e39] px-6 py-4 flex items-center justify-between shrink-0">
    <div class="flex items-center gap-3">
      <div class="bg-gradient-to-tr from-blue-600 to-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg text-sm tracking-wider shadow-lg">
        ANTIGRAVITY
      </div>
      <div>
        <h1 class="text-lg font-bold text-white leading-tight">Momentum Decision Overlay</h1>
        <p class="text-xs text-gray-400">Intraday 1-Minute Candlestick Visualization</p>
      </div>
    </div>

    <div class="flex items-center gap-6">
      <div class="text-right">
        <span class="text-xs text-gray-500 block uppercase font-semibold tracking-wider">Stock Ticker</span>
        <span class="text-2xl font-black text-white">$${ticker}</span>
      </div>
      <div class="h-8 w-[1px] bg-[#2a2e39]"></div>
      <div class="text-right">
        <span class="text-xs text-gray-500 block uppercase font-semibold tracking-wider">Evaluation Timestamp</span>
        <span class="text-sm font-bold text-gray-200 font-mono">${formattedChecklistTime}</span>
      </div>
      <div class="h-8 w-[1px] bg-[#2a2e39]"></div>
      <div>
        <span class="text-xs text-gray-500 block uppercase font-semibold tracking-wider">Status</span>
        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${isAborted ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}">
          ${isAborted ? 'ABORTED' : 'ENTERED'}
        </span>
      </div>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <div class="flex-1 flex flex-col min-w-0 bg-[#0b0e11] relative">
      <div id="chart" class="absolute inset-0"></div>
      
      <div class="absolute top-4 left-4 z-10 bg-[#131722]/90 border border-[#2a2e39] backdrop-blur-md rounded-lg p-4 flex flex-col gap-1.5 shadow-xl text-xs max-w-sm pointer-events-none">
        <div class="font-bold text-gray-300 mb-1 border-b border-[#2a2e39] pb-1 uppercase tracking-wider text-[10px]">Technical Overlay Specs</div>
        <div class="flex justify-between gap-8"><span class="text-gray-500">Resistance Trigger:</span> <span class="font-mono text-emerald-400 font-bold">$${resistanceLevel.toFixed(2)}</span></div>
        <div class="flex justify-between gap-8"><span class="text-gray-500">Stop Loss Low:</span> <span class="font-mono text-rose-400 font-bold">$${pullbackLow.toFixed(2)}</span></div>
        <div class="flex justify-between gap-8"><span class="text-gray-500">Stop Distance:</span> <span class="font-mono text-gray-300">$${(resistanceLevel - pullbackLow).toFixed(2)}</span></div>
        <div class="flex justify-between gap-8"><span class="text-gray-500">Target (2:1 R:R):</span> <span class="font-mono text-sky-400 font-bold">$${(resistanceLevel + 2 * (resistanceLevel - pullbackLow)).toFixed(2)}</span></div>
      </div>
    </div>

    <aside class="w-96 bg-[#131722] border-l border-[#2a2e39] flex flex-col overflow-hidden shrink-0">
      <div class="p-6 border-b border-[#2a2e39]">
        <h2 class="font-bold text-white uppercase tracking-wider text-xs text-gray-400 mb-3">Decision Evaluation Summary</h2>
        <div class="bg-[#0b0e11] rounded-lg p-4 border border-[#2a2e39]">
          <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Decision Timestamp</div>
          <div class="text-xs font-mono text-white font-semibold mb-3">${finalDecisionTime}</div>
          <div class="text-[10px] text-gray-500 uppercase font-bold mb-1">Execution Action</div>
          <div class="text-xs text-gray-300 leading-relaxed font-semibold font-mono">${decisionInfo.decisionReason}</div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        <div>
          <h3 class="font-bold text-gray-400 uppercase tracking-wider text-[10px] mb-3">Buy Entrance Checklist</h3>
          <div class="bg-[#0b0e11] border border-[#2a2e39] rounded-lg overflow-hidden text-xs">
            ${checklistLines.length > 0 ? `
              <div class="font-mono p-3 leading-relaxed whitespace-pre overflow-x-auto text-gray-300">${checklistLines.join('\n')}</div>
            ` : `
              <div class="p-4 text-gray-500 italic text-center">No checklist data found in logs for this symbol.</div>
            `}
          </div>
        </div>

        <div>
          <h3 class="font-bold text-gray-400 uppercase tracking-wider text-[10px] mb-3">Fundamental Catalyst</h3>
          <div class="bg-[#0b0e11] border border-[#2a2e39] rounded-lg p-4 text-xs flex flex-col gap-3">
            <div>
              <span class="text-[10px] text-gray-500 uppercase font-bold block mb-1">News Headline / SEC Filing</span>
              <p class="text-gray-200 font-semibold leading-relaxed">${parsedCatalyst || 'None found'}</p>
            </div>
            ${parsedFloat ? `
              <div class="border-t border-[#2a2e39] pt-3 flex justify-between">
                <div>
                  <span class="text-[10px] text-gray-500 uppercase font-bold block">Free Float Shares</span>
                  <span class="text-gray-200 font-mono font-bold">${parsedFloat}</span>
                </div>
                <div>
                  <span class="text-[10px] text-gray-500 uppercase font-bold block">Scan Price</span>
                  <span class="text-gray-200 font-mono font-bold">$${parsedPrice.toFixed(2)}</span>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </aside>
  </div>

  <script>
    const candleData = ${JSON.stringify(chartCandleData)};
    const emaData = ${JSON.stringify(chartEmaData)};
    const decisionInfo = ${JSON.stringify(decisionInfo)};

    const chartContainer = document.getElementById('chart');
    const chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth || 800,
      height: chartContainer.clientHeight || 550,
      layout: {
        background: { type: 'solid', color: '#0b0e11' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#131722' },
        horzLines: { color: '#131722' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
      },
      localization: {
        timeFormatter: (timestamp) => {
          const date = new Date(timestamp * 1000);
          return date.toLocaleDateString('en-US', { timeZone: 'America/New_York' }) + ' ' + 
                 date.toLocaleTimeString('en-US', {
                   timeZone: 'America/New_York',
                   hour: '2-digit',
                   minute: '2-digit',
                   second: '2-digit',
                   hour12: false
                 });
        }
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const date = new Date(time * 1000);
          return date.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
        }
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candlestickSeries.setData(candleData);

    const emaSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1.5,
      title: 'EMA 9',
    });
    emaSeries.setData(emaData);

    if (decisionInfo.resistanceLevel > 0) {
      candlestickSeries.createPriceLine({
        price: decisionInfo.resistanceLevel,
        color: '#26a69a',
        lineWidth: 1.5,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'Resistance: $' + decisionInfo.resistanceLevel.toFixed(2),
      });
    }

    if (decisionInfo.pullbackLow > 0) {
      candlestickSeries.createPriceLine({
        price: decisionInfo.pullbackLow,
        color: '#ef5350',
        lineWidth: 1.5,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'Stop Loss: $' + decisionInfo.pullbackLow.toFixed(2),
      });
    }

    if (decisionInfo.decisionUnix > 0) {
      candlestickSeries.setMarkers([
        {
          time: decisionInfo.decisionUnix,
          position: 'aboveBar',
          color: decisionInfo.isAborted ? '#f59e0b' : '#10b981',
          shape: 'arrowDown',
          text: decisionInfo.isAborted ? 'ABORTED' : 'ENTERED',
          size: 1.5,
        }
      ]);

      chart.timeScale().setVisibleRange({
        from: decisionInfo.decisionUnix - 30 * 60,
        to: decisionInfo.decisionUnix + 15 * 60,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0].contentRect) { return; }
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.resize(width, height);
      }
    });
    resizeObserver.observe(chartContainer);
  </script>
</body>
</html>
`;

  // Write file with unique timestamp in name
  const outputFilename = `chart-${ticker}-${dateStr}_${timeFormatted}.html`;
  const outputPath = path.join(publicDir, outputFilename);
  fs.writeFileSync(outputPath, htmlContent, 'utf8');

  console.log(`  -> Generated file://${outputPath}`);
  console.log(`  -> URL: http://localhost:3000/${outputFilename}`);
}

/**
 * Main execution entry point. Iterates through all filtered checklist
 * occurrences in the log and processes each one sequentially.
 * 
 * @returns A promise that resolves when the batch run completes.
 */
async function run() {
  try {
    for (let i = 0; i < filteredOccurrences.length; i++) {
      await processOccurrence(filteredOccurrences[i], i);
    }
    console.log(`\nBatch process completed successfully. Generated ${filteredOccurrences.length} pages.`);
  } catch (error: any) {
    console.error("Execution failed:", error.message);
    process.exit(1);
  }
}

run();

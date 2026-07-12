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
const ticker = (process.argv[2] || 'JZXN').toUpperCase();
const filterDate = process.argv[3] || ''; // YYYY-MM-DD (optional filter)

console.log(`Running batch decision chart overlay script for $${ticker}...`);

// Ensure public folder exists
const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Fetch candles cache to avoid duplicate network requests for the same date
const candlesCache = new Map<string, any[]>();

async function getCachedCandles(symbol: string, date: string): Promise<any[]> {
  if (candlesCache.has(date)) {
    return candlesCache.get(date)!;
  }
  const url = `https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${symbol}&from=${date}&to=${date}&apikey=${FMP_API_KEY}`;
  console.log(`Fetching FMP intraday 1min candles for ${date}: ${url.replace(FMP_API_KEY!, 'SECRET')}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FMP API returned status ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Invalid FMP response: ${JSON.stringify(data)}`);
  }
  candlesCache.set(date, data);
  return data;
}

function fmpDateToUnix(fmpDate: string): number {
  const dateStr = fmpDate.replace(' ', 'T');
  const temp = new Date(dateStr + '-04:00'); // Assume EDT
  if (temp.getMonth() < 2 || temp.getMonth() > 10) {
    return Math.floor(new Date(dateStr + '-05:00').getTime() / 1000);
  }
  return Math.floor(temp.getTime() / 1000);
}

// Load and parse log file
const logPath = path.join(process.cwd(), 'logs/H5hyoiz4kIdrWkUeDFZV7mcCg802.log');
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
  if (line.includes(`Buy Entrance Checklist for $${ticker}:`)) {
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

async function processOccurrence(occ: typeof occurrences[0], index: number) {
  const { timestamp, checklistLines, endIndex } = occ;
  const dateStr = timestamp.substring(0, 10); // YYYY-MM-DD
  const timeFormatted = timestamp.substring(11, 19).replace(/:/g, '-'); // HH-MM-SS

  console.log(`\n[${index + 1}/${filteredOccurrences.length}] Processing JZXN evaluation at ${timestamp}...`);

  // Parse check-post decision (abort / fill)
  let isAborted = false;
  let decisionReason = '';
  let finalDecisionTime = timestamp;

  for (let idx = endIndex; idx < Math.min(endIndex + 15, lines.length); idx++) {
    const line = lines[idx];
    if (line.includes(`[ABORT]`) && line.includes(`$${ticker}`)) {
      isAborted = true;
      decisionReason = line.substring(line.indexOf('[ABORT]'));
      const tMatch = line.match(/^\[([^\]]+)\]/);
      if (tMatch) finalDecisionTime = tMatch[1];
      break;
    }
    if (line.includes(`BUY ORDER FILLED`) && line.includes(`$${ticker}`)) {
      isAborted = false;
      decisionReason = line.substring(line.indexOf('BUY ORDER FILLED'));
      const tMatch = line.match(/^\[([^\]]+)\]/);
      if (tMatch) finalDecisionTime = tMatch[1];
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

  // Get raw candles (from FMP)
  const rawCandles = await getCachedCandles(ticker, dateStr);
  if (rawCandles.length === 0) {
    console.error(`  Warning: No candles found for ${dateStr}, skipping.`);
    return;
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
  const checklistUnix = Math.floor(new Date(timestamp).getTime() / 1000);
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
  const finalDecisionUnix = Math.floor(new Date(finalDecisionTime).getTime() / 1000);
  
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

  // Compile HTML output
  const htmlContent = `<!DOCTYPE html>
<html lang="en" class="h-screen">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Momentum Algo Decision Chart - $${ticker} (${timestamp})</title>
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
        <span class="text-sm font-bold text-gray-200 font-mono">${timestamp}</span>
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
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
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

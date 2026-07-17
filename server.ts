/**
 * @file server.ts
 * @description Main Express application server for the AI Studio Trader dashboard.
 * Sets up middleware, API proxies, static file serving, and Vite development server integrations.
 */

import express from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import { analyzeNewsSentiment } from "./src/lib/gemini";
import { FmpApiClient } from "./fmp_client";
import { adminDb, adminAuth } from "./src/lib/firebaseAdmin";

dotenv.config();

/**
 * Formats a Date object into an ISO 8601 string representing Eastern Standard Time (EST/EDT).
 * @param {Date} [date=new Date()] - The date to format.
 * @returns {string} The formatted ISO string in Eastern Time.
 */
function getEasternISOString(date: Date = new Date()): string {
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

  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset'
  });
  const tzParts = tzFormatter.formatToParts(date);
  const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value || 'GMT-04:00';
  const offset = tzName.replace('GMT', '');

  return `${partMap.year}-${partMap.month}-${partMap.day}T${hour}:${partMap.minute}:${partMap.second}.${ms}${offset}`;
}

/**
 * Logs user actions and trade decisions to a local file for diagnostic purposes.
 * Validates the user ID to prevent path traversal vulnerabilities.
 * @param {string | undefined} userId - The unique identifier of the user.
 * @param {string} message - The message to write to the log.
 * @param {string} [level="INFO"] - The severity level of the log message.
 * @returns {void}
 */
function logUserDecision(userId: string | undefined, message: string, level: string = "INFO") {
  if (!userId) return;

  // Security Fix: Validate userId to prevent path traversal vulnerabilities
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    console.warn(`Invalid userId format detected: ${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    return;
  }

  try {
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFilePath = path.join(logsDir, `${userId}.log`);
    const timestamp = getEasternISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(logFilePath, formattedMessage);
  } catch (error) {
    console.error(`Failed to write local log for user ${userId}:`, error);
  }
}

let fmpClient: FmpApiClient;

/**
 * Fetches the current price of a stock symbol using the Financial Modeling Prep (FMP) API.
 * @param {string} ticker - The stock ticker symbol.
 * @param {string} key - The Financial Modeling Prep API key.
 * @returns {Promise<number>} Resolves to the current stock price, defaulting to 10.0 on error.
 */
async function fetchCurrentPrice(ticker: string, key: string): Promise<number> {
  try {
    const data = await fmpClient.fetchWithCache<any[]>(
      `https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`,
      10000 // 10s cache
    );
    if (Array.isArray(data) && data.length > 0 && data[0].price !== undefined) {
      return parseFloat(data[0].price) || 10.0;
    }
  } catch (err) {
    console.warn(`[FMP PRICE FALLBACK] Quote fetch failed for ${ticker}:`, err);
  }
  return 10.0;
}

/**
 * Calculates the Exponential Moving Average (EMA) for a list of stock candles.
 * @param {any[]} candles - The chronological list of candle data objects.
 * @param {number} [period=9] - The EMA period.
 * @returns {number[]} An array containing the calculated EMA values corresponding to each candle.
 */
function computeLocalEma(candles: any[], period: number = 9): number[] {
  if (candles.length < period) {
    const sum = candles.reduce((acc, c) => acc + (parseFloat(c.close) || 0), 0);
    return candles.map(() => sum / (candles.length || 1));
  }

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // Seed EMA with the SMA of the first `period` candles
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += (parseFloat(candles[i].close) || 0);
    emaValues.push(sum / (i + 1));
  }
  emaValues[period - 1] = sum / period;

  // Calculate EMA for remaining candles
  for (let i = period; i < candles.length; i++) {
    const prevEma = emaValues[i - 1];
    const closeVal = parseFloat(candles[i].close) || 0;
    const ema = (closeVal - prevEma) * multiplier + prevEma;
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Starts the HTTP server and initializes all middleware, database collections, and routes.
 * In development mode, configures and mounts Vite as a middleware.
 * @returns {Promise<void>} Resolves when the server is fully started.
 */
async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // JSON middleware
  app.use(express.json());

  // FMP API Proxy
  /**
   * Retrieves the Financial Modeling Prep (FMP) API key from the environment.
   * Throws an error if the key is not set.
   * @returns {string} The FMP API key.
   * @throws {Error} If FMP_API_KEY is not defined in the environment.
   */
  const getFmpKey = () => {
    const key = process.env.FMP_API_KEY;
    if (!key) {
      throw new Error("FMP_API_KEY environment variable is required");
    }
    return key;
  };

  fmpClient = new FmpApiClient(getFmpKey());

  app.get("/api/stock/:ticker/quote", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();

      const [quoteRes, floatRes, profileRes] = await Promise.allSettled([
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`, 10000), // 10s
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${key}`, 3600000), // 1h
        fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${key}`, 3600000) // 1h
      ]);

      if (quoteRes.status !== 'fulfilled') {
        throw new Error(`FMP quote fetch failed`);
      }
      const data = quoteRes.value;

      let floatShares = 0;
      let outstandingShares = 0;
      if (floatRes.status === 'fulfilled') {
        const floatData = floatRes.value;
        if (Array.isArray(floatData) && floatData.length > 0) {
          floatShares = floatData[0].floatShares || 0;
          outstandingShares = floatData[0].outstandingShares || 0;
        }
      }

      let avgVolume = 0;
      if (profileRes.status === 'fulfilled') {
        const profileData = profileRes.value;
        if (Array.isArray(profileData) && profileData.length > 0) {
          avgVolume = profileData[0].averageVolume || 0;
        }
      }

      // Ensure changesPercentage, sharesOutstanding, and avgVolume are populated for frontend compatibility
      const mappedData = data.map((item: any) => {
        const finalFloat = floatShares || outstandingShares || item.sharesOutstanding || 0;
        return {
          ...item,
          changesPercentage: item.changesPercentage !== undefined ? item.changesPercentage : item.changePercentage,
          sharesOutstanding: finalFloat,
          avgVolume: avgVolume || item.avgVolume || 0
        };
      });

      res.json(mappedData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/live-data", async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      const key = getFmpKey();

      const brokerage = req.headers["x-brokerage"];
      const ibkrUrl = req.headers["x-ibkr-url"];
      const robinhoodToken = req.headers["x-robinhood-token"];

      let price: number | null = null;
      let volume: number = 0;

      // Try fetching from Broker first if connected
      if (brokerage === "interactivebrokers" && ibkrUrl && typeof ibkrUrl === "string") {
        try {
          const baseUrl = ibkrUrl.replace(/\/$/, '');
          // 1. Resolve contract ID
          let conid: number | null = null;
          const secdefRes = await fetch(`${baseUrl}/v1/api/iserver/secdef/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: ticker, name: false, secType: "STK" })
          });
          if (secdefRes.ok) {
            const secdefData = await secdefRes.json();
            if (Array.isArray(secdefData) && secdefData.length > 0) {
              const exactMatch = secdefData.find((item: any) => item.symbol?.toUpperCase() === ticker.toUpperCase() && item.conid);
              if (exactMatch && exactMatch.conid) {
                conid = Number(exactMatch.conid);
              } else if (secdefData[0].conid) {
                conid = Number(secdefData[0].conid);
              }
            }
          }
          if (conid) {
            // 2. Fetch snapshot from IBKR
            const snapshotRes = await fetch(`${baseUrl}/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=31,84,86,87`);
            if (snapshotRes.ok) {
              const snapshotData = await snapshotRes.json();
              if (Array.isArray(snapshotData) && snapshotData[0]) {
                const item = snapshotData[0];
                const last = parseFloat(item['31']);
                const ask = parseFloat(item['86']);
                const bid = parseFloat(item['84']);
                const volStr = item['87'];

                if (!isNaN(last) && last > 0) price = last;
                else if (!isNaN(ask) && ask > 0) price = ask;
                else if (!isNaN(bid) && bid > 0) price = bid;

                if (volStr) {
                  let parsedVol = parseFloat(volStr);
                  if (typeof volStr === 'string') {
                    if (volStr.toUpperCase().endsWith('M')) parsedVol *= 1000000;
                    else if (volStr.toUpperCase().endsWith('K')) parsedVol *= 1000;
                  }
                  if (!isNaN(parsedVol)) volume = parsedVol;
                }
              }
            }
          }
        } catch (ibError: any) {
          console.warn(`Failed to fetch live price from IBKR for ${ticker}:`, ibError.message);
        }
      } else if (brokerage === "robinhood" && robinhoodToken && typeof robinhoodToken === "string") {
        try {
          let token = robinhoodToken;
          if (token.startsWith('Bearer ')) token = token.slice(7);
          const quoteRes = await fetch(`https://api.robinhood.com/quotes/${ticker}/`, {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          });
          if (quoteRes.ok) {
            const quoteData = await quoteRes.json();
            const last = parseFloat(quoteData.last_trade_price || quoteData.last_extended_hours_trade_price);
            const ask = parseFloat(quoteData.ask_price);
            const bid = parseFloat(quoteData.bid_price);

            if (!isNaN(last) && last > 0) price = last;
            else if (!isNaN(ask) && ask > 0) price = ask;
            else if (!isNaN(bid) && bid > 0) price = bid;
          }
        } catch (rhError: any) {
          console.warn(`Failed to fetch live price from Robinhood for ${ticker}:`, rhError.message);
        }
      }

      // Fetch FMP news, quote, float and profile as fallback / supplemental data
      let quote: any = null;
      let newsData: any[] = [];
      let floatShares = 0;
      let outstandingShares = 0;
      let profileAvgVolume = 0;

      try {
        const [quoteRes, floatRes, profileRes, newsRes] = await Promise.allSettled([
          fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`, 10000), // 10s
          fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${key}`, 3600000), // 1h
          fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${key}`, 3600000), // 1h
          fmpClient.fetchWithCache<any>(`https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=5&apikey=${key}`, 300000) // 5m
        ]);

        if (quoteRes.status === 'fulfilled') {
          const quoteData = quoteRes.value;
          if (Array.isArray(quoteData) && quoteData.length > 0) {
            quote = quoteData[0];
          }
        }

        if (floatRes.status === 'fulfilled') {
          const floatData = floatRes.value;
          if (Array.isArray(floatData) && floatData.length > 0) {
            floatShares = floatData[0].floatShares || 0;
            outstandingShares = floatData[0].outstandingShares || 0;
          }
        }

        if (profileRes.status === 'fulfilled') {
          const profileData = profileRes.value;
          if (Array.isArray(profileData) && profileData.length > 0) {
            profileAvgVolume = profileData[0].averageVolume || 0;
          }
        }

        if (newsRes.status === 'fulfilled') {
          newsData = newsRes.value;
        }
      } catch (e: any) {
        console.warn(`Parallel FMP fetches failed/warned for ${ticker}:`, e.message);
      }

      // Fetch stock splits catalyst (within last/upcoming 7 days)
      let splitCatalyst: string | null = null;
      try {
        const splitsData = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/splits?symbol=${ticker}&apikey=${key}`, 3600000); // 1h
        if (Array.isArray(splitsData) && splitsData.length > 0) {
          const recentSplit = splitsData.find((s: any) => {
            if (!s.date) return false;
            const splitDate = new Date(s.date);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - splitDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 7;
          });
          if (recentSplit) {
            splitCatalyst = `SEC Filing: Stock Split Catalyst: ${recentSplit.numerator}-to-${recentSplit.denominator} split on ${recentSplit.date}`;
          }
        }
      } catch (e: any) {
        console.warn(`FMP splits fetch failed for ${ticker}:`, e.message);
      }

      // Fetch insider trading catalyst (purchases within last 30 days)
      let insiderCatalyst: string | null = null;
      try {
        const insiderData = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/insider-trading/search?symbol=${ticker}&limit=10&apikey=${key}`, 3600000); // 1h
        if (Array.isArray(insiderData) && insiderData.length > 0) {
          const recentPurchase = insiderData.find((t: any) => {
            if (!t.transactionDate || !t.transactionType) return false;
            const isPurchase = t.transactionType.toUpperCase().includes("PURCHASE") || t.acquisitionOrDisposition === "A";
            if (!isPurchase) return false;

            const txDate = new Date(t.transactionDate);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - txDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays <= 30;
          });
          if (recentPurchase) {
            insiderCatalyst = `SEC Filing: Insider Buying Catalyst: ${recentPurchase.reportingName} (${recentPurchase.typeOfOwner}) purchased ${recentPurchase.securitiesTransacted} shares at $${recentPurchase.price} on ${recentPurchase.transactionDate}`;
          }
        }
      } catch (e: any) {
        console.warn(`FMP insider-trading fetch failed for ${ticker}:`, e.message);
      }

      const finalPrice = price !== null ? price : (quote ? parseFloat(quote.price) : null);
      if (finalPrice === null || isNaN(finalPrice)) {
        throw new Error(`Failed to fetch price for ticker ${ticker} from both Broker and FMP.`);
      }

      const finalVolume = volume > 0 ? volume : (quote?.volume || 0);
      const avgVolume = profileAvgVolume || quote?.avgVolume || 1;
      const rvol = parseFloat((finalVolume / avgVolume).toFixed(2));

      // Combine all catalysts
      const catalystsList: string[] = [];
      if (splitCatalyst) catalystsList.push(splitCatalyst);
      if (insiderCatalyst) catalystsList.push(insiderCatalyst);
      if (newsData && newsData.length > 0 && newsData[0].title) {
        catalystsList.push(`News: ${newsData[0].title}`);
      }

      let catalyst = "No recent fundamental catalyst found on FMP.";
      if (catalystsList.length > 0) {
        catalyst = catalystsList.join(" | ");
      }

      const finalFloat = floatShares || outstandingShares || quote?.sharesOutstanding || 0;

      return res.json({
        price: finalPrice,
        volume: finalVolume,
        avgVolume,
        rvol: isNaN(rvol) ? 1.0 : rvol,
        catalyst,
        sharesOutstanding: finalFloat,
        companyName: quote?.name || ticker
      });
    } catch (error: any) {
      console.error(`Live data retrieval failure for ${req.params.ticker}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/chart", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const data = await fmpClient.fetchWithCache(`https://financialmodelingprep.com/stable/historical-chart/5min?symbol=${ticker}&apikey=${key}`, 60000); // 1m
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/chart/1min", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();

      if (fmpClient.is1MinUnsupported) {
        return res.status(403).json({ error: "FMP Subscription does not support 1-minute historical charts." });
      }

      const data = await fmpClient.fetchWithCache<any[]>(
        `https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${ticker}&apikey=${key}`,
        60000, // 1 minute cache
        { is1Min: true }
      );

      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({ error: `No 1-minute chart data found for ${ticker}.` });
      }

      // Double check EMA calculations against FMP's pre-calculated indicator
      try {
        const chronological = [...data].reverse();
        const localEmaValues = computeLocalEma(chronological, 9);

        const emaApiUrl = `https://financialmodelingprep.com/stable/technical-indicators/ema?symbol=${ticker}&periodLength=9&timeframe=1min&apikey=${key}`;
        const fmpEmaData = await fmpClient.fetchWithCache<any[]>(emaApiUrl, 0);
        if (Array.isArray(fmpEmaData)) {
            const fmpEmaMap = new Map<string, number>();
            fmpEmaData.forEach((item: any) => {
              if (item.date && item.ema !== undefined && item.ema !== null) {
                fmpEmaMap.set(item.date, parseFloat(item.ema));
              }
            });

            let totalChecks = 0;
            let discrepanciesCount = 0;
            chronological.forEach((candle: any, idx: number) => {
              const localVal = localEmaValues[idx];
              if (localVal === null) return;
              const fmpVal = fmpEmaMap.get(candle.date);
              if (fmpVal !== undefined && !isNaN(localVal)) {
                totalChecks++;
                const diff = Math.abs(localVal - fmpVal);
                if (diff > 0.05) {
                  discrepanciesCount++;
                }
              }
            });
            if (discrepanciesCount > 0) {
              console.warn(`[EMA VALIDATION] Found ${discrepanciesCount} significant discrepancies against FMP EMA data out of ${totalChecks} checks for ${ticker}.`);
            }
        }
      } catch (emaErr: any) {
        console.warn(`[EMA VALIDATION ERROR] Could not validate EMA for ${ticker}: ${emaErr.message}`);
      }

      res.json(data);
    } catch (err: any) {
      console.error(`[FMP 1MIN CHART ERROR] Failed for ${req.params.ticker}: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/stock/:ticker/news", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const data = await fmpClient.fetchWithCache(`https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=20&apikey=${key}`, 300000); // 5m
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/news/sentiment", async (req, res) => {
    try {
      // 1. Authenticate Request via Firebase ID Token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized: Missing authorization header." });
      }
      const idToken = authHeader.substring(7);
      try {
        await adminAuth.verifyIdToken(idToken);
      } catch (authErr: any) {
        return res.status(401).json({ error: `Unauthorized: Invalid token. ${authErr.message}` });
      }

      // 2. Validate Request Parameters
      const { ticker, headline } = req.body;
      if (!ticker || !headline) {
        return res.status(400).json({ error: "Ticker and headline are required" });
      }

      if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY is not configured");
        return res.status(503).json({ error: "GEMINI_API_KEY is not configured", code: "API_KEY_MISSING" });
      }

      // 3. Compute Hashes (SHA-256 and FNV-1a) to look up in Firestore Cache
      const normalized = headline.trim().toLowerCase();
      const shaHash = crypto.createHash("sha256").update(normalized).digest("hex");

      let fnvVal = 2166136261;
      for (let i = 0; i < normalized.length; i++) {
        fnvVal ^= normalized.charCodeAt(i);
        fnvVal = Math.imul(fnvVal, 16777619);
      }
      const fnvHash = (fnvVal >>> 0).toString(16).padStart(8, '0');

      try {
        let cachedDoc = await adminDb.collection('newsSentiment').doc(shaHash).get();
        if (!cachedDoc.exists) {
          cachedDoc = await adminDb.collection('newsSentiment').doc(fnvHash).get();
        }

        if (cachedDoc.exists) {
          const data = cachedDoc.data();
          if (data && typeof data.isPositive === 'boolean') {
            return res.json({
              isPositive: data.isPositive,
              reason: data.reason || 'Cached.'
            });
          }
        }
      } catch (err: any) {
        console.warn(`[WARNING] Failed to query Firestore sentiment cache on server: ${err.message}`);
      }

      // 4. Cache Miss: Perform live Gemini API call
      const result = await analyzeNewsSentiment(ticker, headline);

      // 5. Save to persistent Firestore cache under SHA-256 hash using Admin SDK
      try {
        await adminDb.collection('newsSentiment').doc(shaHash).set({
          ticker,
          headline,
          isPositive: result.isPositive,
          reason: result.reason,
          timestamp: new Date()
        });
      } catch (err: any) {
        console.warn(`[WARNING] Failed to write to Firestore sentiment cache on server: ${err.message}`);
      }

      res.json(result);
    } catch (error: any) {
      console.error(`Gemini sentiment check failed for ${req.body.ticker || "unknown"}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/market/gainers", async (req, res) => {
    try {
      const key = getFmpKey();
      const data = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${key}`, 30000); // 30s

      // Ensure changesPercentage is populated for frontend compatibility
      const mappedData = data.map((item: any) => ({
        ...item,
        changesPercentage: item.changesPercentage !== undefined ? item.changesPercentage : item.changePercentage
      }));

      res.json(mappedData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/market/status", async (req, res) => {
    try {
      const key = getFmpKey();

      // Get today's date in New York timezone (YYYY-MM-DD)
      const etString = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
      const etDate = new Date(etString);
      const year = etDate.getFullYear();
      const month = String(etDate.getMonth() + 1).padStart(2, '0');
      const day = String(etDate.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      // 1. Fetch global exchange market hours for NASDAQ
      const hoursData = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/exchange-market-hours?exchange=NASDAQ&apikey=${key}`, 300000); // 5m
      const marketHours = Array.isArray(hoursData) && hoursData.length > 0 ? hoursData[0] : null;

      // 2. Fetch holiday calendar for today
      let isHoliday = false;
      let holidayName: string | null = null;
      try {
        const holidaysData = await fmpClient.fetchWithCache<any[]>(`https://financialmodelingprep.com/stable/holidays-by-exchange?exchange=NASDAQ&from=${todayStr}&to=${todayStr}&apikey=${key}`, 300000); // 5m
        if (Array.isArray(holidaysData) && holidaysData.length > 0) {
          const holiday = holidaysData.find((h: any) => h.isClosed);
          if (holiday) {
            isHoliday = true;
            holidayName = holiday.name || "Market Holiday";
          }
        }
      } catch (holidayError: any) {
        console.warn("Failed to fetch market holidays:", holidayError.message);
      }

      // If it is a holiday, override isMarketOpen to false
      const finalIsMarketOpen = marketHours ? (marketHours.isMarketOpen && !isHoliday) : false;

      res.json({
        isMarketOpen: finalIsMarketOpen,
        openingHour: marketHours?.openingHour || "09:30 AM -04:00",
        closingHour: marketHours?.closingHour || "04:00 PM -04:00",
        timezone: marketHours?.timezone || "America/New_York",
        isHoliday,
        holidayName,
        currentDate: todayStr
      });
    } catch (error: any) {
      console.error("Market status retrieval failure:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Local logging endpoint for client decisions
  app.post("/api/logs", (req, res) => {
    const { userId, message, level } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    logUserDecision(userId, message, level);
    res.json({ success: true });
  });

  // Check if log file exists for a user
  app.get("/api/logs/exists", (req, res) => {
    const { userId } = req.query;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: "userId is required" });
    }
    // Prevent path traversal
    if (userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    const logsDir = path.join(process.cwd(), "logs");
    const logFilePath = path.join(logsDir, `${userId}.log`);
    const exists = fs.existsSync(logFilePath);
    res.json({ exists });
  });

  // Download log file for a user
  app.get("/api/logs/download", (req, res) => {
    const { userId } = req.query;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: "userId is required" });
    }
    // Prevent path traversal
    if (userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    const logsDir = path.join(process.cwd(), "logs");
    const logFilePath = path.join(logsDir, `${userId}.log`);
    if (!fs.existsSync(logFilePath)) {
      return res.status(404).json({ error: "Log file not found" });
    }
    res.download(logFilePath, `${userId}.log`);
  });


  // Brokerage API Proxies
  app.get("/api/broker/trades", async (req, res) => {
    try {
      const { brokerage } = req.query;

      if (brokerage === "robinhood") {
        res.json([]);
      } else if (brokerage === "interactivebrokers") {
        const url = req.headers["x-ibkr-url"];
        if (!url || typeof url !== 'string') throw new Error("Interactive Brokers Gateway URL is missing.");

        const baseUrl = url.replace(/\/$/, '');
        const tradesRes = await fetch(`${baseUrl}/v1/api/iserver/account/trades`);
        if (!tradesRes.ok) {
          if (tradesRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
          }
          throw new Error("Failed to fetch IBKR trades.");
        }

        const data = await tradesRes.json();
        res.json(data);
      } else {
        res.json([]);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Robinhood Login API
  app.post("/api/broker/robinhood/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      // Simulate real auth call to Robinhood (since real one requires complex device token + MFA usually)
      // If we can't fetch a token easily, we'll try to just validate it by making a dummy call if they pass a token,
      // but here they passed user/pass. We'll return a fake token or attempt real authentication.
      // A full implementation requires tracking device_id and handling MFA challenges.
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      // For this prototype, we simulate a successful login check if credentials are provided.
      // Real implementation would use: fetch("https://api.robinhood.com/oauth2/token/")
      // with grant_type=password, client_id, device_token, etc.

      // We will pretend we received a bearer token
      const mockToken = "Bearer " + Buffer.from(username + ":" + Date.now()).toString('base64');
      res.json({ token: mockToken });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/broker/trade", async (req, res) => {
    const userId = req.headers["x-user-id"] as string | undefined;
    try {
      const { brokerage, ticker, shares, price, side, target, stop } = req.body;

      logUserDecision(
        userId,
        `Broker Trade Requested: ${side?.toUpperCase()} ${shares} $${ticker?.toUpperCase()} via ${brokerage} (Price: $${price || 'MKT'}, Target: $${target || 'N/A'}, Stop: $${stop || 'N/A'})`,
        "EXEC"
      );

      if (brokerage === "robinhood") {
        let token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') {
          logUserDecision(userId, "Robinhood trade failed: Token missing in headers", "ERROR");
          throw new Error("Robinhood token missing. Please configure it in Settings.");
        }
        if (token.startsWith('Bearer ')) token = token.slice(7);

        // 1. Get Account
        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        if (!accountsRes.ok) {
          logUserDecision(userId, `Robinhood trade failed: Fetch accounts returned status ${accountsRes.status}`, "ERROR");
          throw new Error("Failed to fetch Robinhood accounts. Check your bearer token.");
        }

        const accountsData = await accountsRes.json();
        const account = accountsData.results?.[0];
        if (!account) {
          logUserDecision(userId, "Robinhood trade failed: No account results returned", "ERROR");
          throw new Error("No Robinhood account found");
        }

        // 2. Get Instrument
        const instrumentRes = await fetch(`https://api.robinhood.com/instruments/?symbol=${ticker}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        if (!instrumentRes.ok) {
          logUserDecision(userId, `Robinhood trade failed: Fetch instrument returned status ${instrumentRes.status}`, "ERROR");
          throw new Error("Failed to fetch instrument.");
        }
        const instrumentData = await instrumentRes.json();
        const instrument = instrumentData.results?.[0];
        if (!instrument) {
          logUserDecision(userId, `Robinhood trade failed: Instrument for symbol ${ticker} not found`, "ERROR");
          throw new Error("Instrument not found.");
        }

        // 3. Place Order
        const priceStr = price ? (parseFloat(price) < 1 ? parseFloat(price).toFixed(4) : parseFloat(price).toFixed(2)) : undefined;

        const orderPayload = {
          account: account.url,
          instrument: instrument.url,
          symbol: ticker,
          price: priceStr,
          quantity: shares.toString(),
          side: side || "buy",
          time_in_force: "gfd",
          trigger: "immediate",
          type: price ? "limit" : "market",
          ref_id: crypto.randomUUID(),
          extended_hours: false,
          market_hours: "regular_hours",
          order_form_version: 4,
          ask_price: priceStr || "1.00",
          bid_price: priceStr || "1.00",
          bid_ask_timestamp: new Date().toISOString()
        };

        logUserDecision(userId, `Submitting order payload to Robinhood: ${JSON.stringify(orderPayload)}`, "INFO");
        const orderRes = await fetch("https://api.robinhood.com/orders/", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          body: JSON.stringify(orderPayload)
        });

        const respText = await orderRes.text();
        logUserDecision(userId, `Robinhood order response status: ${orderRes.status} | body: ${respText}`, "INFO");

        if (!orderRes.ok) {
          throw new Error(`Robinhood trade failed: ${respText}`);
        }

        const orderData = JSON.parse(respText);
        logUserDecision(userId, `Robinhood order submitted successfully: Order ID ${orderData.id}, Status ${orderData.state}`, "SUCCESS");
        return res.json({ success: true, order: { id: orderData.id, status: orderData.state } });
      } else if (brokerage === "interactivebrokers") {
        const url = req.headers["x-ibkr-url"];
        if (!url || typeof url !== 'string') {
          logUserDecision(userId, "IBKR trade failed: Gateway URL is missing", "ERROR");
          throw new Error("Interactive Brokers Gateway URL is missing.");
        }

        const baseUrl = url.replace(/\/$/, '');
        const accountsRes = await fetch(`${baseUrl}/v1/api/portfolio/accounts`);
        if (!accountsRes.ok) {
          logUserDecision(userId, `IBKR trade failed: Fetch accounts returned status ${accountsRes.status}`, "ERROR");
          if (accountsRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
          }
          throw new Error("Failed to fetch IBKR accounts.");
        }

        const accountsData = await accountsRes.json();
        const accountId = accountsData?.[0]?.accountId || accountsData?.[0]?.id;
        if (!accountId) {
          logUserDecision(userId, "IBKR trade failed: No account found", "ERROR");
          throw new Error("No IBKR account found");
        }

        // 1. Resolve ticker symbol to IBKR contract ID (conid)
        let conid: number | null = null;
        try {
          logUserDecision(userId, `Resolving IBKR conid for symbol: ${ticker}`, "INFO");
          const secdefRes = await fetch(`${baseUrl}/v1/api/iserver/secdef/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: ticker, name: false, secType: "STK" })
          });
          if (secdefRes.ok) {
            const secdefData = await secdefRes.json();
            logUserDecision(userId, `IBKR secdef search result: ${JSON.stringify(secdefData)}`, "INFO");
            if (Array.isArray(secdefData) && secdefData.length > 0) {
              const exactMatch = secdefData.find((item: any) => item.symbol?.toUpperCase() === ticker.toUpperCase() && item.conid);
              if (exactMatch && exactMatch.conid) {
                conid = Number(exactMatch.conid);
              } else if (secdefData[0].conid) {
                conid = Number(secdefData[0].conid);
              }
            }
          } else {
            logUserDecision(userId, `IBKR secdef search failed with status ${secdefRes.status}`, "WARN");
            if (secdefRes.status === 401) {
              throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
            }
            const errText = await secdefRes.text();
            console.warn(`IBKR secdef/search returned status ${secdefRes.status}: ${errText}`);
          }
        } catch (searchErr: any) {
          logUserDecision(userId, `IBKR secdef search error: ${searchErr.message}`, "ERROR");
          if (searchErr.message && searchErr.message.includes("unauthenticated or expired")) {
            throw searchErr;
          }
        }

        if (!conid) {
          // Fallback: If ticker is purely numeric, we can use it as conid directly
          const parsedTickerNum = parseInt(ticker, 10);
          if (!isNaN(parsedTickerNum) && parsedTickerNum.toString() === ticker) {
            conid = parsedTickerNum;
          } else {
            logUserDecision(userId, `IBKR trade failed: Could not resolve Contract ID (conid) for symbol ${ticker}`, "ERROR");
            throw new Error(`Could not resolve Contract ID (conid) for symbol: ${ticker}. Please make sure the IBKR client gateway is running, authenticated, and the symbol is valid.`);
          }
        }

        logUserDecision(userId, `Resolved conid for ${ticker} is ${conid}`, "INFO");

        let ordersPayload: any[] = [];

        if (side === "buy" && target && stop) {
          const parentCoid = `B-${crypto.randomUUID().substring(0, 8)}`;
          const profitCoid = `PT-${crypto.randomUUID().substring(0, 8)}`;
          const stopCoid = `SL-${crypto.randomUUID().substring(0, 8)}`;

          ordersPayload = [
            {
              conid: conid,
              secType: "STK",
              cOID: parentCoid,
              side: "BUY",
              orderType: price ? "LMT" : "MKT",
              price: price ? Number(price) : undefined,
              quantity: Number(shares),
              tif: "DAY",
              transmit: false
            },
            {
              conid: conid,
              secType: "STK",
              cOID: profitCoid,
              parentId: parentCoid,
              side: "SELL",
              orderType: "LMT",
              price: Number(target),
              quantity: Number(shares),
              tif: "DAY",
              transmit: false
            },
            {
              conid: conid,
              secType: "STK",
              cOID: stopCoid,
              parentId: parentCoid,
              side: "SELL",
              orderType: "STP",
              price: Number(stop),
              quantity: Number(shares),
              tif: "DAY",
              transmit: true
            }
          ];
        } else {
          ordersPayload = [{
            conid: conid,
            secType: "STK",
            orderType: price ? "LMT" : "MKT",
            price: price ? Number(price) : undefined,
            side: side === "buy" ? "BUY" : "SELL",
            quantity: Number(shares),
            tif: "DAY"
          }];
        }

        logUserDecision(userId, `Submitting order payload to IBKR: ${JSON.stringify({ orders: ordersPayload })}`, "INFO");

        const orderRes = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orders: ordersPayload })
        });

        const respText = await orderRes.text();
        logUserDecision(userId, `IBKR order response status: ${orderRes.status} | body: ${respText}`, "INFO");

        if (!orderRes.ok) {
          logUserDecision(userId, `IBKR order submission failed: status ${orderRes.status}`, "ERROR");
          if (orderRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL (e.g., https://localhost:5000) and try again.");
          }
          throw new Error(`IBKR trade failed: ${respText || `Status ${orderRes.status}`}`);
        }

        const approvedWarningsHeader = req.headers["x-approved-ibkr-warnings"];
        const approvedWarnings = approvedWarningsHeader && typeof approvedWarningsHeader === 'string'
          ? approvedWarningsHeader.split(',').map(s => s.trim()).filter(s => s)
          : [];

        let data = JSON.parse(respText);

        // Check if any order in the response has a Failed status
        if (Array.isArray(data)) {
          const failedOrder = data.find(o => o.order_status === "Failed" || o.status === "Failed");
          if (failedOrder) {
            logUserDecision(userId, `IBKR order placement failed: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`, "ERROR");
            throw new Error(`IBKR trade placement failed: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`);
          }
        } else if (data && data.error) {
          logUserDecision(userId, `IBKR order placement error: ${data.error}`, "ERROR");
          throw new Error(`IBKR trade failed: ${data.error}`);
        }

        // Auto-reply to warnings if the response is a confirmation array and they are approved
        while (Array.isArray(data) && data.length > 0 && data[0].id) {
          const prompt = data[0];
          logUserDecision(userId, `IBKR returned confirmation prompt "${prompt.id}" (messageIds: ${JSON.stringify(prompt.messageIds)})`, "WARN");

          const isApproved = prompt.messageIds && prompt.messageIds.every((id: string) => approvedWarnings.includes(id));
          if (!isApproved) {
            logUserDecision(userId, `Halting order placement for client warning approval. Message: "${prompt.message}"`, "WARN");
            return res.json({ requiresConfirmation: true, prompts: data });
          }

          logUserDecision(userId, `Prompt "${prompt.id}" is already approved. Auto-confirming...`, "INFO");

          // Send confirmed = true to the reply endpoint
          const replyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${prompt.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmed: true })
          });

          if (!replyRes.ok) {
            logUserDecision(userId, `IBKR warning auto-reply failed: status ${replyRes.status}`, "ERROR");
            if (replyRes.status === 401) {
              throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
            }
            const replyErr = await replyRes.text();
            throw new Error(`IBKR trade confirmation reply failed: ${replyErr}`);
          }

          const replyText = await replyRes.text();
          logUserDecision(userId, `IBKR auto-reply response status: ${replyRes.status} | body: ${replyText}`, "INFO");
          data = JSON.parse(replyText);
        }

        logUserDecision(userId, `IBKR order submission complete: ${JSON.stringify(data)}`, "SUCCESS");
        res.json(data);
      } else {
        logUserDecision(userId, "Simulated trade processed successfully", "SUCCESS");
        res.json({ success: true, simulated: true });
      }
    } catch (error: any) {
      logUserDecision(userId, `Trade API execution error: ${error.message}`, "ERROR");
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/broker/ibkr/reply", async (req, res) => {
    const userId = req.headers["x-user-id"] as string | undefined;
    try {
      const { promptId, confirmed } = req.body;
      const url = req.headers["x-ibkr-url"];
      if (!url || typeof url !== 'string') {
        logUserDecision(userId, "IBKR manual reply failed: Gateway URL is missing", "ERROR");
        throw new Error("Interactive Brokers Gateway URL is missing.");
      }

      const baseUrl = url.replace(/\/$/, '');
      const approvedWarningsHeader = req.headers["x-approved-ibkr-warnings"];
      const approvedWarnings = approvedWarningsHeader && typeof approvedWarningsHeader === 'string'
        ? approvedWarningsHeader.split(',').map(s => s.trim()).filter(s => s)
        : [];

      logUserDecision(userId, `Submitting user manual reply for prompt "${promptId}" (confirmed: ${confirmed})`, "EXEC");

      const replyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${promptId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed })
      });

      if (!replyRes.ok) {
        logUserDecision(userId, `IBKR manual reply failed: status ${replyRes.status}`, "ERROR");
        if (replyRes.status === 401) {
          throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
        }
        const replyErr = await replyRes.text();
        throw new Error(`IBKR trade confirmation reply failed: ${replyErr}`);
      }

      const replyText = await replyRes.text();
      logUserDecision(userId, `IBKR manual reply response status: ${replyRes.status} | body: ${replyText}`, "INFO");

      let data = JSON.parse(replyText);

      // Auto-reply to subsequent warnings if they are already approved
      while (Array.isArray(data) && data.length > 0 && data[0].id) {
        const prompt = data[0];
        logUserDecision(userId, `IBKR returned subsequent confirmation prompt "${prompt.id}" (messageIds: ${JSON.stringify(prompt.messageIds)})`, "WARN");

        const isApproved = prompt.messageIds && prompt.messageIds.every((id: string) => approvedWarnings.includes(id));
        if (!isApproved) {
          logUserDecision(userId, `Halting order placement for subsequent client warning approval. Message: "${prompt.message}"`, "WARN");
          return res.json({ requiresConfirmation: true, prompts: data });
        }

        logUserDecision(userId, `Subsequent prompt "${prompt.id}" is already approved. Auto-confirming...`, "INFO");

        const nextReplyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${prompt.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true })
        });

        if (!nextReplyRes.ok) {
          logUserDecision(userId, `IBKR auto-reply to subsequent prompt failed: status ${nextReplyRes.status}`, "ERROR");
          if (nextReplyRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
          }
          const nextReplyErr = await nextReplyRes.text();
          throw new Error(`IBKR subsequent confirmation reply failed: ${nextReplyErr}`);
        }

        const nextReplyText = await nextReplyRes.text();
        logUserDecision(userId, `IBKR subsequent auto-reply response body: ${nextReplyText}`, "INFO");
        data = JSON.parse(nextReplyText);
      }

      // Check if final order response has any failed legs
      if (Array.isArray(data)) {
        const failedOrder = data.find(o => o.order_status === "Failed" || o.status === "Failed");
        if (failedOrder) {
          logUserDecision(userId, `IBKR order reply finished with failed leg: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`, "ERROR");
          throw new Error(`IBKR trade placement failed: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`);
        }
      }

      logUserDecision(userId, `IBKR manual reply flow completed: ${JSON.stringify(data)}`, "SUCCESS");
      res.json(data);
    } catch (error: any) {
      logUserDecision(userId, `IBKR Reply API error: ${error.message}`, "ERROR");
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/broker/balance", async (req, res) => {
    try {
      const { brokerage } = req.query;

      if (brokerage === "robinhood") {
        let token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        if (token.startsWith('Bearer ')) token = token.slice(7);

        const accountsRes = await fetch("https://api.robinhood.com/accounts/", {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        if (!accountsRes.ok) throw new Error("Failed to fetch Robinhood accounts. Check your bearer token.");

        const accountsData = await accountsRes.json();
        const account = accountsData.results?.[0];
        if (!account) throw new Error("No Robinhood account found");

        const buyingPower = account.margin_balances?.unallocated_margin_cash
          || account.cash_balances?.buying_power
          || account.buying_power
          || "0";

        let pnl = 0;
        let pnlPercent = 0;
        try {
          const portfoliosRes = await fetch("https://api.robinhood.com/portfolios/", {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          });
          if (portfoliosRes.ok) {
            const portfoliosData = await portfoliosRes.json();
            const portfolio = portfoliosData.results?.[0];
            if (portfolio) {
              const equity = parseFloat(portfolio.equity || "0");
              const previousClose = parseFloat(portfolio.equity_previous_close || "0");
              pnl = parseFloat((equity - previousClose).toFixed(2));
              pnlPercent = previousClose > 0 ? parseFloat(((pnl / previousClose) * 100).toFixed(2)) : 0;
            }
          }
        } catch (portfolioErr) {
          console.warn("Failed to fetch Robinhood portfolio details:", portfolioErr);
        }

        return res.json({
          balance: parseFloat(buyingPower),
          pnl,
          pnlPercent
        });
      } else if (brokerage === "interactivebrokers") {
        const url = req.headers["x-ibkr-url"];
        if (!url || typeof url !== 'string') throw new Error("Interactive Brokers Gateway URL is missing.");

        const baseUrl = url.replace(/\/$/, '');
        const accountsRes = await fetch(`${baseUrl}/v1/api/portfolio/accounts`);
        if (!accountsRes.ok) {
          if (accountsRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
          }
          throw new Error("Failed to fetch IBKR accounts.");
        }

        const accountsData = await accountsRes.json();
        const accountId = accountsData?.[0]?.accountId || accountsData?.[0]?.id;
        if (!accountId) throw new Error("No IBKR account found");

        const balRes = await fetch(`${baseUrl}/v1/api/portfolio/${accountId}/summary`);
        if (!balRes.ok) {
          if (balRes.status === 401) {
            throw new Error("IBKR Gateway session is unauthenticated or expired. Please log in at your Gateway URL.");
          }
          throw new Error("Failed to fetch IBKR balance.");
        }

        const balData = await balRes.json();
        const balance = balData.availablefunds?.amount || balData.buyingpower?.amount || 0;
        const unrealized = parseFloat(balData.unrealizedpnl?.amount || 0);
        const realized = parseFloat(balData.realizedpnl?.amount || 0);
        const pnl = parseFloat((unrealized + realized).toFixed(2));
        const netLiquidation = parseFloat(balData.netliquidation?.amount || 0);
        const previousLiquidation = netLiquidation - pnl;
        const pnlPercent = previousLiquidation > 0 ? parseFloat(((pnl / previousLiquidation) * 100).toFixed(2)) : 0;

        res.json({
          balance: parseFloat(balance),
          pnl,
          pnlPercent
        });
      } else {
        res.json({ balance: 0, pnl: 0, pnlPercent: 0 }); // Fallback / mock
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // For Express 4
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

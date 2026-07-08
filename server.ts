import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Disable TLS verification for IBKR Client Portal Gateway self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Local logging helper for user decisions
function logUserDecision(userId: string | undefined, message: string, level: string = "INFO") {
  if (!userId) return;
  try {
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFilePath = path.join(logsDir, `${userId}.log`);
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(logFilePath, formattedMessage);
  } catch (error) {
    console.error(`Failed to write local log for user ${userId}:`, error);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON middleware
  app.use(express.json());

  // FMP API Proxy
  const getFmpKey = () => {
    const key = process.env.FMP_API_KEY;
    if (!key) {
      throw new Error("FMP_API_KEY environment variable is required");
    }
    return key;
  };

  app.get("/api/stock/:ticker/quote", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const response = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`);
      if (!response.ok) throw new Error(`FMP API error: status ${response.status}`);
      const data = await response.json();
      
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

      // Fetch FMP news and quote as fallback / supplemental data
      let quote: any = null;
      let newsData: any[] = [];
      
      try {
        const quoteRes = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`);
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          if (Array.isArray(quoteData) && quoteData.length > 0) {
            quote = quoteData[0];
          }
        }
      } catch (e: any) {
        console.warn(`FMP quote fetch failed for ${ticker}:`, e.message);
      }

      try {
        const newsRes = await fetch(`https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=5&apikey=${key}`);
        if (newsRes.ok) {
          newsData = await newsRes.json();
        }
      } catch (e: any) {
        console.warn(`FMP news fetch failed for ${ticker}:`, e.message);
      }

      const finalPrice = price !== null ? price : (quote ? parseFloat(quote.price) : null);
      if (finalPrice === null || isNaN(finalPrice)) {
        throw new Error(`Failed to fetch price for ticker ${ticker} from both Broker and FMP.`);
      }

      const finalVolume = volume > 0 ? volume : (quote?.volume || 0);
      const avgVolume = quote?.avgVolume || 1;
      const rvol = parseFloat((finalVolume / avgVolume).toFixed(2));

      let catalyst = "No recent news catalyst found on FMP.";
      if (newsData && newsData.length > 0 && newsData[0].title) {
        catalyst = newsData[0].title;
      }

      return res.json({
        price: finalPrice,
        volume: finalVolume,
        avgVolume,
        rvol: isNaN(rvol) ? 1.0 : rvol,
        catalyst,
        sharesOutstanding: quote?.sharesOutstanding || 0,
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
      const response = await fetch(`https://financialmodelingprep.com/stable/historical-chart/5min?symbol=${ticker}&apikey=${key}`);
      if (!response.ok) throw new Error(`FMP API error: status ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/chart/1min", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const response = await fetch(`https://financialmodelingprep.com/stable/historical-chart/1min?symbol=${ticker}&apikey=${key}`);
      if (!response.ok) throw new Error(`FMP API error: status ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/news", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const response = await fetch(`https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=20&apikey=${key}`);
      if (!response.ok) throw new Error(`FMP API error: status ${response.status}`);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/news/sentiment", async (req, res) => {
    try {
      const { ticker, headline } = req.body;
      if (!ticker || !headline) {
        return res.status(400).json({ error: "Ticker and headline are required" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("GEMINI_API_KEY is not configured, bypassing sentiment check");
        return res.json({ isPositive: true, reason: "GEMINI_API_KEY not configured, sentiment check bypassed." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analyze the sentiment of the following news headline/catalyst for the stock symbol "${ticker}". Determine if the news is positive (bullish) or negative (bearish/neutral) for the stock price.

Headline: "${headline}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              isPositive: {
                type: "BOOLEAN",
                description: "True if the news is positive/bullish for the company, false if negative or bearish/neutral."
              },
              reason: {
                type: "STRING",
                description: "A short, one-sentence explanation of the sentiment decision."
              }
            },
            required: ["isPositive", "reason"]
          }
        }
      });

      if (!response.text) {
        throw new Error("No text response received from Gemini API");
      }

      const parsed = JSON.parse(response.text);
      res.json({
        isPositive: parsed.isPositive === true,
        reason: parsed.reason || "No reason provided."
      });
    } catch (error: any) {
      console.error(`Gemini sentiment check failed for ${req.body.ticker || "unknown"}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/market/gainers", async (req, res) => {
    try {
      const key = getFmpKey();
      const response = await fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${key}`);
      if (!response.ok) throw new Error(`FMP API error: status ${response.status}`);
      const data = await response.json();
      
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

  // Local logging endpoint for client decisions
  app.post("/api/logs", (req, res) => {
    const { userId, message, level } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    logUserDecision(userId, message, level);
    res.json({ success: true });
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

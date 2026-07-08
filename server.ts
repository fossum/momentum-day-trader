import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";

// Disable TLS verification for IBKR Client Portal Gateway self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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
      const response = await fetch(`https://financialmodelingprep.com/api/v3/quote/${ticker}?apikey=${key}`);
      if (!response.ok) throw new Error("FMP API error");
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock/:ticker/chart", async (req, res) => {
    try {
      const key = getFmpKey();
      const ticker = req.params.ticker.toUpperCase();
      const response = await fetch(`https://financialmodelingprep.com/api/v3/historical-chart/5min/${ticker}?apikey=${key}`);
      if (!response.ok) throw new Error("FMP API error");
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
      const response = await fetch(`https://financialmodelingprep.com/api/v3/stock_news?tickers=${ticker}&limit=20&apikey=${key}`);
      if (!response.ok) throw new Error("FMP API error");
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/market/gainers", async (req, res) => {
    try {
      const key = getFmpKey();
      const response = await fetch(`https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey=${key}`);
      if (!response.ok) throw new Error("FMP API error");
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
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
        if (!tradesRes.ok) throw new Error("Failed to fetch IBKR trades.");
        
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
    try {
      const { brokerage, ticker, shares, price, side } = req.body;
      
      if (brokerage === "robinhood") {
        let token = req.headers["x-robinhood-token"];
        if (!token || typeof token !== 'string') throw new Error("Robinhood token missing. Please configure it in Settings.");
        if (token.startsWith('Bearer ')) token = token.slice(7);
        
        // 1. Get Account
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
        
        // 2. Get Instrument
        const instrumentRes = await fetch(`https://api.robinhood.com/instruments/?symbol=${ticker}`, {
          headers: { 
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        if (!instrumentRes.ok) throw new Error("Failed to fetch instrument.");
        const instrumentData = await instrumentRes.json();
        const instrument = instrumentData.results?.[0];
        if (!instrument) throw new Error("Instrument not found.");
        
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
        
        console.log("Submitting order to Robinhood:", JSON.stringify(orderPayload, null, 2));
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
        console.log("Robinhood Order Response Status:", orderRes.status);
        console.log("Robinhood Order Response Body:", respText);
        
        const fs = require('fs');
        fs.appendFileSync('broker.log', `[${new Date().toISOString()}] STATUS: ${orderRes.status} BODY: ${respText}\n`);
        
        if (!orderRes.ok) {
          throw new Error(`Robinhood trade failed: ${respText}`);
        }
        
        const orderData = JSON.parse(respText);
        return res.json({ success: true, order: { id: orderData.id, status: orderData.state } });
      } else if (brokerage === "interactivebrokers") {
        const url = req.headers["x-ibkr-url"];
        if (!url || typeof url !== 'string') throw new Error("Interactive Brokers Gateway URL is missing.");
        
        const baseUrl = url.replace(/\/$/, '');
        const accountsRes = await fetch(`${baseUrl}/v1/api/portfolio/accounts`);
        if (!accountsRes.ok) throw new Error("Failed to fetch IBKR accounts.");
        
        const accountsData = await accountsRes.json();
        const accountId = accountsData?.[0]?.accountId || accountsData?.[0]?.id;
        if (!accountId) throw new Error("No IBKR account found");
        
        // 1. Resolve ticker symbol to IBKR contract ID (conid)
        let conid: number | null = null;
        try {
          console.log(`Resolving IBKR conid for symbol: ${ticker}`);
          const secdefRes = await fetch(`${baseUrl}/v1/api/iserver/secdef/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbol: ticker, name: false, secType: "STK" })
          });
          if (secdefRes.ok) {
            const secdefData = await secdefRes.json();
            console.log("IBKR secdef search result:", JSON.stringify(secdefData));
            if (Array.isArray(secdefData) && secdefData.length > 0) {
              const exactMatch = secdefData.find((item: any) => item.symbol?.toUpperCase() === ticker.toUpperCase() && item.conid);
              if (exactMatch && exactMatch.conid) {
                conid = Number(exactMatch.conid);
              } else if (secdefData[0].conid) {
                conid = Number(secdefData[0].conid);
              }
            }
          } else {
            const errText = await secdefRes.text();
            console.warn(`IBKR secdef/search returned status ${secdefRes.status}: ${errText}`);
          }
        } catch (searchErr: any) {
          console.error("Error searching IBKR secdef:", searchErr);
        }

        if (!conid) {
          // Fallback: If ticker is purely numeric, we can use it as conid directly
          const parsedTickerNum = parseInt(ticker, 10);
          if (!isNaN(parsedTickerNum) && parsedTickerNum.toString() === ticker) {
            conid = parsedTickerNum;
          } else {
            throw new Error(`Could not resolve Contract ID (conid) for symbol: ${ticker}. Please make sure the IBKR client gateway is running, authenticated, and the symbol is valid.`);
          }
        }

        console.log(`Resolved conid for ${ticker} is ${conid}`);

        const orderRes = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orders: [{
              conid: conid, 
              secType: "STK",
              orderType: price ? "LMT" : "MKT",
              price: price ? Number(price) : undefined,
              side: side === "buy" ? "BUY" : "SELL",
              quantity: Number(shares),
              tif: "DAY"
            }]
          })
        });
        
        if (!orderRes.ok) {
          const err = await orderRes.text();
          throw new Error(`IBKR trade failed: ${err}`);
        }
        
        const data = await orderRes.json();
        res.json(data);
      } else {
        res.json({ success: true, simulated: true });
      }
    } catch (error: any) {
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

        return res.json({ balance: parseFloat(buyingPower) });
      } else if (brokerage === "interactivebrokers") {
        const url = req.headers["x-ibkr-url"];
        if (!url || typeof url !== 'string') throw new Error("Interactive Brokers Gateway URL is missing.");
        
        const baseUrl = url.replace(/\/$/, '');
        const accountsRes = await fetch(`${baseUrl}/v1/api/portfolio/accounts`);
        if (!accountsRes.ok) throw new Error("Failed to fetch IBKR accounts.");
        
        const accountsData = await accountsRes.json();
        const accountId = accountsData?.[0]?.accountId || accountsData?.[0]?.id;
        if (!accountId) throw new Error("No IBKR account found");
        
        const balRes = await fetch(`${baseUrl}/v1/api/portfolio/${accountId}/summary`);
        if (!balRes.ok) throw new Error("Failed to fetch IBKR balance.");
        
        const balData = await balRes.json();
        const balance = balData.availablefunds?.amount || balData.buyingpower?.amount || 0;
        res.json({ balance: parseFloat(balance) });
      } else {
        res.json({ balance: 0 }); // Fallback / mock
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

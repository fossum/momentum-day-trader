import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

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

      const [quoteRes, newsRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/quote?symbol=${ticker}&apikey=${key}`),
        fetch(`https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=5&apikey=${key}`)
      ]);

      if (!quoteRes.ok) throw new Error(`FMP Quote API failed with status ${quoteRes.status}`);
      if (!newsRes.ok) throw new Error(`FMP News API failed with status ${newsRes.status}`);

      const quoteData = await quoteRes.json();
      const newsData = await newsRes.json();

      if (!quoteData || quoteData.length === 0) {
        throw new Error(`No quote data found for ticker ${ticker} on FMP.`);
      }

      const quote = quoteData[0];
      const price = parseFloat(quote.price);
      if (isNaN(price)) throw new Error("Invalid price returned from FMP.");

      const volume = quote.volume || 0;
      const avgVolume = quote.avgVolume || 1;
      const rvol = parseFloat((volume / avgVolume).toFixed(2));

      let catalyst = "No recent news catalyst found on FMP.";
      if (newsData && newsData.length > 0 && newsData[0].title) {
        catalyst = newsData[0].title;
      }

      return res.json({
        price,
        volume,
        avgVolume,
        rvol,
        catalyst,
        companyName: quote.name || ticker
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
      const { brokerage, ticker, shares, price, side, target, stop } = req.body;

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

        console.log("Submitting order to IBKR:", JSON.stringify({ orders: ordersPayload }, null, 2));

        const orderRes = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orders: ordersPayload })
        });

        const respText = await orderRes.text();
        console.log("IBKR Order Response Status:", orderRes.status);
        console.log("IBKR Order Response Body:", respText);

        if (!orderRes.ok) {
          throw new Error(`IBKR trade failed: ${respText}`);
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
            console.error("IBKR order placement failed leg:", failedOrder);
            throw new Error(`IBKR trade placement failed: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`);
          }
        } else if (data && data.error) {
          throw new Error(`IBKR trade failed: ${data.error}`);
        }

        // Auto-reply to warnings if the response is a confirmation array and they are approved
        while (Array.isArray(data) && data.length > 0 && data[0].id) {
          const prompt = data[0];
          console.log(`IBKR returned confirmation prompt "${prompt.id}":`, JSON.stringify(prompt.message));

          const isApproved = prompt.messageIds && prompt.messageIds.every((id: string) => approvedWarnings.includes(id));
          if (!isApproved) {
            console.log(`Prompt "${prompt.id}" contains unapproved messageIds ${JSON.stringify(prompt.messageIds)}. Halting order placement for client approval.`);
            return res.json({ requiresConfirmation: true, prompts: data });
          }

          console.log(`Prompt "${prompt.id}" (messageIds: ${JSON.stringify(prompt.messageIds)}) is already approved. Auto-confirming...`);

          // Send confirmed = true to the reply endpoint
          const replyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${prompt.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmed: true })
          });

          if (!replyRes.ok) {
            const replyErr = await replyRes.text();
            throw new Error(`IBKR trade confirmation reply failed: ${replyErr}`);
          }

          const replyText = await replyRes.text();
          console.log("IBKR confirmation reply response status:", replyRes.status);
          console.log("IBKR confirmation reply response body:", replyText);
          data = JSON.parse(replyText);
        }

        res.json(data);
      } else {
        res.json({ success: true, simulated: true });
      }
    } catch (error: any) {
      console.error("Trade API execution error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/broker/ibkr/reply", async (req, res) => {
    try {
      const { promptId, confirmed } = req.body;
      const url = req.headers["x-ibkr-url"];
      if (!url || typeof url !== 'string') throw new Error("Interactive Brokers Gateway URL is missing.");

      const baseUrl = url.replace(/\/$/, '');
      const approvedWarningsHeader = req.headers["x-approved-ibkr-warnings"];
      const approvedWarnings = approvedWarningsHeader && typeof approvedWarningsHeader === 'string'
        ? approvedWarningsHeader.split(',').map(s => s.trim()).filter(s => s)
        : [];

      console.log(`Submitting user manual reply for prompt "${promptId}" (confirmed: ${confirmed})`);

      const replyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${promptId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed })
      });

      if (!replyRes.ok) {
        const replyErr = await replyRes.text();
        throw new Error(`IBKR trade confirmation reply failed: ${replyErr}`);
      }

      const replyText = await replyRes.text();
      console.log("IBKR manual reply response status:", replyRes.status);
      console.log("IBKR manual reply response body:", replyText);

      let data = JSON.parse(replyText);

      // Auto-reply to subsequent warnings if they are already approved
      while (Array.isArray(data) && data.length > 0 && data[0].id) {
        const prompt = data[0];
        console.log(`IBKR returned subsequent confirmation prompt "${prompt.id}":`, JSON.stringify(prompt.message));

        const isApproved = prompt.messageIds && prompt.messageIds.every((id: string) => approvedWarnings.includes(id));
        if (!isApproved) {
          console.log(`Subsequent prompt "${prompt.id}" requires client approval.`);
          return res.json({ requiresConfirmation: true, prompts: data });
        }

        console.log(`Subsequent prompt "${prompt.id}" is already approved. Auto-confirming...`);

        const nextReplyRes = await fetch(`${baseUrl}/v1/api/iserver/reply/${prompt.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true })
        });

        if (!nextReplyRes.ok) {
          const nextReplyErr = await nextReplyRes.text();
          throw new Error(`IBKR subsequent confirmation reply failed: ${nextReplyErr}`);
        }

        const nextReplyText = await nextReplyRes.text();
        console.log("IBKR subsequent confirmation reply response body:", nextReplyText);
        data = JSON.parse(nextReplyText);
      }

      // Check if final order response has any failed legs
      if (Array.isArray(data)) {
        const failedOrder = data.find(o => o.order_status === "Failed" || o.status === "Failed");
        if (failedOrder) {
          console.error("IBKR order reply finished with failed leg:", failedOrder);
          throw new Error(`IBKR trade placement failed: ${failedOrder.text || failedOrder.warning_message || 'Unknown reason'}`);
        }
      }

      res.json(data);
    } catch (error: any) {
      console.error("IBKR Reply API error:", error);
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

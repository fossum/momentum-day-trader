import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

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

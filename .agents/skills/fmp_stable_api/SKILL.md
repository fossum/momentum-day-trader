---
name: fmp_stable_api
description: "Guides agents on FMP Stable API endpoints, query format parameters, and property mappings."
---

# Financial Modeling Prep (FMP) Stable API Integration Guide

FMP has deprecated legacy `/api/v3/*` endpoints for newly generated API keys, returning a `403 Forbidden` legacy endpoint error. Use the `/stable/*` paths to ensure correct data retrieval.

> [!NOTE]
> For the complete, comprehensive FMP Stable API documentation including parameters, schemas, and alternative endpoints, refer to the local [api-docs.md](file:///mnt/c/development/ericfoss/ai-studio-trader/.agents/skills/fmp_stable_api/references/api-docs.md) reference.

## 1. Quote API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/quote/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/quote?symbol={ticker}&apikey={key}`
* **Field Mapping:** The stable quote endpoint returns the key `"changePercentage"` instead of `"changesPercentage"`. Ensure you map the field for client-side compatibility:
  ```javascript
  changesPercentage: item.changesPercentage !== undefined ? item.changesPercentage : item.changePercentage
  ```
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "price": 316.22,
      "changePercentage": 0.90303,
      "change": 2.83,
      "volume": 44882363,
      "dayLow": 308.16,
      "dayHigh": 316.53,
      "yearHigh": 317.4,
      "yearLow": 201.5,
      "marketCap": 4644435714320,
      "priceAvg50": 296.8762,
      "priceAvg200": 272.1535,
      "exchange": "NASDAQ",
      "open": 310.445,
      "previousClose": 313.39,
      "timestamp": 1783627200
    }
  ]
  ```

## 2. Intraday Historical Charts API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/historical-chart/5min/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/historical-chart/5min?symbol={ticker}&apikey={key}`
* **Format Change:** The ticker must be passed as a query parameter `?symbol={ticker}` instead of a path parameter.
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "date": "2026-07-09 15:55:00",
      "open": 316.21,
      "low": 315.9,
      "high": 316.53,
      "close": 316.18,
      "volume": 1720522
    },
    {
      "date": "2026-07-09 15:50:00",
      "open": 315.75,
      "low": 315.68,
      "high": 316.35,
      "close": 316.23,
      "volume": 684175
    }
  ]
  ```

## 3. Stock News API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/stock_news?tickers={ticker}&limit={limit}&apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/news/stock?symbols={ticker}&limit={limit}&apikey={key}`
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "symbol": "AAPL",
      "publishedDate": "2026-07-09 22:51:00",
      "publisher": "The Motley Fool",
      "title": "Broadcom Is Less Than 5% From the $2 Trillion Club -- and Apple Just Committed $30 Billion for More Chips",
      "image": "https://images.financialmodelingprep.com/news/broadcom-is-less-than-5-from-the-2-trillion-20260709.jpg",
      "site": "fool.com",
      "text": "Broadcom's market value sits within about 5% of $2 trillion. AI semiconductor revenue jumped 143% year over year last quarter and is guided to keep surging.",
      "url": "https://www.fool.com/investing/2026/07/09/broadcom-is-less-than-5-from-the-2-trillion-club-a/"
    }
  ]
  ```

## 4. Top Gainers API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/biggest-gainers?apikey={key}`
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "symbol": "JLHL",
      "price": 12.79,
      "name": "Julong Holding Limited Class A Ordinary Shares",
      "change": 9.73,
      "changesPercentage": 317.97386,
      "exchange": "NASDAQ"
    },
    {
      "symbol": "VRAX",
      "price": 6.36,
      "name": "Virax Biolabs Group Limited",
      "change": 3.18,
      "changesPercentage": 100,
      "exchange": "NASDAQ"
    }
  ]
  ```

## 5. 1-Minute Intraday Historical Charts API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/historical-chart/1min/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/historical-chart/1min?symbol={ticker}&apikey={key}`
* **Format Change:** Same as 5min — the ticker must be passed as a query parameter `?symbol={ticker}` instead of a path parameter.
* **Usage:** Used by the momentum algo pattern detector to fetch 1-minute OHLCV candle data for bull flag detection.
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "date": "2026-07-09 15:59:00",
      "open": 316.07,
      "low": 315.9,
      "high": 316.21,
      "close": 316.18,
      "volume": 60530
    },
    {
      "date": "2026-07-09 15:58:00",
      "open": 316.31,
      "low": 316.06,
      "high": 316.48,
      "close": 316.06,
      "volume": 458354
    }
  ]
  ```

## 6. Shares Float API
* **Stable URL:** `https://financialmodelingprep.com/stable/shares-float?symbol={ticker}&apikey={key}`
* **Fields Returned:** Returns an array containing objects with `floatShares` (actual free float), `outstandingShares` (shares outstanding), and `freeFloat` (percentage float). Used to fetch accurate float information for stock screening.
* **Example JSON Response (Array of objects):**
  ```json
  [
    {
      "symbol": "AAPL",
      "date": "2026-07-07 08:47:25",
      "freeFloat": 99.83099999754891,
      "floatShares": 14662534368,
      "outstandingShares": 14687356000,
      "source": "https://www.sec.gov/Archives/edgar/data/320193/000032019326000013/aapl-20260328.htm"
    }
  ]
  ```

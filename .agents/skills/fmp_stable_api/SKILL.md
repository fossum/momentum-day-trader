---
name: fmp_stable_api
description: "Guides agents on FMP Stable API endpoints, query format parameters, and property mappings."
---

# Financial Modeling Prep (FMP) Stable API Integration Guide

FMP has deprecated legacy `/api/v3/*` endpoints for newly generated API keys, returning a `403 Forbidden` legacy endpoint error. Use the `/stable/*` paths to ensure correct data retrieval.

## 1. Quote API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/quote/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/quote?symbol={ticker}&apikey={key}`
* **Field Mapping:** The stable quote endpoint returns the key `"changePercentage"` instead of `"changesPercentage"`. Ensure you map the field for client-side compatibility:
  ```javascript
  changesPercentage: item.changesPercentage !== undefined ? item.changesPercentage : item.changePercentage
  ```

## 2. Intraday Historical Charts API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/historical-chart/5min/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/historical-chart/5min?symbol={ticker}&apikey={key}`
* **Format Change:** The ticker must be passed as a query parameter `?symbol={ticker}` instead of a path parameter.

## 3. Stock News API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/stock_news?tickers={ticker}&limit={limit}&apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/news/stock?symbols={ticker}&limit={limit}&apikey={key}`

## 4. Top Gainers API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/stock_market/gainers?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/biggest-gainers?apikey={key}`

## 5. 1-Minute Intraday Historical Charts API
* **Legacy URL:** `https://financialmodelingprep.com/api/v3/historical-chart/1min/{ticker}?apikey={key}`
* **Stable URL:** `https://financialmodelingprep.com/stable/historical-chart/1min?symbol={ticker}&apikey={key}`
* **Format Change:** Same as 5min — the ticker must be passed as a query parameter `?symbol={ticker}` instead of a path parameter.
* **Usage:** Used by the momentum algo pattern detector to fetch 1-minute OHLCV candle data for bull flag detection.

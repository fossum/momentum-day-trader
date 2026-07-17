---
name: momentum_algo
description: "Ross Cameron-style momentum day trading algorithm. Defines real-time screener filters, bull flag pattern detection from 1-minute candles, catalyst validation, entry/exit rules, and risk management parameters."
---

# Momentum Day Trading Algo — Code Behavior Specification

## Overview
Write logic to process real-time market data (streaming quotes, 1-minute candle charts, and news) to identify and execute Ross Cameron-style momentum scalping setups. A critical component of this logic is validating the presence of a fundamental news catalyst before confirming any technical breakout.

## 1. Baseline Ticker Filtering (The Screener)
The code must filter incoming live top gainers from the FMP API and only pass a ticker to the setup detection logic if it meets ALL of the following criteria:
*   **Price:** $2.00 <= Price <= $20.00
*   **Float:** < 20,000,000 shares
*   **Daily Gain:** >= 10%
*   **Relative Volume (RVOL):** >= 5x the 14-day average for the current time of day.
*   **Time Window:** Only process signals between 09:30 AM and 11:30 AM EST (default). An `extendedTradingHours` preference allows extending to 4:00 PM EST.

## 2. Catalyst Verification (The News Filter)
Before entering Phase A (Technical Setup), the system must query the FMP news API to confirm a fundamental reason for the volume spike.
*   **Timeframe:** The news must have dropped either in the current day's pre-market or during the current intraday session.
*   **Valid Catalyst Keywords:** Scan the headline and summary for high-impact drivers: "FDA", "Earnings", "Clinical Trial", "Partnership", "Contract", "Acquisition", "Patent", "Merger", "Buyout", "SEC Filing", "Drug Approval", "Phase II", "Phase III", "Revenue", "Guidance", "Agreement", "Cooperation", "Cooperate".
*   **Action:** If no recent, high-impact news catalyst is found, flag the ticker as a "Technical Breakout Only" and abort the trade. The momentum strategy requires a fundamental driver.

## 3. Setup Detection: Bull Flag from 1-Minute Candles
The core logic must analyze 1-minute candle data fetched from the `/api/stock/:ticker/chart/1min` endpoint. Implement state tracking for the following phases:

### Phase A: The Flagpole (Accumulation)
*   Must detect 2 to 3 consecutive 1-minute green candles making new highs.
*   Must detect aggressive volume acceleration on these green candles.
*   Record the peak price of this move as `Resistance_Level`.

### Phase B: The Pullback (Consolidation)
*   Must detect 2 to 4 subsequent 1-minute candles (red or doji) pulling back from `Resistance_Level`.
*   **CRITICAL FILTERING RULE:** The average volume of the pullback candles MUST strictly be less than 50% of the average volume of the Flagpole candles.
*   If pullback volume >= 50% of flagpole volume, clear the state and abandon the ticker (indicates heavy selling pressure).
*   Price must not break below the 9 EMA on the 1-minute timeframe.

## 4. Entry Execution Logic (The Breakout)
The system should prepare to trigger a market order when the News Catalyst is validated, Phase B is successfully completed, and the following conditions are met:
*   **The Trigger:** Fire the entry signal when the current price ticks above `Resistance_Level`.
*   Entry price = breakout price at `Resistance_Level`.

## 5. Risk Management
*   **Stop Loss:** Set at the lowest price of the Phase B pullback candles.
*   **Maximum Stop Distance:** $0.20 per share. If the pullback depth exceeds $0.20, do not take the trade.
*   **Reward:Risk Ratio:** Minimum 2:1. If the distance from entry to the target does not provide at least 2x the stop distance, do not take the trade.
*   **Target Price:** Derived from the 2:1 minimum R:R ratio (entry + 2 × stop distance), or the next resistance level if it provides >= 2:1.

## 6. Failed Breakout Bailout & Scratch Limits
*   **Bailout:** If the price does not surge within the first 2 minutes after entry (price is flat or declining below entry), trigger an immediate bailout exit at market price.
*   **Scratch:** If the setup stalls and fails to hit the target or stop loss within 5 minutes of entry, exit the trade at market price to free up capital.
*   Do not hold a failed breakout hoping it will recover.

## 7. Architecture
*   **Pattern Detection Module:** `src/hooks/usePatternDetector.ts` — Contains all pure-logic functions for EMA, bull flag detection, catalyst validation, stop/target calculation, and trading window checks.
*   **Server Endpoint:** `GET /api/stock/:ticker/chart/1min` — Fetches 1-minute OHLCV candle data from FMP stable API.
*   **Engine State Machine:** `src/components/ExecutionEngine.tsx` — Orchestrates the full pipeline: Scan → Catalyst → Pattern → Entry → Position Tracking (with bailout) → Resolution → Cooldown.

---
name: backtester
description: "Guides agents on backtesting momentum strategy setups. Describes the relationship, shared modules, constants, and date parsing between the simulation and the live execution engine."
---

# Momentum Strategy Backtester & Live Parity

## Overview
This skill outlines the architecture and execution rules for the day trading momentum backtester to maintain strict behavioral parity with the live execution engine. Both systems must utilize the same core modules, parameters, and algorithms to ensure simulation results match actual trading behavior.

## Shared Module: `evaluateSetup`
All buy entrance setup evaluations must be performed through the shared function `evaluateSetup` defined in [evaluation.ts](file:///mnt/c/development/ericfoss/ai-studio-trader/src/lib/momentum/evaluation.ts). This includes the following checklist requirements:
1. **Price Range:** Price must fall within the configured boundaries (default $2.00 to $20.00).
2. **Daily Gain:** Daily gapper gain must be at least the configured threshold (default 10%).
3. **Relative Volume (RVOL):** RVOL = `totalVolumeToday / averageVolume`. 
   - RVOL must be >= 5x by default.
   - **Midday Lull Adjustment:** If the current simulated Eastern Time is after 10:30 AM, the minimum RVOL is scaled to at least 20x.
4. **Shares Float:** Float must be within the configured limit (default 20M shares).
5. **Trading Window:** Trade signals are restricted to the morning window between 9:30 AM and 11:30 AM EST (or extended to 4:00 PM EST if enabled).
6. **Catalyst Keywords:** If keyword validation is enabled, headlines must match high-impact fundamental drivers.
7. **Gemini News Sentiment:** If Gemini validation is enabled, a news headline must exist and be analyzed using the `gemini-2.5-flash` model. Non-positive news or missing catalysts reject the trade.
8. **Bull Flag Pattern:** Re-evaluates 1-minute chronological candles using `analyzeBullFlag` with the specified proximity, flagpole color, and pullback volume/EMA constraints.
9. **Stop Distance:** Validates stop distance (Pullback Low to Entry) is within bounds (default $0.01 to $0.20).
10. **Risk/Reward:** Validates that the profit target meets the minimum R:R ratio (default 2:1).

## Data Parity Rules

### 1. Pre-market Candle Integration
- Always retrieve and retain pre-market candles (04:00 AM to 09:30 AM EST) in the candle array passed to calculations.
- Compute the 9 EMA on the entire set of today's candles (including pre-market) to avoid immature EMA lines at the market open.
- Sum all candles since the beginning of the day (including pre-market) to compute the cumulative daily volume for RVOL calculations.

### 2. Timezone Alignment
- FMP API date strings are returned in Eastern Time (`America/New_York`).
- When parsing candles and checking trading windows, convert dates to Eastern Time explicitly to avoid machine-local timezone shifts.

### 3. Preferences Configuration
- The backtester loads custom preferences from Firebase Firestore for the specified user (e.g. `testuser`) if available.
- If Firebase project context is missing, it falls back to hardcoded defaults which match the standard strategy parameters.

## Simulated Trading & Performance Tracking
The backtest script simulates live trading execution and outputs key performance metrics at completion:
1. **Starting Balance:** Defaults to a simulated `$100,000.00`.
2. **Position Sizing:** Position sizes are determined from `UserPreferences.positionSize` (e.g. `%` of balance or absolute share counts).
3. **P&L Calculations:** Tracks gross profit, gross loss, net P&L, win/loss counts, win rate, and the Profit Factor (Gross Profit / Gross Loss).
4. **Window Exits:** Any position still open at the end of the trading window is closed out at the last candle close price.

